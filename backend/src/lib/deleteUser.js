'use strict';
const db = require('../db/database');

/**
 * Cascade-delete a user and everything that references them but doesn't
 * already have a real ON DELETE CASCADE FK. Order matters — tables without
 * cascade must be cleared before the users row itself.
 * Shared by admin.js's admin-initiated delete and auth.js's self-service delete.
 */
async function deleteUserCascade(uid) {
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
  await db.prepare('DELETE FROM settings WHERE key LIKE ?').run(`reminder_${uid}%`);
  await db.prepare('DELETE FROM users WHERE id = ?').run(uid);
}

module.exports = { deleteUserCascade };
