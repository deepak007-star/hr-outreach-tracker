'use strict';

const express  = require('express');
const crypto   = require('crypto');
const db       = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getTransportForUser } = require('../services/mailTransport');

const router = express.Router();

// ─── GET /api/scraped-jobs ────────────────────────────────────────────────────
// Query params: category, since (1d|3d|7d|24d|30d), limit, page, search, scraper

router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      category,
      since    = '7d',
      limit    = '50',
      page     = '1',
      search,
      scraper,
    } = req.query;

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const pageNum  = Math.max(parseInt(page) || 1, 1);
    const offset   = (pageNum - 1) * limitNum;

    // Compute cutoff timestamp based on 'since' param
    function sinceToCutoff(s) {
      const now = Date.now();
      const map = { '1d': 1, '3d': 3, '7d': 7, '24d': 24, '30d': 30 };
      const days = map[s] || 7;
      return new Date(now - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    }

    const cutoff = sinceToCutoff(since);
    const params = [cutoff];
    let q = 'SELECT * FROM scraped_jobs WHERE created_at >= ?';

    if (category) { q += ' AND job_category = ?'; params.push(category); }
    if (scraper)  { q += ' AND scraper_type = ?';  params.push(scraper); }
    if (search) {
      q += ' AND (title ILIKE ? OR company ILIKE ? OR location ILIKE ? OR tags ILIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const countQ  = q.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countRow = await db.prepare(countQ).get(...params);
    const total    = parseInt(countRow?.total || 0);

    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const rows = await db.prepare(q).all(...params);

    res.json({
      jobs:  rows,
      total,
      page:  pageNum,
      limit: limitNum,
      since,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scraped-jobs/stats ──────────────────────────────────────────────

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const d7  = new Date(Date.now() - 7  * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const [total, last30, last7, byCategory] = await Promise.all([
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs').get(),
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs WHERE created_at >= ?').get(d30),
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs WHERE created_at >= ?').get(d7),
      db.prepare('SELECT job_category, COUNT(*) as c FROM scraped_jobs GROUP BY job_category').all(),
    ]);

    res.json({
      total:    parseInt(total?.c || 0),
      last30:   parseInt(last30?.c || 0),
      last7:    parseInt(last7?.c || 0),
      byCategory: Object.fromEntries((byCategory || []).map(r => [r.job_category, parseInt(r.c)])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/scraped-jobs/purge (admin) ─────────────────────────────────────

router.post('/purge', requireAdmin, async (req, res) => {
  try {
    const { retention_days } = req.body;
    const days = Math.max(parseInt(retention_days) || 30, 1);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const result = await db.prepare('DELETE FROM scraped_jobs WHERE created_at < ?').run(cutoff);

    // Update last_purge in settings
    const purgeRow = await db.prepare("SELECT value FROM settings WHERE key = 'purge_config'").get();
    let cfg = {};
    try { cfg = JSON.parse(purgeRow?.value || '{}'); } catch {}
    cfg.last_purge = new Date().toISOString().slice(0, 10);
    cfg.retention_days = days;
    await db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
      .run('purge_config', JSON.stringify(cfg));

    res.json({ deleted: result.changes, cutoff, retention_days: days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scraped-jobs/feed-contacts ──────────────────────────────────────
// Email contacts from the linkedin-feed scraper, with per-user "already emailed"
// flag. Used by the Gmail Tracking tab for auto-synced cold-email leads.
// Query params: since (7d|14d|30d|90d), limit, page, search

router.get('/feed-contacts', requireAuth, async (req, res) => {
  try {
    const { since = '30d', limit = '200', page = '1', search } = req.query;
    const limitNum = Math.min(parseInt(limit) || 100, 500);
    const pageNum  = Math.max(parseInt(page)  || 1,   1);
    const offset   = (pageNum - 1) * limitNum;

    const daysMap = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30, '90d': 90 };
    const cutoff  = new Date(Date.now() - (daysMap[since] || 30) * 86_400_000)
      .toISOString().replace('T', ' ').slice(0, 19);

    const params = [cutoff];
    let q = `SELECT * FROM scraped_jobs
             WHERE scraper_type = 'linkedin-feed'
               AND contact_email IS NOT NULL
               AND contact_email != ''
               AND created_at >= ?`;

    if (search) {
      q += ` AND (title ILIKE ? OR company ILIKE ? OR contact_email ILIKE ? OR description ILIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const contacts = await db.prepare(q).all(...params);

    // Mark which ones the current user has already emailed
    if (contacts.length) {
      const emails    = [...new Set(contacts.map(c => c.contact_email).filter(Boolean))];
      const placeholders = emails.map(() => '?').join(',');
      const emailed   = await db.prepare(
        `SELECT DISTINCT contact_email FROM gmail_tracked_emails WHERE user_id = ? AND contact_email IN (${placeholders})`
      ).all(req.user.userId, ...emails);
      const emailedSet = new Set(emailed.map(r => r.contact_email));
      contacts.forEach(c => { c.already_emailed = emailedSet.has(c.contact_email) ? 1 : 0; });
    }

    res.json({ contacts, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/scraped-jobs/send-feed-emails ──────────────────────────────────
// Sends one separate email per contact and records each in gmail_tracked_emails.
// Body: { subject, body, contacts: [{ email, name, company, title }] }

router.post('/send-feed-emails', requireAuth, async (req, res) => {
  try {
    const { subject, body, contacts } = req.body;
    if (!Array.isArray(contacts) || !contacts.length)
      return res.status(400).json({ error: 'contacts[] required' });
    if (!subject?.trim() || !body?.trim())
      return res.status(400).json({ error: 'subject and body required' });

    const mail = await getTransportForUser(req.user.userId);
    if (!mail)
      return res.status(400).json({
        error: 'No email account connected. Connect Gmail or configure SMTP in Settings first.',
      });

    const { transport, fromEmail, fromName } = mail;
    const now     = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const results = [];
    const htmlBody = body.trim()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    for (const contact of contacts) {
      const { email, name = '', company = '' } = contact;
      if (!email) { results.push({ email, ok: false, error: 'Missing email' }); continue; }

      try {
        await transport.sendMail({
          from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
          to:      name ? `"${name}" <${email}>` : email,
          subject: subject.trim(),
          text:    body.trim(),
          html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.7">${htmlBody}</div>`,
        });

        await db.prepare(`
          INSERT INTO gmail_tracked_emails
            (id, user_id, contact_email, contact_name, subject, body_snippet, full_body, sent_at, email_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent')
          ON CONFLICT DO NOTHING
        `).run(
          crypto.randomUUID(), req.user.userId,
          email, name,
          subject.trim(), body.trim().slice(0, 200), body.trim(), now
        );

        results.push({ email, ok: true });
      } catch (e) {
        results.push({ email, ok: false, error: e.message });
      }
    }

    const sent = results.filter(r => r.ok).length;
    res.json({ sent, total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
