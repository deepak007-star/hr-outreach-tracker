'use strict';

// Content AI pipeline config, GitHub PAT connection, and LinkedIn credential
// CRUD. Mirrors job-intelligence.js's config shape and apply-automation.js's
// credential CRUD shape. password_encrypted/pat_encrypted are never returned
// by any route here — only masked display values.

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { encrypt } = require('../services/tokenCrypto');
const { runContentPipeline, getConfig, saveConfig } = require('../agents/content/orchestrator');

const router = express.Router();

function maskUsername(u) {
  if (!u) return '';
  if (u.includes('@')) {
    const [local, domain] = u.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return u.length > 4 ? `${u.slice(0, 2)}***${u.slice(-1)}` : '***';
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ── Pipeline config (admin) ─────────────────────────────────────────────────

router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const current = await getConfig();
    const updated = { ...current, ...req.body };
    await saveConfig(updated);
    res.json({ ok: true, config: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ started: true, message: 'Content pipeline started in background' });
    runContentPipeline('manual').catch(e => console.error('[ContentAI] Manual run failed:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/runs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.prepare(`SELECT * FROM content_pipeline_runs ORDER BY started_at DESC LIMIT 20`).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GitHub PAT connection (per user) ────────────────────────────────────────

router.get('/github/status', requireAuth, async (req, res) => {
  try {
    const row = await db.prepare(
      'SELECT github_username, last_synced_at, last_error FROM github_integration WHERE user_id = ?'
    ).get(req.user.userId);
    res.json({
      connected: !!row,
      github_username: row?.github_username || null,
      last_synced_at: row?.last_synced_at || null,
      last_error: row?.last_error || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/content/github — body { pat, github_username }
router.put('/github', requireAuth, async (req, res) => {
  const { pat, github_username } = req.body || {};
  if (!pat?.trim() || !github_username?.trim()) {
    return res.status(400).json({ error: 'pat and github_username are required' });
  }
  try {
    const encrypted = encrypt(pat.trim());
    await db.prepare(`
      INSERT INTO github_integration (user_id, pat_encrypted, github_username, last_error, updated_at)
      VALUES (?, ?, ?, NULL, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        pat_encrypted = EXCLUDED.pat_encrypted,
        github_username = EXCLUDED.github_username,
        last_error = NULL,
        updated_at = EXCLUDED.updated_at
    `).run(req.user.userId, encrypted, github_username.trim(), nowStr());
    res.json({ ok: true, github_username: github_username.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/github', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM github_integration WHERE user_id = ?').run(req.user.userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LinkedIn credentials (reuses portal_credentials with portal='linkedin') ─

router.get('/linkedin/credentials', requireAuth, async (req, res) => {
  try {
    const row = await db.prepare(
      `SELECT username, status, last_login_at, last_login_error, updated_at
       FROM portal_credentials WHERE user_id = ? AND portal = 'linkedin'`
    ).get(req.user.userId);
    res.json(row ? { ...row, username: maskUsername(row.username), connected: true } : { connected: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/content/linkedin/credentials — body { username, password }
router.put('/linkedin/credentials', requireAuth, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  try {
    const encrypted = encrypt(password);
    const now = nowStr();
    await db.prepare(`
      INSERT INTO portal_credentials (user_id, portal, username, password_encrypted, status, last_login_error, updated_at)
      VALUES (?, 'linkedin', ?, ?, 'active', NULL, ?)
      ON CONFLICT (user_id, portal) DO UPDATE SET
        username = EXCLUDED.username,
        password_encrypted = EXCLUDED.password_encrypted,
        status = 'active',
        last_login_error = NULL,
        updated_at = EXCLUDED.updated_at
    `).run(req.user.userId, username, encrypted, now);
    res.json({ ok: true, username: maskUsername(username), status: 'active' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/linkedin/credentials', requireAuth, async (req, res) => {
  try {
    await db.prepare(`DELETE FROM portal_credentials WHERE user_id = ? AND portal = 'linkedin'`).run(req.user.userId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
