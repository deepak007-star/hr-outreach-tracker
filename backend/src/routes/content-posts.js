'use strict';

// Content AI review/action endpoints: list pending batches, edit, regenerate,
// approve, reject, publish-now, retry-publish, history. Every mutating
// action logs a content_feedback row (log-only today — feeds a future
// learning phase, no logic reads it yet).

const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { buildUserContext } = require('../agents/content/contextBuilder');
const { regenerateCandidate } = require('../agents/content/candidateGenerator');
const { getConfig } = require('../agents/content/orchestrator');
const { publishPost } = require('../agents/content/linkedinPublisher');

const router = express.Router();
router.use(requireAuth);

const VALID_SEGMENTS = ['pending_review', 'approved', 'published', 'rejected', 'failed', 'all'];

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function logFeedback(postId, userId, action, extra = {}) {
  await db.prepare(`
    INSERT INTO content_feedback (id, post_id, user_id, action, instruction, reason, before_content, after_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), postId, userId, action,
    extra.instruction || null, extra.reason || null, extra.before || null, extra.after || null
  );
}

async function getOwnedPost(id, userId) {
  return db.prepare('SELECT * FROM content_posts WHERE id = ? AND user_id = ?').get(id, userId);
}

// ── GET /api/content/posts — paginated list, filter by status ──────────────
router.get('/posts', async (req, res) => {
  const { status = 'pending_review', page, limit } = req.query;
  const userId = req.user.userId;
  const seg = VALID_SEGMENTS.includes(status) ? status : 'pending_review';

  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pageNum - 1) * limitNum;

  const where = ['user_id = ?'];
  const params = [userId];
  if (seg !== 'all') { where.push('status = ?'); params.push(seg); }
  const whereSql = 'WHERE ' + where.join(' AND ');

  try {
    const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM content_posts ${whereSql}`).get(...params);
    const total = parseInt(countRow?.total, 10) || 0;
    const rows = await db.prepare(`
      SELECT * FROM content_posts ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);
    res.json({ items: rows, total, page: pageNum, limit: limitNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/content/posts/pending-batches — entry list for the review UI ──
router.get('/posts/pending-batches', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT batch_id, topic, MIN(created_at) AS created_at, COUNT(*) AS count
      FROM content_posts WHERE user_id = ? AND status = 'pending_review'
      GROUP BY batch_id, topic ORDER BY created_at DESC
    `).all(req.user.userId);
    res.json({ batches: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/content/posts/history ──────────────────────────────────────────
router.get('/posts/history', async (req, res) => {
  const { status = 'all', page, limit } = req.query;
  const userId = req.user.userId;
  const seg = VALID_SEGMENTS.includes(status) ? status : 'all';
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pageNum - 1) * limitNum;

  const where = ['user_id = ?', `status IN ('approved','published','rejected','failed')`];
  const params = [userId];
  if (seg !== 'all') { where.push('status = ?'); params.push(seg); }
  const whereSql = 'WHERE ' + where.join(' AND ');

  try {
    const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM content_posts ${whereSql}`).get(...params);
    const total = parseInt(countRow?.total, 10) || 0;
    const rows = await db.prepare(`
      SELECT * FROM content_posts ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);
    res.json({ items: rows, total, page: pageNum, limit: limitNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/content/posts/batch/:batchId — all variants in one batch ──────
router.get('/posts/batch/:batchId', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT * FROM content_posts WHERE batch_id = ? AND user_id = ? ORDER BY variant_label ASC
    `).all(req.params.batchId, req.user.userId);
    res.json({ posts: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/content/posts/:id — edit content ─────────────────────────────
router.patch('/posts/:id', async (req, res) => {
  const { content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  try {
    const post = await getOwnedPost(req.params.id, req.user.userId);
    if (!post) return res.status(404).json({ error: 'Not found' });

    const history = JSON.parse(post.edit_history || '[]');
    history.push({ ts: nowStr(), before: post.content, after: content.trim() });

    await db.prepare(`UPDATE content_posts SET content = ?, edit_history = ?, updated_at = ? WHERE id = ?`)
      .run(content.trim(), JSON.stringify(history), nowStr(), post.id);
    await logFeedback(post.id, req.user.userId, 'edit', { before: post.content, after: content.trim() });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/content/posts/:id/regenerate — body { instruction } ──────────
router.post('/posts/:id/regenerate', async (req, res) => {
  const { instruction } = req.body || {};
  try {
    const post = await getOwnedPost(req.params.id, req.user.userId);
    if (!post) return res.status(404).json({ error: 'Not found' });

    const context = await buildUserContext(req.user.userId);
    const revised = await regenerateCandidate(post.content, instruction, context);
    if (!revised) return res.status(502).json({ error: 'Regeneration failed — try again' });

    await db.prepare(`
      UPDATE content_posts SET content = ?, regenerate_count = regenerate_count + 1, updated_at = ? WHERE id = ?
    `).run(revised, nowStr(), post.id);
    await logFeedback(post.id, req.user.userId, 'regenerate', { instruction, before: post.content, after: revised });

    res.json({ ok: true, content: revised });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/content/posts/:id/approve — body { scheduled_for? } ──────────
router.post('/posts/:id/approve', async (req, res) => {
  try {
    const post = await getOwnedPost(req.params.id, req.user.userId);
    if (!post) return res.status(404).json({ error: 'Not found' });

    const cfg = await getConfig();
    const scheduledFor = req.body?.scheduled_for || (cfg.auto_publish ? nowStr() : null);
    if (!scheduledFor) return res.status(400).json({ error: 'scheduled_for is required unless auto_publish is enabled' });

    await db.prepare(`
      UPDATE content_posts SET status = 'approved', approved_at = ?, scheduled_for = ?, updated_at = ? WHERE id = ?
    `).run(nowStr(), scheduledFor, nowStr(), post.id);
    await logFeedback(post.id, req.user.userId, 'approve');

    res.json({ ok: true, scheduled_for: scheduledFor });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/content/posts/:id/reject — body { reason } ───────────────────
router.post('/posts/:id/reject', async (req, res) => {
  const { reason } = req.body || {};
  try {
    const post = await getOwnedPost(req.params.id, req.user.userId);
    if (!post) return res.status(404).json({ error: 'Not found' });

    await db.prepare(`
      UPDATE content_posts SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?
    `).run((reason || '').slice(0, 500), nowStr(), post.id);
    await logFeedback(post.id, req.user.userId, 'reject', { reason });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/content/posts/:id/publish-now — bypasses the scheduler ───────
router.post('/posts/:id/publish-now', async (req, res) => {
  try {
    const post = await getOwnedPost(req.params.id, req.user.userId);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.status !== 'approved') return res.status(400).json({ error: `post is not approved (status=${post.status})` });

    res.json({ started: true });
    publishPost(post.id).catch(e => console.error('[ContentAI] publish-now failed:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/content/posts/:id/retry-publish — human-gated, no auto-retry ─
router.post('/posts/:id/retry-publish', async (req, res) => {
  try {
    const post = await getOwnedPost(req.params.id, req.user.userId);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.status !== 'failed') return res.status(400).json({ error: `post did not fail (status=${post.status})` });

    await db.prepare(`
      UPDATE content_posts SET status = 'approved', scheduled_for = ?, publish_error = NULL, updated_at = ? WHERE id = ?
    `).run(nowStr(), nowStr(), post.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
