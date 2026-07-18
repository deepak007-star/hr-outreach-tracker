const express    = require('express');
const nodemailer = require('nodemailer');
const db         = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function getSmtp() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'smtp_config'").get();
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}

// GET /api/reminder
router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`reminder_${req.user.userId}`);
  try { res.json(JSON.parse(row?.value || '{}')); } catch { res.json({}); }
});

// PUT /api/reminder
router.put('/', requireAuth, (req, res) => {
  const key = `reminder_${req.user.userId}`;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(req.body));
  res.json({ success: true });
});

// ── Email sender (called from scheduled interval in index.js) ─────────────
async function sendReminderEmail(userEmail, userName, config) {
  const smtp = getSmtp();
  if (!smtp.host || !smtp.user || !smtp.pass) return false;

  const msg = config.message || 'Time for your daily HR outreach goal!';
  const transport = nodemailer.createTransport({
    host:   smtp.host,
    port:   parseInt(smtp.port) || 587,
    secure: String(smtp.port) === '465',
    auth:   { user: smtp.user, pass: smtp.pass },
    tls:    { rejectUnauthorized: false },
  });

  await transport.sendMail({
    from:    smtp.fromName ? `"${smtp.fromName}" <${smtp.user}>` : smtp.user,
    to:      userEmail,
    subject: '⏰ HR Outreach Reminder',
    text:    `Hi ${userName},\n\n${msg}\n\nGood luck with your outreach today!\n\n— HR Outreach Tracker`,
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;max-width:480px">
  <p style="font-size:20px">⏰</p>
  <p>Hi <strong>${userName}</strong>,</p>
  <p style="font-size:16px;color:#1e40af;font-weight:600">${msg}</p>
  <p>Open your <a href="http://localhost:5173">HR Outreach Tracker</a> to get started.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:24px">— HR Outreach Tracker &nbsp;·&nbsp; You're receiving this because you set up a reminder.</p>
</div>`,
  });
  return true;
}

module.exports = router;
module.exports.sendReminderEmail = sendReminderEmail;
