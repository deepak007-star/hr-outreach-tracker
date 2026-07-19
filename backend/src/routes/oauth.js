const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db/database');
const { requireAuth, SECRET } = require('../middleware/auth');
const { encrypt } = require('../services/tokenCrypto');

const router = express.Router();

// gmail.readonly deliberately omitted — it's a "restricted" scope that
// requires Google's paid annual CASA security assessment. gmail.send alone
// is a "sensitive" scope: free verification, no CASA. See
// google-oauth-verification/README.md for the full tradeoff.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
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
      const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
      const sessionToken = jwt.sign({ userId, plan: 'demo', role: user.role || 'user' }, SECRET, { expiresIn: '30d' });
      res.cookie('hr_session', sessionToken, COOKIE_OPTS);
      return res.redirect(`${frontend}/?google_login_token=${encodeURIComponent(sessionToken)}`);
    }

    res.redirect(`${frontend}/?oauth=connected`);
  } catch (err) {
    console.error('[OAuth] Google callback failed:', err.message);
    const errParam = payload.purpose === 'google-login' ? 'google_login_error' : 'oauth_error';
    res.redirect(`${frontend}/?${errParam}=${encodeURIComponent(err.message)}`);
  }
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
