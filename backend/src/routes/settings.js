const express = require('express');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const ALLOWED_SETTINGS_KEYS = new Set([
  'smtp_config', 'daily_send_cap', 'apify_api_key', 'apify_queries', 'apify_last_scrape',
  'unsubscribe_footer_text', 'purge_config', 'groq_api_key', 'groq_model',
]);

router.get('/', async (_, res) => {
  const rows = await db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', async (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
  for (const [k, v] of Object.entries(req.body)) {
    if (!ALLOWED_SETTINGS_KEYS.has(k)) continue; // block writes to internal keys
    await stmt.run(k, String(v));
  }
  const rows = await db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

module.exports = router;
