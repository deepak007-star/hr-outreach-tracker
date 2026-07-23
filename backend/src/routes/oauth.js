const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db/database');
const { requireAuth, SECRET } = require('../middleware/auth');
const { encrypt } = require('../services/tokenCrypto');

const router = express.Router();

// ── One-time login-code store ──────────────────────────────────────────────
// Maps code → { userId, role, plan, expiresAt }
// Codes are single-use and expire in 60 seconds — the JWT never touches a URL.
const _loginCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _loginCodes) if (now > v.expiresAt) _loginCodes.delete(k);
}, 60_000);

// gmail.readonly deliberately omitted — full-body read access, and a
// "restricted" scope requiring Google's paid annual CASA security
// assessment before it can be used beyond 100 manually-added test users.
// gmail.metadata is *also* restricted (same CASA requirement to go past the
// 100-test-user cap) but grants only headers/labels, no body — enough for
// Gmail Sync's to/subject/date/reply-detection use case, so it's the
// narrower of the two options. This app currently stays in Google's
// "Testing" publishing status, where restricted scopes work for free for
// up to 100 whitelisted accounts (added in the Cloud Console OAuth consent
// screen) — going past that requires the paid CASA assessment. gmail.send
// is a lighter "sensitive" scope: free verification, no CASA, no 100-user
// cap once verified. See google-oauth-verification/README.md for the full
// tradeoff.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.metadata',
  'openid',
  'email',
  'profile',
];

const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   isProd,
  sameSite: isProd ? 'none' : 'lax',
  maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
  path:     '/',
};

function googleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function isGoogleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ── GET /api/oauth/google/start ────────────────────────────────────────────
// Connect Gmail for an already-logged-in user (Settings / Cold Email tab).
router.get('/google/start', requireAuth, (req, res) => {
  const state = jwt.sign({ userId: req.user.userId, purpose: 'google-oauth' }, SECRET, { expiresIn: '5m' });
  const url = googleClient().generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       GOOGLE_SCOPES,
    state,
  });
  res.json({ url });
});

// ── GET /api/oauth/google/login-start ──────────────────────────────────────
// "Continue with Google" from the login form — no session yet. Signing in
// this way grants the same gmail.send/readonly scopes in the same step, so
// a Google-authenticated user can send outreach mail immediately without a
// separate Settings visit.
router.get('/google/login-start', (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }
  const state = jwt.sign({ purpose: 'google-login' }, SECRET, { expiresIn: '5m' });
  const url = googleClient().generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       GOOGLE_SCOPES,
    state,
  });
  res.json({ url });
});

// ── GET /api/oauth/google/callback ─────────────────────────────────────────
// Shared callback for both flows above — branches on state.purpose.
router.get('/google/callback', async (req, res) => {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { code, state } = req.query;

  let payload;
  try {
    payload = jwt.verify(state, SECRET);
    if (!['google-oauth', 'google-login'].includes(payload.purpose)) throw new Error('bad state');
  } catch {
    return res.redirect(`${frontend}/?oauth_error=${encodeURIComponent('Invalid or expired OAuth state')}`);
  }

  try {
    const client = googleClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token — try disconnecting and reconnecting.');
    }

    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const idInfo = ticket.getPayload();
    const email  = idInfo?.email;
    const name   = idInfo?.name;
    if (!email) throw new Error('Could not read the connected Gmail address.');

    let userId;
    if (payload.purpose === 'google-oauth') {
      userId = payload.userId;
    } else {
      // "Sign in with Google" — find the account by verified email, or create one.
      let user = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
      if (!user) {
        const { cnt } = await db.prepare('SELECT COUNT(*) as cnt FROM users').get();
        const role = parseInt(cnt) === 0 ? 'admin' : 'user';
        // No password is ever set by the user for a Google-created account —
        // store an unguessable random hash so password_hash's NOT NULL is
        // satisfied and password login stays impossible for this account.
        const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        const newId = crypto.randomUUID();
        const displayName = name || email.split('@')[0];
        await db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
          .run(newId, displayName, email.toLowerCase(), randomHash, role);
        await db.prepare('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)').run(newId, displayName);
        user = { id: newId };
      }
      userId = user.id;
    }

    await db.prepare(`
      INSERT INTO oauth_accounts (user_id, provider, email, refresh_token, scope)
      VALUES (?, 'google', ?, ?, ?)
      ON CONFLICT (user_id, provider) DO UPDATE SET
        email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token,
        scope = EXCLUDED.scope, updated_at = EXCLUDED.updated_at
    `).run(userId, email, encrypt(tokens.refresh_token), GOOGLE_SCOPES.join(' '));

    if (payload.purpose === 'google-login') {
      const user = await db.prepare('SELECT role, plan FROM users WHERE id = ?').get(userId);
      const role = user?.role || 'user';
      const plan = user?.plan || 'demo';

      // Issue a short-lived one-time code instead of embedding the JWT in the redirect URL.
      // The frontend will exchange this code (POST /api/oauth/exchange) for the real session token.
      // Code is valid for 60 seconds and is deleted on first use.
      const loginCode = crypto.randomBytes(32).toString('hex');
      _loginCodes.set(loginCode, { userId, role, plan, expiresAt: Date.now() + 60_000 });

      return res.redirect(`${frontend}/?google_login_code=${loginCode}`);
    }

    res.redirect(`${frontend}/?oauth=connected`);
  } catch (err) {
    console.error('[OAuth] Google callback failed:', err.message);
    const errParam = payload.purpose === 'google-login' ? 'google_login_error' : 'oauth_error';
    // Never include raw error messages in redirect URLs — use a generic code
    const safeMsg = encodeURIComponent('Google sign-in failed. Please try again.');
    res.redirect(`${frontend}/?${errParam}=${safeMsg}`);
  }
});

// ── POST /api/oauth/exchange ───────────────────────────────────────────────
// Frontend exchanges the short-lived one-time code from the redirect URL
// for a real 30-day session JWT. Code is deleted immediately after use.
router.post('/exchange', (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code is required.' });
  }
  const entry = _loginCodes.get(code);
  if (!entry) {
    return res.status(401).json({ error: 'Invalid or expired login code. Please sign in again.' });
  }
  if (Date.now() > entry.expiresAt) {
    _loginCodes.delete(code);
    return res.status(401).json({ error: 'Login code expired. Please sign in again.' });
  }
  // Single-use: delete immediately
  _loginCodes.delete(code);

  const sessionToken = jwt.sign(
    { userId: entry.userId, plan: entry.plan, role: entry.role },
    SECRET,
    { expiresIn: '30d' },
  );
  res.cookie('hr_session', sessionToken, COOKIE_OPTS);
  res.json({ token: sessionToken, userId: entry.userId, role: entry.role, plan: entry.plan });
});

// ── GET /api/oauth/status ──────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  const row = await db.prepare(
    "SELECT email FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
  ).get(req.user.userId);
  res.json({ google: { connected: !!row, email: row?.email || null } });
});

// ── DELETE /api/oauth/google ───────────────────────────────────────────────
router.delete('/google', requireAuth, async (req, res) => {
  await db.prepare("DELETE FROM oauth_accounts WHERE user_id = ? AND provider = 'google'").run(req.user.userId);
  res.json({ success: true });
});

module.exports = router;
