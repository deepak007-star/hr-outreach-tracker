const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — own + broadcast
router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.user.userId);
  res.json(rows);
});

// PATCH /api/notifications/read-all
router.patch('/read-all', requireAuth, async (req, res) => {
  // Only mark the user's own notifications as read — don't touch broadcast rows (user_id IS NULL)
  // so other users still see them as unread.
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?')
    .run(req.user.userId);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', requireAuth, async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
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
