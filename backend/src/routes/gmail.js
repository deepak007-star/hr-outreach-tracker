'use strict';

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { decrypt } = require('../services/tokenCrypto');
const { cleanContactName } = require('../lib/nameUtils');

const router = express.Router();

// Gmail sync now shares the single Google connection made via
// /api/oauth/google/start (oauth_accounts table) instead of its own
// separate OAuth flow — one "Connect Google" covers both sending and sync.

function isGoogleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Accounts connected before gmail.metadata was added to routes/oauth.js's
// GOOGLE_SCOPES only have gmail.send stored — any read call here (messages.
// list/get, threads.get) will 403 with an insufficient-scope error until
// they reconnect Google to re-grant the expanded scope set. Surface that as
// a clear message instead of the raw API error.
function friendlyGmailError(err) {
  const msg = err?.message || '';
  if (err?.code === 403 || /insufficient.*scope|insufficient permission/i.test(msg)) {
    return 'Gmail Sync needs an updated permission grant — disconnect and reconnect your Google account to enable it.';
  }
  return msg || 'Gmail Sync failed';
}

// ─── GET /api/gmail/status ────────────────────────────────────────────────────

router.get('/status', requireAuth, async (req, res) => {
  try {
    const oauthRow = await db.prepare(
      "SELECT email, scope FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
    ).get(req.user.userId);
    const lastSync = await db.prepare(
      'SELECT MAX(last_synced_at) as ts FROM gmail_tracked_emails WHERE user_id = ?'
    ).get(req.user.userId);
    res.json({
      connected:         !!oauthRow,
      gmailEmail:        oauthRow?.email || null,
      lastSynced:        lastSync?.ts || null,
      configured:        isGoogleConfigured(),
      hasMetadataScope:  !!oauthRow?.scope?.includes('gmail.metadata'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: get authenticated Gmail client for a user ───────────────────────

async function getGmailClient(userId) {
  if (!isGoogleConfigured()) {
    const e = new Error('Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env (from your Google Cloud Console OAuth client), then restart the backend.');
    e.notConfigured = true;
    throw e;
  }
  const row = await db.prepare(
    "SELECT refresh_token FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
  ).get(userId);
  if (!row) throw new Error('Gmail not connected — connect your Google account in Settings first.');

  const { google } = require('googleapis');
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: decrypt(row.refresh_token) });

  return google.gmail({ version: 'v1', auth: oauth2 });
}

// ─── Core sync logic — shared by the manual POST /sync route below and the
// automatic background job in index.js, so "Sync Now" and auto-sync are
// always the exact same code path, not two implementations to keep in sync. ──

// maxPages/windowDays default to the manual "Sync Now" button's full deep
// scan (500 messages / 18 months). The background auto-sync job in index.js
// calls this with a much smaller window (a couple pages, a few days) — it
// only needs to catch NEW activity since the last poll, not re-scan history
// every 20 minutes.
async function syncGmailForUser(userId, { maxPages = 10, windowDays = 548 } = {}) {
    const gmail = await getGmailClient(userId);

    const oauthRow = await db.prepare(
      "SELECT email FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
    ).get(userId);

    const sinceMs = Date.now() - windowDays * 86_400_000;

    // gmail.metadata scope does not allow the `q` search parameter at all
    // ("Parameter cannot be used when accessing the api using the
    // gmail.metadata scope" — Gmail API reference) — filter to the Sent
    // folder via labelIds instead of `in:sent`, and rely on Gmail's default
    // newest-first ordering to stop paginating as soon as a message is older
    // than the 18-month cutoff, rather than a server-side date filter.
    // This also means every sent contact is picked up, not just ones
    // matching HR-ish keywords — matches "show all previous contacts."
    let messages   = [];
    let pageToken  = null;
    let iterations = 0;

    while (iterations < maxPages) {
      const listResp = await gmail.users.messages.list({
        userId:    'me',
        labelIds:  ['SENT'],
        maxResults: 50,
        pageToken: pageToken || undefined,
      });

      const batch = listResp.data.messages || [];
      messages.push(...batch);

      pageToken = listResp.data.nextPageToken;
      iterations++;
      if (!pageToken || messages.length >= maxPages * 50) break;
    }

    let imported = 0;
    let scanned  = 0;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id:     msg.id,
          format: 'metadata',
          metadataHeaders: ['To', 'Subject', 'Date', 'From'],
        });

        const headers = detail.data.payload?.headers || [];
        const getH    = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        const toHeader   = getH('To');
        const subject    = getH('Subject');
        const dateHeader = getH('Date');
        const threadId   = detail.data.threadId;

        const msgDate = dateHeader ? new Date(dateHeader) : null;
        // Sent folder is returned newest-first — once we're past the
        // 18-month cutoff there's nothing older left worth checking.
        if (msgDate && !isNaN(msgDate) && msgDate.getTime() < sinceMs) break;
        scanned++;

        // Extract recipient email
        const emailMatch = toHeader.match(/[\w._%+\-]+@[\w.\-]+\.[a-z]{2,}/i);
        if (!emailMatch) continue;
        const contactEmail = emailMatch[0].toLowerCase();
        const contactName  = toHeader.replace(emailMatch[0], '').replace(/[<>,"]/g, '').trim() || contactEmail;

        const sentAt = msgDate && !isNaN(msgDate)
          ? msgDate.toISOString().replace('T', ' ').slice(0, 19)
          : now;

        // Check if thread has replies (reply = another message in thread not from 'me')
        let emailStatus = 'sent';
        let repliedAt   = null;
        let replySnippet = null;

        const threadDetail = await gmail.users.threads.get({
          userId: 'me',
          id:     threadId,
          format: 'metadata',
          metadataHeaders: ['From', 'Date'],
        });

        const threadMessages = threadDetail.data.messages || [];
        if (threadMessages.length > 1) {
          // Find a reply that is NOT from the user themselves (not from userEmail)
          const userEmail = oauthRow?.email || '';
          const replyMsg  = threadMessages.find(m => {
            if (m.id === msg.id) return false;
            const from = m.payload?.headers?.find(h => h.name === 'From')?.value || '';
            return !from.toLowerCase().includes(userEmail.toLowerCase());
          });
          if (replyMsg) {
            emailStatus  = 'replied';
            const replyDate = replyMsg.payload?.headers?.find(h => h.name === 'Date')?.value;
            repliedAt    = replyDate ? new Date(replyDate).toISOString().replace('T', ' ').slice(0, 19) : now;
            replySnippet = replyMsg.snippet?.slice(0, 300) || '';
          }
        }

        const id = crypto.createHash('sha256')
          .update(`${userId}|${msg.id}`)
          .digest('hex').slice(0, 32);

        await db.prepare(`
          INSERT INTO gmail_tracked_emails (
            id, user_id, gmail_message_id, gmail_thread_id,
            contact_email, contact_name, subject, body_snippet,
            sent_at, email_status, replied_at, reply_snippet, last_synced_at, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT (id) DO UPDATE SET
            email_status   = EXCLUDED.email_status,
            replied_at     = EXCLUDED.replied_at,
            reply_snippet  = EXCLUDED.reply_snippet,
            last_synced_at = EXCLUDED.last_synced_at
        `).run(
          id, userId, msg.id, threadId,
          contactEmail, contactName, subject, detail.data.snippet?.slice(0, 300) || '',
          sentAt, emailStatus, repliedAt, replySnippet, now, now
        );
        imported++;
        // Deliberately NOT auto-creating a row in the shared `contacts`
        // table here — that table has no per-user scoping (see routes/
        // contacts.js), so every signed-in user sees every row in it.
        // Silently writing someone's personal Gmail history there would
        // leak their contacts to every other user of the app. Promoting a
        // synced contact into the shared table is an explicit, per-contact
        // action instead — see POST /emails/:id/add-contact below.
      } catch { /* skip individual message errors */ }
    }

    return { imported, scanned, total: messages.length };
}

// ─── POST /api/gmail/sync — fetch HR emails from Gmail (manual, deep scan) ────

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const result = await syncGmailForUser(req.user.userId);
    res.json(result);
  } catch (err) {
    console.error('[Gmail sync]', err.message);
    res.status(500).json({ error: friendlyGmailError(err) });
  }
});

