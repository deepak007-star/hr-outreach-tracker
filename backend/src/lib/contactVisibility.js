'use strict';

// Contacts are a SHARED pool: subscribed users (and admins) see everyone's
// contacts, while free/demo users see only their own. Each user carries their
// own status/notes/send-history via the `contact_user_state` table, so applying
// or re-labelling a contact never affects another user's view.

const db = require('../db/database');

const SUBSCRIBED_PLANS = ['basic', 'advanced'];

// Can this user see the shared pool (all users' contacts)?
function canSeePool(user) {
  if (!user) return false;
  return user.role === 'admin' || SUBSCRIBED_PLANS.includes(user.plan);
}

const NOW = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Upsert one user's own status/notes for a contact (never touches the shared
// contact row or another user's state). Pass only the fields you want to change.
async function upsertContactState(contactId, userId, { status, notes, follow_up_at } = {}) {
  const cols = ['contact_id', 'user_id'], vals = [contactId, userId], setc = [];
  if (status       !== undefined) {
    cols.push('status'); vals.push(status); setc.push('status = EXCLUDED.status');
    cols.push('status_changed_at'); vals.push(NOW()); setc.push('status_changed_at = EXCLUDED.status_changed_at');
  }
  if (notes        !== undefined) { cols.push('notes');        vals.push(notes);        setc.push('notes = EXCLUDED.notes'); }
  if (follow_up_at !== undefined) { cols.push('follow_up_at'); vals.push(follow_up_at); setc.push('follow_up_at = EXCLUDED.follow_up_at'); }
  cols.push('updated_at'); vals.push(NOW()); setc.push('updated_at = EXCLUDED.updated_at');
  await db.prepare(
    `INSERT INTO contact_user_state (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT (contact_id, user_id) DO UPDATE SET ${setc.join(', ')}`
  ).run(...vals);
}

module.exports = { canSeePool, upsertContactState, SUBSCRIBED_PLANS };
