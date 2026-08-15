const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const ExcelJS  = require('exceljs');
const crypto   = require('crypto');
const db       = require('../db/database');
const { syncExcel, buildExcelBuffer } = require('../services/excelSync');
const { requireAuth } = require('../middleware/auth');
const { cleanContactName } = require('../lib/nameUtils');
const { canSeePool, upsertContactState: upsertState } = require('../lib/contactVisibility');

const router = express.Router();
router.use(requireAuth);

// Shape a joined row (contacts c + this user's state s) into the API contact,
// overlaying the viewer's own status/notes onto the shared identity.
function shapeContact(r, userId) {
  const { my_status, my_notes, my_follow_up_at, ...c } = r;
  return {
    ...c,
    status:       my_status || 'New',
    notes:        my_notes ?? null,
    follow_up_at: my_follow_up_at ?? null,
    tags:         JSON.parse(c.tags || '[]'),
    is_shared:    c.user_id !== userId,   // added by another user
  };
}

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

// Shared filter-building logic for GET / and GET /export, so exporting
// respects the same status/source/search/tag(s)/segment/title filters as the
// visible table instead of always dumping the whole pool. `tags` accepts a
// comma-separated list and AND-matches (a contact must carry every listed tag).
// `segment` mirrors the frontend's "Not contacted / Already mailed" toggle —
// pushed server-side so pagination operates on the truly-filtered set rather
// than a client-side .filter() over whatever page happens to be loaded.
// Two different "contacted" definitions coexist by design: the segment toggle
// treats a closed-out contact (Rejected / Do Not Contact) as "already mailed"
// (you took a final action on them, they're not "not contacted"), while the
// StatsBar's outreach-progress stat only counts an actual email having gone
// out (narrower — excludes terminal statuses since those aren't send activity).
const ALREADY_MAILED_STATUSES_SQL = `('Sent','Opened','Replied','Interview','Rejected','Do Not Contact')`;
const EMAILED_STATUSES_SQL        = `('Sent','Opened','Replied','Interview')`;
// A contact is "flagged" once a bounce/delivery-failure has been recorded
// against it — orthogonal to the status pipeline above (a contact can be
// Sent/Replied AND flagged, e.g. it bounced on a later re-send).
const FLAGGED_DELIVERABLE_SQL = `('hard_bounce','soft_bounce','flagged')`;
function buildContactFilters({ status, search, source, tag, tags, segment, title }, userId, pool) {
  const where = [];
  const p = [];
  if (!pool)  { where.push('c.user_id = ?'); p.push(userId); }
  if (status) { where.push(`COALESCE(s.status, 'New') = ?`); p.push(status); }
  if (source) { where.push('c.email_source = ?'); p.push(source); }
  if (title)  { where.push('c.title ILIKE ?'); p.push(`%${title}%`); }
  if (segment === 'contacted')     where.push(`COALESCE(s.status, 'New') IN ${ALREADY_MAILED_STATUSES_SQL}`);
  if (segment === 'not_contacted') where.push(`COALESCE(s.status, 'New') NOT IN ${ALREADY_MAILED_STATUSES_SQL}`);
  if (segment === 'flagged')       where.push(`c.email_deliverable IN ${FLAGGED_DELIVERABLE_SQL}`);
  if (search) {
    where.push('(c.name ILIKE ? OR c.company ILIKE ? OR c.email ILIKE ? OR c.title ILIKE ?)');
    const s = `%${search}%`;
    p.push(s, s, s, s);
  }
  const tagList = tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : (tag ? [tag] : []);
  for (const t of tagList) { where.push('c.tags ILIKE ?'); p.push(`%"${t}"%`); }
  return { where, params: p };
}

