'use strict';

// Apply Queue: builds a per-user queue of already-scraped jobs ranked by
// skill match, for the user to review and click "Apply" on themselves. This
// module itself NEVER submits a form or opens a browser — it only reads
// scraped_jobs (populated by the existing daily scrape) and writes to
// job_applications. See routes/apply-queue.js for the HTTP layer.
//
// Real logged-in auto-submit is now built (agents/autoApplyWorker.js), scoped
// to Naukri/Instahyre/Foundit ONLY (the three portals with one consistent,
// first-party one-click-apply flow to automate) and only for a portal the
// user has explicitly opted into after being told the ToS/ban-risk trade-off.
// RemoteOK/WWR/LinkedIn stay manual-only — every listing there redirects to a
// different third-party company page/ATS, so there's no single safe flow to
// automate the way there is here. getQueueConfig()'s `auto_apply` block below
// is what the worker reads to decide which portals are enabled and their
// daily hard-submit cap; this file's own refreshQueue() is unchanged by any
// of that — it only ever queues candidates, auto or not.

const crypto = require('crypto');
const db = require('../db/database');
const { lightweightSkillMatch, parseSkills } = require('../lib/skillMatch');

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
// listings with an apply link. linkedin-jobs (real postings) stays in the
// pool — it's just never treated differently from any other portal here;
// "queue-only, no automation" is already true for every portal in this file.
const EXCLUDED_SCRAPER_TYPES = ['linkedin-feed'];

// Purely a UI label ("⚡ Easy Apply" vs "🔗 Direct apply") — nothing is
// actually auto-submitted either way; this only affects the badge shown.
const EASY_APPLY_SCRAPERS = new Set(['linkedin-jobs', 'naukri', 'instahyre', 'foundit']);
function inferApplyMethod(scraperType) {
  return EASY_APPLY_SCRAPERS.has(scraperType) ? 'easy_apply' : 'direct';
}

const CONFIG_KEY = 'apply_queue_config';
const DEFAULT_TARGET = 20; // "start from 20 per job portal, increase gradually" — this is that dial

// Auto-apply portals ⊂ easy-apply scrapers — linkedin-jobs gets the "Easy
// Apply" UI badge but was explicitly excluded from real automation (LinkedIn
// account-ban risk, handled as queue-only per the user's own instruction).
const AUTO_APPLY_PORTALS = ['naukri', 'instahyre', 'foundit'];
const DEFAULT_AUTO_APPLY = {
  enabled: { naukri: false, instahyre: false, foundit: false },
  daily_caps: { naukri: DEFAULT_TARGET, instahyre: DEFAULT_TARGET, foundit: DEFAULT_TARGET },
  paused: false, // global kill switch, checked before every single submission
};

async function getQueueConfig() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(CONFIG_KEY).catch(() => null);
  let cfg = {};
  try { cfg = JSON.parse(row?.value || '{}'); } catch {}
  return {
    default_target: DEFAULT_TARGET,
    targets: {},
    ...cfg,
    auto_apply: {
      ...DEFAULT_AUTO_APPLY,
      ...(cfg.auto_apply || {}),
      enabled:    { ...DEFAULT_AUTO_APPLY.enabled,    ...(cfg.auto_apply?.enabled    || {}) },
      daily_caps: { ...DEFAULT_AUTO_APPLY.daily_caps, ...(cfg.auto_apply?.daily_caps || {}) },
    },
  };
}

async function saveQueueConfig(patch) {
  const cur = await getQueueConfig();
  const next = {
    ...cur, ...patch,
    targets: { ...cur.targets, ...(patch.targets || {}) },
    auto_apply: {
      ...cur.auto_apply,
      ...(patch.auto_apply || {}),
      enabled:    { ...cur.auto_apply.enabled,    ...(patch.auto_apply?.enabled    || {}) },
      daily_caps: { ...cur.auto_apply.daily_caps, ...(patch.auto_apply?.daily_caps || {}) },
    },
  };
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(CONFIG_KEY, JSON.stringify(next));
  return next;
}

/**
 * The worker's hard-stop gate — called before EVERY submission attempt, not
 * just once per run. Returns { allowed, reason } rather than throwing, so
 * the worker can log a clear reason and move to the next portal/job instead
 * of crashing the run.
 */
async function checkAutoApplyAllowed(userId, portal) {
  if (!AUTO_APPLY_PORTALS.includes(portal)) return { allowed: false, reason: 'portal_not_supported' };

  const cfg = await getQueueConfig();
  if (cfg.auto_apply.paused) return { allowed: false, reason: 'globally_paused' };
  if (!cfg.auto_apply.enabled[portal]) return { allowed: false, reason: 'portal_disabled' };

  const cred = await db.prepare(
    `SELECT status FROM portal_credentials WHERE user_id = ? AND portal = ?`
  ).get(userId, portal);
  if (!cred) return { allowed: false, reason: 'no_credentials' };
  if (cred.status !== 'active') return { allowed: false, reason: `credentials_${cred.status}` };

  const today = new Date().toISOString().slice(0, 10);
  const submittedToday = await db.prepare(`
    SELECT COUNT(*) c FROM job_applications
    WHERE user_id = ? AND scraper_type = ? AND submission_mode = 'auto' AND LEFT(applied_at, 10) = ?
  `).get(userId, portal, today);
  const cap = Number.isFinite(cfg.auto_apply.daily_caps[portal]) ? cfg.auto_apply.daily_caps[portal] : DEFAULT_TARGET;
  const used = parseInt(submittedToday?.c, 10) || 0;
  if (used >= cap) return { allowed: false, reason: 'daily_cap_reached', used, cap };

  return { allowed: true, remaining: cap - used, cap, used };
}

