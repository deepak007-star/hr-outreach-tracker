'use strict';
const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const SINCE_HOURS = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 };

// GET /api/admin/logs?level=error&search=auth&since=24h&limit=100&offset=0
router.get('/', async (req, res) => {
  try {
    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const level  = req.query.level  || null;
    const search = req.query.search || null;
    const since  = req.query.since  || '24h';

    const hours = SINCE_HOURS[since] ?? 24;

    const conds  = [];
    const params = [];

    if (hours) {
      conds.push(`created_at >= ?`);
      params.push(new Date(Date.now() - hours * 3_600_000).toISOString().replace('T', ' ').slice(0, 19));
    }
    if (level) { conds.push('level = ?'); params.push(level); }
    if (search) {
      conds.push(`(message ILIKE ? OR meta ILIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const rows = await db.prepare(
      `SELECT id, level, message, meta, created_at
       FROM activity_logs ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const countRow = await db.prepare(
      `SELECT COUNT(*) AS total FROM activity_logs ${where}`
    ).get(...params);

    res.json({
      logs:   rows,
      total:  parseInt(countRow?.total || 0),
      limit,
      offset,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/logs?days=7  — purge logs older than N days
router.delete('/', async (req, res) => {
  try {
    const days   = Math.max(1, parseInt(req.query.days) || 7);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const result = await db.prepare('DELETE FROM activity_logs WHERE created_at < ?').run(cutoff);
    res.json({ deleted: result.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
