'use strict';

// Apply Queue: a semi-automated job-application review list. The pipeline
// (agents/applyQueue.js) ranks/matches already-scraped jobs against the
// user's profile and queues them; every route here only reads/writes
// job_applications + scraped_jobs — nothing ever submits a form or logs
// into a job platform. The user clicks "Apply" (opens the real apply page)
// and then explicitly confirms before a row is marked applied.

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { refreshQueue, ACTIVE_TARGET } = require('../agents/applyQueue');

const router = express.Router();
router.use(requireAuth);

const VALID_SEGMENTS = ['queued', 'applied', 'skipped', 'all'];

// ── GET /api/apply-queue  ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { segment = 'queued', page, limit } = req.query;
  const userId = req.user.userId;
  const seg = VALID_SEGMENTS.includes(segment) ? segment : 'queued';

  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const pageNum  = Math.max(parseInt(page, 10) || 1, 1);
  const offset   = (pageNum - 1) * limitNum;

  const where  = ['ja.user_id = ?'];
  const params = [userId];
  if (seg !== 'all') { where.push('ja.status = ?'); params.push(seg); }
  const whereSql = 'WHERE ' + where.join(' AND ');

  try {
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS total FROM job_applications ja ${whereSql}
    `).get(...params);
    const total = parseInt(countRow?.total, 10) || 0;

    const rows = await db.prepare(`
      SELECT ja.id, ja.status, ja.match_percent, ja.matched_skills, ja.apply_method,
             ja.skip_reason, ja.queued_at, ja.applied_at, ja.skipped_at,
             sj.title, sj.company, sj.location, sj.link, sj.apply_link,
             sj.scraper_type, sj.salary, sj.job_type, sj.description
      FROM job_applications ja
      JOIN scraped_jobs sj ON sj.id = ja.job_id
      ${whereSql}
      ORDER BY ja.match_percent DESC, ja.queued_at DESC, ja.id ASC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    const items = rows.map(r => ({ ...r, matched_skills: JSON.parse(r.matched_skills || '[]') }));
    res.json({ items, total, page: pageNum, limit: limitNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/apply-queue/summary  ───────────────────────────────────────────
router.get('/summary', async (req, res) => {
  const userId = req.user.userId;
  try {
    const rows = await db.prepare(
      `SELECT status, COUNT(*) AS c FROM job_applications WHERE user_id = ? GROUP BY status`
    ).all(userId);
    const counts = { queued: 0, applied: 0, skipped: 0 };
    for (const r of rows) counts[r.status] = parseInt(r.c, 10) || 0;
    const total = counts.queued + counts.applied + counts.skipped;

    const today = new Date().toISOString().slice(0, 10);
    const todayRow = await db.prepare(
      `SELECT COUNT(*) AS c FROM job_applications WHERE user_id = ? AND LEFT(applied_at, 10) = ?`
    ).get(userId, today);

    res.json({
      ...counts,
      total,
      applied_today: parseInt(todayRow?.c, 10) || 0,
      daily_target: ACTIVE_TARGET,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/apply-queue/refresh  ──────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const userId = req.user.userId;
  try {
    const profile = await db.prepare('SELECT skills FROM profiles WHERE user_id = ?').get(userId);
    if (!profile) {
      return res.status(400).json({ error: 'Add skills to your profile first — the queue is built from a skill match.' });
    }
    const result = await refreshQueue(userId, profile);
    if (result.reason === 'no_skills_on_profile') {
      return res.status(400).json({ error: 'Add skills to your profile first — the queue is built from a skill match.' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/apply-queue/:id/apply  ────────────────────────────────────────
// Marks applied and hands back the URL to open — the frontend does the
// window.open, not this route, so a popup-blocked failure is visibly
// distinct from "the click did nothing."
router.post('/:id/apply', async (req, res) => {
  const userId = req.user.userId;
  try {
    const row = await db.prepare(`
      SELECT ja.id, ja.apply_method, sj.apply_link, sj.link
      FROM job_applications ja JOIN scraped_jobs sj ON sj.id = ja.job_id
      WHERE ja.id = ? AND ja.user_id = ?
    `).get(req.params.id, userId);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(
      `UPDATE job_applications SET status = 'applied', applied_at = ? WHERE id = ? AND user_id = ?`
    ).run(now, req.params.id, userId);

    res.json({ ok: true, open_url: row.apply_link || row.link, apply_method: row.apply_method });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/apply-queue/:id/skip  ─────────────────────────────────────────
router.post('/:id/skip', async (req, res) => {
  const userId = req.user.userId;
  const { reason } = req.body || {};
  try {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const result = await db.prepare(
      `UPDATE job_applications SET status = 'skipped', skipped_at = ?, skip_reason = ? WHERE id = ? AND user_id = ?`
    ).run(now, reason || null, req.params.id, userId);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/apply-queue/bulk-skip  ────────────────────────────────────────
router.post('/bulk-skip', async (req, res) => {
  const userId = req.user.userId;
  const { ids, reason } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] required' });
  try {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const result = await db.prepare(
      `UPDATE job_applications SET status = 'skipped', skipped_at = ?, skip_reason = ? WHERE user_id = ? AND id = ANY(?)`
    ).run(now, reason || null, userId, ids);
    res.json({ ok: true, updated: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
