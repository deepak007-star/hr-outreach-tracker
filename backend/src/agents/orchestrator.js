'use strict';
const { randomUUID }      = require('crypto');
const db                  = require('../db/database');
const { ingestAll }       = require('./ingestion/index');
const { normalizeAll }    = require('./normalization');
const { deduplicateBatch }= require('./deduplication');
const { extractFromJob }  = require('./extraction');
const { classifyJob }     = require('./classification');
const { storeJob }        = require('./storage');
const { qaCheck }         = require('./qa');

const CONFIG_KEY = 'job_intel_config';

const DEFAULT_CONFIG = {
  enabled:              false,
  run_every_hours:      6,
  keywords:             ['Backend Developer', 'Node.js Developer', 'Java Developer', 'React Developer', 'Frontend Developer'],
  locations:            ['India', 'Remote'],
  greenhouse_companies: [],
  lever_companies:      [],
  adzuna_app_id:        '',
  adzuna_key:           '',
  jooble_key:           '',
  classify:             true,
  min_confidence:       0.5,
};

async function getConfig() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(CONFIG_KEY).catch(() => null);
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(row?.value || '{}') }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

async function saveConfig(cfg) {
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(CONFIG_KEY, JSON.stringify(cfg));
}

let _running = false;

/**
 * Full pipeline run. Safe to call concurrently — will skip if already running.
 * Returns summary { runId, fetched, new: stored, duplicates, errors, durationMs }
 */
async function runPipeline(triggeredBy = 'scheduler') {
  if (_running) return { skipped: true, reason: 'already running' };
  _running = true;

  const runId     = randomUUID();
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const errors    = {};
  let   totalFetched = 0, totalNew = 0, totalDupes = 0;

  console.log(`[Pipeline] Run ${runId} started (trigger: ${triggeredBy})`);

  await db.prepare(`
    INSERT INTO pipeline_runs (id, started_at, status, sources_run) VALUES (?, ?, 'running', '[]')
    ON CONFLICT DO NOTHING
  `).run(runId, startedAt);

  try {
    const cfg = await getConfig();

    // ── 1. Ingestion ───────────────────────────────────────────────────────
    let raw = [], sourceStats = {};
    try {
      ({ raw, sourceStats } = await ingestAll(cfg));
      totalFetched = raw.length;
      console.log(`[Pipeline] Ingested ${totalFetched} raw postings from ${Object.keys(sourceStats).join(', ')}`);
    } catch (e) {
      errors.ingestion = e.message;
    }

    // ── 2. Normalization ───────────────────────────────────────────────────
    const normalized = normalizeAll(raw);
    console.log(`[Pipeline] Normalized: ${normalized.length}`);

    // ── 3. Deduplication ──────────────────────────────────────────────────
    const { unique, duplicateCount } = await deduplicateBatch(normalized);
    totalDupes = duplicateCount;
    console.log(`[Pipeline] Dedup: ${unique.length} unique, ${duplicateCount} duplicates`);

    // ── 4. Extract + Classify + QA + Store (one-by-one with LLM throttle) ─
    const classEnabled = cfg.classify !== false;
    let llmCalls = 0;
    for (const job of unique) {
      try {
        // Extraction
        const extraction = await extractFromJob(job);
        Object.assign(job, extraction);

        // Classification (LLM, throttle 1/sec to respect Groq rate limits)
        let classResult = null;
        if (classEnabled) {
          classResult = await classifyJob(job, cfg);
          if (classResult) {
            Object.assign(job, classResult);
            llmCalls++;
            if (llmCalls % 10 === 0) await new Promise(r => setTimeout(r, 1000));
          }
        }

        // QA
        const qa = qaCheck(job, classResult);
        Object.assign(job, qa);

        // Store
        const outcome = await storeJob(job);
        if (outcome === 'stored') totalNew++;
      } catch (e) {
        errors[`store:${job.source}:${job.external_id}`] = e.message;
      }
    }

    console.log(`[Pipeline] Stored ${totalNew} new postings (${llmCalls} LLM classification calls)`);

    // ── 5. Update run record ───────────────────────────────────────────────
    const finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(`
      UPDATE pipeline_runs SET
        finished_at = ?, status = 'success',
        sources_run = ?, total_fetched = ?, total_new = ?,
        total_duplicates = ?, errors = ?
      WHERE id = ?
    `).run(
      finishedAt,
      JSON.stringify(Object.keys(sourceStats)),
      totalFetched, totalNew, totalDupes,
      JSON.stringify(errors), runId
    );

    // Notification
    await db.prepare(`INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), null, 'info', 'Job Intelligence pipeline completed',
        `Fetched ${totalFetched} postings from ${Object.keys(sourceStats).join(', ')} — ${totalNew} new stored.`);

    const durationMs = Date.now() - new Date(startedAt.replace(' ', 'T') + 'Z').getTime();
    return { runId, fetched: totalFetched, new: totalNew, duplicates: totalDupes, errors, durationMs };

  } catch (e) {
    console.error('[Pipeline] Fatal error:', e.message);
    await db.prepare(`UPDATE pipeline_runs SET status='failed', finished_at=?, errors=? WHERE id=?`)
      .run(new Date().toISOString().replace('T', ' ').slice(0, 19), JSON.stringify({ fatal: e.message }), runId);
    throw e;
  } finally {
    _running = false;
  }
}

/**
 * Schedule the pipeline to run every N hours based on DB config.
 * Called once from index.js after DB is ready.
 */
async function schedulePipeline() {
  const cfg = await getConfig();
  if (!cfg.enabled) {
    console.log('[Pipeline] Disabled — enable via Admin Panel → Job Intel');
    return;
  }

  const intervalMs = Math.max(1, cfg.run_every_hours || 6) * 3_600_000;
  console.log(`[Pipeline] Scheduling every ${cfg.run_every_hours}h`);

  // Run once after 30s to populate on startup, then on interval
  setTimeout(() => runPipeline('startup').catch(e => console.error('[Pipeline] Startup run failed:', e.message)), 30_000);
  setInterval(() => runPipeline('scheduler').catch(e => console.error('[Pipeline] Scheduled run failed:', e.message)), intervalMs);
}

module.exports = { runPipeline, schedulePipeline, getConfig, saveConfig, DEFAULT_CONFIG };
