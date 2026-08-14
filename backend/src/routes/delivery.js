const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const WEBHOOK_SECRET = process.env.DELIVERY_WEBHOOK_SECRET || '';
if (!WEBHOOK_SECRET) {
  console.warn('[SECURITY] DELIVERY_WEBHOOK_SECRET is not set — /api/delivery/webhooks/bounce is disabled until it is configured. Set it and point your ESP\'s webhook URL at .../bounce?secret=<value>.');
}

// Plain !== leaks a (small, but real) timing signal via V8's char-by-char
// short-circuit string comparison. crypto.timingSafeEqual closes that for the
// content comparison; the length check has to happen first since
// timingSafeEqual throws on mismatched lengths rather than returning false.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── POST /api/delivery/webhooks/bounce — ESP bounce/failure webhook ────────
// Handles Mailgun, SendGrid, Postmark, or any generic provider. No JWT auth —
// the ESP posts here directly, not a logged-in user — so it's gated by a
// shared secret instead (query param or header, since signing schemes differ
// per provider). Without this, anyone on the internet could POST a fake
// "hard_bounce" event for any email address and flip any user's contact to
// Do Not Contact.
router.post('/webhooks/bounce', async (req, res) => {
  const secret = req.query.secret || req.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || !secret || !safeEqual(secret, WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid or missing webhook secret' });
  }
  const body = req.body || {};
  try {
    // SendGrid sends an array of events
    if (Array.isArray(body)) {
      for (const evt of body) {
        const type = (evt.event || '').toLowerCase();
        await processWebhookEvent({
          email:     evt.email,
          eventType: type === 'bounce'    ? 'hard_bounce'
                   : type === 'deferred'  ? 'soft_bounce'
                   : type === 'dropped'   ? 'hard_bounce'
                   : type,
          reason:    evt.reason || evt.status || type,
          messageId: evt.smtp_id || evt['smtp-id'],
          rawData:   evt,
        });
      }
      return res.json({ ok: true, processed: body.length });
    }

    // Mailgun: { event, recipient, 'Message-Id', error: { code, description } }
    if (body.recipient) {
      const type = (body.event || '').toLowerCase();
      await processWebhookEvent({
        email:     body.recipient,
        eventType: type === 'bounced' ? 'hard_bounce' : type === 'failed' ? 'failed' : type,
        reason:    body.error?.description || body['error-description'] || body.event,
        messageId: body['Message-Id'] || body.messageId,
        rawData:   body,
      });
      return res.json({ ok: true });
    }

    // Postmark / generic: { Email, Description, Type, MessageID }
    const email = body.Email || body.email || body.To;
    if (!email) return res.status(400).json({ error: 'Cannot extract email from webhook payload' });
    const type = (body.Type || body.event || '').toLowerCase();
    await processWebhookEvent({
      email,
      eventType: type.includes('hard') || type === 'bounce' ? 'hard_bounce'
               : type.includes('soft') || type === 'deferred' ? 'soft_bounce'
               : 'failed',
      reason:    body.Description || body.reason || body.Type,
      messageId: body.MessageID || body.messageId,
      rawData:   body,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[delivery webhook]', err);
    res.status(500).json({ error: err.message });
  }
});

async function processWebhookEvent({ email, eventType, reason, messageId, rawData }) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Find the most recent email_log entry for this message or email address
  let logRow = null;
  if (messageId) {
    logRow = await db.prepare(`
      SELECT el.*, c.email AS contact_email
      FROM email_log el JOIN contacts c ON c.id = el.contact_id
      WHERE el.message_id = ?
    `).get(messageId);
  }
  if (!logRow) {
    logRow = await db.prepare(`
      SELECT el.*, c.email AS contact_email
      FROM email_log el JOIN contacts c ON c.id = el.contact_id
      WHERE LOWER(c.email) = LOWER(?)
      ORDER BY el.sent_at DESC LIMIT 1
    `).get(email);
  }

  // Update email_log delivery status
  if (logRow) {
    const newStatus = eventType === 'hard_bounce' ? 'bounced'
                    : eventType === 'soft_bounce'  ? 'soft_bounce'
                    : 'failed';
    await db.prepare(`
      UPDATE email_log SET delivery_status = ?, bounce_reason = ?, bounced_at = ?, bounced = ?
      WHERE id = ?
    `).run(newStatus, reason || null, now, eventType !== 'failed' ? 1 : 0, logRow.id);

    await db.prepare(`
      INSERT INTO email_delivery_events
        (id, email_log_id, contact_id, user_id, event_type, message_id, bounce_reason, raw_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), logRow.id, logRow.contact_id, logRow.user_id,
      eventType, messageId || null, reason || null, JSON.stringify(rawData), now
    );
  }

  // Update all contacts sharing this email address
  if (eventType === 'hard_bounce') {
    await db.prepare(`
      UPDATE contacts SET
        email_deliverable = 'hard_bounce',
        bounce_count      = bounce_count + 1,
        last_bounce_at    = ?,
        bounce_reason     = ?,
        status            = CASE WHEN status != 'Do Not Contact' THEN 'Do Not Contact' ELSE status END
      WHERE LOWER(email) = LOWER(?)
    `).run(now, reason || 'Hard bounce (webhook)', email);
  } else if (eventType === 'soft_bounce') {
    await db.prepare(`
      UPDATE contacts SET
        email_deliverable = CASE WHEN email_deliverable NOT IN ('hard_bounce') THEN 'soft_bounce' ELSE email_deliverable END,
        bounce_count      = bounce_count + 1,
        last_bounce_at    = ?,
        bounce_reason     = ?
      WHERE LOWER(email) = LOWER(?)
    `).run(now, reason || 'Soft bounce (webhook)', email);
  }
}

// ── GET /api/delivery/stats — delivery stats for current user ──────────────
router.get('/stats', requireAuth, async (req, res) => {
  const userId = req.user.userId;

  const months = await db.prepare(`
    SELECT billing_month, emails_sent, emails_delivered, emails_bounced, emails_failed
    FROM delivery_billing_stats
    WHERE user_id = ?
    ORDER BY billing_month DESC
    LIMIT 12
  `).all(userId);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const current = months.find(m => m.billing_month === currentMonth) || {
    billing_month:   currentMonth,
    emails_sent:     0,
    emails_delivered:0,
    emails_bounced:  0,
    emails_failed:   0,
  };

  const totals = months.reduce((acc, m) => ({
    sent:      acc.sent      + parseInt(m.emails_sent      || 0),
    delivered: acc.delivered + parseInt(m.emails_delivered || 0),
    bounced:   acc.bounced   + parseInt(m.emails_bounced   || 0),
    failed:    acc.failed    + parseInt(m.emails_failed    || 0),
  }), { sent: 0, delivered: 0, bounced: 0, failed: 0 });

  res.json({ currentMonth: current, history: months, totals });
});

// ── PATCH /api/delivery/log/:id/status — manual status override (admin) ────
router.patch('/log/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, bounceReason } = req.body;
  const valid = ['sent', 'delivered', 'bounced', 'soft_bounce', 'failed'];
  if (!valid.includes(status))
    return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });

  const row = await db.prepare('SELECT * FROM email_log WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Email log entry not found' });

  const now  = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const isBounceStatus = ['bounced', 'soft_bounce'].includes(status);

  await db.prepare(`
    UPDATE email_log SET delivery_status = ?, bounce_reason = ?, bounced = ?, bounced_at = ?
    WHERE id = ?
  `).run(status, bounceReason || null, isBounceStatus ? 1 : 0, isBounceStatus ? now : null, id);

  await db.prepare(`
    INSERT INTO email_delivery_events
      (id, email_log_id, contact_id, user_id, event_type, bounce_reason, raw_data, created_at)
    VALUES (?, ?, ?, ?, 'manual_override', ?, ?, ?)
  `).run(
    crypto.randomUUID(), id, row.contact_id, req.user.userId,
    bounceReason || null, JSON.stringify({ overridden_to: status }), now
  );

  res.json({ ok: true, id, status });
});

// ── POST /api/delivery/contacts/:id/flag — mark contact undeliverable ──────
router.post('/contacts/:id/flag', requireAuth, requireAdmin, async (req, res) => {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(`
    UPDATE contacts SET email_deliverable = 'flagged', last_bounce_at = ?, bounce_reason = ? WHERE id = ?
  `).run(now, req.body.reason || 'Manually flagged by admin', req.params.id);

  res.json({ ok: true, id: req.params.id, email_deliverable: 'flagged' });
});

// ── DELETE /api/delivery/contacts/:id/flag — remove undeliverable flag ─────
router.delete('/contacts/:id/flag', requireAuth, requireAdmin, async (req, res) => {
  const contact = await db.prepare('SELECT id FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  await db.prepare(`
    UPDATE contacts SET email_deliverable = 'unknown', bounce_reason = NULL, last_bounce_at = NULL
    WHERE id = ?
  `).run(req.params.id);

  res.json({ ok: true, id: req.params.id, email_deliverable: 'unknown' });
});

module.exports = router;
