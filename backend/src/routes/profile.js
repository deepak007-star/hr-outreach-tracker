const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const os       = require('os');
const fs       = require('fs');
const db       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024 } });

// All profile routes require auth
router.use(requireAuth);

// ── GET /api/profile ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const profile = await db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.userId);
  if (!profile) return res.json({});
  try { profile.skills = JSON.parse(profile.skills || '[]'); } catch { profile.skills = []; }
  res.json(profile);
});

// ── PUT /api/profile ───────────────────────────────────────────────────────
router.put('/', async (req, res) => {
  const fields = [
    'full_name', 'current_title', 'current_company', 'location',
    'phone', 'linkedin_url', 'github_url', 'portfolio_url',
    'summary', 'total_experience', 'skills',
    'job_title_1', 'job_title_2', 'job_title_3', 'preferred_city',
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

  const filePath = req.file.path;
  const ext      = path.extname(req.file.originalname || '').toLowerCase();
  const cleanup  = () => { try { fs.unlinkSync(filePath); } catch {} };

  try {
    let text = '';

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      text = data.text;
    } else if (ext === '.docx' || ext === '.doc') {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf8');
    } else {
      cleanup();
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, or TXT.' });
    }

    cleanup();
    text = text.replace(/\r\n/g, '\n').trim();

    // Persist resume text + filename in profile
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(`
      INSERT INTO profiles (user_id, resume_text, resume_filename, resume_uploaded_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        resume_text = excluded.resume_text,
        resume_filename = excluded.resume_filename,
        resume_uploaded_at = excluded.resume_uploaded_at,
        updated_at = excluded.updated_at
    `).run(req.user.userId, text, req.file.originalname, now, now);

    res.json({ text, filename: req.file.originalname });
  } catch (err) {
    cleanup();
    res.status(500).json({ error: `Failed to parse resume: ${err.message}` });
  }
});

module.exports = router;
