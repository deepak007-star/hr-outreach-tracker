'use strict';
const crypto = require('crypto');
const db     = require('../db/database');

/**
 * Compute a stable fingerprint for a normalized posting.
 * Hash of (title + company + posted_at_year_month) so the same job
 * from two different sources deduplicates correctly.
 */
function fingerprint(job) {
  const key = [
    (job.title   || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    (job.company || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    (job.posted_at || '').slice(0, 7), // YYYY-MM only
  ].join('||');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/**
 * Check DB for existing fingerprints and mark duplicates.
 * Returns { unique: [...jobs with fingerprint], duplicateCount }.
 */
async function deduplicateBatch(jobs) {
  const seen    = new Map(); // fingerprint -> first job in this batch
  const unique  = [];
  let duplicateCount = 0;

  for (const job of jobs) {
    const fp = fingerprint(job);
    job.fingerprint = fp;

    if (seen.has(fp)) {
      duplicateCount++;
      continue;
    }
    seen.set(fp, job);

    // Check against DB (existing row from a prior run)
    const existing = await db.prepare(
      'SELECT id FROM job_postings WHERE fingerprint = ? LIMIT 1'
    ).get(fp).catch(() => null);

    if (existing) {
      job.duplicate_of = existing.id;
      duplicateCount++;
    } else {
      unique.push(job);
    }
  }

  return { unique, duplicateCount };
}

module.exports = { fingerprint, deduplicateBatch };
