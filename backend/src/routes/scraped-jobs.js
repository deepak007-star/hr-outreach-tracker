'use strict';

const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/scraped-jobs ────────────────────────────────────────────────────
// Query params: category, since (1d|3d|7d|24d|30d), limit, page, search, scraper

router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      category,
      since    = '7d',
      limit    = '50',
      page     = '1',
      search,
      scraper,
    } = req.query;

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const pageNum  = Math.max(parseInt(page) || 1, 1);
    const offset   = (pageNum - 1) * limitNum;

    // Compute cutoff timestamp based on 'since' param
    function sinceToCutoff(s) {
      const now = Date.now();
      const map = { '1d': 1, '3d': 3, '7d': 7, '24d': 24, '30d': 30 };
      const days = map[s] || 7;
      return new Date(now - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    }

    const cutoff = sinceToCutoff(since);
    const params = [cutoff];
    let q = 'SELECT * FROM scraped_jobs WHERE created_at >= ?';

    if (category) { q += ' AND job_category = ?'; params.push(category); }
    if (scraper)  { q += ' AND scraper_type = ?';  params.push(scraper); }
    if (search) {
      q += ' AND (title ILIKE ? OR company ILIKE ? OR location ILIKE ? OR tags ILIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const countQ  = q.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countRow = await db.prepare(countQ).get(...params);
    const total    = parseInt(countRow?.total || 0);

    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const rows = await db.prepare(q).all(...params);

    res.json({
      jobs:  rows,
      total,
      page:  pageNum,
      limit: limitNum,
      since,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scraped-jobs/stats ──────────────────────────────────────────────

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const d7  = new Date(Date.now() - 7  * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const [total, last30, last7, byCategory] = await Promise.all([
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs').get(),
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs WHERE created_at >= ?').get(d30),
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs WHERE created_at >= ?').get(d7),
      db.prepare('SELECT job_category, COUNT(*) as c FROM scraped_jobs GROUP BY job_category').all(),
    ]);

    res.json({
      total:    parseInt(total?.c || 0),
      last30:   parseInt(last30?.c || 0),
      last7:    parseInt(last7?.c || 0),
      byCategory: Object.fromEntries((byCategory || []).map(r => [r.job_category, parseInt(r.c)])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/scraped-jobs/purge (admin) ─────────────────────────────────────

router.post('/purge', requireAdmin, async (req, res) => {
  try {
    const { retention_days } = req.body;
    const days = Math.max(parseInt(retention_days) || 30, 1);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const result = await db.prepare('DELETE FROM scraped_jobs WHERE created_at < ?').run(cutoff);

    // Update last_purge in settings
    const purgeRow = await db.prepare("SELECT value FROM settings WHERE key = 'purge_config'").get();
    let cfg = {};
    try { cfg = JSON.parse(purgeRow?.value || '{}'); } catch {}
    cfg.last_purge = new Date().toISOString().slice(0, 10);
    cfg.retention_days = days;
    await db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
      .run('purge_config', JSON.stringify(cfg));

    res.json({ deleted: result.changes, cutoff, retention_days: days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
