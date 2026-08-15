'use strict';

// Apply Queue: builds a per-user queue of already-scraped jobs ranked by
// skill match, for the user to review and click "Apply" on themselves. This
// module NEVER submits a form, logs into a job platform, or opens a browser
// — it only reads scraped_jobs (populated by the existing daily scrape) and
// writes to job_applications. See routes/apply-queue.js for the HTTP layer.

const crypto = require('crypto');
const db = require('../db/database');
const { lightweightSkillMatch, parseSkills } = require('../lib/skillMatch');

const ACTIVE_TARGET   = 60;   // target size of the "queued" pile the user reviews
const CANDIDATE_CAP    = 1500; // safety cap on how many scraped_jobs rows get scored per refresh
const CANDIDATE_WINDOW_DAYS = 30;
// lightweightSkillMatch's percent is matched / total-skills-on-profile — that
// structurally caps low for anyone with a broad skill list (a 29-skill
// profile hits ~14-17% on genuinely strong Java/Spring/Kafka matches, since
// no single job posting mentions most of a 29-item list). Verified live
// against a real profile: a percent floor of 40 filtered out EVERY
// candidate, including clearly-relevant postings. Gate on the ABSOLUTE
// number of matched skills instead — "this posting explicitly mentions 3+
// of your listed skills" is a real significance signal regardless of how
// long the user's overall skill list is. `match_percent` is still stored
// and shown (useful for ranking within one user's own queue), just not
// used as the qualification threshold.
const MIN_MATCHED_SKILLS = 3;

// linkedin-feed is deliberately excluded — that's hiring-post/contact-
// extraction content (handled by a separate pipeline), not structured job
// listings with an apply link.
const EXCLUDED_SCRAPER_TYPES = ['linkedin-feed'];

// Purely a UI label ("⚡ Easy Apply" vs "🔗 Direct apply") — nothing is
// actually auto-submitted either way; this only affects the badge shown.
const EASY_APPLY_SCRAPERS = new Set(['linkedin-jobs', 'naukri', 'instahyre', 'foundit']);
function inferApplyMethod(scraperType) {
  return EASY_APPLY_SCRAPERS.has(scraperType) ? 'easy_apply' : 'direct';
}

/**
 * Tops the caller's queue up to ACTIVE_TARGET `status='queued'` rows —
 * inserts only as many NEW rows as there are open slots, never grows the
 * queue past the target. Safe to call repeatedly (e.g. every time the user
 * opens the Apply Queue view); already-queued/applied/skipped jobs are
 * excluded from the candidate pool entirely, and the INSERT is additionally
 * guarded by the table's (user_id, job_id) unique constraint.
 */
async function refreshQueue(userId, profile) {
  const skills = parseSkills(profile?.skills);
  if (!skills.length) return { added: 0, reason: 'no_skills_on_profile' };

  const currentQueued = await db.prepare(
    `SELECT COUNT(*) c FROM job_applications WHERE user_id = ? AND status = 'queued'`
  ).get(userId);
  const slots = ACTIVE_TARGET - (parseInt(currentQueued?.c, 10) || 0);
  if (slots <= 0) return { added: 0, reason: 'queue_full' };

  const cutoff = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const candidates = await db.prepare(`
    SELECT * FROM scraped_jobs
    WHERE created_at >= ?
      AND scraper_type != ALL(?)
      AND id NOT IN (SELECT job_id FROM job_applications WHERE user_id = ?)
    ORDER BY created_at DESC, id ASC
    LIMIT ?
  `).all(cutoff, EXCLUDED_SCRAPER_TYPES, userId, CANDIDATE_CAP);

  const scored = candidates
    .map(job => ({ job, ...lightweightSkillMatch(skills, `${job.title || ''} ${job.description || ''}`) }))
    .filter(s => s.matched.length >= MIN_MATCHED_SKILLS)
    .sort((a, b) => b.matched.length - a.matched.length || b.percent - a.percent)
    .slice(0, slots);

  let added = 0;
  for (const s of scored) {
    const row = await db.prepare(`
      INSERT INTO job_applications (id, user_id, job_id, status, match_percent, matched_skills, apply_method)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
      ON CONFLICT (user_id, job_id) DO NOTHING
      RETURNING (xmax = 0) AS is_new
    `).get(
      crypto.randomUUID(), userId, s.job.id, s.percent, JSON.stringify(s.matched), inferApplyMethod(s.job.scraper_type)
    );
    if (row?.is_new) added++;
  }

  return { added, candidatesScanned: candidates.length, candidate_capped: candidates.length >= CANDIDATE_CAP };
}

module.exports = { refreshQueue, ACTIVE_TARGET, MIN_MATCHED_SKILLS, inferApplyMethod, EXCLUDED_SCRAPER_TYPES };
