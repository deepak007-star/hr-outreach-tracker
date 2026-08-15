const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — own + broadcast, paginated (default 50/page) so
// the bell dropdown can page back through history instead of being capped at
// a hardcoded 50 with no way to see anything older.
router.get('/', requireAuth, async (req, res) => {
  const limitNum = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
  const offset   = Math.max(parseInt(req.query.offset) || 0, 0);
  const countRow = await db.prepare(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? OR user_id IS NULL`
  ).get(req.user.userId);
  const rows = await db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.userId, limitNum, offset);
  const total = parseInt(countRow.count, 10) || 0;
  res.json({ notifications: rows, total, hasMore: offset + rows.length < total });
});

// PATCH /api/notifications/read-all
router.patch('/read-all', requireAuth, async (req, res) => {
  // Only mark the user's own notifications as read — don't touch broadcast rows (user_id IS NULL)
  // so other users still see them as unread.
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?')
    .run(req.user.userId);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read — own notifications only (same rule as
// read-all: broadcast rows, user_id IS NULL, are never touched here so
// marking one user's copy read doesn't hide it from everyone else).
router.patch('/:id/read', requireAuth, async (req, res) => {
  const r = await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Notification not found' });
  res.json({ success: true });
});

// DELETE /api/notifications — clear user's own notifications only (broadcast rows stay)
router.delete('/', requireAuth, async (req, res) => {
  await db.prepare('DELETE FROM notifications WHERE user_id = ?')
    .run(req.user.userId);
  res.json({ success: true });
});

// POST /api/notifications — create for calling user only (user_id in body is ignored for non-admins)
router.post('/', requireAuth, async (req, res) => {
  const { title, body = '', type = 'info' } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const id     = crypto.randomUUID();
  const target = req.user.userId; // always own notifications — prevents cross-user spam
  await db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(id, target, type, title, body);
  res.status(201).json({ id, success: true });
});

module.exports = router;