/**
 * Tops each PORTAL's (scraper_type's) queued pile up to its own configured
 * target independently — not one shared global cap. This is what makes
 * "20/portal to start, ramp up gradually per portal" actually mean something:
 * Naukri can be raised to 40 while Instahyre stays at 20, etc., each portal's
 * own knob in apply_queue_config.targets (falls back to default_target).
 * Inserts only as many NEW rows as there are open slots per portal, never
 * grows any portal's queue past its target. Safe to call repeatedly.
 */
async function refreshQueue(userId, profile) {
  const skills = parseSkills(profile?.skills);
  if (!skills.length) return { added: 0, reason: 'no_skills_on_profile' };

  const cfg = await getQueueConfig();

  const cutoff = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const candidates = await db.prepare(`
    SELECT * FROM scraped_jobs
    WHERE created_at >= ?
      AND scraper_type != ALL(?)
      AND (apply_link != '' OR link != '')
      AND id NOT IN (SELECT job_id FROM job_applications WHERE user_id = ? AND job_id IS NOT NULL)
    ORDER BY created_at DESC, id ASC
    LIMIT ?
  `).all(cutoff, EXCLUDED_SCRAPER_TYPES, userId, CANDIDATE_CAP);
  // job_id was relaxed to nullable (ON DELETE SET NULL, so the daily purge
  // doesn't cascade-delete application history) — SQL's NOT IN treats a set
  // containing NULL as "unknown" for every row, silently excluding EVERY
  // candidate the moment even one job_applications row had its job_id
  // nulled out by a purge. The `job_id IS NOT NULL` filter above is required,
  // not cosmetic.

  if (!candidates.length) {
    return { added: 0, reason: 'no_candidates_scraped', candidatesScanned: 0, candidate_capped: false };
  }

  const queuedByTypeRows = await db.prepare(`
    SELECT scraper_type, COUNT(*) c FROM job_applications
    WHERE user_id = ? AND status = 'queued'
    GROUP BY scraper_type
  `).all(userId);
  const queuedCountByType = {};
  for (const r of queuedByTypeRows) queuedCountByType[r.scraper_type || 'unknown'] = parseInt(r.c, 10) || 0;

  const byType = {};
  for (const job of candidates) {
    const type = job.scraper_type || 'unknown';
    (byType[type] = byType[type] || []).push(job);
  }

  let added = 0;
  const addedByType = {};
  for (const [type, jobs] of Object.entries(byType)) {
    const target = Number.isFinite(cfg.targets?.[type]) ? cfg.targets[type] : cfg.default_target;
    const slots  = target - (queuedCountByType[type] || 0);
    if (slots <= 0) continue;

    const scored = jobs
      .map(job => ({ job, ...lightweightSkillMatch(skills, `${job.title || ''} ${job.description || ''}`) }))
      .filter(s => s.matched.length >= MIN_MATCHED_SKILLS)
      .sort((a, b) => b.matched.length - a.matched.length || b.percent - a.percent)
      .slice(0, slots);

    for (const s of scored) {
      const job = s.job;
      const row = await db.prepare(`
        INSERT INTO job_applications (
          id, user_id, job_id, status, match_percent, matched_skills, apply_method,
          title, company, location, link, apply_link, salary, job_type, scraper_type
        )
        VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, job_id) DO NOTHING
        RETURNING (xmax = 0) AS is_new
      `).get(
        crypto.randomUUID(), userId, job.id, s.percent, JSON.stringify(s.matched), inferApplyMethod(job.scraper_type),
        job.title, job.company, job.location, job.link, job.apply_link, job.salary, job.job_type, job.scraper_type
      );
      if (row?.is_new) { added++; addedByType[type] = (addedByType[type] || 0) + 1; }
    }
  }

  // Distinguishes "nothing scanned" (empty scraped_jobs / fresh install),
  // "scanned plenty but none met the ≥3-matched-skills bar," and the normal
  // success case — the frontend previously couldn't tell any of these apart
  // from "queue_full" and showed a misleading "already full" toast even when
  // the real reason was "no relevant jobs found."
  const reason = added > 0 ? undefined : 'no_matches_found';
  return { added, addedByType, reason, candidatesScanned: candidates.length, candidate_capped: candidates.length >= CANDIDATE_CAP };
}

module.exports = {
  refreshQueue, MIN_MATCHED_SKILLS, inferApplyMethod, EXCLUDED_SCRAPER_TYPES,
  getQueueConfig, saveQueueConfig, DEFAULT_TARGET,
  AUTO_APPLY_PORTALS, checkAutoApplyAllowed,
};
