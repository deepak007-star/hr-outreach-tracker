const express    = require('express');
const crypto     = require('crypto');
const db         = require('../db/database');
const { syncExcel } = require('../services/excelSync');
const { middleware: rlMiddleware } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');
const { getTransportForUser, createLegacyTransport } = require('../services/mailTransport');

const router = express.Router();
router.use(requireAuth);

// ── Helpers ────────────────────────────────────────────────────────────────

function renderTemplate(tpl, contact) {
  return tpl
    .replace(/\{\{name\}\}/gi,    contact.name    || '')
    .replace(/\{\{company\}\}/gi, contact.company || '')
    .replace(/\{\{title\}\}/gi,   contact.title   || '')
    .replace(/\{\{email\}\}/gi,   contact.email   || '');
}

async function getFooter() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'unsubscribe_footer_text'").get();
  return row?.value || 'To opt out of future emails, reply with UNSUBSCRIBE.';
}

async function getSentToday() {
  const today = new Date().toISOString().slice(0, 10);
  const row = await db.prepare("SELECT COUNT(*) as c FROM email_log WHERE LEFT(sent_at, 10) = ?").get(today);
  return parseInt(row?.c || 0);
}

async function getDailyCap() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'daily_send_cap'").get();
  return parseInt(row?.value || '20');
}

async function wasRecentlySent(contactId) {
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const row = await db.prepare(`
    SELECT id FROM email_log
    WHERE contact_id = ? AND sent_at > ?
    LIMIT 1
  `).get(contactId, cutoff);
  return !!row;
}

// ── POST /api/email/preview ────────────────────────────────────────────────
router.post('/preview', async (req, res) => {
  const { contactIds, subject, body } = req.body;
  if (!Array.isArray(contactIds) || !contactIds.length)
    return res.status(400).json({ error: 'contactIds[] required' });
  if (!subject || !body)
    return res.status(400).json({ error: 'subject and body are required' });

  const footer   = await getFooter();
  const sentToday = await getSentToday();
  const cap       = await getDailyCap();
  const previews  = [];
  let budgetLeft  = Math.max(0, cap - sentToday);

  for (const id of contactIds) {
    const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!contact) continue;

    let blocked = false;
    let blockReason = null;

    if (contact.status === 'Do Not Contact') {
      blocked = true; blockReason = 'Marked Do Not Contact';
    } else if (await wasRecentlySent(id)) {
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

  const mail = await getTransportForUser(req.user.userId);
  if (!mail)
    return res.status(400).json({
      error: 'No email account connected. Connect Google or configure SMTP in Settings first.'
    });
  const { transport, fromEmail, fromName } = mail;

  // Re-check daily cap server-side (defense-in-depth)
  const cap = await getDailyCap();
  if (await getSentToday() >= cap)
    return res.status(429).json({ error: `Daily send cap of ${cap} reached. Try again tomorrow.` });

  const footer      = await getFooter();
  const results     = [];
  let sentCount     = await getSentToday();

  for (let i = 0; i < sends.length; i++) {
    const { contactId, subject, body } = sends[i];
    // Re-validate each contact right before sending
    const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    if (!contact) { results.push({ contactId, ok: false, error: 'Contact not found' }); continue; }

    if (contact.status === 'Do Not Contact') {
      results.push({ contactId, ok: false, error: 'Do Not Contact' }); continue;
    }
    if (await wasRecentlySent(contactId)) {
      results.push({ contactId, ok: false, error: 'Already emailed in the last 14 days' }); continue;
    }
    if (sentCount >= cap) {
      results.push({ contactId, ok: false, error: 'Daily cap reached' }); continue;
    }

    const textBody = `${body}\n\n---\n${footer}`;
    const htmlBody = textBody.split('\n').map(l => `<p style="margin:0 0 4px">${l}</p>`).join('');

    const mailOpts = {
      from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to:      contact.email,
      subject,
      text:    textBody,
      html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${htmlBody}</div>`,
    };

    try {
      await transport.sendMail(mailOpts);

      await db.prepare(`INSERT INTO email_log (id, contact_id, subject, body_snapshot) VALUES (?, ?, ?, ?)`)
        .run(crypto.randomUUID(), contactId, subject, textBody);

      const newStatus = ['New', 'Drafted'].includes(contact.status) ? 'Sent' : contact.status;
      const contactedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await db.prepare(`UPDATE contacts SET status = ?, date_last_contacted = ? WHERE id = ?`)
        .run(newStatus, contactedAt, contactId);

      sentCount++;
      results.push({ contactId, ok: true, email: contact.email });

    } catch (err) {
      const isBounce = !!(err.responseCode && err.responseCode >= 500);
      if (isBounce) {
        await db.prepare("UPDATE contacts SET status = 'Do Not Contact' WHERE id = ?").run(contactId);
        await db.prepare(`INSERT INTO email_log (id, contact_id, subject, body_snapshot, bounced) VALUES (?, ?, ?, ?, 1)`)
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
    const t = createLegacyTransport({ host, port, user, pass });
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

  const mail = await getTransportForUser(req.user.userId);
  if (!mail)
    return res.status(400).json({ error: 'No email account connected. Connect Google or configure SMTP in Settings first.' });
  const { transport, fromEmail, fromName } = mail;

  const cap = await getDailyCap();
  if (await getSentToday() >= cap)
    return res.status(429).json({ error: `Daily send cap of ${cap} reached.` });

  const footer   = await getFooter();
  const fullBody = `${body}\n\n---\n${footer}`;
  const htmlBody = fullBody.split('\n').map(l => `<p style="margin:0 0 4px">${l || '&nbsp;'}</p>`).join('');

  try {
    await transport.sendMail({
      from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
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
router.get('/log', async (req, res) => {
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

  res.json(await db.prepare(q).all(...p));
});

// ── GET /api/email/stats ───────────────────────────────────────────────────
router.get('/stats', async (_, res) => {
  const sentToday = await getSentToday();
  const cap       = await getDailyCap();
  const totalRow  = await db.prepare('SELECT COUNT(*) as c FROM email_log').get();
  const total     = parseInt(totalRow?.c || 0);
  res.json({ sentToday, dailyCap: cap, remaining: Math.max(0, cap - sentToday), totalSent: total });
});

module.exports = router;
