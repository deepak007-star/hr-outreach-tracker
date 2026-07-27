const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const db       = require('../db/database');
const { requireAuth, SECRET } = require('../middleware/auth');
const { authLimiter, authSlowDown } = require('../middleware/security');

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
router.post('/register', authLimiter, authSlowDown, authRateLimit, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim())     return res.status(400).json({ error: 'Name is required.' });
  if (!email?.trim())    return res.status(400).json({ error: 'Email is required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Please enter a valid email address.' });
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

  const token = jwt.sign({ userId: id, plan: 'demo', role, tokenVersion: 0 }, SECRET, { expiresIn: '30d' });
  res.cookie('hr_session', token, COOKIE_OPTS);
  res.status(201).json({ token, user: { id, name: name.trim(), email: email.toLowerCase().trim(), plan: 'demo', role } });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', authLimiter, authSlowDown, authRateLimit, async (req, res) => {
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

  const role         = user.role         || 'user';
  const plan         = user.plan         || 'demo';
  const tokenVersion = user.token_version ?? 0;
  const token = jwt.sign({ userId: user.id, plan, role, tokenVersion }, SECRET, { expiresIn: '30d' });
  res.cookie('hr_session', token, COOKIE_OPTS);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan, role } });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
// Always issues a fresh token so the session stays alive as long as the user is active
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT id, name, email, plan, role, token_version, created_at FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Auto-downgrade if paid subscription has expired
  if (user.plan === 'basic' || user.plan === 'advanced') {
    try {
      const sub = await db.prepare(
        "SELECT current_period_end FROM subscriptions WHERE user_id = ? AND status = 'active'"
      ).get(req.user.userId);
      if (sub?.current_period_end) {
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        if (sub.current_period_end < now) {
          await db.prepare(
            "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE user_id = ?"
          ).run(now, req.user.userId);
          await db.prepare("UPDATE users SET plan = 'demo' WHERE id = ?").run(req.user.userId);
          user.plan = 'demo';
          console.log(`[Auth] Subscription expired — downgraded user ${req.user.userId} to demo`);
        }
      }
    } catch (e) {
      console.error('[Auth] Subscription expiry check failed:', e.message);
    }
  }

  // Roll a fresh token — extends the session on every successful /me call
  const freshToken = jwt.sign(
    { userId: user.id, plan: user.plan, role: user.role, tokenVersion: user.token_version ?? 0 },
    SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('hr_session', freshToken, COOKIE_OPTS);
  // Return the fresh token in the body so the frontend can update localStorage.
  // Strip token_version from the client-facing payload — it's an internal revocation field.
  const { token_version: _tv, ...publicUser } = user;
  res.json({ ...publicUser, _token: freshToken });
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
  await db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(hash, req.user.userId);

  // Issue a fresh token with the new version so this session stays alive
  const updated = await db.prepare('SELECT plan, role, token_version FROM users WHERE id = ?').get(req.user.userId);
  const freshToken = jwt.sign(
    { userId: req.user.userId, plan: updated.plan, role: updated.role, tokenVersion: updated.token_version },
    SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('hr_session', freshToken, COOKIE_OPTS);
  res.json({ ok: true, token: freshToken });
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
