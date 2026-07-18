const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — own + broadcast
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.user.userId);
  res.json(rows);
});

// PATCH /api/notifications/read-all
router.patch('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id IS NULL')
    .run(req.user.userId);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// DELETE /api/notifications — clear all for user + broadcasts
router.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ? OR user_id IS NULL')
    .run(req.user.userId);
  res.json({ success: true });
});

// POST /api/notifications — create (authenticated users can create for themselves)
router.post('/', requireAuth, (req, res) => {
  const { title, body = '', type = 'info', user_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const id = crypto.randomUUID();
  const target = user_id !== undefined ? user_id : req.user.userId;
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(id, target, type, title, body);
  res.status(201).json({ id, success: true });
});

module.exports = router;
