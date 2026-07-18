'use strict';

const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { getTransportForUser } = require('../services/mailTransport');

const router = express.Router();
router.use(requireAuth);

// GET /api/referrals/users
// Returns all users except the caller, with profile info and whether
// the caller has already sent them a referral request.
router.get('/users', async (req, res) => {
  const myId = req.user.userId;
  const users = await db.prepare(`
    SELECT
      u.id, u.name, u.email, u.created_at,
      p.current_title, p.current_company, p.location,
      p.skills, p.summary, p.linkedin_url,
      p.job_title_1, p.job_title_2, p.job_title_3,
      CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS request_sent
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN referral_requests r
           ON r.from_user_id = ? AND r.to_user_id = u.id
    WHERE u.id != ?
    ORDER BY u.name ASC
  `).all(myId, myId);
  res.json(users);
});

// GET /api/referrals/received
// Returns referral requests received by the current user.
router.get('/received', async (req, res) => {
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
});

// GET /api/referrals/sent
// Returns referral requests sent by the current user.
router.get('/sent', async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.to_user_id, r.subject, r.message, r.created_at,
           u.name AS to_name, u.email AS to_email
    FROM referral_requests r
    JOIN users u ON u.id = r.to_user_id
    WHERE r.from_user_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user.userId);
  res.json(rows);
});

// POST /api/referrals/ask/:targetUserId
// Sends a referral-request email to another user (one-time only per pair).
router.post('/ask/:targetUserId', async (req, res) => {
  const { targetUserId } = req.params;
  const { subject, message } = req.body;
  const myId = req.user.userId;

  if (myId === targetUserId)
    return res.status(400).json({ error: 'Cannot send a referral request to yourself' });

  if (!message?.trim())
    return res.status(400).json({ error: 'Message is required' });

  const existing = await db.prepare(
    'SELECT id FROM referral_requests WHERE from_user_id = ? AND to_user_id = ?'
  ).get(myId, targetUserId);
  if (existing)
    return res.status(409).json({ error: 'You have already sent a referral request to this user' });

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

  // Write DB record first — if email fails we can retry; if DB fails email would have no record
  await db.prepare(
    'INSERT INTO referral_requests (id, from_user_id, to_user_id, subject, message) VALUES (?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), myId, targetUserId, finalSubject, finalMessage);

  await transport.sendMail({
    from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    to:      `"${target.name}" <${target.email}>`,
    subject: finalSubject,
    text:    finalMessage,
    html:    `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;white-space:pre-wrap">${finalMessage.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`,
  });

  res.json({ ok: true, to: target.name });
});

module.exports = router;
