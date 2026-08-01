'use strict';

const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const https   = require('https');
const http    = require('http');
const multer  = require('multer');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { putResumeFile, getResumeFile, copyResumeFile, deleteResumeFile } = require('../services/resumeFiles');

const router = express.Router();
router.use(requireAuth);

const MAX_VERSIONS = 5;
const NOW = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ── File storage helpers ───────────────────────────────────────────────────────

const RESUME_DIR = path.join(__dirname, '../../uploads/resumes');
if (!fs.existsSync(RESUME_DIR)) fs.mkdirSync(RESUME_DIR, { recursive: true });

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024 } });

function storeVaultFile(tmpPath, userId, ext) {
  const userDir = path.join(RESUME_DIR, userId);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const dest = path.join(userDir, `${crypto.randomUUID()}${ext}`);
  fs.copyFileSync(tmpPath, dest);
  return dest;
}

async function parseFileToText(filePath, ext) {
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(filePath));
    return { text: data.text, mimeType: 'application/pdf' };
  }
  if (ext === '.docx' || ext === '.doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (ext === '.txt') {
    return { text: fs.readFileSync(filePath, 'utf8'), mimeType: 'text/plain' };
  }
  throw new Error('Unsupported file type. Use PDF, DOCX, or TXT.');
}

function getDriveFileId(url) {
  const m1 = (url || '').match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = (url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

function fetchUrl(urlStr, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Too many redirects'));
    const lib = urlStr.startsWith('https') ? https : http;
    const req = lib.get(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function saveVaultVersion(userId, text, storedPath, mimeType, label, targetRole, isAtsTemplate = false, fileId = null, skills = null) {
  const { cnt } = await db.prepare(
    'SELECT COUNT(*) AS cnt FROM resume_versions WHERE user_id = ?'
  ).get(userId);
  if (cnt >= MAX_VERSIONS) await pruneOldest(userId);
  const id = crypto.randomUUID();
  // Use explicit skills when supplied (e.g. Analyzer's job+resume skills), else the profile's
  const profileSkills = Array.isArray(skills)
    ? JSON.stringify(skills)
    : ((await db.prepare('SELECT skills FROM profiles WHERE user_id = ?').get(userId))?.skills || '[]');
  await db.prepare(`
    INSERT INTO resume_versions (id, user_id, label, resume_text, target_role, skills, auto_saved, file_path, mime_type, is_ats_template, file_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(id, userId, label.slice(0, 80), text.trim(), (targetRole || '').slice(0, 80), profileSkills, storedPath, mimeType, isAtsTemplate ? 1 : 0, fileId, NOW());
  const saved = await db.prepare(
    'SELECT id, user_id, label, target_role, skills, auto_saved, created_at, mime_type, is_ats_template FROM resume_versions WHERE id = ?'
  ).get(id);
  saved.skills = parseSkills(saved.skills);
  saved.has_file = !!fileId || !!(storedPath && fs.existsSync(storedPath));
  return saved;
}

// Delete the oldest vault version for a user, including its stored file bytes.
async function pruneOldest(userId) {
  const oldest = await db.prepare(
    'SELECT id, file_id FROM resume_versions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1'
  ).get(userId);
  if (!oldest) return;
  await db.prepare('DELETE FROM resume_versions WHERE id = ?').run(oldest.id);
  await deleteResumeFile(oldest.file_id);
}

function parseSkills(json) {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// GET /api/resume-versions
router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT id, user_id, label, target_role, skills, auto_saved, created_at, mime_type, file_path, file_id, is_ats_template FROM resume_versions WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.userId);
    rows.forEach(r => {
      r.skills   = parseSkills(r.skills);
      r.has_file = !!r.file_id || !!(r.file_path && fs.existsSync(r.file_path));
      delete r.file_path;
      delete r.file_id;
    });
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
    const { label, resumeText, targetRole, skills, autoSaved = false, filePath, mimeType, fromProfile } = req.body;
    if (!resumeText?.trim()) return res.status(400).json({ error: 'Resume text is required' });

    const userId = req.user.userId;

    // When saving from the profile's current resume, carry over its stored file
    // (DB bytes preferred; legacy disk path kept for backward-compat).
    let actualFilePath = filePath || null;
    let actualMimeType = mimeType || null;
    let fileId         = null;
    if (fromProfile) {
      const prof = await db.prepare('SELECT resume_file_path, resume_mime_type, resume_file_id FROM profiles WHERE user_id = ?').get(userId);
      if (prof?.resume_file_id) {
        fileId = await copyResumeFile(prof.resume_file_id, userId);   // independent copy for this version
        actualMimeType = prof.resume_mime_type || actualMimeType;
      }
      if (prof?.resume_file_path && fs.existsSync(prof.resume_file_path)) {
        actualFilePath = prof.resume_file_path;
        actualMimeType = prof.resume_mime_type || actualMimeType;
      }
    }

    // Auto-prune oldest when at cap (also frees its stored bytes)
    const { cnt } = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM resume_versions WHERE user_id = ?'
    ).get(userId);
    if (cnt >= MAX_VERSIONS) await pruneOldest(userId);

    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO resume_versions (id, user_id, label, resume_text, target_role, skills, auto_saved, file_path, mime_type, file_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId,
      (label || 'Untitled Version').slice(0, 80),
      resumeText.trim(),
      (targetRole || '').slice(0, 80),
      JSON.stringify(Array.isArray(skills) ? skills : []),
      autoSaved ? 1 : 0,
      actualFilePath,
      actualMimeType,
      fileId,
      NOW(),
    );

    const saved = await db.prepare(
      'SELECT id, user_id, label, target_role, skills, auto_saved, created_at, mime_type FROM resume_versions WHERE id = ?'
    ).get(id);
    saved.skills   = parseSkills(saved.skills);
    saved.has_file = !!fileId || !!(actualFilePath && fs.existsSync(actualFilePath));
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
    const row = await db.prepare(
      'SELECT file_id FROM resume_versions WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.userId);
    const result = await db.prepare(
      'DELETE FROM resume_versions WHERE id = ? AND user_id = ?'
    ).run(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Version not found' });
    await deleteResumeFile(row?.file_id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[resume-versions] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete version' });
  }
});

// POST /api/resume-versions/upload  — upload a resume file from device
router.post('/upload', upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { label = '', targetRole = '', isAtsTemplate = '0', skills: skillsRaw } = req.body;
  let skills = null;
  if (skillsRaw) { try { const p = JSON.parse(skillsRaw); if (Array.isArray(p)) skills = p; } catch {} }
  const userId = req.user.userId;
  const tmpPath = req.file.path;
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const cleanup = () => { try { fs.unlinkSync(tmpPath); } catch {} };
  try {
    if (!['.pdf', '.docx', '.doc', '.txt'].includes(ext)) {
      cleanup();
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, or TXT.' });
    }
    // Text extraction is best-effort — store the file even if it fails (scanned/image PDFs)
    let text = '', mimeType = 'application/octet-stream';
    try {
      const parsed = await parseFileToText(tmpPath, ext);
      text     = parsed.text     || '';
      mimeType = parsed.mimeType || mimeType;
    } catch {
      mimeType = ext === '.pdf'  ? 'application/pdf'
        : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : ext === '.doc'  ? 'application/msword'
        : 'text/plain';
    }
    const fileBuffer = fs.readFileSync(tmpPath);
    const storedPath = storeVaultFile(tmpPath, userId, ext);
    cleanup();
    const storedFileId = await putResumeFile(userId, fileBuffer, mimeType, req.file.originalname);
    const finalLabel = (label.trim() || req.file.originalname || 'Uploaded Resume').slice(0, 80);
    const saved = await saveVaultVersion(userId, text, storedPath, mimeType, finalLabel, targetRole, isAtsTemplate === '1', storedFileId, skills);
    res.json(saved);
  } catch (err) {
    cleanup();
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
});

// POST /api/resume-versions/from-drive  — import from a public Google Drive share link
router.post('/from-drive', async (req, res) => {
  const { driveUrl, label = '', targetRole = '' } = req.body;
  if (!driveUrl?.trim()) return res.status(400).json({ error: 'Drive URL is required' });
  const fileId = getDriveFileId(driveUrl);
  if (!fileId) return res.status(400).json({ error: 'Could not extract file ID. Use a standard Google Drive share link.' });
  const userId = req.user.userId;
  let tmpPath = null;
  try {
    const downloadLink = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    const { buffer, contentType } = await fetchUrl(downloadLink);
    let ext = '.pdf';
    if (contentType.includes('wordprocessingml') || contentType.includes('msword')) ext = '.docx';
    else if (contentType.includes('text/plain')) ext = '.txt';
    tmpPath = path.join(os.tmpdir(), `drive-${crypto.randomUUID()}${ext}`);
    fs.writeFileSync(tmpPath, buffer);
    const { text, mimeType } = await parseFileToText(tmpPath, ext);
    if (!text?.trim()) return res.status(400).json({ error: 'Could not extract text. Make sure the file is a PDF or DOCX and publicly shared.' });
    const storedPath = storeVaultFile(tmpPath, userId, ext);
    const finalLabel = (label.trim() || 'Drive Import').slice(0, 80);
    const storedFileId = await putResumeFile(userId, buffer, mimeType, finalLabel + ext);
    const saved = await saveVaultVersion(userId, text, storedPath, mimeType, finalLabel, targetRole, false, storedFileId);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: `Drive import failed: ${err.message}` });
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
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

// GET /api/resume-versions/:id/file  — stream the stored original file for formatted preview
router.get('/:id/file', async (req, res) => {
  try {
    const row = await db.prepare(
      'SELECT file_path, mime_type, label, file_id FROM resume_versions WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.userId);
    if (!row) return res.status(404).json({ error: 'No file stored for this version' });

    // Prefer DB-stored bytes (portable across redeploys); fall back to legacy disk file.
    const blob = await getResumeFile(row.file_id, req.user.userId);
    const hasDisk = row.file_path && fs.existsSync(row.file_path);
    if (!blob && !hasDisk) {
      return res.status(404).json({ error: 'No file stored for this version' });
    }

    const mime = blob?.mime_type || row.mime_type || '';

    if (mime.includes('wordprocessingml') || mime.includes('msword')) {
      const mammoth = require('mammoth');
      const result  = blob
        ? await mammoth.convertToHtml({ buffer: blob.data })
        : await mammoth.convertToHtml({ path: row.file_path });
      const html    = wrapDocxHtml(result.value);
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    res.set('Content-Type', mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(row.label || 'resume')}"`);
    if (blob) return res.send(blob.data);
    fs.createReadStream(row.file_path).pipe(res);
  } catch (err) {
    console.error('[resume-versions] GET /:id/file error:', err);
    res.status(500).json({ error: `Failed to serve resume file: ${err.message}` });
  }
});

function wrapDocxHtml(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: Calibri, Arial, sans-serif; margin: 32px 40px; line-height: 1.7; color: #1a1a1a; max-width: 860px; }
  h1, h2, h3 { color: #111; margin: 1.2em 0 0.4em; }
  p { margin: 0.3em 0; }
  ul, ol { padding-left: 1.6em; margin: 0.4em 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
  td, th { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  strong { font-weight: 700; }
  a { color: #1a56db; }
</style></head><body>${body}</body></html>`;
}

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
