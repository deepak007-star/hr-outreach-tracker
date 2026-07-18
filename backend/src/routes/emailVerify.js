const express = require('express');
const dns     = require('dns').promises;
const db      = require('../db/database');

const router = express.Router();

async function checkEmailDomain(email) {
  const domain = email?.split('@')[1];
  if (!domain) return 'invalid';
  try {
    const records = await dns.resolveMx(domain);
    return records?.length > 0 ? 'valid' : 'invalid';
  } catch {
    return 'unverifiable';
  }
}

// POST /api/email-verify/batch  — verify all contacts with pending/stale status
router.post('/batch', async (req, res) => {
  const contacts = db.prepare(
    `SELECT id, email FROM contacts
     WHERE email_verified IN ('pending','unverifiable')
        OR email_checked_at IS NULL
        OR email_checked_at < datetime('now', '-23 hours')`
  ).all();

  let updated = 0;
  for (const c of contacts) {
    const status = await checkEmailDomain(c.email);
    db.prepare(`UPDATE contacts SET email_verified = ?, email_checked_at = datetime('now') WHERE id = ?`)
      .run(status, c.id);
    updated++;
  }
  res.json({ updated });
});

// POST /api/email-verify/:id  — verify a single contact
router.post('/:id', async (req, res) => {
  const contact = db.prepare('SELECT id, email FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  const status = await checkEmailDomain(contact.email);
  db.prepare(`UPDATE contacts SET email_verified = ?, email_checked_at = datetime('now') WHERE id = ?`)
    .run(status, contact.id);
  res.json({ id: contact.id, email: contact.email, email_verified: status });
});

module.exports = router;
module.exports.checkEmailDomain = checkEmailDomain;
