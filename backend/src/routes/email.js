const express    = require('express');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const db         = require('../db/database');
const { syncExcel } = require('../services/excelSync');
const { middleware: rlMiddleware } = require('../middleware/rateLimiter');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function renderTemplate(tpl, contact) {
  return tpl
    .replace(/\{\{name\}\}/gi,    contact.name    || '')
    .replace(/\{\{company\}\}/gi, contact.company || '')
    .replace(/\{\{title\}\}/gi,   contact.title   || '')
    .replace(/\{\{email\}\}/gi,   contact.email   || '');
}

function getSmtpConfig() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'smtp_config'").get();
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}

function getFooter() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'unsubscribe_footer_text'").get();
  return row?.value || 'To opt out of future emails, reply with UNSUBSCRIBE.';
}

function getSentToday() {
  const row = db.prepare("SELECT COUNT(*) as c FROM email_log WHERE date(sent_at) = date('now')").get();
  return row?.c || 0;
}

function getDailyCap() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'daily_send_cap'").get();
  return parseInt(row?.value || '20');
}

function createTransport(smtp) {
  return nodemailer.createTransport({
    host:   smtp.host,
    port:   parseInt(smtp.port) || 587,
    secure: String(smtp.port) === '465',
    auth:   { user: smtp.user, pass: smtp.pass },
    tls:    { rejectUnauthorized: false },
  });
}

function wasRecentlySent(contactId) {
  const row = db.prepare(`
    SELECT id FROM email_log
    WHERE contact_id = ? AND sent_at > datetime('now', '-14 days')
    LIMIT 1
  `).get(contactId);
  return !!row;
}

// ── POST /api/email/preview ────────────────────────────────────────────────
router.post('/preview', (req, res) => {
  const { contactIds, subject, body } = req.body;
  if (!Array.isArray(contactIds) || !contactIds.length)
    return res.status(400).json({ error: 'contactIds[] required' });
  if (!subject || !body)
    return res.status(400).json({ error: 'subject and body are required' });

  const footer   = getFooter();
  const sentToday = getSentToday();
  const cap       = getDailyCap();
  const previews  = [];
  let budgetLeft  = Math.max(0, cap - sentToday);

  for (const id of contactIds) {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!contact) continue;

    let blocked = false;
    let blockReason = null;

    if (contact.status === 'Do Not Contact') {
      blocked = true; blockReason = 'Marked Do Not Contact';
    } else if (wasRecentlySent(id)) {
      blocked = true; blockReason = 'Already emailed in the last 14 days';
    } else if (budgetLeft <= 0) {
      blocked = true; blockReason = `Daily cap of ${cap} reached`;
    } else {
      budgetLeft--;
    }

    previews.push({
      contactId:   contact.id,
      name:        contact.name,
      email:       contact.email,
      company:     contact.company,
      subject:     renderTemplate(subject, contact),
      body:        renderTemplate(body, contact),
      footer,
      blocked,
      blockReason,
    });
  }

  res.json({
    previews,
    sentToday,
    dailyCap: cap,
    eligible: previews.filter(p => !p.blocked).length,
  });
});

