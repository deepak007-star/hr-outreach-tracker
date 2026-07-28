'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireAuth, requireAdmin, invalidatePermCache } = require('../middleware/auth');
const { decrypt } = require('../services/vaultCrypto');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const VALID_PLANS = ['guest', 'demo', 'basic', 'advanced'];

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const users = await db.prepare(
    'SELECT id, name, email, plan, role, created_at FROM users ORDER BY created_at ASC'
  ).all();
  res.json(users);
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!role?.trim()) return res.status(400).json({ error: 'Role is required' });
  // Verify role exists in DB
  const roleRow = await db.prepare('SELECT id FROM roles WHERE name = ?').get(role);
  if (!roleRow) return res.status(400).json({ error: 'Invalid role — not found in roles table' });
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: "You can't change your own role" });
  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  // Flush the old role's permission set so requirePermission() picks up new grants immediately
  invalidatePermCache(role);
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/plan
router.put('/users/:id/plan', async (req, res) => {
  const { plan } = req.body;
  if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  await db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: "You can't delete your own account" });
  try {
    const uid = req.params.id;
    // Delete in FK-safe order — tables without ON DELETE CASCADE must go first
    await db.prepare('DELETE FROM gmail_tracked_emails WHERE user_id = ?').run(uid);
    await db.prepare('DELETE FROM gmail_tokens WHERE user_id = ?').run(uid);
    await db.prepare('DELETE FROM oauth_accounts WHERE user_id = ?').run(uid);
    await db.prepare('DELETE FROM delivery_billing_stats WHERE user_id = ?').run(uid);
    await db.prepare('UPDATE email_log SET user_id = NULL WHERE user_id = ?').run(uid);
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
    await db.prepare('DELETE FROM profiles WHERE user_id = ?').run(uid);
    // Contacts belong to the user — nullify email_log FK first, then delete
    const userContactIds = await db.prepare('SELECT id FROM contacts WHERE user_id = ?').all(uid);
    if (userContactIds.length) {
      const ph = userContactIds.map(() => '?').join(',');
      const ids = userContactIds.map(r => r.id);
      await db.prepare(`UPDATE email_log SET contact_id = NULL WHERE contact_id IN (${ph})`).run(...ids);
      await db.prepare(`DELETE FROM contacts WHERE user_id = ?`).run(uid);
    }
    // Clean up reminder settings keys for this user (reminder_<userId> and reminder_email_sent_<userId>_*)
    await db.prepare("DELETE FROM settings WHERE key LIKE ?").run(`reminder_${uid}%`);
    await db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/password — force-reset any user's login password
router.put('/users/:id/password', async (req, res) => {
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: 'Use change-password to update your own password' });
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = await bcrypt.hash(password, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/referral-settings
router.get('/referral-settings', async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'referral_request_limit'").get();
  res.json({ limit: parseInt(row?.value || '2') });
});

// PUT /api/admin/referral-settings — global per-pair referral request limit
router.put('/referral-settings', async (req, res) => {
  const limit = parseInt(req.body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return res.status(400).json({ error: 'Limit must be a whole number between 1 and 100' });
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES ('referral_request_limit', ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(String(limit));
  res.json({ limit });
});

// GET /api/admin/referrals — every (sender, target) pair with how many
// requests have gone out, for the admin panel's reset UI
router.get('/referrals', async (req, res) => {
  const rows = await db.prepare(`
    SELECT
      r.from_user_id, r.to_user_id,
      fu.name AS from_name, fu.email AS from_email,
      tu.name AS to_name,   tu.email AS to_email,
      COUNT(*)       AS request_count,
      MAX(r.created_at) AS last_sent_at
    FROM referral_requests r
    JOIN users fu ON fu.id = r.from_user_id
    JOIN users tu ON tu.id = r.to_user_id
    GROUP BY r.from_user_id, r.to_user_id, fu.name, fu.email, tu.name, tu.email
    ORDER BY last_sent_at DESC
  `).all();
  res.json(rows);
});

// DELETE /api/admin/referrals/:fromUserId/:toUserId — reset one pair's
// count to 0 so that sender can request a referral from that user again
router.delete('/referrals/:fromUserId/:toUserId', async (req, res) => {
  await db.prepare('DELETE FROM referral_requests WHERE from_user_id = ? AND to_user_id = ?')
    .run(req.params.fromUserId, req.params.toUserId);
  res.json({ ok: true });
});

// GET /api/admin/vault — list all vault entries across users (passwords omitted)
router.get('/vault', async (req, res) => {
  const rows = await db.prepare(
    `SELECT pv.id, pv.user_id, u.name AS user_name, u.email AS user_email,
            pv.title, pv.username, pv.url, pv.category, pv.notes, pv.created_at
     FROM password_vault pv
     JOIN users u ON u.id = pv.user_id
     ORDER BY u.name, pv.created_at DESC`
  ).all();
  res.json(rows);
});

// GET /api/admin/vault/:id/reveal — admin decrypts any vault entry on demand
router.get('/vault/:id/reveal', async (req, res) => {
  const row = await db.prepare('SELECT * FROM password_vault WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  try {
    const password = decrypt({ iv: row.iv, enc: row.password_enc, tag: row.tag });
    res.json({ password });
  } catch {
    res.status(500).json({ error: 'Decryption failed' });
  }
});

module.exports = router;
