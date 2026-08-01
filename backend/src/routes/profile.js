const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const os       = require('os');
const fs       = require('fs');
const crypto   = require('crypto');
const db       = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { putResumeFile, getResumeFile, deleteResumeFile } = require('../services/resumeFiles');

const MAX_VAULT = 5;

// Permanent resume storage directory
const RESUME_DIR = path.join(__dirname, '../../uploads/resumes');
if (!fs.existsSync(RESUME_DIR)) fs.mkdirSync(RESUME_DIR, { recursive: true });

// Save copy of uploaded file to permanent storage, return its path
function storeResumeFile(tmpPath, userId, ext) {
  const userDir = path.join(RESUME_DIR, userId);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const dest = path.join(userDir, `${crypto.randomUUID()}${ext}`);
  fs.copyFileSync(tmpPath, dest);
  return dest;
}

async function autoSaveToVault(userId, resumeText, filename, filePath, mimeType, fileBuffer) {
  try {
    const { cnt } = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM resume_versions WHERE user_id = ?'
    ).get(userId);
    if (cnt >= MAX_VAULT) return;

    const profile = await db.prepare('SELECT skills FROM profiles WHERE user_id = ?').get(userId);
    const skills  = profile?.skills || '[]';

    const label = `Upload #${cnt + 1}${filename ? ' — ' + filename : ''}`.slice(0, 80);
    const now   = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // Give the vault version its own independent copy of the bytes so deleting
    // it (or the profile) never affects the other.
    const fileId = await putResumeFile(userId, fileBuffer, mimeType, filename);

    await db.prepare(`
      INSERT INTO resume_versions (id, user_id, label, resume_text, target_role, skills, auto_saved, file_path, mime_type, file_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, label, resumeText.trim(), '', skills, filePath || null, mimeType || null, fileId, now);
  } catch (e) {
    console.warn('[profile] auto-save to vault failed (non-fatal):', e.message);
  }
}

const router = express.Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

// ── GET /api/profile ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.userId);
  if (!profile) return res.json({});
  try { profile.skills = JSON.parse(profile.skills || '[]'); } catch { profile.skills = []; }
  // Expose whether an original file is available (DB bytes first, then legacy disk)
  profile.has_resume_file = !!profile.resume_file_id || !!(profile.resume_file_path && fs.existsSync(profile.resume_file_path));
  delete profile.resume_file_path;
  delete profile.resume_file_id;
  res.json(profile);
});

// ── PUT /api/profile ───────────────────────────────────────────────────────
router.put('/', async (req, res) => {
  const fields = [
    'full_name', 'current_title', 'current_company', 'location',
    'phone', 'linkedin_url', 'github_url', 'portfolio_url',
    'summary', 'total_experience', 'skills',
    'job_title_1', 'job_title_2', 'job_title_3', 'preferred_city',
    'notice_period', 'preferred_location',
  ];

  const data = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      data[f] = f === 'skills' ? JSON.stringify(req.body[f]) : req.body[f];
    }
  }
  data.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const setClauses = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values     = [...Object.values(data), req.user.userId];

  await db.prepare(`
    INSERT INTO profiles (user_id, ${Object.keys(data).join(', ')})
    VALUES (?, ${Object.keys(data).map(() => '?').join(', ')})
    ON CONFLICT(user_id) DO UPDATE SET ${setClauses}
  `).run(req.user.userId, ...Object.values(data), ...Object.values(data));

  res.json({ ok: true });
});

// ── POST /api/profile/resume ───────────────────────────────────────────────
router.post('/resume', upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const tmpPath  = req.file.path;
  const ext      = path.extname(req.file.originalname || '').toLowerCase();
  const cleanup  = () => { try { fs.unlinkSync(tmpPath); } catch {} };

  try {
    const userId     = req.user.userId;
    const fileBuffer = fs.readFileSync(tmpPath);
    let text     = '';
    let mimeType = req.file.mimetype || 'application/octet-stream';

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fileBuffer);
      text = data.text;
      mimeType = 'application/pdf';
    } else if (ext === '.docx' || ext === '.doc') {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ buffer: fileBuffer });
      text = result.value;
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (ext === '.txt') {
      text = fileBuffer.toString('utf8');
      mimeType = 'text/plain';
    } else {
      cleanup();
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, or TXT.' });
    }

    text = text.replace(/\r\n/g, '\n').trim();

    // Persist bytes to the DB (survives redeploys) + keep a local-disk copy (legacy/cache)
    const storedPath = storeResumeFile(tmpPath, userId, ext);
    cleanup();
    const fileId = await putResumeFile(userId, fileBuffer, mimeType, req.file.originalname);

    // Drop the previously stored profile file bytes, if any
    const prev = await db.prepare('SELECT resume_file_id FROM profiles WHERE user_id = ?').get(userId);
    if (prev?.resume_file_id) await deleteResumeFile(prev.resume_file_id);

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(`
      INSERT INTO profiles (user_id, resume_text, resume_filename, resume_uploaded_at, resume_file_path, resume_mime_type, resume_file_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        resume_text = excluded.resume_text,
        resume_filename = excluded.resume_filename,
        resume_uploaded_at = excluded.resume_uploaded_at,
        resume_file_path = excluded.resume_file_path,
        resume_mime_type = excluded.resume_mime_type,
        resume_file_id = excluded.resume_file_id,
        updated_at = excluded.updated_at
    `).run(userId, text, req.file.originalname, now, storedPath, mimeType, fileId, now);

    autoSaveToVault(userId, text, req.file.originalname, storedPath, mimeType, fileBuffer);

    res.json({ text, filename: req.file.originalname, mimeType });
  } catch (err) {
    cleanup();
    res.status(500).json({ error: `Failed to parse resume: ${err.message}` });
  }
});

// ── GET /api/profile/resume/file ──────────────────────────────────────────
// Streams the stored resume file; converts DOCX → HTML for browser preview
router.get('/resume/file', async (req, res) => {
  try {
    const profile = await db.prepare(
      'SELECT resume_file_path, resume_mime_type, resume_filename, resume_file_id FROM profiles WHERE user_id = ?'
    ).get(req.user.userId);

    if (!profile) return res.status(404).json({ error: 'No resume file stored.' });

    // Prefer DB-stored bytes (portable across redeploys); fall back to legacy disk file.
    const blob = await getResumeFile(profile.resume_file_id, req.user.userId);
    const hasDisk = profile.resume_file_path && fs.existsSync(profile.resume_file_path);
    if (!blob && !hasDisk) {
      return res.status(404).json({ error: 'No resume file stored.' });
    }

    const mime     = (blob?.mime_type || profile.resume_mime_type || '');
    const filename = profile.resume_filename || blob?.filename || 'resume';

    if (mime.includes('wordprocessingml') || mime.includes('msword')) {
      const mammoth = require('mammoth');
      const result  = blob
        ? await mammoth.convertToHtml({ buffer: blob.data })
        : await mammoth.convertToHtml({ path: profile.resume_file_path });
      const html    = wrapDocxHtml(result.value);
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    res.set('Content-Type', mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    if (blob) return res.send(blob.data);
    fs.createReadStream(profile.resume_file_path).pipe(res);
  } catch (err) {
    res.status(500).json({ error: `Failed to serve resume: ${err.message}` });
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
  a { color: #1a56db; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style></head><body>${body}</body></html>`;
}

module.exports = router;
