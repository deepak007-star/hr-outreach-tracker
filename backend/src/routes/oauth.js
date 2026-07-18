const express = require('express');
const jwt     = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db/database');
const { requireAuth, SECRET } = require('../middleware/auth');
const { encrypt } = require('../services/tokenCrypto');

const router = express.Router();

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
];

function googleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// ── GET /api/oauth/google/start ────────────────────────────────────────────
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

// ── GET /api/oauth/google/callback ─────────────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { code, state } = req.query;

  let userId;
  try {
    const payload = jwt.verify(state, SECRET);
    if (payload.purpose !== 'google-oauth') throw new Error('bad state');
    userId = payload.userId;
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
    const email = ticket.getPayload()?.email;
    if (!email) throw new Error('Could not read the connected Gmail address.');

    await db.prepare(`
      INSERT INTO oauth_accounts (user_id, provider, email, refresh_token, scope)
      VALUES (?, 'google', ?, ?, ?)
      ON CONFLICT (user_id, provider) DO UPDATE SET
        email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token,
        scope = EXCLUDED.scope, updated_at = EXCLUDED.updated_at
    `).run(userId, email, encrypt(tokens.refresh_token), GOOGLE_SCOPES.join(' '));

    res.redirect(`${frontend}/?oauth=connected`);
  } catch (err) {
    console.error('[OAuth] Google callback failed:', err.message);
    res.redirect(`${frontend}/?oauth_error=${encodeURIComponent(err.message)}`);
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
