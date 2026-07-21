'use strict';

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { getTransportForUser } = require('../services/mailTransport');

const router = express.Router();
router.use(requireAuth);

// Per-pair send limit, admin-configurable (see routes/admin.js) — defaults
// to 2 so a normal user isn't stuck at the old hard-coded "once ever".
async function getReferralLimit() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'referral_request_limit'").get();
  return parseInt(row?.value || '2');
}

// GET /api/referrals/users
// Returns all users except the caller, with profile info and how many
// times the caller has already requested a referral from them.
router.get('/users', async (req, res) => {
  try {
    const myId  = req.user.userId;
    const limit = await getReferralLimit();
    // request_count via correlated subquery, not a LEFT JOIN on the pair —
    // a JOIN would duplicate the user row once more than one request per
    // pair is allowed.
    const rows = await db.prepare(`
      SELECT
        u.id, u.name, u.email, u.created_at,
        p.current_title, p.current_company, p.location,
        p.skills, p.summary, p.linkedin_url,
        p.job_title_1, p.job_title_2, p.job_title_3,
        (SELECT COUNT(*) FROM referral_requests r
          WHERE r.from_user_id = ? AND r.to_user_id = u.id) AS request_count
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id != ?
      ORDER BY u.name ASC
    `).all(myId, myId);
    const users = rows.map(u => ({
      ...u,
      request_count: parseInt(u.request_count) || 0,
      request_sent:  parseInt(u.request_count) >= limit ? 1 : 0,
    }));
    res.json({ users, limit });
  } catch (err) {
    console.error('[referrals] GET /users error:', err);
    res.status(500).json({ error: 'Failed to load community members' });
  }
});

// GET /api/referrals/received
// Returns referral requests received by the current user.
router.get('/received', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT r.id, r.from_user_id, r.subject, r.message, r.created_at,
             u.name AS from_name, u.email AS from_email,
             p.current_title AS from_title, p.current_company AS from_company
      FROM referral_requests r
      JOIN users u ON u.id = r.from_user_id
      LEFT JOIN profiles p ON p.user_id = r.from_user_id
      WHERE r.to_user_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.userId);
    res.json(rows);
  } catch (err) {
    console.error('[referrals] GET /received error:', err);
    res.status(500).json({ error: 'Failed to load received requests' });
  }
});

// GET /api/referrals/sent
// Returns referral requests sent by the current user.
router.get('/sent', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT r.id, r.to_user_id, r.subject, r.message, r.created_at,
             u.name AS to_name, u.email AS to_email
      FROM referral_requests r
      JOIN users u ON u.id = r.to_user_id
      WHERE r.from_user_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.userId);
    res.json(rows);
  } catch (err) {
    console.error('[referrals] GET /sent error:', err);
    res.status(500).json({ error: 'Failed to load sent requests' });
  }
});

// POST /api/referrals/ask/:targetUserId
// Sends a referral-request email to another user, up to the configurable
// per-pair limit (settings.referral_request_limit, default 2 — admins can
// raise it or reset a specific pair's count from the admin panel).
router.post('/ask/:targetUserId', async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const { subject, message } = req.body;
    const myId = req.user.userId;

    if (myId === targetUserId)
      return res.status(400).json({ error: 'Cannot send a referral request to yourself' });

    if (!message?.trim())
      return res.status(400).json({ error: 'Message is required' });

    const limit = await getReferralLimit();
    const { c: sentCount } = await db.prepare(
      'SELECT COUNT(*) as c FROM referral_requests WHERE from_user_id = ? AND to_user_id = ?'
    ).get(myId, targetUserId);
    if (parseInt(sentCount) >= limit)
      return res.status(409).json({
        error: `You've already sent ${limit} referral request${limit !== 1 ? 's' : ''} to this user`,
      });

    const target = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(targetUserId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const sender = await db.prepare('SELECT name, email FROM users WHERE id = ?').get(myId);

    const mail = await getTransportForUser(myId);
    if (!mail)
      return res.status(400).json({
        error: 'No email account connected. Connect your Gmail or configure SMTP in Settings first.',
      });

    const { transport, fromEmail, fromName } = mail;
    const finalSubject = subject?.trim() || `Referral Request from ${sender.name}`;
    const finalMessage = message.trim();

    // Send first, then record — if the send fails we must not leave a row
    // behind, or the duplicate-request guard above would permanently block
    // every retry even though no email ever went out.
    await transport.sendMail({
      from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      to:      `"${target.name}" <${target.email}>`,
      subject: finalSubject,
      text:    finalMessage,
      html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;white-space:pre-wrap">${finalMessage.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`,
    });

    await db.prepare(
      'INSERT INTO referral_requests (id, from_user_id, to_user_id, subject, message) VALUES (?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), myId, targetUserId, finalSubject, finalMessage);

    res.json({ ok: true, to: target.name });
  } catch (err) {
    console.error('[referrals] POST /ask error:', err);
    res.status(500).json({ error: err.message || 'Failed to send referral request' });
  }
});

module.exports = router;
