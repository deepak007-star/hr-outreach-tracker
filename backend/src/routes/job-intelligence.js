'use strict';
const express       = require('express');
const jwt           = require('jsonwebtoken');
const db            = require('../db/database');
const { requireAuth, requireAdmin, SECRET } = require('../middleware/auth');
const { runPipeline, syncJobIntelContacts, getConfig, saveConfig, DEFAULT_CONFIG } = require('../agents/orchestrator');
const { tokenize, keywordTokens } = require('../agents/relevanceFilter');
const { categorize, CATEGORY_LABELS } = require('../agents/categorize');
const { lightweightSkillMatch, parseSkills } = require('../lib/skillMatch');
const { getUserSkillEmbeddings, matchAgainstPostingEmbedding } = require('../lib/embeddingMatch');
const DEFAULT_KEYWORDS = require('../agents/defaultKeywords');

const router = express.Router();

// Validates token if present but never blocks — /contacts stays public,
// but a logged-in caller with a Profile gets postings ranked by relevance
// (see relevanceScore below).
function softAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, SECRET); } catch {} }
  next();
}

// Per-posting skill match, embedding tier first (semantic — catches "model
// deployment" ~ "MLOps"), falling back to the free synonym+fuzzy matcher
// (lib/skillMatch.js) whenever an embedding isn't available for this posting
// or for this account (no Groq key, rate-limited, or the embedding model
// isn't enabled on this plan — see embeddingMatch.js's circuit breaker).
// Never throws; always returns a usable {percent, matched, method} shape.
function computeSkillMatch(job, skills, userSkillVectors) {
  if (userSkillVectors && job.embedding) {
    let postingVec = null;
    try { postingVec = JSON.parse(job.embedding); } catch {}
    const embResult = postingVec ? matchAgainstPostingEmbedding(skills, userSkillVectors, postingVec) : null;
    if (embResult) return { ...embResult, method: 'embedding' };
  }
  return { ...lightweightSkillMatch(skills, `${job.title || ''} ${job.description || ''}`), method: 'lightweight' };
}

// Composite relevance score against the user's Profile — NOT a strict
// preference-1/2/3-or-nothing bucket. job_title_1/2/3 contribute the most
// (priority-weighted); skill-match percent (computeSkillMatch above)
// contributes continuously PLUS a step bonus at the 40%/50% thresholds you'd
// recognize as "meaningfully relevant"; a category match adds a flat bonus.
// Every relevant posting still shows (relevanceFilter.js already gated the
// table to keyword-relevant rows at ingestion time) — this only changes ORDER,
// unless the caller explicitly opts into ?min_skill_match=N (see /contacts).
function relevanceScore(job, { prefTitles, skillMatch, skillCategory }) {
  const hay = new Set(tokenize(`${job.title || ''} ${job.description || ''}`.slice(0, 1500)));
  let score = 0;
  let matchedPref = null;

  prefTitles.forEach((title, i) => {
    const toks = keywordTokens(title);
    if (toks.length && toks.every(t => hay.has(t))) {
      score += [30, 20, 10][i] || 5;
      if (matchedPref === null) matchedPref = i + 1;
    }
  });

  const percent = skillMatch?.percent || 0;
  score += percent * 0.3;              // continuous — up to +30 at 100%
  if (percent >= 50) score += 15;      // explicit "meaningfully relevant" bonus
  else if (percent >= 40) score += 8;

  if (job.category && skillCategory && job.category === skillCategory) score += 10;

  return { score, matchedPref };
}

