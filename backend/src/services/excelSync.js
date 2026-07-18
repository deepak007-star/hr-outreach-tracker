const ExcelJS = require('exceljs');
const path = require('path');
const db = require('../db/database');

const EXCEL_PATH = path.join(__dirname, '../../data/HR_Outreach_Tracker.xlsx');

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

async function syncExcel() {
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

  const contacts = await db.prepare('SELECT * FROM contacts ORDER BY date_added DESC').all();

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

  await wb.xlsx.writeFile(EXCEL_PATH);
  return EXCEL_PATH;
}

module.exports = { syncExcel, EXCEL_PATH };