// ─── GET /api/gmail/emails ─────────────────────────────────────────────────────

router.get('/emails', requireAuth, async (req, res) => {
  try {
    const {
      since      = '18m',
      status,
      search,
      limit      = '50',
      page       = '1',
      replies_only,
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum  = Math.max(parseInt(page) || 1, 1);
    const offset   = (pageNum - 1) * limitNum;

    // since: '7d', '30d', '18m' (18 months)
    function sinceToCutoff(s) {
      const now = Date.now();
      if (s === '18m') return new Date(now - 548 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
      const days = parseInt(s) || 30;
      return new Date(now - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    }

    const cutoff = sinceToCutoff(since);
    const params = [req.user.userId, cutoff];
    let q = 'SELECT * FROM gmail_tracked_emails WHERE user_id = ? AND sent_at >= ?';

    if (status)                          { q += ' AND email_status = ?'; params.push(status); }
    if (replies_only === 'true')         { q += ` AND email_status = 'replied'`; }
    if (search) {
      q += ' AND (contact_email ILIKE ? OR contact_name ILIKE ? OR subject ILIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const countRow = await db.prepare(q.replace('SELECT *', 'SELECT COUNT(*) as total')).get(...params);
    const total    = parseInt(countRow?.total || 0);

    q += ' ORDER BY sent_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const rows = await db.prepare(q).all(...params);
    res.json({ emails: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/gmail/emails/:id/add-contact — explicitly promote one synced
// contact into the shared Contacts table (never automatic — see /sync) ────

router.post('/emails/:id/add-contact', requireAuth, async (req, res) => {
  try {
    const row = await db.prepare(
      'SELECT * FROM gmail_tracked_emails WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.userId);
    if (!row) return res.status(404).json({ error: 'Tracked email not found' });

    const existing = await db.prepare('SELECT id FROM contacts WHERE email = ? AND user_id = ?').get(row.contact_email, req.user.userId);
    if (existing) return res.json({ ok: true, added: false, reason: 'already in Contacts' });

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(`
      INSERT INTO contacts (id, user_id, name, email, email_source, status, date_added, date_last_contacted, notes)
      VALUES (?, ?, ?, ?, 'gmail', ?, ?, ?, ?)
      ON CONFLICT (email, user_id) DO NOTHING
    `).run(
      crypto.randomUUID(), req.user.userId, cleanContactName(row.contact_name, row.contact_email), row.contact_email,
      row.email_status === 'replied' ? 'Replied' : 'Sent',
      now, row.replied_at || row.sent_at, `Imported from Gmail Sync — last subject: "${row.subject}"`
    );
    res.json({ ok: true, added: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/gmail/add-all-contacts — promote every synced contact not ───
// already in the shared Contacts table, deduped by email (most recent
// tracked email per contact wins for name/subject/status) ──────────────────

router.post('/add-all-contacts', requireAuth, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT DISTINCT ON (contact_email) contact_email, contact_name, subject, email_status, sent_at, replied_at
      FROM gmail_tracked_emails
      WHERE user_id = ?
      ORDER BY contact_email, sent_at DESC
    `).all(req.user.userId);

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    let added = 0, skipped = 0;
    for (const row of rows) {
      const existing = await db.prepare('SELECT id FROM contacts WHERE email = ? AND user_id = ?').get(row.contact_email, req.user.userId);
      if (existing) { skipped++; continue; }
      await db.prepare(`
        INSERT INTO contacts (id, user_id, name, email, email_source, status, date_added, date_last_contacted, notes)
        VALUES (?, ?, ?, ?, 'gmail', ?, ?, ?, ?)
        ON CONFLICT (email, user_id) DO NOTHING
      `).run(
        crypto.randomUUID(), req.user.userId, cleanContactName(row.contact_name, row.contact_email), row.contact_email,
        row.email_status === 'replied' ? 'Replied' : 'Sent',
        now, row.replied_at || row.sent_at, `Imported from Gmail Sync — last subject: "${row.subject}"`
      );
      added++;
    }
    res.json({ ok: true, added, skipped, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/gmail/recent-replies — replies in last 30 days ──────────────────

router.get('/recent-replies', requireAuth, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const rows = await db.prepare(`
      SELECT * FROM gmail_tracked_emails
      WHERE user_id = ? AND email_status = 'replied' AND replied_at >= ?
      ORDER BY replied_at DESC
      LIMIT 50
    `).all(req.user.userId, cutoff);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/gmail/reply — send a quick reply via Gmail API ─────────────────

router.post('/reply', requireAuth, async (req, res) => {
  try {
    const { emailId, subject, body, threadId } = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });

    const gmail    = await getGmailClient(req.user.userId);
    const oauthRow = await db.prepare(
      "SELECT email FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
    ).get(req.user.userId);

    // Build RFC 2822 email
    const to      = req.body.to || '';
    const replyTo = subject?.startsWith('Re:') ? subject : `Re: ${subject || ''}`;
    const raw = [
      `From: ${oauthRow.email}`,
      `To: ${to}`,
      `Subject: ${replyTo}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ].join('\r\n');

    const encoded = Buffer.from(raw).toString('base64url');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encoded,
        threadId: threadId || undefined,
      },
    });

    // Update email status
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (emailId) {
      await db.prepare('UPDATE gmail_tracked_emails SET email_status=?, last_synced_at=? WHERE id=? AND user_id=?')
        .run('replied', now, emailId, req.user.userId);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Gmail reply]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/gmail/disconnect ─────────────────────────────────────────────
// Disconnects the shared Google connection — also stops outreach sending
// from this account, since it's the same oauth_accounts row.

router.delete('/disconnect', requireAuth, async (req, res) => {
  try {
    await db.prepare("DELETE FROM oauth_accounts WHERE user_id = ? AND provider = 'google'").run(req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.syncGmailForUser = syncGmailForUser;
