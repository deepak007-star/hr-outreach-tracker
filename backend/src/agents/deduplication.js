'use strict';
const crypto = require('crypto');
const db     = require('../db/database');

/**
 * Compute a stable fingerprint for a normalized posting.
 * Hash of (title + company + posted_at_year_month) so the same job
 * from two different sources deduplicates correctly.
 */
function fingerprint(job) {
  // Internal DB sources (linkedin-posts, scraped:*) are already unique per post ID.
  // Use source+external_id so different HRs posting the same job title from the same
  // company don't collapse into one row (they may have different recruiter emails).
  if (job.source === 'linkedin-posts' || job.source.startsWith('scraped:')) {
    return crypto.createHash('sha256')
      .update(`${job.source}||${job.external_id}`)
      .digest('hex').slice(0, 32);
  }

  // For external API sources: semantic dedup by title+company+month so the same job
  // listed on both Arbeitnow and Remotive doesn't get stored twice.
  const title   = (job.title   || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const company = (job.company || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const key     = [title, company, (job.posted_at || '').slice(0, 7)].join('||');
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
      continue;
    }

    // Fingerprint miss doesn't mean "genuinely new" — the same job reposted
    // with a slightly reworded title ("Java Developer" vs "Java Backend
    // Developer") won't share a fingerprint. Fall back to a fuzzy check
    // (pg_trgm, already enabled on this DB) against same-company postings
    // from the same month before accepting it as unique.
    const fuzzy = await findFuzzyDuplicate(job).catch(() => null);
    if (fuzzy) {
      job.duplicate_of = fuzzy.id;
      duplicateCount++;
      continue;
    }

    unique.push(job);
  }

  return { unique, duplicateCount };
}

/**
 * Secondary dedup pass: same company, same posting month, title similarity > 0.7
 * (pg_trgm). Skipped for internal sources (linkedin-posts/scraped:*) — those
 * are already keyed by source+external_id and different recruiters posting
 * similar-sounding roles from the same company shouldn't collapse.
 */
async function findFuzzyDuplicate(job) {
  if (job.source === 'linkedin-posts' || job.source.startsWith('scraped:')) return null;
  if (!job.title || !job.company) return null;

  const month = (job.posted_at || '').slice(0, 7);
  const row = await db.prepare(`
    SELECT id FROM job_postings
    WHERE company ILIKE ?
      AND similarity(title, ?) > 0.7
      AND (posted_at IS NULL OR ? = '' OR posted_at LIKE ? || '%')
    ORDER BY similarity(title, ?) DESC
    LIMIT 1
  `).get(job.company, job.title, month, month, job.title);

  return row || null;
}

module.exports = { fingerprint, deduplicateBatch };
