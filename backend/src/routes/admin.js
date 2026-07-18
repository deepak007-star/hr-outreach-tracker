const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const VALID_ROLES = ['admin', 'user'];
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
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
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

module.exports = router;
