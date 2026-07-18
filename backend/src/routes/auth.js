const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const db       = require('../db/database');
const { requireAuth, SECRET } = require('../middleware/auth');

const router = express.Router();

// ── Cookie config ──────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,           // not readable by JS — primary XSS protection
  secure:   isProd,         // HTTPS only in production
  sameSite: isProd ? 'none' : 'lax', // 'none' needed for cross-domain in production
  maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days in ms
  path:     '/',
};
const CLEAR_COOKIE_OPTS = { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', path: '/' };

// ── Per-IP auth rate limiter (10 attempts / 15 min) ───────────────────────
const _authAttempts = new Map(); // ip -> { count, resetAt }
function checkAuthRate(ip) {
  const now = Date.now();
  const rec = _authAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    _authAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (rec.count >= 10) return false;
  rec.count++;
  return true;
}
// Clean up old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _authAttempts) if (now > v.resetAt) _authAttempts.delete(k);
}, 60 * 60 * 1000);

function authRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkAuthRate(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
  }
  next();
}

// ── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', authRateLimit, async (req, res) => {
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

  await db.prepare('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)').run(id, name.trim());

  const token = jwt.sign({ userId: id, plan: 'demo', role }, SECRET, { expiresIn: '30d' });
  res.cookie('hr_session', token, COOKIE_OPTS);
  res.status(201).json({ token, user: { id, name: name.trim(), email: email.toLowerCase().trim(), plan: 'demo', role } });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', authRateLimit, async (req, res) => {
  const { email, password } = req.body;
  const identifier = email?.trim();
  if (!identifier || !password?.trim())
    return res.status(400).json({ error: 'Email/username and password are required.' });

  let user = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(identifier.toLowerCase());
  if (!user) {
    user = await db.prepare('SELECT * FROM users WHERE LOWER(name) = ?').get(identifier.toLowerCase());
  }
  if (!user) return res.status(401).json({ error: 'No account found with that email or username.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok)  return res.status(401).json({ error: 'Incorrect password.' });

  const role  = user.role  || 'user';
  const plan  = user.plan  || 'demo';
  const token = jwt.sign({ userId: user.id, plan, role }, SECRET, { expiresIn: '30d' });
  res.cookie('hr_session', token, COOKIE_OPTS);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan, role } });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
// Always issues a fresh token so the session stays alive as long as the user is active
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT id, name, email, plan, role, created_at FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Roll a fresh token — extends the session on every successful /me call
  const freshToken = jwt.sign(
    { userId: user.id, plan: user.plan, role: user.role },
    SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('hr_session', freshToken, COOKIE_OPTS);
  // Return the fresh token in the body so the frontend can update localStorage
  res.json({ ...user, _token: freshToken });
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('hr_session', CLEAR_COOKIE_OPTS);
  res.json({ success: true });
});

// ── PUT /api/auth/change-password ─────────────────────────────────────────
router.put('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both currentPassword and newPassword are required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  if (currentPassword === newPassword)
    return res.status(400).json({ error: 'New password must be different from current password' });

  const hash = await bcrypt.hash(newPassword, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.userId);
  res.json({ ok: true });
});

// ── GET /api/auth/whoami  (admin only) ────────────────────────────────────
const { requireAdmin } = require('../middleware/auth');
router.get('/whoami', requireAuth, requireAdmin, async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Pass ?email=... to check' });
  const user = await db.prepare('SELECT id, name, email, role, plan, created_at FROM users WHERE LOWER(email) = ?').get(email.toLowerCase().trim());
  if (!user) return res.json({ found: false, email, message: 'No row in public.users for this email' });
  res.json({ found: true, ...user });
});

module.exports = router;
