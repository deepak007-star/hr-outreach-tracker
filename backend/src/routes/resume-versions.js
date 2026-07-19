'use strict';

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_VERSIONS = 5;
const NOW = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function parseSkills(json) {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// GET /api/resume-versions
router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT id, user_id, label, target_role, skills, auto_saved, created_at FROM resume_versions WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.userId);
    rows.forEach(r => { r.skills = parseSkills(r.skills); });
    res.json(rows);
  } catch (err) {
    console.error('[resume-versions] GET / error:', err);
    res.status(500).json({ error: 'Failed to load resume versions' });
  }
});

// GET /api/resume-versions/:id/text  — fetch full resume text for a specific version
router.get('/:id/text', async (req, res) => {
  try {
    const row = await db.prepare(
      'SELECT id, label, resume_text, target_role, skills FROM resume_versions WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.userId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    row.skills = parseSkills(row.skills);
    res.json(row);
  } catch (err) {
    console.error('[resume-versions] GET /:id/text error:', err);
    res.status(500).json({ error: 'Failed to load resume version' });
  }
});

// POST /api/resume-versions  — save a new version (auto-prunes oldest if at cap)
router.post('/', async (req, res) => {
  try {
    const { label, resumeText, targetRole, skills, autoSaved = false } = req.body;
    if (!resumeText?.trim()) return res.status(400).json({ error: 'Resume text is required' });

    const userId = req.user.userId;

    // Count existing versions
    const { cnt } = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM resume_versions WHERE user_id = ?'
    ).get(userId);

    // Auto-prune oldest when at cap
    if (cnt >= MAX_VERSIONS) {
      const oldest = await db.prepare(
        'SELECT id FROM resume_versions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1'
      ).get(userId);
      if (oldest) await db.prepare('DELETE FROM resume_versions WHERE id = ?').run(oldest.id);
    }

    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO resume_versions (id, user_id, label, resume_text, target_role, skills, auto_saved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId,
      (label || 'Untitled Version').slice(0, 80),
      resumeText.trim(),
      (targetRole || '').slice(0, 80),
      JSON.stringify(Array.isArray(skills) ? skills : []),
      autoSaved ? 1 : 0,
      NOW(),
    );

    const saved = await db.prepare(
      'SELECT id, user_id, label, target_role, skills, auto_saved, created_at FROM resume_versions WHERE id = ?'
    ).get(id);
    saved.skills = parseSkills(saved.skills);
    res.json(saved);
  } catch (err) {
    console.error('[resume-versions] POST / error:', err);
    res.status(500).json({ error: 'Failed to save resume version' });
  }
});

// PUT /api/resume-versions/:id  — rename label / change target role
router.put('/:id', async (req, res) => {
  try {
    const { label, targetRole } = req.body;
    const { id } = req.params;

    const existing = await db.prepare(
      'SELECT id FROM resume_versions WHERE id = ? AND user_id = ?'
    ).get(id, req.user.userId);
    if (!existing) return res.status(404).json({ error: 'Version not found' });

    const updates = {};
    if (label      !== undefined) updates.label       = String(label).slice(0, 80);
    if (targetRole !== undefined) updates.target_role = String(targetRole).slice(0, 80);
    if (!Object.keys(updates).length) return res.json({ ok: true });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.prepare(
      `UPDATE resume_versions SET ${setClauses} WHERE id = ? AND user_id = ?`
    ).run(...Object.values(updates), id, req.user.userId);

    res.json({ ok: true });
  } catch (err) {
    console.error('[resume-versions] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update version' });
  }
});

// DELETE /api/resume-versions/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.prepare(
      'DELETE FROM resume_versions WHERE id = ? AND user_id = ?'
    ).run(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Version not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[resume-versions] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete version' });
  }
});

// POST /api/resume-versions/suggest
// Body: { jobSkills: string[], jobTitle?: string }
// Returns the best-matching vault version (or null)
router.post('/suggest', async (req, res) => {
  try {
    const { jobSkills = [], jobTitle = '' } = req.body;
    if (!Array.isArray(jobSkills) || jobSkills.length === 0) return res.json({ match: null });

    const rows = await db.prepare(
      'SELECT id, label, target_role, skills, created_at FROM resume_versions WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.userId);

    if (!rows.length) return res.json({ match: null });

    const jobSet = new Set(jobSkills.map(s => s.toLowerCase()));
    let best = null, bestMatchCount = 0, bestScore = 0;

    for (const row of rows) {
      const skills = parseSkills(row.skills);
      const matchCount = skills.filter(s => jobSet.has(s.toLowerCase())).length;
      const score = matchCount / jobSkills.length;
      if (score > bestScore || (score === bestScore && matchCount > bestMatchCount)) {
        best = { ...row, skills };
        bestScore = score;
        bestMatchCount = matchCount;
      }
    }

    if (!best || bestMatchCount === 0) return res.json({ match: null });

    res.json({ match: best, matchCount: bestMatchCount, totalJobSkills: jobSkills.length, score: bestScore });
  } catch (err) {
    console.error('[resume-versions] POST /suggest error:', err);
    res.status(500).json({ error: 'Suggestion failed' });
  }
});

// GET /api/resume-versions/count  — lightweight count for auto-save decision
router.get('/count', async (req, res) => {
  try {
    const { cnt } = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM resume_versions WHERE user_id = ?'
    ).get(req.user.userId);
    res.json({ count: cnt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

module.exports = router;
