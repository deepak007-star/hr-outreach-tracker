'use strict';

// Central store for original resume file bytes, kept in Postgres (`resume_files`
// table) rather than on local disk. Local disk paths break on redeploys /
// ephemeral hosting — the container's filesystem is wiped while the DB row
// survives, leaving a dangling path and forcing a raw-text fallback in previews.
// Storing the bytes in the DB makes previews and email attachments show the
// original uploaded file everywhere the DB is reachable.

const crypto = require('crypto');
const db     = require('../db/database');

const NOW = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Store bytes and return the new file id (or null when there's nothing to store).
async function putResumeFile(userId, buffer, mimeType, filename) {
  if (!buffer || !buffer.length) return null;
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO resume_files (id, user_id, data, mime_type, filename, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, buffer, mimeType || null, filename || null, NOW());
  return id;
}

// Fetch { data: Buffer, mime_type, filename } or null. userId is optional and,
// when given, scopes the lookup to that owner.
async function getResumeFile(fileId, userId) {
  if (!fileId) return null;
  const row = userId
    ? await db.prepare('SELECT data, mime_type, filename FROM resume_files WHERE id = ? AND user_id = ?').get(fileId, userId)
    : await db.prepare('SELECT data, mime_type, filename FROM resume_files WHERE id = ?').get(fileId);
  return row || null;
}

// Duplicate an existing file into a new row (e.g. saving the profile resume into
// the vault as its own independent version). Returns the new file id or null.
async function copyResumeFile(fileId, userId) {
  const src = await getResumeFile(fileId, userId);
  if (!src?.data) return null;
  return putResumeFile(userId, src.data, src.mime_type, src.filename);
}

// Best-effort delete; never throws so callers can fire-and-forget on cleanup.
async function deleteResumeFile(fileId) {
  if (!fileId) return;
  try { await db.prepare('DELETE FROM resume_files WHERE id = ?').run(fileId); }
  catch (e) { console.warn('[resumeFiles] delete failed (non-fatal):', e.message); }
}

module.exports = { putResumeFile, getResumeFile, copyResumeFile, deleteResumeFile };
