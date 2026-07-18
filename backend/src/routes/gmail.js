'use strict';

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Google OAuth helper ──────────────────────────────────────────────────────
// Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI

function getOAuthClient() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/api/gmail/callback'
  );
}

function isGoogleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ─── GET /api/gmail/auth-url — OAuth initiation ───────────────────────────────

router.get('/auth-url', requireAuth, (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({
      error: 'Gmail integration not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend .env',
    });
  }
  const oauth2 = getOAuthClient();
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state: Buffer.from(JSON.stringify({ userId: req.user.userId })).toString('base64'),
  });
  res.json({ url });
});

// ─── GET /api/gmail/callback — OAuth code exchange ────────────────────────────

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?gmail_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?gmail_error=missing_params`);
  }

  try {
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    const oauth2     = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);

    // Get the Gmail address
    oauth2.setCredentials(tokens);
    const { google } = require('googleapis');
    const gmail      = google.gmail({ version: 'v1', auth: oauth2 });
    const profile    = await gmail.users.getProfile({ userId: 'me' });
    const gmailEmail = profile.data.emailAddress;

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    await db.prepare(`
      INSERT INTO gmail_tokens (user_id, gmail_email, access_token, refresh_token, token_expiry, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (user_id) DO UPDATE SET
        gmail_email   = EXCLUDED.gmail_email,
        access_token  = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, gmail_tokens.refresh_token),
        token_expiry  = EXCLUDED.token_expiry,
        updated_at    = EXCLUDED.updated_at
    `).run(
      userId, gmailEmail,
      tokens.access_token,
      tokens.refresh_token || null,
      tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      now, now
    );

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?gmail_connected=1`);
  } catch (err) {
    console.error('[Gmail callback]', err.message);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?gmail_error=${encodeURIComponent(err.message)}`);
  }
});

// ─── GET /api/gmail/status ────────────────────────────────────────────────────

router.get('/status', requireAuth, async (req, res) => {
  try {
    const token = await db.prepare('SELECT gmail_email, updated_at FROM gmail_tokens WHERE user_id = ?')
      .get(req.user.userId);
    res.json({
      connected:    !!token,
      gmailEmail:   token?.gmail_email || null,
      lastSynced:   token?.updated_at || null,
      configured:   isGoogleConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: get authenticated Gmail client for a user ───────────────────────

async function getGmailClient(userId) {
  const tokenRow = await db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(userId);
  if (!tokenRow) throw new Error('Gmail not connected for this user');

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    access_token:  tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date:   tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
  });

  // Auto-refresh token if expired / close to expiry
  oauth2.on('tokens', async (tokens) => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(`
      UPDATE gmail_tokens SET access_token=?, token_expiry=?, updated_at=? WHERE user_id=?
    `).run(
      tokens.access_token,
      tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      now, userId
    );
  });

  const { google } = require('googleapis');
  return google.gmail({ version: 'v1', auth: oauth2 });
}

// ─── POST /api/gmail/sync — fetch HR emails from Gmail ────────────────────────

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const gmail  = await getGmailClient(req.user.userId);
    const userId = req.user.userId;

    // Fetch sent emails from last 18 months (1.5 years)
    const sinceDate = new Date(Date.now() - 548 * 86_400_000); // ~18 months
    const after     = Math.floor(sinceDate.getTime() / 1000);

    // Search sent folder for HR-related emails
    const hrKeywords = [
      'job application', 'hiring', 'opportunity', 'resume', 'position',
      'developer', 'engineer', 'internship', 'role', 'recruiter', 'HR',
    ];
    const query = `in:sent after:${after} (${hrKeywords.map(k => `"${k}"`).join(' OR ')})`;

    let messages   = [];
    let pageToken  = null;
    let iterations = 0;

    // Collect up to 500 messages (rate-limit safe)
    while (iterations < 10) {
      const listResp = await gmail.users.messages.list({
        userId:    'me',
        q:         query,
        maxResults: 50,
        pageToken: pageToken || undefined,
      });

      const batch = listResp.data.messages || [];
      messages.push(...batch);

      pageToken = listResp.data.nextPageToken;
      iterations++;
      if (!pageToken || messages.length >= 500) break;
    }

    let imported = 0;
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

        // Extract recipient email
        const emailMatch = toHeader.match(/[\w._%+\-]+@[\w.\-]+\.[a-z]{2,}/i);
        if (!emailMatch) continue;
        const contactEmail = emailMatch[0].toLowerCase();
        const contactName  = toHeader.replace(emailMatch[0], '').replace(/[<>,"]/g, '').trim() || contactEmail;

        const sentAt = dateHeader
          ? new Date(dateHeader).toISOString().replace('T', ' ').slice(0, 19)
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
          // There's at least one reply
          const replyMsg = threadMessages.find(m => m.id !== msg.id);
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

        // Auto-create contact if not already tracked
        const existingContact = await db.prepare('SELECT id FROM contacts WHERE email = ?').get(contactEmail);
        if (!existingContact) {
          const contactId = crypto.randomUUID();
          await db.prepare(`
            INSERT INTO contacts (id, name, email, email_source, status, date_added)
            VALUES (?, ?, ?, 'gmail', ?, ?)
            ON CONFLICT (email) DO NOTHING
          `).run(contactId, contactName || contactEmail, contactEmail, emailStatus === 'replied' ? 'Replied' : 'Sent', now);
        } else if (emailStatus === 'replied') {
          // Update status if replied
          await db.prepare(`
            UPDATE contacts SET status='Replied', date_last_contacted=? WHERE email=? AND status IN ('Sent','Opened','New')
          `).run(repliedAt || now, contactEmail);
        }
      } catch { /* skip individual message errors */ }
    }

    // Update last synced
    await db.prepare('UPDATE gmail_tokens SET updated_at=? WHERE user_id=?').run(now, userId);

    res.json({ imported, total: messages.length });
  } catch (err) {
    console.error('[Gmail sync]', err.message);
    res.status(500).json({ error: err.message });
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
    const tokenRow = await db.prepare('SELECT gmail_email FROM gmail_tokens WHERE user_id=?').get(req.user.userId);

    // Build RFC 2822 email
    const to      = req.body.to || '';
    const replyTo = subject?.startsWith('Re:') ? subject : `Re: ${subject || ''}`;
    const raw = [
      `From: ${tokenRow.gmail_email}`,
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
        raw,
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

router.delete('/disconnect', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM gmail_tokens WHERE user_id = ?').run(req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
