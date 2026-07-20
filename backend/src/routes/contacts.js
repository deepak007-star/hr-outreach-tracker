const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const ExcelJS  = require('exceljs');
const crypto   = require('crypto');
const db       = require('../db/database');
const { syncExcel } = require('../services/excelSync');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls, .csv allowed'), ok);
  },
});

const VALID_STATUSES = ['New', 'Drafted', 'Sent', 'Opened', 'Replied', 'Interview', 'Rejected', 'Do Not Contact'];

// ── GET /api/contacts  ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, search, source, tag } = req.query;
  let q = 'SELECT * FROM contacts WHERE 1=1';
  const p = [];

  if (status) { q += ' AND status = ?'; p.push(status); }
  if (source) { q += ' AND email_source = ?'; p.push(source); }
  if (search) {
    q += ' AND (name ILIKE ? OR company ILIKE ? OR email ILIKE ? OR title ILIKE ?)';
    const s = `%${search}%`;
    p.push(s, s, s, s);
  }
  if (tag) { q += ' AND tags ILIKE ?'; p.push(`%"${tag}"%`); }

  q += ' ORDER BY date_added DESC';

  try {
    const rows = await db.prepare(q).all(...p);
    res.json(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/export  ──────────────────────────────────────────────
router.get('/export', async (_, res) => {
  try {
    const fp = await syncExcel();
    res.download(fp, 'HR_Outreach_Tracker.xlsx');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/contacts/import  ─────────────────────────────────────────────
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const isCSV    = /\.csv$/i.test(req.file.originalname);

  try {
    const wb = new ExcelJS.Workbook();
    if (isCSV) await wb.csv.readFile(filePath);
    else       await wb.xlsx.readFile(filePath);

    const ws = wb.worksheets[0];

    // Build header map
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = (cell.value?.toString() || '').toLowerCase().trim();
    });

    const findCol = (...kws) => headers.findIndex(h => kws.some(k => h.includes(k)));
    const colMap = {
      name:       findCol('name'),
      title:      findCol('title', 'position', 'designation', 'role'),
      company:    findCol('company', 'organization', 'employer', 'org'),
      email:      findCol('email', 'e-mail', 'mail'),
      status:     findCol('status'),
      notes:      findCol('note', 'comment', 'remark'),
      tags:       findCol('tag', 'label', 'category'),
      source_url: findCol('url', 'link', 'source'),
    };

    const getCell = (row, colIdx) =>
      colIdx < 0 ? '' : (row.getCell(colIdx + 1).value?.toString().trim() || '');

    const stmt = db.prepare(`
      INSERT INTO contacts
        (id, name, title, company, email, email_source, email_confidence, status, notes, tags, source_url)
      VALUES (?, ?, ?, ?, ?, 'csv_import', 'unknown', ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);

    let imported = 0, skipped = 0;
    const errors = [];

    const parsedRows = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;

      const name  = getCell(row, colMap.name);
      const email = getCell(row, colMap.email).toLowerCase();
      if (!name || !email) { skipped++; return; }

      const statusRaw = getCell(row, colMap.status);
      const status    = VALID_STATUSES.includes(statusRaw) ? statusRaw : 'New';
      const tagsRaw   = getCell(row, colMap.tags);
      const tags      = tagsRaw ? tagsRaw.split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];

      parsedRows.push({
        rowNum, name, email, status,
        title:      getCell(row, colMap.title) || null,
        company:    getCell(row, colMap.company) || null,
        notes:      getCell(row, colMap.notes) || null,
        tags,
        source_url: getCell(row, colMap.source_url) || null,
      });
    });

    for (const r of parsedRows) {
      try {
        const result = await stmt.run(
          crypto.randomUUID(), r.name, r.title, r.company,
          r.email, r.status, r.notes, JSON.stringify(r.tags), r.source_url
        );
        if (result.changes > 0) imported++;
        else skipped++; // duplicate email
      } catch (e) {
        errors.push({ row: r.rowNum, email: r.email, error: e.message });
      }
    }

    fs.unlinkSync(filePath);
    await syncExcel();
    res.json({ imported, skipped, errors });

  } catch (err) {
    try { fs.unlinkSync(filePath); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/contacts/bulk-delete  ───────────────────────────────────────
router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'ids[] required' });

  try {
    const ph = ids.map(() => '?').join(',');
    // email_log.contact_id has no ON DELETE CASCADE — nullify before delete
    await db.prepare(`UPDATE email_log SET contact_id = NULL WHERE contact_id IN (${ph})`).run(...ids);
    await db.prepare(`DELETE FROM contacts WHERE id IN (${ph})`).run(...ids);
    await syncExcel();
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/contacts/bulk-status  ───────────────────────────────────────
router.post('/bulk-status', async (req, res) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || !status)
    return res.status(400).json({ error: 'ids[] and status required' });
  if (!VALID_STATUSES.includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  try {
    await db.prepare(`UPDATE contacts SET status = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(status, ...ids);
    await syncExcel();
    res.json({ ok: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/:id  ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const c = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ ...c, tags: JSON.parse(c.tags || '[]') });
});

// ── POST /api/contacts  ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    name, title, company, email,
    email_source = 'manual', email_confidence = 'unknown',
    source_url, notes, tags = [], status = 'New',
  } = req.body;

  if (!name)  return res.status(400).json({ error: 'name is required' });
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const id = crypto.randomUUID();
  try {
    await db.prepare(`
      INSERT INTO contacts
        (id, name, title, company, email, email_source, email_confidence, source_url, status, notes, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, title || null, company || null, email.toLowerCase(),
        email_source, email_confidence, source_url || null, status, notes || null, JSON.stringify(tags));

    await syncExcel();
    const c = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    res.status(201).json({ ...c, tags: JSON.parse(c.tags) });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'A contact with this email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/contacts/:id  ─────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'title', 'company', 'email', 'email_source', 'email_confidence',
    'source_url', 'status', 'notes', 'tags', 'date_last_contacted'];

  const sets = [], params = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(f === 'tags' ? JSON.stringify(req.body[f]) : req.body[f]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  if (req.body.status && !VALID_STATUSES.includes(req.body.status))
    return res.status(400).json({ error: 'Invalid status' });

  params.push(id);
  try {
    const r = await db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    await syncExcel();
    const c = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    res.json({ ...c, tags: JSON.parse(c.tags) });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Email already in use by another contact' });
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/contacts/:id  ──────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // email_log.contact_id has no ON DELETE CASCADE — nullify before delete
    await db.prepare('UPDATE email_log SET contact_id = NULL WHERE contact_id = ?').run(req.params.id);
    const r = await db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    await syncExcel();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
