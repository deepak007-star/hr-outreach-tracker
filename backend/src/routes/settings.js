const express = require('express');
const db = require('../db/database');

const router = express.Router();

router.get('/', async (_, res) => {
  const rows = await db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', async (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
  for (const [k, v] of Object.entries(req.body)) await stmt.run(k, String(v));
  const rows = await db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

module.exports = router;
