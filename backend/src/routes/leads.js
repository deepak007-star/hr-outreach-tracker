const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { leadLimiter } = require('../middleware/security');

const router = express.Router();

// ── POST /api/leads — public submit (upsert by email so users can edit) ─────
router.post('/', leadLimiter, async (req, res) => {
  const { name, email, mobile, plan_interest, experience, job_type, other_info,
          linkedin_url, twitter_handle, github_url, preferred_contact } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: 'Name is required.' });
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });

  const existing = await db.prepare('SELECT id FROM leads WHERE email = ?').get(email.trim().toLowerCase());

  if (existing) {
    await db.prepare(`
      UPDATE leads SET name=?, mobile=?, plan_interest=?, experience=?, job_type=?, other_info=?,
        linkedin_url=?, twitter_handle=?, github_url=?, preferred_contact=?, status='new'
      WHERE id=?
    `).run(
      name.trim(), mobile||null, plan_interest||null, experience||null,
      job_type||null, other_info||null,
      linkedin_url||null, twitter_handle||null, github_url||null, preferred_contact||null,
      existing.id,
    );
    return res.json({ success: true, updated: true, message: "Your interest has been updated!" });
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO leads (id, name, email, mobile, plan_interest, experience, job_type, other_info,
                       linkedin_url, twitter_handle, github_url, preferred_contact)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), email.trim().toLowerCase(), mobile||null,
    plan_interest||null, experience||null, job_type||null, other_info||null,
    linkedin_url||null, twitter_handle||null, github_url||null, preferred_contact||null);

  res.status(201).json({ success: true, message: "Thank you! We'll be in touch soon." });
});

// ── Admin routes (all require auth + admin) ──────────────────────────────────
router.use(requireAuth, requireAdmin);

// GET /api/leads — list all with optional filter
router.get('/', async (req, res) => {
  const { status } = req.query;
  const leads = status
    ? await db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY created_at DESC').all(status)
    : await db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  res.json(leads);
});

// PUT /api/leads/:id — update status / notes
router.put('/:id', async (req, res) => {
  const { status, notes, name, mobile, plan_interest, experience, job_type, other_info,
          linkedin_url, twitter_handle, github_url, preferred_contact } = req.body;
  const allowed = {};
  if (status            !== undefined) allowed.status            = status;
  if (notes             !== undefined) allowed.notes             = notes;
  if (name              !== undefined) allowed.name              = name;
  if (mobile            !== undefined) allowed.mobile            = mobile;
  if (plan_interest     !== undefined) allowed.plan_interest     = plan_interest;
  if (experience        !== undefined) allowed.experience        = experience;
  if (job_type          !== undefined) allowed.job_type          = job_type;
  if (other_info        !== undefined) allowed.other_info        = other_info;
  if (linkedin_url      !== undefined) allowed.linkedin_url      = linkedin_url;
  if (twitter_handle    !== undefined) allowed.twitter_handle    = twitter_handle;
  if (github_url        !== undefined) allowed.github_url        = github_url;
  if (preferred_contact !== undefined) allowed.preferred_contact = preferred_contact;

  if (!Object.keys(allowed).length) return res.status(400).json({ error: 'Nothing to update' });

  const sets   = Object.keys(allowed).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(allowed), req.params.id];
  await db.prepare(`UPDATE leads SET ${sets} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
