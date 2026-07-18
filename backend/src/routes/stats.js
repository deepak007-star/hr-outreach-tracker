const express = require('express');
const db      = require('../db/database');
const router  = express.Router();

// GET /api/stats/activity?days=365
router.get('/activity', (req, res) => {
  const days = Math.min(parseInt(req.query.days || '365'), 730);

  const emailRows = db.prepare(`
    SELECT date(sent_at) as date, COUNT(*) as emails_sent
    FROM email_log
    WHERE date(sent_at) >= date('now', '-${days} days')
    GROUP BY date(sent_at)
  `).all();

  const contactRows = db.prepare(`
    SELECT date(date_added) as date, COUNT(*) as contacts_added
    FROM contacts
    WHERE date(date_added) >= date('now', '-${days} days')
    GROUP BY date(date_added)
  `).all();

  const map = {};

  for (const r of emailRows) {
    map[r.date] = { date: r.date, emails_sent: r.emails_sent, contacts_added: 0 };
  }
  for (const r of contactRows) {
    if (map[r.date]) map[r.date].contacts_added = r.contacts_added;
    else map[r.date] = { date: r.date, emails_sent: 0, contacts_added: r.contacts_added };
  }

  const result = Object.values(map)
    .map(d => ({ ...d, total: d.emails_sent + d.contacts_added }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json(result);
});

module.exports = router;