// ── POST /api/email/send ───────────────────────────────────────────────────
router.post('/send', rlMiddleware('email'), async (req, res) => {
  const { sends } = req.body;
  if (!Array.isArray(sends) || !sends.length)
    return res.status(400).json({ error: 'sends[] required' });

  const smtp = getSmtpConfig();
  if (!smtp.host || !smtp.user || !smtp.pass)
    return res.status(400).json({
      error: 'SMTP is not configured. Open SMTP Settings and save your credentials first.'
    });

  // Re-check daily cap server-side (defense-in-depth)
  const cap = getDailyCap();
  if (getSentToday() >= cap)
    return res.status(429).json({ error: `Daily send cap of ${cap} reached. Try again tomorrow.` });

  const footer      = getFooter();
  const transport   = createTransport(smtp);
  const results     = [];
  let sentCount     = getSentToday();

  for (let i = 0; i < sends.length; i++) {
    const { contactId, subject, body } = sends[i];
    // Re-validate each contact right before sending
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    if (!contact) { results.push({ contactId, ok: false, error: 'Contact not found' }); continue; }

    if (contact.status === 'Do Not Contact') {
      results.push({ contactId, ok: false, error: 'Do Not Contact' }); continue;
    }
    if (wasRecentlySent(contactId)) {
      results.push({ contactId, ok: false, error: 'Already emailed in the last 14 days' }); continue;
    }
    if (sentCount >= cap) {
      results.push({ contactId, ok: false, error: 'Daily cap reached' }); continue;
    }

    const textBody = `${body}\n\n---\n${footer}`;
    const htmlBody = textBody.split('\n').map(l => `<p style="margin:0 0 4px">${l}</p>`).join('');

    const mailOpts = {
      from:    smtp.fromName ? `"${smtp.fromName}" <${smtp.user}>` : smtp.user,
      to:      contact.email,
      subject,
      text:    textBody,
      html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${htmlBody}</div>`,
    };

    try {
      await transport.sendMail(mailOpts);

      db.prepare(`INSERT INTO email_log (id, contact_id, subject, body_snapshot) VALUES (?, ?, ?, ?)`)
        .run(crypto.randomUUID(), contactId, subject, textBody);

      const newStatus = ['New', 'Drafted'].includes(contact.status) ? 'Sent' : contact.status;
      db.prepare(`UPDATE contacts SET status = ?, date_last_contacted = datetime('now') WHERE id = ?`)
        .run(newStatus, contactId);

      sentCount++;
      results.push({ contactId, ok: true, email: contact.email });

    } catch (err) {
      const isBounce = !!(err.responseCode && err.responseCode >= 500);
      if (isBounce) {
        db.prepare("UPDATE contacts SET status = 'Do Not Contact' WHERE id = ?").run(contactId);
        db.prepare(`INSERT INTO email_log (id, contact_id, subject, body_snapshot, bounced) VALUES (?, ?, ?, ?, 1)`)
          .run(crypto.randomUUID(), contactId, subject, textBody);
      }
      results.push({ contactId, ok: false, error: err.message, bounced: isBounce });
    }

    // Rate-limit: 2 s gap between sends in a batch
    if (i < sends.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  await syncExcel();

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  res.json({ sent, failed, results });
});

// ── POST /api/email/test ───────────────────────────────────────────────────
router.post('/test', async (req, res) => {
  const { host, port, user, pass } = req.body;
  if (!host || !user || !pass)
    return res.status(400).json({ error: 'host, user, and pass are required' });

  try {
    const t = createTransport({ host, port, user, pass });
    await t.verify();
    res.json({ ok: true, message: `Connected to ${host}:${port || 587} — credentials valid` });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── POST /api/email/send-direct — send to any address (no contact required) ──
router.post('/send-direct', rlMiddleware('email'), async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body)
    return res.status(400).json({ error: 'to, subject, and body are required.' });

  const smtp = getSmtpConfig();
  if (!smtp.host || !smtp.user || !smtp.pass)
    return res.status(400).json({ error: 'SMTP not configured. Open SMTP Settings first.' });

  const cap = getDailyCap();
  if (getSentToday() >= cap)
    return res.status(429).json({ error: `Daily send cap of ${cap} reached.` });

  const footer   = getFooter();
  const fullBody = `${body}\n\n---\n${footer}`;
  const htmlBody = fullBody.split('\n').map(l => `<p style="margin:0 0 4px">${l || '&nbsp;'}</p>`).join('');

  try {
    const transport = createTransport(smtp);
    await transport.sendMail({
      from:    smtp.fromName ? `"${smtp.fromName}" <${smtp.user}>` : smtp.user,
      to,
      subject,
      text:    fullBody,
      html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${htmlBody}</div>`,
    });
    res.json({ ok: true, to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/email/log ─────────────────────────────────────────────────────
router.get('/log', (req, res) => {
  const { contactId } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '100'), 500);

  let q = `
    SELECT el.id, el.contact_id, el.sent_at, el.subject, el.opened, el.bounced,
           c.name, c.email, c.company
    FROM email_log el
    JOIN contacts c ON c.id = el.contact_id
  `;
  const p = [];
  if (contactId) { q += ' WHERE el.contact_id = ?'; p.push(contactId); }
  q += ' ORDER BY el.sent_at DESC LIMIT ?';
  p.push(limit);

  res.json(db.prepare(q).all(...p));
});

// ── GET /api/email/stats ───────────────────────────────────────────────────
router.get('/stats', (_, res) => {
  const sentToday = getSentToday();
  const cap       = getDailyCap();
  const total     = db.prepare('SELECT COUNT(*) as c FROM email_log').get()?.c || 0;
  res.json({ sentToday, dailyCap: cap, remaining: Math.max(0, cap - sentToday), totalSent: total });
});

module.exports = router;
