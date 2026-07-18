const express    = require('express');
const db         = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { getTransportForUser } = require('../services/mailTransport');

const router = express.Router();

// GET /api/reminder
router.get('/', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(`reminder_${req.user.userId}`);
  try { res.json(JSON.parse(row?.value || '{}')); } catch { res.json({}); }
});

// PUT /api/reminder
router.put('/', requireAuth, async (req, res) => {
  const key = `reminder_${req.user.userId}`;
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(key, JSON.stringify(req.body));
  res.json({ success: true });
});

// ── Email sender (called from scheduled interval in index.js) ─────────────
async function sendReminderEmail(userId, userEmail, userName, config) {
  const mail = await getTransportForUser(userId);
  if (!mail) return false;
  const { transport, fromEmail, fromName } = mail;

  const msg = config.message || 'Time for your daily HR outreach goal!';
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';

  await transport.sendMail({
    from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    to:      userEmail,
    subject: '⏰ HR Outreach Reminder',
    text:    `Hi ${userName},\n\n${msg}\n\nGood luck with your outreach today!\n\n— HR Outreach Tracker`,
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;max-width:480px">
  <p style="font-size:20px">⏰</p>
  <p>Hi <strong>${userName}</strong>,</p>
  <p style="font-size:16px;color:#1e40af;font-weight:600">${msg}</p>
  <p>Open your <a href="${frontend}">HR Outreach Tracker</a> to get started.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:24px">— HR Outreach Tracker &nbsp;·&nbsp; You're receiving this because you set up a reminder.</p>
</div>`,
  });
  return true;
}

module.exports = router;
module.exports.sendReminderEmail = sendReminderEmail;
