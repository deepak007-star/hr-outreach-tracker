'use strict';

/**
 * Deterministic keyword + location relevance gate (no LLM cost).
 *
 * The pipeline previously had no mandatory relevance check: any posting with
 * an email — from any industry, any location — flowed straight through
 * dedup/deep-fetch/extraction and into the user's Contacts, because LLM
 * classification (the only thing that judges relevance) is off by default
 * and never gated storage even when on. This filter runs right after
 * normalization, before dedup/deep-fetch/extraction, so irrelevant postings
 * never reach those (costlier) stages at all.
 */

const STOPWORDS = new Set([
  'developer', 'engineer', 'manager', 'senior', 'junior', 'lead', 'associate',
  'specialist', 'executive', 'officer', 'intern', 'analyst', 'consultant',
]);

function tokenize(str) {
  return (str || '').toLowerCase().match(/[a-z0-9+.#]+/g) || [];
}

// Reduce a keyword phrase like "Node.js Developer" to its distinguishing
// tokens (drop generic role words) so "Backend Developer" also matches a
// posting titled "Backend Engineer".
function keywordTokens(keyword) {
  const toks = tokenize(keyword).filter(t => t.length > 1 && !STOPWORDS.has(t));
  return toks.length ? toks : tokenize(keyword);
}

function matchesKeywords(job, keywordSets) {
  if (!keywordSets.length) return true; // no target profile configured — permissive
  const hay = new Set(tokenize(`${job.title} ${job.description || ''}`.slice(0, 1500)));
  return keywordSets.some(toks => toks.every(t => hay.has(t)));
}

const REMOTE_RE = /\bremote\b|\bwork from home\b|\bwfh\b/i;

function matchesLocation(job, locations) {
  if (!locations.length) return true;
  const loc = (job.location || '').toLowerCase();
  if (!loc) return true; // unknown location on this source — don't reject on missing data
  return locations.some(l => {
    const norm = String(l).toLowerCase();
    if (norm === 'remote') return REMOTE_RE.test(loc) || REMOTE_RE.test(`${job.title} ${job.description || ''}`);
    return loc.includes(norm);
  });
}

// Internal sources are already keyword/city-targeted at scrape time (see
// db-linkedin-posts.js / db-scraped.js) and their location field is often
// blank or inconsistent — skip location filtering for them specifically,
// but still run the keyword check (the DB read-back re-scans the full
// lookback window, which can include posts from unrelated past keyword runs).
const SKIP_LOCATION_SOURCES = /^(linkedin-posts|scraped:)/;

function isRelevant(job, cfg) {
  const keywordSets = (Array.isArray(cfg.keywords) ? cfg.keywords : []).map(keywordTokens).filter(t => t.length);
  if (!matchesKeywords(job, keywordSets)) return false;

  if (!SKIP_LOCATION_SOURCES.test(job.source || '')) {
    const locations = Array.isArray(cfg.locations) ? cfg.locations : [];
    if (!matchesLocation(job, locations)) return false;
  }

  return true;
}

function filterRelevant(jobs, cfg) {
  const kept = [], dropped = [];
  for (const job of jobs) (isRelevant(job, cfg) ? kept : dropped).push(job);
  return { kept, dropped };
}

module.exports = { isRelevant, filterRelevant, tokenize, keywordTokens };
