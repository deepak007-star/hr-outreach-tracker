const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const db       = require('../db/database');
const { requireAuth, SECRET } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim())     return res.status(400).json({ error: 'Name is required.' });
  if (!email?.trim())    return res.status(400).json({ error: 'Email is required.' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const hash = await bcrypt.hash(password, 10);
  const id   = crypto.randomUUID();

  // First registered user becomes admin
  const { cnt } = await db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  const role = parseInt(cnt) === 0 ? 'admin' : 'user';

  await db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, name.trim(), email.toLowerCase().trim(), hash, role);

  // Create empty profile row
  await db.prepare('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)').run(id, name.trim());

  const token = jwt.sign({ userId: id, plan: 'demo', role }, SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: { id, name: name.trim(), email: email.toLowerCase().trim(), plan: 'demo', role } });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok)  return res.status(401).json({ error: 'Invalid email or password.' });

  const role = user.role || 'user';
  const token = jwt.sign({ userId: user.id, plan: user.plan || 'demo', role }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan || 'demo', role } });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT id, name, email, plan, role, created_at FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

module.exports = router;
