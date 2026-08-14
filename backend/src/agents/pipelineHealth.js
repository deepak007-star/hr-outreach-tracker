'use strict';
const db = require('../db/database');

const SOURCE_HEALTH_KEY = 'job_intel_source_health';
const HEALTH_REPORT_KEY = 'job_intel_health';

/**
 * Self-healing layer for the Job Intel pipeline: after each run, a fixed
 * Snapshot (this run's stats — not live state) is read by a handful of
 * stateless check functions, each emitting 0+ Findings with a severity.
 * A small, reversible action registry fires for the worst findings.
 * Persisted state lives in the existing `settings` key/value table — same
 * pattern as the pre-existing `antibot_status` key, no new table.
 */

async function getSourceHealth() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SOURCE_HEALTH_KEY).catch(() => null);
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}

async function saveSourceHealth(health) {
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(SOURCE_HEALTH_KEY, JSON.stringify(health));
}

async function isSourceDisabled(source) {
  const health = await getSourceHealth();
  return !!health[source]?.disabled;
}

// Reversible from the Admin Panel (routes/job-intelligence.js) — disabling a
// source is never a one-way trip.
async function setSourceDisabled(source, disabled) {
  const health = await getSourceHealth();
  health[source] = {
    ...(health[source] || {}),
    disabled,
    consecutiveFailures: disabled ? (health[source]?.consecutiveFailures || 0) : 0,
  };
  await saveSourceHealth(health);
  return health[source];
}

function buildSnapshot(input) {
  return {
    ts:               new Date().toISOString(),
    sourceStats:      input.sourceStats  || {},
    sourceErrors:     input.sourceErrors || {},
    totalFetched:     input.totalFetched     || 0,
    totalNew:         input.totalNew         || 0,
    freshlyScraped:   input.freshlyScraped   || 0,
    expectedMin:      input.expectedMin      || 0,
    proxyHealth:      input.proxyHealth      || null,
    relevanceKept:    input.relevanceKept    || 0,
    relevanceDropped: input.relevanceDropped || 0,
  };
}

// ── Checks — stateless, each returns 0+ Findings {code, severity, message} ──

function checkProxyPool(snapshot) {
  const ph = snapshot.proxyHealth;
  if (!ph || ph.total === 0 || ph.alive > 0) return [];
  return [{
    code:     'proxy_pool_dead',
    severity: snapshot.freshlyScraped < snapshot.expectedMin ? 'critical' : 'warn',
    message:  `All ${ph.total} configured proxies are dead — scraping direct (IP-block risk).`,
    action:   'triggerProxyRefresh',
  }];
}

// Mutates sourceHealth in place (accumulates consecutive-failure streaks).
// Only real failures (present in sourceErrors) count — a source that
// legitimately returned 0 results this run is not a failure and resets the
// streak, same as a successful non-zero run.
function checkSourceFailures(snapshot, sourceHealth) {
  const findings = [];
  for (const source of Object.keys(snapshot.sourceStats)) {
    const failed = !!snapshot.sourceErrors[source];
    const h = sourceHealth[source] || { consecutiveFailures: 0, disabled: false };
    if (failed) {
      h.consecutiveFailures = (h.consecutiveFailures || 0) + 1;
      h.lastError = snapshot.sourceErrors[source];
    } else {
      h.consecutiveFailures = 0;
      h.lastOkAt = snapshot.ts;
    }
    sourceHealth[source] = h;

    if (failed && h.consecutiveFailures >= 6 && !h.disabled) {
      h.disabled = true;
      findings.push({
        code: 'source_auto_disabled', severity: 'critical', source,
        message: `Source "${source}" failed ${h.consecutiveFailures} consecutive runs (${h.lastError}) — auto-disabled. Re-enable it from Admin Panel → Job Intel Pipeline.`,
      });
    } else if (failed && h.consecutiveFailures >= 3) {
      findings.push({
        code: 'source_failing', severity: 'warn', source,
        message: `Source "${source}" has failed ${h.consecutiveFailures} consecutive runs (${h.lastError}).`,
      });
    }
  }
  return findings;
}

// Mutates sourceHealth in place under a reserved pseudo-source key.
function checkYieldTrend(snapshot, sourceHealth) {
  const KEY = '_yield_trend';
  const h = sourceHealth[KEY] || { consecutiveLow: 0 };
  const low = snapshot.freshlyScraped < snapshot.expectedMin;
  h.consecutiveLow = low ? (h.consecutiveLow || 0) + 1 : 0;
  sourceHealth[KEY] = h;

  if (h.consecutiveLow >= 3) {
    return [{
      code: 'persistent_low_yield', severity: 'critical',
      message: `Live LinkedIn scrape yield has been low for ${h.consecutiveLow} consecutive runs — likely a sustained IP block, not one-off noise.`,
      action: 'triggerProxyRefresh',
    }];
  }
  if (low) {
    return [{ code: 'low_yield', severity: 'info', message: `Low yield this run (${snapshot.freshlyScraped} < expected ${snapshot.expectedMin}).` }];
  }
  return [];
}

// Informational only — no action. A near-100% drop rate usually means the
// keyword/location config is too narrow, not that the filter is broken.
function checkRelevanceDropRate(snapshot) {
  const total = snapshot.relevanceKept + snapshot.relevanceDropped;
  if (total < 20) return [];
  const dropRate = snapshot.relevanceDropped / total;
  if (dropRate > 0.98) {
    return [{
      code: 'relevance_filter_too_strict', severity: 'warn',
      message: `Relevance filter dropped ${snapshot.relevanceDropped}/${total} postings (${(dropRate * 100).toFixed(1)}%) this run — check the keyword/location config isn't too narrow.`,
    }];
  }
  return [];
}

// ── Action registry — small, reversible, best-effort (never throws) ────────

async function triggerProxyRefresh() {
  const proxyFetcher = require('../services/proxyFetcher');
  const result = await proxyFetcher.refresh(db);
  console.log(`[PipelineHealth] Auto-triggered proxy refresh: ${result?.proxies?.length || 0} validated`);
}

const ACTIONS = { triggerProxyRefresh };

async function runHealthChecks(snapshotInput) {
  const snapshot     = buildSnapshot(snapshotInput);
  const sourceHealth = await getSourceHealth();

  const findings = [
    ...checkProxyPool(snapshot),
    ...checkSourceFailures(snapshot, sourceHealth),
    ...checkYieldTrend(snapshot, sourceHealth),
    ...checkRelevanceDropRate(snapshot),
  ];

  await saveSourceHealth(sourceHealth).catch(e => console.warn('[PipelineHealth] saveSourceHealth failed:', e.message));

  // Each distinct action fires at most once per run, regardless of how many
  // findings reference it. A health-action failure is logged, not fatal.
  const acted = new Set();
  for (const f of findings) {
    if (f.action && ACTIONS[f.action] && !acted.has(f.action)) {
      acted.add(f.action);
      await ACTIONS[f.action]().catch(e => console.warn(`[PipelineHealth] action "${f.action}" failed:`, e.message));
    }
  }

  const report = { ts: snapshot.ts, findings, snapshot };
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(HEALTH_REPORT_KEY, JSON.stringify(report)).catch(() => {});

  if (findings.length) {
    console.log(`[PipelineHealth] ${findings.length} finding(s): ${findings.map(f => `${f.severity}:${f.code}`).join(', ')}`);
  }
  return report;
}

module.exports = {
  runHealthChecks, isSourceDisabled, setSourceDisabled, getSourceHealth,
  SOURCE_HEALTH_KEY, HEALTH_REPORT_KEY,
};