// ── GET /api/contacts  ─────────────────────────────────────────────────────
// Paginated by default (page/limit, 20/page unless the caller asks for more) —
// the contacts pool can run into the thousands once Job Intel has been
// syncing for a while, and loading it all in one request made the page feel
// slow on first paint. `all=true` bypasses paging (capped at 5000) for
// explicit "select every matching contact" bulk actions, where the frontend
// deliberately wants the full matching set in one shot rather than a page.
router.get('/', async (req, res) => {
  const { status, search, source, tag, tags, segment, title, page, limit, all } = req.query;
  const userId = req.user.userId;
  const pool   = canSeePool(req.user);   // subscribers/admins see everyone's contacts

  const { where, params: wp } = buildContactFilters({ status, search, source, tag, tags, segment, title }, userId, pool);
  const p = [userId, ...wp];
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const limitNum = all === 'true' ? 5000 : Math.min(Math.max(parseInt(limit) || 20, 1), 200);
  const pageNum  = Math.max(parseInt(page) || 1, 1);
  const offset   = all === 'true' ? 0 : (pageNum - 1) * limitNum;

  // Join this user's own state so status/notes reflect the viewer, not the owner.
  // ORDER BY date_added alone is NOT a stable sort key for LIMIT/OFFSET paging —
  // thousands of Job Intel contacts can share the exact same bulk-sync
  // timestamp (down to the second), so successive page requests can return
  // overlapping/duplicate rows among tied timestamps without a tiebreaker.
  // `id` is unique per row, so appending it makes page boundaries deterministic.
  let q = `
    SELECT c.*, s.status AS my_status, s.notes AS my_notes, s.follow_up_at AS my_follow_up_at
    FROM contacts c
    LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
    ${whereSql}
    ORDER BY c.date_added DESC, c.id ASC
    LIMIT ? OFFSET ?
  `;

  try {
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS count FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      ${whereSql}
    `).get(...p);
    const total = parseInt(countRow.count, 10) || 0;
    const rows  = await db.prepare(q).all(...p, limitNum, offset);
    res.json({
      contacts: rows.map(r => shapeContact(r, userId)),
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.max(1, Math.ceil(total / limitNum)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/summary ── aggregate counts for the current filter set ──
// Independent of pagination — the StatsBar and segment-tab counts need the
// TRUE total/contacted/replied/interview counts across every matching
// contact, not just whatever page happens to be loaded client-side.
router.get('/summary', async (req, res) => {
  const { status, search, source, tag, tags, title } = req.query;
  const userId = req.user.userId;
  const pool   = canSeePool(req.user);
  const { where, params: wp } = buildContactFilters({ status, search, source, tag, tags, title }, userId, pool);
  const p = [userId, ...wp];
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  try {
    const row = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(s.status, 'New') IN ${ALREADY_MAILED_STATUSES_SQL} THEN 1 ELSE 0 END) AS already_mailed,
        SUM(CASE WHEN COALESCE(s.status, 'New') IN ${EMAILED_STATUSES_SQL}        THEN 1 ELSE 0 END) AS emailed,
        SUM(CASE WHEN COALESCE(s.status, 'New') = 'Replied'   THEN 1 ELSE 0 END) AS replied,
        SUM(CASE WHEN COALESCE(s.status, 'New') = 'Interview' THEN 1 ELSE 0 END) AS interviews,
        SUM(CASE WHEN c.email_deliverable IN ${FLAGGED_DELIVERABLE_SQL} THEN 1 ELSE 0 END) AS flagged
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      ${whereSql}
    `).get(...p);
    const total         = parseInt(row.total, 10) || 0;
    const alreadyMailed = parseInt(row.already_mailed, 10) || 0;
    res.json({
      total,
      contacted:     alreadyMailed,           // segment-tab semantics ("Already mailed")
      not_contacted: total - alreadyMailed,
      emailed:    parseInt(row.emailed, 10) || 0, // StatsBar semantics — narrower, excludes Rejected/DNC
      replied:    parseInt(row.replied, 10) || 0,
      interviews: parseInt(row.interviews, 10) || 0,
      flagged:    parseInt(row.flagged, 10) || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/dashboard-stats ── aggregates for the Dashboard tab ──
// The Dashboard needs the full-pool picture (status pipeline, per-source
// conversion, stalled follow-ups, company count) — computed in SQL rather
// than handed the entire `contacts` array, which is now paginated on the
// main list and would otherwise only reflect whatever page(s) are loaded.
router.get('/dashboard-stats', async (req, res) => {
  const userId = req.user.userId;
  const pool   = canSeePool(req.user);
  const scopeSql = pool ? '' : ' WHERE c.user_id = ?';
  const scopeParams = pool ? [] : [userId];

  try {
    const pipelineRows = await db.prepare(`
      SELECT COALESCE(s.status, 'New') AS status, COUNT(*) AS count
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      ${scopeSql}
      GROUP BY COALESCE(s.status, 'New')
    `).all(userId, ...scopeParams);
    const pipeline = {};
    for (const r of pipelineRows) pipeline[r.status] = parseInt(r.count, 10) || 0;

    const sourceRows = await db.prepare(`
      SELECT
        COALESCE(c.email_source, 'manual') AS source,
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(s.status, 'New') IN ${ALREADY_MAILED_STATUSES_SQL} THEN 1 ELSE 0 END) AS contacted,
        SUM(CASE WHEN COALESCE(s.status, 'New') IN ('Replied','Interview')        THEN 1 ELSE 0 END) AS replied
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      ${scopeSql}
      GROUP BY COALESCE(c.email_source, 'manual')
    `).all(userId, ...scopeParams);
    const sourceBreakdown = sourceRows
      .map(r => {
        const total = parseInt(r.total, 10) || 0;
        const contacted = parseInt(r.contacted, 10) || 0;
        const replied = parseInt(r.replied, 10) || 0;
        return { key: r.source, total, contacted, replied, rate: contacted ? Math.round((replied / contacted) * 100) : 0 };
      })
      .sort((a, b) => b.total - a.total);

    const companyWhere  = [`c.company IS NOT NULL`, `c.company != ''`];
    const companyParams = [];
    if (!pool) { companyWhere.unshift('c.user_id = ?'); companyParams.push(userId); }
    const companyWhereSql = ' WHERE ' + companyWhere.join(' AND ');

    const companyRow = await db.prepare(`
      SELECT COUNT(DISTINCT c.company) AS count FROM contacts c${companyWhereSql}
    `).get(...companyParams);
    const myCompaniesRows = await db.prepare(`
      SELECT DISTINCT c.company FROM contacts c${companyWhereSql} ORDER BY c.company ASC LIMIT 12
    `).all(...companyParams);

    // Sent/Opened for >7 days with no reply — a concrete follow-up shortlist.
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const stalledWhere  = [`COALESCE(s.status, 'New') IN ('Sent','Opened')`, `c.date_last_contacted IS NOT NULL`, `c.date_last_contacted < ?`];
    const stalledParams = [userId]; // for the join
    if (!pool) { stalledWhere.unshift('c.user_id = ?'); stalledParams.push(userId); }
    stalledParams.push(cutoff);
    const stalledRows = await db.prepare(`
      SELECT c.*, s.status AS my_status, s.notes AS my_notes, s.follow_up_at AS my_follow_up_at
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      WHERE ${stalledWhere.join(' AND ')}
      ORDER BY c.date_last_contacted ASC LIMIT 8
    `).all(...stalledParams);

    // Bounced/undeliverable contacts — surfaced on the Dashboard the same way
    // stalled follow-ups are, so a delivery problem doesn't stay buried until
    // someone happens to filter My HR List by the Flagged tab.
    const flaggedWhere  = [`c.email_deliverable IN ${FLAGGED_DELIVERABLE_SQL}`];
    const flaggedScopeParams = [];
    if (!pool) { flaggedWhere.unshift('c.user_id = ?'); flaggedScopeParams.push(userId); }
    const flaggedRows = await db.prepare(`
      SELECT c.*, s.status AS my_status, s.notes AS my_notes, s.follow_up_at AS my_follow_up_at
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      WHERE ${flaggedWhere.join(' AND ')}
      ORDER BY c.last_bounce_at DESC NULLS LAST LIMIT 8
    `).all(userId, ...flaggedScopeParams);
    const flaggedCountRow = await db.prepare(`
      SELECT COUNT(*) AS count FROM contacts c WHERE ${flaggedWhere.join(' AND ')}
    `).get(...flaggedScopeParams);

    res.json({
      pipeline,
      sourceBreakdown,
      companyCount: parseInt(companyRow?.count, 10) || 0,
      myCompanies: myCompaniesRows.map(r => r.company),
      stalledContacts: stalledRows.map(r => shapeContact(r, userId)),
      flaggedContacts: flaggedRows.map(r => shapeContact(r, userId)),
      flaggedCount: parseInt(flaggedCountRow?.count, 10) || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/tags ── distinct tags in use + counts, for a filter dropdown ──
// Scoped by the same pool-visibility rule as the main list so this can't leak
// tag names from contacts the viewer isn't allowed to see.
router.get('/tags', async (req, res) => {
  const userId = req.user.userId;
  const pool   = canSeePool(req.user);
  try {
    const rows = pool
      ? await db.prepare(`SELECT tags FROM contacts WHERE tags IS NOT NULL AND tags != '[]'`).all()
      : await db.prepare(`SELECT tags FROM contacts WHERE user_id = ? AND tags IS NOT NULL AND tags != '[]'`).all(userId);

    const counts = new Map();
    for (const r of rows) {
      let tags = [];
      try { tags = JSON.parse(r.tags || '[]'); } catch {}
      for (const t of tags) {
        if (!t) continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    const result = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/follow-ups/due  ──────────────────────────────────────
// This viewer's contacts with a follow_up_at reminder that has arrived —
// follow_up_at lives per-viewer in contact_user_state, so setting one on a
// shared-pool contact never affects another user's reminders.
router.get('/follow-ups/due', async (req, res) => {
  const userId = req.user.userId;
  const pool   = canSeePool(req.user);
  const now    = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    const rows = await db.prepare(`
      SELECT c.*, s.status AS my_status, s.notes AS my_notes, s.follow_up_at AS my_follow_up_at
      FROM contacts c
      JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      WHERE s.follow_up_at IS NOT NULL AND s.follow_up_at <= ? ${pool ? '' : 'AND c.user_id = ?'}
      ORDER BY s.follow_up_at ASC
    `).all(...(pool ? [userId, now] : [userId, now, userId]));
    res.json(rows.map(r => shapeContact(r, userId)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/export  ──────────────────────────────────────────────
// Generates the Excel on-demand for the contacts the user can see, with the
// viewer's own status/notes overlaid.
router.get('/export', async (req, res) => {
  const { status, search, source, tag, tags, format } = req.query;
  const userId = req.user.userId;
  const pool   = canSeePool(req.user);
  try {
    let q = `
      SELECT c.*, s.status AS my_status, s.notes AS my_notes, s.follow_up_at AS my_follow_up_at
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
    `;
    const { where, params: wp } = buildContactFilters({ status, search, source, tag, tags }, userId, pool);
    const p = [userId, ...wp];
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    q += ' ORDER BY c.date_added DESC';

    const rows = await db.prepare(q).all(...p);
    const contacts = rows.map(r => shapeContact(r, userId));
    // Built in-memory (not the shared EXCEL_PATH file) so a concurrent
    // syncExcel() write from another user's request can't race with this
    // download and serve them someone else's contact list.
    const buf = await buildExcelBuffer(contacts);
    if (format === 'csv') {
      const ExcelJS2 = require('exceljs');
      const wb = new ExcelJS2.Workbook();
      await wb.xlsx.load(buf);
      const csvBuf = await wb.csv.writeBuffer();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="HR_Outreach_Tracker.csv"');
      return res.send(csvBuf);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="HR_Outreach_Tracker.xlsx"');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/contacts/import  ─────────────────────────────────────────────
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const userId  = req.user.userId;
  const filePath = req.file.path;
  const isCSV    = /\.csv$/i.test(req.file.originalname);
  const updateExisting = req.body.updateExisting === 'true';

  try {
    const wb = new ExcelJS.Workbook();
    if (isCSV) await wb.csv.readFile(filePath);
    else       await wb.xlsx.readFile(filePath);

    const ws = wb.worksheets[0];

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

    // RETURNING id — on an update, ON CONFLICT DO UPDATE keeps the EXISTING row's
    // primary key, not the freshly generated one bound as a param below, so the
    // real id must be read back rather than assumed (otherwise upsertState()
    // would write per-user status/notes against a contact id that doesn't exist).
    const stmt = db.prepare(updateExisting ? `
      INSERT INTO contacts
        (id, user_id, name, title, company, email, email_source, email_confidence, status, notes, tags, source_url)
      VALUES (?, ?, ?, ?, ?, ?, 'csv_import', 'unknown', ?, ?, ?, ?)
      ON CONFLICT (email, user_id) DO UPDATE SET
        name = EXCLUDED.name, title = EXCLUDED.title, company = EXCLUDED.company,
        notes = EXCLUDED.notes, tags = EXCLUDED.tags, source_url = EXCLUDED.source_url
      RETURNING id
    ` : `
      INSERT INTO contacts
        (id, user_id, name, title, company, email, email_source, email_confidence, status, notes, tags, source_url)
      VALUES (?, ?, ?, ?, ?, ?, 'csv_import', 'unknown', ?, ?, ?, ?)
      ON CONFLICT (email, user_id) DO NOTHING
      RETURNING id
    `);

    // Pre-fetch existing emails so imported/updated counts stay meaningful
    // (ON CONFLICT DO UPDATE reports a row change for both new and updated rows).
    const existingEmails = new Set(
      (await db.prepare('SELECT email FROM contacts WHERE user_id = ?').all(userId)).map(r => r.email)
    );

    let imported = 0, updated = 0, skipped = 0;
    const errors = [];

    const parsedRows = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;

      const rawName = getCell(row, colMap.name);
      const email   = getCell(row, colMap.email).toLowerCase();
      if (!email) { skipped++; return; }
      const name = cleanContactName(rawName, email);

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
        const newId = crypto.randomUUID();
        const result = await stmt.get(
          newId, userId, r.name, r.title, r.company,
          r.email, r.status, r.notes, JSON.stringify(r.tags), r.source_url
        );
        if (result?.id) {
          if (existingEmails.has(r.email)) updated++; else imported++;
          await upsertState(result.id, userId, { status: r.status, notes: r.notes });
        } else skipped++;
      } catch (e) {
        errors.push({ row: r.rowNum, email: r.email, error: e.message });
      }
    }

    fs.unlinkSync(filePath);
    res.json({ imported, updated, skipped, errors });

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

  const userId = req.user.userId;
  const ph = ids.map(() => '?').join(',');

  try {
    // Resolve ownership FIRST — a shared-pool contact ID belonging to another
    // user (canSeePool) must not have its email_log linkage nulled out just
    // because it was included in this request; only rows this user actually
    // owns get touched at all.
    const owned = await db.prepare(`SELECT id FROM contacts WHERE id IN (${ph}) AND user_id = ?`).all(...ids, userId);
    const ownedIds = owned.map(r => r.id);
    if (!ownedIds.length) return res.json({ ok: true, deleted: 0 });
    const ownedPh = ownedIds.map(() => '?').join(',');

    await db.prepare(`UPDATE email_log SET contact_id = NULL WHERE contact_id IN (${ownedPh})`).run(...ownedIds);
    await db.prepare(`DELETE FROM contacts WHERE id IN (${ownedPh}) AND user_id = ?`).run(...ownedIds, userId);
    res.json({ ok: true, deleted: ownedIds.length });
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

  const userId = req.user.userId;
  const pool   = canSeePool(req.user);
  try {
    // Only touch contacts the user can actually see, then set THEIR status
    const ph = ids.map(() => '?').join(',');
    const visible = await db.prepare(
      `SELECT id FROM contacts WHERE id IN (${ph}) ${pool ? '' : 'AND user_id = ?'}`
    ).all(...ids, ...(pool ? [] : [userId]));
    for (const { id } of visible) await upsertState(id, userId, { status });
    res.json({ ok: true, updated: visible.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/contacts/bulk-tags  ──────────────────────────────────────────
// Tags are shared-identity (like name/company), so only the contact's owner
// may change them — same rule PUT /:id already enforces for IDENTITY fields.
router.post('/bulk-tags', async (req, res) => {
  const { ids, tags, mode = 'add' } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || !Array.isArray(tags) || tags.length === 0)
    return res.status(400).json({ error: 'ids[] and tags[] required' });
  if (!['add', 'remove'].includes(mode))
    return res.status(400).json({ error: 'mode must be "add" or "remove"' });

  const userId = req.user.userId;
  try {
    const ph = ids.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT id, tags FROM contacts WHERE id IN (${ph}) AND user_id = ?`).all(...ids, userId);

    let updated = 0;
    for (const r of rows) {
      let current = [];
      try { current = JSON.parse(r.tags || '[]'); } catch {}
      const next = mode === 'add'
        ? [...new Set([...current, ...tags])]
        : current.filter(t => !tags.includes(t));
      await db.prepare('UPDATE contacts SET tags = ? WHERE id = ?').run(JSON.stringify(next), r.id);
      updated++;
    }
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/contacts/:id  ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const userId = req.user.userId;
  const pool   = canSeePool(req.user);
  try {
    const r = await db.prepare(`
      SELECT c.*, s.status AS my_status, s.notes AS my_notes, s.follow_up_at AS my_follow_up_at
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      WHERE c.id = ? ${pool ? '' : 'AND c.user_id = ?'}
    `).get(...(pool ? [userId, req.params.id] : [userId, req.params.id, userId]));
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(shapeContact(r, userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/contacts  ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    name, title, company, email,
    email_source = 'manual', email_confidence = 'unknown',
    source_url, notes, tags = [], status = 'New',
  } = req.body;

  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const cleanedName = cleanContactName(name, email);
  const userId = req.user.userId;
  const id     = crypto.randomUUID();
  try {
    await db.prepare(`
      INSERT INTO contacts
        (id, user_id, name, title, company, email, email_source, email_confidence, source_url, status, notes, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, cleanedName, title || null, company || null, email.toLowerCase(),
        email_source, email_confidence, source_url || null, status, notes || null, JSON.stringify(tags));

    await upsertState(id, userId, { status, notes: notes || null });

    const c = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    res.status(201).json({ ...c, status, notes: notes || null, tags: JSON.parse(c.tags), is_shared: false });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'A contact with this email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/contacts/:id  ─────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { id }  = req.params;
  const userId  = req.user.userId;
  const pool    = canSeePool(req.user);

  if (req.body.status && !VALID_STATUSES.includes(req.body.status))
    return res.status(400).json({ error: 'Invalid status' });

  // status + notes are the viewer's own state; everything else is shared identity
  // that only the contact's owner may edit.
  const IDENTITY = ['name', 'title', 'company', 'email', 'email_source', 'email_confidence',
    'source_url', 'tags', 'date_last_contacted'];

  try {
    const contact = await db.prepare(
      `SELECT * FROM contacts WHERE id = ? ${pool ? '' : 'AND user_id = ?'}`
    ).get(...(pool ? [id] : [id, userId]));
    if (!contact) return res.status(404).json({ error: 'Not found' });
    const isOwner = contact.user_id === userId;

    // Collect shared-identity edits (owner only) and per-user state edits (anyone)
    const sets = [], params = [];
    for (const f of IDENTITY) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        params.push(f === 'tags' ? JSON.stringify(req.body[f]) : f === 'email' ? req.body[f].trim().toLowerCase() : req.body[f]);
      }
    }
    const stateUpdate = {};
    if (req.body.status       !== undefined) stateUpdate.status       = req.body.status;
    if (req.body.notes        !== undefined) stateUpdate.notes        = req.body.notes;
    if (req.body.follow_up_at !== undefined) stateUpdate.follow_up_at = req.body.follow_up_at;

    if (!sets.length && !Object.keys(stateUpdate).length)
      return res.status(400).json({ error: 'No valid fields to update' });

    // Reject identity edits by non-owners up front (no partial writes)
    if (sets.length && !isOwner) return res.status(403).json({
      error: "This contact was added by another user — you can set your own status/notes and email it, but not edit its details.",
    });

    if (Object.keys(stateUpdate).length) await upsertState(id, userId, stateUpdate);
    if (sets.length) {
      params.push(id, userId);
      await db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    }

    const r = await db.prepare(`
      SELECT c.*, s.status AS my_status, s.notes AS my_notes, s.follow_up_at AS my_follow_up_at
      FROM contacts c
      LEFT JOIN contact_user_state s ON s.contact_id = c.id AND s.user_id = ?
      WHERE c.id = ?
    `).get(userId, id);
    res.json(shapeContact(r, userId));
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Email already in use by another contact' });
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/contacts/:id  ──────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const userId = req.user.userId;
  try {
    // Confirm ownership before touching email_log — a shared-pool contact
    // belonging to another user must 404 without any side effect.
    const owned = await db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!owned) return res.status(404).json({ error: 'Not found' });

    await db.prepare('UPDATE email_log SET contact_id = NULL WHERE contact_id = ?').run(req.params.id);
    const r = await db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(req.params.id, userId);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
