const express    = require('express');
const crypto     = require('crypto');
const fs         = require('fs');
const https      = require('https');
const http       = require('http');
const db         = require('../db/database');
const { syncExcel } = require('../services/excelSync');
const { middleware: rlMiddleware } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');
const { getTransportForUser, createLegacyTransport } = require('../services/mailTransport');
const sanitizeHtml = require('sanitize-html');
const { scrapeLimiter } = require('../middleware/security');

// Allowed HTML subset for outgoing email bodies: safe formatting, no scripts/iframes
const EMAIL_HTML_OPTS = {
  allowedTags: ['b','i','u','s','strong','em','del','ins','br','hr','p','div','span',
                 'ul','ol','li','blockquote','h1','h2','h3','a'],
  allowedAttributes: {
    '*':  ['style', 'class'],
    'a':  ['href', 'target', 'rel'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  disallowedTagsMode: 'discard',
};

// Strip control chars and quote marks that could inject extra headers in From:/To: fields
function sanitizeHeaderValue(val) {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[\r\n\t"<>]/g, '').trim();
}

const router = express.Router();
router.use(requireAuth);

// ── Helpers ────────────────────────────────────────────────────────────────

// `profile` fills the sender-side vars the compose UI offers
// ({{your_name}}, {{phone}}, {{linkedin_url}}, ...) — without this, a
// template saved before the sender's profile changed (or picked before the
// frontend's own profile pre-fill ran) reaches this function with those
// tokens still literal. Any placeholder left over after both passes is
// stripped so a recipient can never receive raw {{...}} merge syntax —
// that alone (looking like a broken mail-merge) is enough to get flagged
// as spam, unlike the plain hand-typed text referrals.js sends.
function renderTemplate(tpl, contact, profile) {
  const p          = profile || {};
  // name is already cleaned to first-name-only at write time
  const firstName  = (contact.name || '').split(' ')[0].trim();
  const skillsStr  = Array.isArray(p.skills) ? p.skills.join(', ') : (p.skills || '');

  // Helper: replace many regex patterns with the same value in one pass
  function sub(text, patterns, value) {
    let r = text;
    for (const pat of patterns) r = r.replace(pat, value);
    return r;
  }

  let result = tpl;

  // ── Contact / recipient vars ──────────────────────────────────────────────
  // {{name}} → first name only (skips email-address values)
  result = sub(result, [
    /\{\{name\}\}/gi, /\{name\}/gi, /\[name\]/gi,
    /\{\{HR_?[Nn]ame\}\}/g, /\{HR_?[Nn]ame\}/g,
    /\{\{[Hh]iring_?[Mm]anager\}\}/g,
    /\{\{[Rr]ecipient_?[Nn]ame\}\}/g, /\{[Rr]ecipient_?[Nn]ame\}/g,
    /\{\{[Ff]ull_?[Nn]ame\}\}/g,
  ], firstName);

  result = sub(result, [
    /\{\{[Ff]irst_?[Nn]ame\}\}/g, /\{[Ff]irst_?[Nn]ame\}/g,
  ], firstName);

  result = sub(result, [
    /\{\{company\}\}/gi, /\{company\}/gi, /\[company\]/gi,
    /\{\{[Cc]ompany_?[Nn]ame\}\}/g, /\{[Cc]ompany_?[Nn]ame\}/g,
  ], contact.company || '');

  result = sub(result, [
    /\{\{title\}\}/gi, /\{title\}/gi,
    /\{\{role\}\}/gi,  /\{role\}/gi,
    /\{\{[Pp]osition\}\}/gi,
  ], contact.title || '');

  result = sub(result, [
    /\{\{email\}\}/gi, /\{email\}/gi,
  ], contact.email || '');

  // ── Sender / profile vars ─────────────────────────────────────────────────
  result = sub(result, [/\{\{your_name\}\}/gi, /\{your_name\}/gi],         p.full_name        || '');
  result = sub(result, [/\{\{current_title\}\}/gi, /\{current_title\}/gi], p.current_title    || '');
  result = sub(result, [/\{\{experience\}\}/gi, /\{experience\}/gi],       p.total_experience || '');
  result = sub(result, [/\{\{notice_period\}\}/gi, /\{notice_period\}/gi], p.notice_period    || '');
  result = sub(result, [/\{\{location\}\}/gi, /\{location\}/gi],           p.location         || '');
  result = sub(result, [/\{\{linkedin_url\}\}/gi, /\{linkedin_url\}/gi],   p.linkedin_url     || '');
  result = sub(result, [/\{\{phone\}\}/gi, /\{phone\}/gi],                 p.phone            || '');
  result = sub(result, [/\{\{skills\}\}/gi, /\{skills\}/gi],               skillsStr);

  // Strip any remaining unresolved tokens ({{...}}, {...}, [...])
  result = result.replace(/\{\{[\s\S]*?\}\}/g, '');
  result = result.replace(/\{[A-Za-z_]\w*\}/g, '');

  // Clean up greeting when name was empty: "Hi ," or "Hi  ," → "Hi,"
  result = result.replace(/\bHi\s+,/g, 'Hi,');

  return result;
}

function getDriveFileId(url) {
  const m1 = (url || '').match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = (url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

function fetchUrl(urlStr, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Too many redirects'));
    const lib = urlStr.startsWith('https') ? https : http;
    const req = lib.get(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function stripHtml(html) {
  return html
    .replace(/<div><br><\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function resolveAttachment(attachment, userId) {
  if (!attachment || !attachment.type) return [];
  try {
    if (attachment.type === 'profile') {
      const profile = await db.prepare(
        'SELECT resume_file_path, resume_mime_type, resume_filename FROM profiles WHERE user_id = ?'
      ).get(userId);
      if (profile?.resume_file_path && fs.existsSync(profile.resume_file_path)) {
        return [{
          filename:    profile.resume_filename || 'resume',
          path:        profile.resume_file_path,
          contentType: profile.resume_mime_type || 'application/octet-stream',
        }];
      }
    } else if (attachment.type === 'vault' && attachment.vaultId) {
      const version = await db.prepare(
        'SELECT file_path, mime_type, label, resume_text FROM resume_versions WHERE id = ? AND user_id = ?'
      ).get(attachment.vaultId, userId);
      if (version?.file_path && fs.existsSync(version.file_path)) {
        const ext = version.mime_type?.includes('pdf') ? '.pdf'
                  : version.mime_type?.includes('word') ? '.docx' : '';
        return [{
          filename:    (version.label || 'resume') + ext,
          path:        version.file_path,
          contentType: version.mime_type || 'application/octet-stream',
        }];
      }
      // Fallback: file missing on disk but resume text exists — send as .txt
      if (version?.resume_text?.trim()) {
        return [{
          filename:    (version.label || 'resume') + '.txt',
          content:     Buffer.from(version.resume_text, 'utf8'),
          contentType: 'text/plain',
        }];
      }
    } else if (attachment.type === 'local' && attachment.data) {
      return [{
        filename:    attachment.filename || 'resume',
        content:     Buffer.from(attachment.data, 'base64'),
        contentType: attachment.mimeType || 'application/octet-stream',
      }];
    } else if (attachment.type === 'drive' && attachment.driveUrl) {
      const fileId = getDriveFileId(attachment.driveUrl);
      if (!fileId) throw new Error('Invalid Drive URL');
      const downloadLink = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      const { buffer, contentType } = await fetchUrl(downloadLink);
      return [{
        filename:    attachment.filename || 'resume.pdf',
        content:     buffer,
        contentType: contentType || 'application/pdf',
      }];
    }
  } catch (e) {
    console.warn('[email] resolveAttachment failed (non-fatal):', e.message);
  }
  return [];
}

async function getFooter() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'unsubscribe_footer_text'").get();
  return row?.value || 'To opt out of future emails, reply with UNSUBSCRIBE.';
}

async function getSentToday(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = await db.prepare(
    "SELECT COUNT(*) as c FROM email_log WHERE LEFT(sent_at, 10) = ? AND user_id = ? AND delivery_status = 'sent'"
  ).get(today, userId);
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
    WHERE contact_id = ? AND sent_at > ? AND delivery_status = 'sent'
    LIMIT 1
  `).get(contactId, cutoff);
  return !!row;
}

// Classify SMTP errors into bounce types for deliverability tracking
function classifyBounce(err) {
  const code = err.responseCode || 0;
  const text = ((err.message || '') + ' ' + (err.response || '')).toLowerCase();
  const hardPatterns = [
    'does not exist', 'no such user', 'user unknown', 'user not found',
    'invalid address', 'invalid recipient', 'bad destination', 'address rejected',
    'recipient rejected', 'mailbox not found', 'mailbox unavailable',
    'no mailbox', 'account does not exist', 'undeliverable', 'non-existent',
    'address invalid', 'no route to host', '5.1.1', '5.1.2',
  ];
  if (hardPatterns.some(p => text.includes(p)) || (code >= 550 && code <= 554)) return 'hard_bounce';
  const softPatterns = ['mailbox full', 'quota', 'over quota', 'temporarily', 'try again', 'service unavailable'];
  if (softPatterns.some(p => text.includes(p)) || (code >= 400 && code < 500)) return 'soft_bounce';
  if (code >= 500) return 'hard_bounce';
  return 'failed';
}

// Upsert per-user monthly billing stats
async function upsertBillingStats(userId, field) {
  const month = new Date().toISOString().slice(0, 7);
  const now   = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(`
    INSERT INTO delivery_billing_stats (id, user_id, billing_month, ${field}, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (user_id, billing_month) DO UPDATE SET
      ${field} = delivery_billing_stats.${field} + 1,
      updated_at = ?
  `).run(crypto.randomUUID(), userId, month, now, now);
}

// ── POST /api/email/preview ────────────────────────────────────────────────
router.post('/preview', async (req, res) => {
  const { contactIds, subject, body } = req.body;
  if (!Array.isArray(contactIds) || !contactIds.length)
    return res.status(400).json({ error: 'contactIds[] required' });
  if (!subject || !body)
    return res.status(400).json({ error: 'subject and body are required' });

  const isAdmin   = req.user.role === 'admin';
  const sentToday = await getSentToday(req.user.userId);
  const cap       = isAdmin ? Infinity : await getDailyCap();
  const profile   = await db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.userId);
  const previews  = [];
  let budgetLeft  = isAdmin ? Infinity : Math.max(0, cap - sentToday);

  for (const id of contactIds) {
    const contact = await db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(id, req.user.userId);
    if (!contact) continue;

    let blocked = false, blockReason = null, blockType = null;

    if (contact.status === 'Do Not Contact') {
      blocked = true; blockReason = 'Marked Do Not Contact'; blockType = 'do_not_contact';
    } else if (contact.email_deliverable === 'hard_bounce') {
      blocked = true; blockReason = 'Hard bounce — address does not exist'; blockType = 'hard_bounce';
    } else if (contact.email_deliverable === 'flagged') {
      blocked = true; blockReason = 'Flagged undeliverable (bounced for another user)'; blockType = 'flagged';
    } else if (await wasRecentlySent(id)) {
      blocked = true; blockReason = 'Already emailed in the last 14 days'; blockType = 'recently_sent';
    } else if (budgetLeft <= 0) {
      blocked = true; blockReason = `Daily cap of ${cap} reached`; blockType = 'cap_reached';
    } else {
      if (budgetLeft !== Infinity) budgetLeft--;
    }

    previews.push({
      contactId:        contact.id,
      name:             contact.name,
      email:            contact.email,
      company:          contact.company,
      subject:          renderTemplate(subject, contact, profile),
      body:             renderTemplate(body, contact, profile),
      blocked,
      blockReason,
      blockType,
      emailDeliverable: contact.email_deliverable || 'unknown',
    });
  }

  res.json({
    previews,
    sentToday,
    dailyCap:  isAdmin ? null : cap,
    eligible:  previews.filter(p => !p.blocked).length,
  });
});

// ── POST /api/email/send ───────────────────────────────────────────────────
router.post('/send', rlMiddleware('email'), async (req, res) => {
  const { sends, attachment } = req.body;
  if (!Array.isArray(sends) || !sends.length)
    return res.status(400).json({ error: 'sends[] required' });

  const mail = await getTransportForUser(req.user.userId);
  if (!mail)
    return res.status(400).json({
      error: 'No email account connected. Connect Google or configure SMTP in Settings first.'
    });
  const { transport, fromEmail } = mail;
  const fromName = sanitizeHeaderValue(mail.fromName);

  const isAdmin = req.user.role === 'admin';
  const cap     = isAdmin ? Infinity : await getDailyCap();
  if (!isAdmin && await getSentToday(req.user.userId) >= cap)
    return res.status(429).json({ error: `Daily send cap of ${cap} reached. Try again tomorrow.` });

  const results     = [];
  let sentCount     = await getSentToday(req.user.userId);
  const attachments = await resolveAttachment(attachment, req.user.userId);

  for (let i = 0; i < sends.length; i++) {
    // sends[] normally carries subject/body already rendered by /preview, but
    // never forward a raw, unresolved {{var}} to a real recipient regardless —
    // it reads as a broken mail-merge and is a strong spam signal on its own.
    const contactId    = sends[i].contactId;
    const subject      = sends[i].subject.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');
    const body         = sends[i].body.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');
    const contact = await db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(contactId, req.user.userId);
    if (!contact) { results.push({ contactId, ok: false, error: 'Contact not found' }); continue; }

    if (contact.status === 'Do Not Contact') {
      results.push({ contactId, ok: false, error: 'Do Not Contact' }); continue;
    }
    if (contact.email_deliverable === 'hard_bounce' || contact.email_deliverable === 'flagged') {
      results.push({ contactId, ok: false, error: 'Email undeliverable', deliverable: false }); continue;
    }
    if (await wasRecentlySent(contactId)) {
      results.push({ contactId, ok: false, error: 'Already emailed in the last 14 days' }); continue;
    }
    if (!isAdmin && sentCount >= cap) {
      results.push({ contactId, ok: false, error: 'Daily cap reached' }); continue;
    }

    const isHtml   = /<[a-zA-Z]/.test(body);
    // Sanitize HTML to strip any injected script/iframe/event-handler payloads
    const safeBody = isHtml ? sanitizeHtml(body, EMAIL_HTML_OPTS) : body;
    const textBody = isHtml ? stripHtml(safeBody) : safeBody;
    const htmlBody = isHtml
      ? `<div style="font-family:sans-serif;font-size:14px;line-height:1.7">${safeBody}</div>`
      : `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${
          safeBody.split('\n').map(l => `<p style="margin:0 0 4px">${l || '&nbsp;'}</p>`).join('')
        }</div>`;

    const mailOpts = {
      from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to:      contact.email,
      subject,
      text:    textBody,
      html:    htmlBody,
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    const logId = crypto.randomUUID();
    const now   = new Date().toISOString().replace('T', ' ').slice(0, 19);

    try {
      const info  = await transport.sendMail(mailOpts);
      const msgId = info?.messageId || null;

      await db.prepare(`
        INSERT INTO email_log (id, contact_id, user_id, subject, body_snapshot, delivery_status, message_id)
        VALUES (?, ?, ?, ?, ?, 'sent', ?)
      `).run(logId, contactId, req.user.userId, subject, textBody, msgId);

      await db.prepare(`
        INSERT INTO email_delivery_events (id, email_log_id, contact_id, user_id, event_type, message_id, created_at)
        VALUES (?, ?, ?, ?, 'sent', ?, ?)
      `).run(crypto.randomUUID(), logId, contactId, req.user.userId, msgId, now);

      // SMTP acceptance is our best signal that the address is reachable
      if (!['hard_bounce', 'flagged'].includes(contact.email_deliverable)) {
        await db.prepare(`UPDATE contacts SET email_deliverable = 'valid' WHERE id = ?`).run(contactId);
      }

      const newStatus = ['New', 'Drafted'].includes(contact.status) ? 'Sent' : contact.status;
      await db.prepare(`UPDATE contacts SET status = ?, date_last_contacted = ? WHERE id = ?`)
        .run(newStatus, now, contactId);

      await upsertBillingStats(req.user.userId, 'emails_sent');

      sentCount++;
      results.push({ contactId, ok: true, email: contact.email, messageId: msgId });

    } catch (err) {
      const bounceType   = classifyBounce(err);
      const bounceReason = err.message || 'Unknown error';
      const isBounce     = bounceType !== 'failed';

      const deliveryStatus = bounceType === 'hard_bounce' ? 'bounced'
                           : bounceType === 'soft_bounce' ? 'soft_bounce'
                           : 'failed';

      await db.prepare(`
        INSERT INTO email_log (id, contact_id, user_id, subject, body_snapshot, bounced, delivery_status, bounce_reason, bounced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(logId, contactId, req.user.userId, subject, textBody, isBounce ? 1 : 0, deliveryStatus, bounceReason, now);

      await db.prepare(`
        INSERT INTO email_delivery_events (id, email_log_id, contact_id, user_id, event_type, bounce_reason, raw_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), logId, contactId, req.user.userId,
        bounceType, bounceReason, JSON.stringify({ responseCode: err.responseCode || null }), now
      );

      if (bounceType === 'hard_bounce') {
        await db.prepare(`
          UPDATE contacts SET
            email_deliverable = 'hard_bounce',
            bounce_count      = bounce_count + 1,
            last_bounce_at    = ?,
            bounce_reason     = ?,
            status            = 'Do Not Contact'
          WHERE id = ?
        `).run(now, bounceReason, contactId);

        // Cross-user shared intelligence: flag this address for all other users
        await db.prepare(`
          UPDATE contacts SET
            email_deliverable = 'flagged',
            bounce_count      = bounce_count + 1,
            last_bounce_at    = ?,
            bounce_reason     = ?
          WHERE LOWER(email) = LOWER(?) AND id != ? AND email_deliverable NOT IN ('hard_bounce', 'flagged')
        `).run(now, 'Flagged: hard bounce reported by another user', contact.email, contactId);

        await upsertBillingStats(req.user.userId, 'emails_bounced');

      } else if (bounceType === 'soft_bounce') {
        await db.prepare(`
          UPDATE contacts SET
            email_deliverable = CASE WHEN email_deliverable NOT IN ('hard_bounce') THEN 'soft_bounce' ELSE email_deliverable END,
            bounce_count      = bounce_count + 1,
            last_bounce_at    = ?,
            bounce_reason     = ?
          WHERE id = ?
        `).run(now, bounceReason, contactId);
        await upsertBillingStats(req.user.userId, 'emails_bounced');

      } else {
        await upsertBillingStats(req.user.userId, 'emails_failed');
      }

      results.push({ contactId, ok: false, error: err.message, bounced: isBounce, bounceType });
    }

    // 1s gap between sends — enough to stay within Gmail's per-second rate limit
    if (i < sends.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  // Sync Excel with only the current user's contacts (not all users' data)
  const userContacts = await db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY date_added DESC').all(req.user.userId);
  await syncExcel(userContacts);

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  res.json({ sent, failed, results });
});

// ── POST /api/email/test ───────────────────────────────────────────────────
router.post('/test', scrapeLimiter, async (req, res) => {
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

  if (req.user.role !== 'admin') {
    const cap = await getDailyCap();
    if (await getSentToday(req.user.userId) >= cap)
      return res.status(429).json({ error: `Daily send cap of ${cap} reached.` });
  }

  const htmlBody = body.split('\n').map(l => `<p style="margin:0 0 4px">${l || '&nbsp;'}</p>`).join('');

  try {
    await transport.sendMail({
      from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to, subject,
      text:    body,
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
    SELECT el.id, el.contact_id, el.user_id, el.sent_at, el.subject,
           el.opened, el.bounced, el.delivery_status, el.bounce_reason,
           el.bounced_at, el.message_id,
           c.name, c.email, c.company
    FROM email_log el
    JOIN contacts c ON c.id = el.contact_id
    WHERE el.user_id = ?
  `;
  const p = [req.user.userId];
  if (contactId) { q += ' AND el.contact_id = ?'; p.push(contactId); }
  q += ' ORDER BY el.sent_at DESC LIMIT ?';
  p.push(limit);

  res.json(await db.prepare(q).all(...p));
});

// ── GET /api/email/stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const isAdmin   = req.user.role === 'admin';
  const sentToday = await getSentToday(req.user.userId);
  const cap       = isAdmin ? null : await getDailyCap();
  const totalRow  = await db.prepare('SELECT COUNT(*) as c FROM email_log WHERE user_id = ?').get(req.user.userId);
  const total     = parseInt(totalRow?.c || 0);

  // Delivery status breakdown for this user's logs
  const deliveryRows = await db.prepare(
    `SELECT delivery_status, COUNT(*) as c FROM email_log WHERE user_id = ? GROUP BY delivery_status`
  ).all(req.user.userId);
  const delivery = {};
  for (const r of deliveryRows) delivery[r.delivery_status || 'sent'] = parseInt(r.c);

  // Billing stats for this user's current month
  const month      = new Date().toISOString().slice(0, 7);
  const billingRow = await db.prepare(`
    SELECT emails_sent, emails_delivered, emails_bounced, emails_failed
    FROM delivery_billing_stats
    WHERE user_id = ? AND billing_month = ?
  `).get(req.user.userId, month);

  // Contact deliverability summary — scoped to this user's contacts only
  const deliverabilityRows = await db.prepare(
    `SELECT email_deliverable, COUNT(*) as c FROM contacts WHERE user_id = ? GROUP BY email_deliverable`
  ).all(req.user.userId);
  const deliverability = {};
  for (const r of deliverabilityRows) deliverability[r.email_deliverable || 'unknown'] = parseInt(r.c);

  res.json({
    sentToday,
    dailyCap:  cap,
    remaining: isAdmin ? null : Math.max(0, cap - sentToday),
    totalSent: total,
    delivery,
    billing: billingRow ? {
      month,
      sent:      parseInt(billingRow.emails_sent      || 0),
      delivered: parseInt(billingRow.emails_delivered || 0),
      bounced:   parseInt(billingRow.emails_bounced   || 0),
      failed:    parseInt(billingRow.emails_failed    || 0),
    } : { month, sent: 0, delivered: 0, bounced: 0, failed: 0 },
    deliverability,
  });
});

module.exports = router;
