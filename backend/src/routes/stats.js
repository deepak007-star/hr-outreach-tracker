const express = require('express');
const db      = require('../db/database');
const router  = express.Router();

// GET /api/stats/activity?days=365
router.get('/activity', async (req, res) => {
  const days = Math.min(parseInt(req.query.days || '365'), 730);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const emailRows = await db.prepare(`
    SELECT LEFT(sent_at, 10) as date, COUNT(*) as emails_sent
    FROM email_log
    WHERE LEFT(sent_at, 10) >= ?
    GROUP BY LEFT(sent_at, 10)
  `).all(since);

  const contactRows = await db.prepare(`
    SELECT LEFT(date_added, 10) as date, COUNT(*) as contacts_added
    FROM contacts
    WHERE LEFT(date_added, 10) >= ?
    GROUP BY LEFT(date_added, 10)
  `).all(since);

  const map = {};

  for (const r of emailRows) {
    map[r.date] = { date: r.date, emails_sent: parseInt(r.emails_sent), contacts_added: 0 };
  }
  for (const r of contactRows) {
    const contacts_added = parseInt(r.contacts_added);
    if (map[r.date]) map[r.date].contacts_added = contacts_added;
    else map[r.date] = { date: r.date, emails_sent: 0, contacts_added };
  }

  const result = Object.values(map)
    .map(d => ({ ...d, total: d.emails_sent + d.contacts_added }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json(result);
});

module.exports = router;
