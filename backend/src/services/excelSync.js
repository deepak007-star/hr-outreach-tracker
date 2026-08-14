const ExcelJS = require('exceljs');
const path = require('path');
const fs   = require('fs');
const db = require('../db/database');

const EXCEL_PATH = path.join(__dirname, '../../data/HR_Outreach_Tracker.xlsx');
// Ensure the data directory exists before any write attempt
fs.mkdirSync(path.dirname(EXCEL_PATH), { recursive: true });

const STATUS_FILL = {
  'New':            { argb: 'FFF5F5F5' },
  'Drafted':        { argb: 'FFE3F2FD' },
  'Sent':           { argb: 'FFFFF9C4' },
  'Opened':         { argb: 'FFF1F8E9' },
  'Replied':        { argb: 'FFE8F5E9' },
  'Interview':      { argb: 'FFB9F6CA' },
  'Rejected':       { argb: 'FFFFEBEE' },
  'Do Not Contact': { argb: 'FF37474F' },
};

const STATUS_FONT = {
  'Do Not Contact': { color: { argb: 'FFB0BEC5' }, strike: true },
};

// contacts: optional pre-fetched array. When provided (e.g. from an
// authenticated export endpoint), only those rows are written — enabling
// per-user exports. When omitted, all contacts are written (admin/legacy use).
async function buildWorkbook(contacts) {
  if (!contacts) {
    contacts = await db.prepare('SELECT * FROM contacts ORDER BY date_added DESC').all();
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR Outreach Tracker';
  wb.lastModifiedBy = 'HR Outreach Tracker';
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet('Contacts', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: 'FF1E3A5F' } },
  });

  ws.columns = [
    { header: 'Name',             key: 'name',                width: 22 },
    { header: 'Title',            key: 'title',               width: 24 },
    { header: 'Company',          key: 'company',             width: 20 },
    { header: 'Email',            key: 'email',               width: 30 },
    { header: 'Status',           key: 'status',              width: 16 },
    { header: 'Source',           key: 'email_source',        width: 16 },
    { header: 'Confidence',       key: 'email_confidence',    width: 12 },
    { header: 'Tags',             key: 'tags',                width: 22 },
    { header: 'Notes',            key: 'notes',               width: 38 },
    { header: 'Source URL',       key: 'source_url',          width: 36 },
    { header: 'Date Added',       key: 'date_added',          width: 18 },
    { header: 'Last Contacted',   key: 'date_last_contacted', width: 18 },
  ];

  // Style header
  const hdr = ws.getRow(1);
  hdr.height = 22;
  hdr.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF0D2137' } } };
  });

  for (const c of contacts) {
    const row = ws.addRow({
      name:                 c.name,
      title:                c.title || '',
      company:              c.company || '',
      email:                c.email,
      status:               c.status,
      email_source:         c.email_source,
      email_confidence:     c.email_confidence,
      tags:                 JSON.parse(c.tags || '[]').join(', '),
      notes:                c.notes || '',
      source_url:           c.source_url || '',
      date_added:           c.date_added ? c.date_added.replace('T', ' ').slice(0, 16) : '',
      date_last_contacted:  c.date_last_contacted ? c.date_last_contacted.replace('T', ' ').slice(0, 16) : '',
    });

    row.height = 18;
    const fill   = STATUS_FILL[c.status] || STATUS_FILL['New'];
    const fnt    = STATUS_FONT[c.status] || null;

    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: fill };
      cell.font      = fnt ? { ...fnt, size: 10 } : { size: 10 };
      cell.alignment = { vertical: 'middle' };
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } } };
    });
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  return wb;
}

// Writes the canonical shared file at EXCEL_PATH — used by every mutating
// contacts endpoint to keep the on-disk export current. NOT used by the
// on-demand /export download route (see buildExcelBuffer) since concurrent
// callers writing this same fixed path could otherwise race with a download
// reading it back, serving one user's data to another.
async function syncExcel(contacts) {
  const wb = await buildWorkbook(contacts);
  await wb.xlsx.writeFile(EXCEL_PATH);
  return EXCEL_PATH;
}

// In-memory build for the on-demand export download — never touches the
// shared EXCEL_PATH, so it can't race with (or be raced by) another
// request's syncExcel() write.
async function buildExcelBuffer(contacts) {
  const wb = await buildWorkbook(contacts);
  return wb.xlsx.writeBuffer();
}

module.exports = { syncExcel, buildExcelBuffer, EXCEL_PATH };