// ── GET /api/job-intel/contacts ── HR contacts extracted from job postings ───
// Always filtered to rows with at least one extracted email.
router.get('/contacts', softAuth, async (req, res) => {
  try {
    const { q, source, category, since, min_skill_match, limit = 50, offset = 0 } = req.query;
    // Also surface phone-only leads (WhatsApp-only hiring posts with no email) —
    // read-only/informational here; they never get synced into the Contacts
    // table since that's an email-outreach tool and these have no real email.
    const conditions = [`(extracted_emails != '[]' OR contact_channel IS NOT NULL)`];
    const params     = [];

    if (q) {
      conditions.push(`(title ILIKE ? OR company ILIKE ? OR extracted_emails ILIKE ? OR extracted_contact_name ILIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (source)   { conditions.push(`source = ?`);   params.push(source); }
    if (category) { conditions.push(`category = ?`); params.push(category); }
    if (since) {
      const days   = parseInt(since) || 30;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
      conditions.push(`fetched_at >= ?`);
      params.push(cutoff);
    }

    const where  = `WHERE ${conditions.join(' AND ')}`;
    const cap    = Math.min(parseInt(limit) || 50, 200);
    const off    = parseInt(offset) || 0;

    // Personalization: a logged-in user with a Profile (preferred roles and/or
    // skills) sees relevant postings ranked first — pulls a bounded working
    // set and re-ranks in JS (job_postings is a personal-scale table, not
    // millions of rows) rather than a per-user dynamic SQL ORDER BY.
    let relevanceInputs = null;
    if (req.user?.userId) {
      const profile = await db.prepare(
        `SELECT job_title_1, job_title_2, job_title_3, skills FROM profiles WHERE user_id = ?`
      ).get(req.user.userId).catch(() => null);
      const prefTitles = [profile?.job_title_1, profile?.job_title_2, profile?.job_title_3].filter(Boolean);
      const skills = parseSkills(profile?.skills);

      if (prefTitles.length || skills.length) {
        const skillCategory = skills.length ? categorize({ title: skills.join(' '), description: '' }) : null;
        relevanceInputs = { prefTitles, skills, skillCategory };
      }
    }

    // Editing skills in Profile changes nothing here except the input to this
    // request — there's no cached/precomputed personalization state to reset.
    // The only cache in this path is a per-user Groq skill-embedding cache
    // (lib/embeddingMatch.js), keyed by a hash of the skills list itself, so
    // it self-invalidates the moment the list actually changes.
    const userSkillVectors = relevanceInputs?.skills.length
      ? await getUserSkillEmbeddings(req.user.userId, relevanceInputs.skills).catch(() => null)
      : null;

    const minSkillMatch = relevanceInputs?.skills.length && min_skill_match != null ? parseInt(min_skill_match) : null;

    const [rowsRaw, countRow] = await Promise.all([
      relevanceInputs
        ? db.prepare(`SELECT * FROM job_postings ${where} ORDER BY fetched_at DESC LIMIT 500`).all(...params)
        : db.prepare(`SELECT * FROM job_postings ${where} ORDER BY fetched_at DESC, posted_at DESC NULLS LAST LIMIT ? OFFSET ?`).all(...params, cap, off),
      db.prepare(`SELECT COUNT(*) as n FROM job_postings ${where}`).get(...params),
    ]);

    let rows = rowsRaw;
    let total = parseInt(countRow?.n) || 0;
    if (relevanceInputs) {
      let ranked = rowsRaw.map(r => {
        const skillMatch = relevanceInputs.skills.length
          ? computeSkillMatch(r, relevanceInputs.skills, userSkillVectors)
          : null;
        const rel = relevanceScore(r, { prefTitles: relevanceInputs.prefTitles, skillMatch, skillCategory: relevanceInputs.skillCategory });
        return { ...r, _rel: rel, _skillMatch: skillMatch };
      });

      // Opt-in only — filtering by skill match is a deliberate choice via
      // ?min_skill_match=N, not the default. Everything relevant still shows
      // otherwise. Note: since this filters the bounded 500-row working set,
      // `total` becomes an approximation capped at that set when active.
      if (minSkillMatch != null && !Number.isNaN(minSkillMatch)) {
        ranked = ranked.filter(r => (r._skillMatch?.percent || 0) >= minSkillMatch);
        total = ranked.length;
      }

      rows = ranked
        .sort((a, b) => b._rel.score - a._rel.score) // stable sort — keeps fetched_at DESC order within a tie
        .slice(off, off + cap)
        .map(({ _rel, _skillMatch, ...r }) => ({
          ...r,
          preference_match: (_rel.score > 0 || (_skillMatch?.percent || 0) > 0)
            ? {
                score: _rel.score,
                preference: _rel.matchedPref,
                skillMatchPercent: _skillMatch?.percent || 0,
                skillMatchMethod: _skillMatch?.method || null,
                matchedSkills: _skillMatch?.matched || [],
              }
            : null,
        }));
    }

    // Parse emails array for each row; strip the raw embedding blob (internal-only, large)
    const contacts = rows.map(({ embedding, ...r }) => ({
      ...r,
      emails: (() => { try { return JSON.parse(r.extracted_emails); } catch { return []; } })(),
    }));

    res.json({ total, limit: cap, offset: off, contacts, personalized: !!relevanceInputs });
  } catch (e) {
    console.error('[Job Intel] /contacts error:', e.message);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// ── GET /api/job-intel/status-badge ── lightweight, non-admin health signal ──
// The full /health report below is admin-only (source-level detail), but a
// solo user browsing the app has no way to tell scraping is degraded without
// opening the Job Intel tab. This exposes just the ok/low_yield/proxy_pool_dead
// flag so the main nav can show a badge.
router.get('/status-badge', async (req, res) => {
  try {
    const row = await db.prepare(`SELECT value FROM settings WHERE key = 'antibot_status'`).get();
    let parsed = null;
    try { parsed = JSON.parse(row?.value || 'null'); } catch {}
    res.json({ status: parsed?.status || 'ok' });
  } catch (e) {
    res.json({ status: 'ok' });
  }
});

// ── GET /api/job-intel/categories ── distinct tech-stack category list + counts ──
router.get('/categories', async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT category, COUNT(*) as count FROM job_postings WHERE extracted_emails != '[]' AND category IS NOT NULL GROUP BY category ORDER BY count DESC`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/job-intel/category-yield ── which categories actually convert ──
// Was previously admin-only visibility (buried in the Admin Panel's health
// card) — surfaced here too so the person actually browsing Job Intel
// contacts can see which categories/keywords are worth focusing on next.
router.get('/category-yield', softAuth, async (req, res) => {
  try {
    const { getYieldWeights, getOutcomeWeights, getStats } = require('../lib/categoryYield');
    const [stats, emailYield, outcomeYield] = await Promise.all([getStats(), getYieldWeights(), getOutcomeWeights()]);
    const rows = Object.keys(stats).map(cat => ({
      category:      cat,
      label:          CATEGORY_LABELS[cat] || cat,
      scanned:        stats[cat].scanned,
      withEmail:      stats[cat].withEmail,
      emailYieldPct:  Math.round((emailYield[cat] || 0) * 100),
      outcomeScore:   outcomeYield[cat] != null ? Math.round(outcomeYield[cat] * 100) : null,
    })).sort((a, b) => b.scanned - a.scanned);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/job-intel/postings ── filterable job list ──────────────────────
router.get('/postings', async (req, res) => {
  try {
    const {
      q, source, location, category, has_email, is_relevant,
      seniority, needs_review, limit = 50, offset = 0,
    } = req.query;

    const conditions = [];
    const params     = [];

    if (q) {
      conditions.push(`(title ILIKE ? OR company ILIKE ? OR description ILIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (source)       { conditions.push(`source = ?`);        params.push(source); }
    if (category)     { conditions.push(`category = ?`);     params.push(category); }
    if (location)     { conditions.push(`location ILIKE ?`);  params.push(`%${location}%`); }
    if (has_email === 'true')  { conditions.push(`extracted_emails != '[]'`); }
    if (is_relevant === 'true')  { conditions.push(`is_relevant = 1`); }
    if (is_relevant === 'false') { conditions.push(`is_relevant = 0`); }
    if (seniority)    { conditions.push(`seniority = ?`);     params.push(seniority); }
    if (needs_review === 'true') { conditions.push(`needs_review = 1`); }

    const where   = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const cap     = Math.min(parseInt(limit) || 50, 200);
    const off     = parseInt(offset) || 0;

    const [rows, countRow] = await Promise.all([
      db.prepare(`SELECT * FROM job_postings ${where} ORDER BY fetched_at DESC LIMIT ? OFFSET ?`)
        .all(...params, cap, off),
      db.prepare(`SELECT COUNT(*) as n FROM job_postings ${where}`)
        .get(...params),
    ]);

    res.json({ total: parseInt(countRow?.n) || 0, limit: cap, offset: off, jobs: rows });
  } catch (e) {
    console.error('[Job Intel] /postings error:', e.message);
    res.status(500).json({ error: 'Failed to load job postings' });
  }
});

// ── GET /api/job-intel/sources ── distinct source list + counts ──────────────
router.get('/sources', async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT source, COUNT(*) as count FROM job_postings GROUP BY source ORDER BY count DESC`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/job-intel/stats ── contact-centric dashboard stats ──────────────
router.get('/stats', async (req, res) => {
  try {
    const [total, today, week, lastRun] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as n FROM job_postings WHERE extracted_emails != '[]'`).get(),
      db.prepare(`SELECT COUNT(*) as n FROM job_postings WHERE extracted_emails != '[]' AND fetched_at >= ?`)
        .get(new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19)),
      db.prepare(`SELECT COUNT(*) as n FROM job_postings WHERE extracted_emails != '[]' AND fetched_at >= ?`)
        .get(new Date(Date.now() - 7 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)),
      db.prepare(`SELECT started_at, finished_at, status, total_fetched, total_new FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`).get(),
    ]);
    res.json({
      total:    parseInt(total?.n)  || 0,
      today:    parseInt(today?.n)  || 0,
      this_week:parseInt(week?.n)   || 0,
      last_run: lastRun || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/job-intel/runs ── recent pipeline run history (admin) ────────────
router.get('/runs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 20`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/job-intel/health ── self-healing findings + per-source status (admin) ──
router.get('/health', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { getSourceHealth, HEALTH_REPORT_KEY } = require('../agents/pipelineHealth');
    const [reportRow, sourceHealth, syncErrorRow] = await Promise.all([
      db.prepare(`SELECT value FROM settings WHERE key = ?`).get(HEALTH_REPORT_KEY).catch(() => null),
      getSourceHealth(),
      db.prepare(`SELECT value FROM settings WHERE key = 'job_intel_sync_error'`).get().catch(() => null),
    ]);
    let report = null;
    try { report = JSON.parse(reportRow?.value || 'null'); } catch {}
    let syncError = null;
    try { syncError = JSON.parse(syncErrorRow?.value || 'null'); } catch {}
    res.json({ report, sources: sourceHealth, syncError });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/job-intel/extraction-quality ── anomaly agent's blocklist + flagged-count reconciliation (admin) ──
router.get('/extraction-quality', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { getBlocklist, QUALITY_REPORT_KEY } = require('../agents/extractionQuality');
    const [blocklist, reportRow] = await Promise.all([
      getBlocklist(),
      db.prepare(`SELECT value FROM settings WHERE key = ?`).get(QUALITY_REPORT_KEY).catch(() => null),
    ]);
    let flaggedReport = null;
    try { flaggedReport = JSON.parse(reportRow?.value || 'null'); } catch {}
    res.json({ blocklist, flaggedReport });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/job-intel/extraction-quality/:type/:value ── un-block a learned address/domain (admin) ──
// Reversible, same pattern as pipelineHealth's source disable — the agent's
// learned calls are never a one-way trip; a false positive can be undone.
router.delete('/extraction-quality/:type/:value', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { getBlocklist } = require('../agents/extractionQuality');
    const { type, value } = req.params;
    if (!['emails', 'domains'].includes(type)) return res.status(400).json({ error: 'type must be "emails" or "domains"' });
    const bl = await getBlocklist();
    delete bl[type][decodeURIComponent(value).toLowerCase()];
    await db.prepare(`
      INSERT INTO settings (key, value) VALUES ('extraction_blocklist', ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `).run(JSON.stringify(bl));
    res.json({ ok: true, blocklist: bl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/job-intel/health/sources/:source ── enable/disable a source (admin) ──
// Reversible — an auto-disabled source (see pipelineHealth.js checkSourceFailures)
// is never a one-way trip.
router.patch('/health/sources/:source', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { setSourceDisabled } = require('../agents/pipelineHealth');
    const disabled = !!req.body.disabled;
    const result = await setSourceDisabled(req.params.source, disabled);
    res.json({ ok: true, source: req.params.source, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/job-intel/sync-contacts ── manual sync to contacts (admin) ──────
router.post('/sync-contacts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const synced = await syncJobIntelContacts();
    res.json({ ok: true, synced, message: `${synced} contact(s) added/updated in your Contacts page` });
  } catch (e) {
    console.error('[Job Intel] sync-contacts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/job-intel/run ── manual trigger (admin only) ───────────────────
router.post('/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ started: true, message: 'Pipeline started in background' });
    runPipeline('manual').catch(e => console.error('[Pipeline] Manual run failed:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/job-intel/run-full ── alias for /run — pipeline now embeds scraping ─
// The pipeline (runPipeline) now actively scrapes LinkedIn Feed at the start of
// every run, so a separate scrape step is no longer needed. This endpoint is kept
// for backwards compatibility with the Admin Panel button.
router.post('/run-full', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ started: true, message: 'Pipeline started — will scrape LinkedIn Feed fresh data first (5-20 min), then extract HR contacts. Check run history.' });
    runPipeline('manual-full').catch(e => console.error('[Pipeline] manual-full failed:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/job-intel/default-keywords ── recommended keyword list (admin) ──
// Read-only reference list — a config already saved to the DB won't pick up
// changes to DEFAULT_CONFIG.keywords automatically, so the Admin Panel offers
// a "Load recommended list" button backed by this endpoint.
router.get('/default-keywords', requireAuth, requireAdmin, async (req, res) => {
  res.json({ keywords: DEFAULT_KEYWORDS });
});

// ── GET /api/job-intel/default-companies ── recommended Greenhouse/Lever seed lists (admin) ──
// Same reasoning as /default-keywords — live-verified working slugs (2026-08-15),
// won't retroactively apply to an already-saved config.
router.get('/default-companies', requireAuth, requireAdmin, async (req, res) => {
  res.json({ greenhouse: DEFAULT_CONFIG.greenhouse_companies, lever: DEFAULT_CONFIG.lever_companies });
});

// ── GET /api/job-intel/config ── get pipeline config ─────────────────────────
router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/job-intel/config ── save pipeline config ────────────────────────
router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const current = await getConfig();
    const updated = { ...current, ...req.body };
    await saveConfig(updated);
    res.json({ ok: true, config: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/job-intel/postings ── purge old postings (admin) ─────────────
router.delete('/postings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { older_than_days = 30 } = req.query;
    const cutoff = new Date(Date.now() - parseInt(older_than_days) * 86_400_000)
      .toISOString().replace('T', ' ').slice(0, 19);
    const result = await db.prepare(`DELETE FROM job_postings WHERE fetched_at < ?`).run(cutoff);
    res.json({ deleted: result.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/job-intel/postings/:id/review ── mark reviewed (admin) ────────
router.patch('/postings/:id/review', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.prepare(`UPDATE job_postings SET needs_review = 0, review_reason = NULL WHERE id = ?`)
      .run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Auto-proxy: fetch + validate free proxies for the scraper ────────────────
const proxyFetcher = require('../services/proxyFetcher');

// GET /api/job-intel/proxy-auto — config + last-refresh stats (admin)
router.get('/proxy-auto', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = await proxyFetcher.getConfig(db);
    const cache  = await proxyFetcher.getCache(db);
    res.json({ config, lastRefresh: cache.ts || null, count: cache.proxies?.length || 0, stats: cache.stats || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/job-intel/proxy-auto — update config (enabled, sources, webshareApiKey…) (admin)
router.put('/proxy-auto', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = await proxyFetcher.saveConfig(db, req.body || {});
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/job-intel/proxy-auto/refresh — fetch + validate now (admin)
router.post('/proxy-auto/refresh', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cache = await proxyFetcher.refresh(db);
    res.json({ ok: true, lastRefresh: cache.ts, count: cache.proxies.length, stats: cache.stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
