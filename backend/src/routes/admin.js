'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { decrypt } = require('../services/vaultCrypto');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const VALID_PLANS = ['guest', 'demo', 'basic', 'advanced'];

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const users = await db.prepare(
    'SELECT id, name, email, plan, role, created_at FROM users ORDER BY created_at ASC'
  ).all();
  res.json(users);
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!role?.trim()) return res.status(400).json({ error: 'Role is required' });
  // Verify role exists in DB
  const roleRow = await db.prepare('SELECT id FROM roles WHERE name = ?').get(role);
  if (!roleRow) return res.status(400).json({ error: 'Invalid role — not found in roles table' });
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: "You can't change your own role" });
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/plan
router.put('/users/:id/plan', async (req, res) => {
  const { plan } = req.body;
  if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  await db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: "You can't delete your own account" });
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/password — force-reset any user's login password
router.put('/users/:id/password', async (req, res) => {
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: 'Use change-password to update your own password' });
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = await bcrypt.hash(password, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/vault — list all vault entries across users (passwords omitted)
router.get('/vault', async (req, res) => {
  const rows = await db.prepare(
    `SELECT pv.id, pv.user_id, u.name AS user_name, u.email AS user_email,
            pv.title, pv.username, pv.url, pv.category, pv.notes, pv.created_at
     FROM password_vault pv
     JOIN users u ON u.id = pv.user_id
     ORDER BY u.name, pv.created_at DESC`
  ).all();
  res.json(rows);
});

// GET /api/admin/vault/:id/reveal — admin decrypts any vault entry on demand
router.get('/vault/:id/reveal', async (req, res) => {
  const row = await db.prepare('SELECT * FROM password_vault WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  try {
    const password = decrypt({ iv: row.iv, enc: row.password_enc, tag: row.tag });
    res.json({ password });
  } catch {
    res.status(500).json({ error: 'Decryption failed' });
  }
});

module.exports = router;
