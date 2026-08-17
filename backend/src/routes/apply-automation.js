'use strict';

// Auto-apply configuration: encrypted portal login credentials + the
// screening-question answer bank the worker (agents/autoApplyWorker.js)
// reads before ever submitting a real application. Nothing here launches a
// browser or submits anything — this is config storage only.
//
// Security note: password_encrypted is NEVER returned by any route here,
// including right after it's set — the frontend has no legitimate reason to
// ever re-read a stored password, only to overwrite it.

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { encrypt } = require('../services/tokenCrypto');

const router = express.Router();
router.use(requireAuth);

const VALID_PORTALS = ['naukri', 'instahyre', 'foundit'];

// ── Credentials ──────────────────────────────────────────────────────────────

function maskUsername(u) {
  if (!u) return '';
  if (u.includes('@')) {
    const [local, domain] = u.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return u.length > 4 ? `${u.slice(0, 2)}***${u.slice(-1)}` : '***';
}

// GET /api/apply-automation/credentials
router.get('/credentials', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT portal, username, status, last_login_at, last_login_error, updated_at
      FROM portal_credentials WHERE user_id = ?
    `).all(req.user.userId);
    const byPortal = {};
    for (const r of rows) byPortal[r.portal] = { ...r, username: maskUsername(r.username) };
    res.json({ portals: byPortal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/apply-automation/credentials/:portal  — body { username, password }
router.put('/credentials/:portal', async (req, res) => {
  const { portal } = req.params;
  const { username, password } = req.body || {};
  if (!VALID_PORTALS.includes(portal)) return res.status(400).json({ error: 'Unknown portal' });
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  try {
    const encrypted = encrypt(password);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    // Re-entering credentials always resets status back to 'active' and
    // clears the last error — this is the ONLY way status can go from
    // 'invalid' back to usable; the worker itself never does this.
    await db.prepare(`
      INSERT INTO portal_credentials (user_id, portal, username, password_encrypted, status, last_login_error, updated_at)
      VALUES (?, ?, ?, ?, 'active', NULL, ?)
      ON CONFLICT (user_id, portal) DO UPDATE SET
        username = EXCLUDED.username,
        password_encrypted = EXCLUDED.password_encrypted,
        status = 'active',
        last_login_error = NULL,
        updated_at = EXCLUDED.updated_at
    `).run(req.user.userId, portal, username, encrypted, now);
    res.json({ ok: true, portal, username: maskUsername(username), status: 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/apply-automation/credentials/:portal
router.delete('/credentials/:portal', async (req, res) => {
  const { portal } = req.params;
  try {
    await db.prepare('DELETE FROM portal_credentials WHERE user_id = ? AND portal = ?').run(req.user.userId, portal);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Screening-question answer bank ──────────────────────────────────────────

// GET /api/apply-automation/answers
router.get('/answers', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT id, question_pattern, answer, created_at FROM apply_answer_bank
      WHERE user_id = ? ORDER BY created_at ASC
    `).all(req.user.userId);
    res.json({ answers: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apply-automation/answers  — body { question_pattern, answer }
router.post('/answers', async (req, res) => {
  const { question_pattern, answer } = req.body || {};
  if (!question_pattern?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: 'question_pattern and answer are required' });
  }
  try {
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO apply_answer_bank (id, user_id, question_pattern, answer)
      VALUES (?, ?, ?, ?)
    `).run(id, req.user.userId, question_pattern.trim(), answer.trim());
    res.json({ id, question_pattern: question_pattern.trim(), answer: answer.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/apply-automation/answers/:id
router.put('/answers/:id', async (req, res) => {
  const { question_pattern, answer } = req.body || {};
  if (!question_pattern?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: 'question_pattern and answer are required' });
  }
  try {
    const result = await db.prepare(`
      UPDATE apply_answer_bank SET question_pattern = ?, answer = ?
      WHERE id = ? AND user_id = ?
    `).run(question_pattern.trim(), answer.trim(), req.params.id, req.user.userId);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/apply-automation/answers/:id
router.delete('/answers/:id', async (req, res) => {
  try {
    const result = await db.prepare('DELETE FROM apply_answer_bank WHERE id = ? AND user_id = ?').run(req.params.id, req.user.userId);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
