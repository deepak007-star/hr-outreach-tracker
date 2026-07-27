'use strict';
const express       = require('express');
const db            = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { runPipeline, getConfig, saveConfig } = require('../agents/orchestrator');

const router = express.Router();

// ── GET /api/job-intel/postings ── filterable job list ──────────────────────
router.get('/postings', async (req, res) => {
  try {
    const {
      q, source, location, has_email, is_relevant,
      seniority, needs_review, limit = 50, offset = 0,
    } = req.query;

    const conditions = [];
    const params     = [];

    if (q) {
      conditions.push(`(title ILIKE ? OR company ILIKE ? OR description ILIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (source)       { conditions.push(`source = ?`);        params.push(source); }
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

// ── GET /api/job-intel/stats ── dashboard stats ──────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [total, withEmail, relevant, reviewNeeded, lastRun] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as n FROM job_postings`).get(),
      db.prepare(`SELECT COUNT(*) as n FROM job_postings WHERE extracted_emails != '[]'`).get(),
      db.prepare(`SELECT COUNT(*) as n FROM job_postings WHERE is_relevant = 1`).get(),
      db.prepare(`SELECT COUNT(*) as n FROM job_postings WHERE needs_review = 1`).get(),
      db.prepare(`SELECT started_at, finished_at, status, total_fetched, total_new FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`).get(),
    ]);
    res.json({
      total:        parseInt(total?.n) || 0,
      with_email:   parseInt(withEmail?.n) || 0,
      relevant:     parseInt(relevant?.n) || 0,
      review_needed:parseInt(reviewNeeded?.n) || 0,
      last_run:     lastRun || null,
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

// ── POST /api/job-intel/run ── manual trigger (admin only) ───────────────────
router.post('/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ started: true, message: 'Pipeline started in background' });
    runPipeline('manual').catch(e => console.error('[Pipeline] Manual run failed:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

module.exports = router;
