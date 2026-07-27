'use strict';
const fetchArbeitnow        = require('./arbeitnow');
const fetchRemotive         = require('./remotive');
const fetchRemoteOK         = require('./remoteok');
const fetchWWR              = require('./wwr');
const fetchGreenhouse       = require('./greenhouse');
const fetchLever            = require('./lever');
const fetchAdzuna           = require('./adzuna');
const fetchJooble           = require('./jooble');
const fetchLinkedinPostsDB  = require('./db-linkedin-posts');
const fetchScrapedJobsDB    = require('./db-scraped');

/**
 * Run all enabled ingestion agents in parallel batches.
 * cfg: the parsed job_intel_config settings object.
 * Returns { raw: [...], sourceStats: { source: count } }
 *
 * Internal DB sources (db-linkedin-posts, db-scraped) run first —
 * they are fast (local DB query) and provide the most HR emails.
 * External API sources supplement with additional signal but rarely have emails.
 */
async function ingestAll(cfg) {
  const keywords    = Array.isArray(cfg.keywords) && cfg.keywords.length
    ? cfg.keywords
    : ['Backend Developer', 'Node.js Developer', 'Java Developer', 'React Developer'];
  const ghCompanies = Array.isArray(cfg.greenhouse_companies) ? cfg.greenhouse_companies : [];
  const lvCompanies = Array.isArray(cfg.lever_companies)      ? cfg.lever_companies      : [];
  const adzunaOpts  = { appId: cfg.adzuna_app_id, appKey: cfg.adzuna_key, location: cfg.adzuna_location || '' };
  const joobleOpts  = { key: cfg.jooble_key, location: cfg.jooble_location || 'India' };

  const tasks = [
    // ── Internal DB sources (fast, high email yield) ──────────────────────────
    { name: 'linkedin-posts-db', fn: () => fetchLinkedinPostsDB(cfg) },
    { name: 'scraped-db',        fn: () => fetchScrapedJobsDB(cfg)   },
    // ── External API sources (slower, low email yield but good for discovery) ─
    { name: 'arbeitnow',  fn: () => fetchArbeitnow() },
    { name: 'remotive',   fn: () => fetchRemotive(keywords) },
    { name: 'remoteok',   fn: () => fetchRemoteOK() },
    { name: 'wwr',        fn: () => fetchWWR() },
    ...(ghCompanies.length ? [{ name: 'greenhouse', fn: () => fetchGreenhouse(ghCompanies) }] : []),
    ...(lvCompanies.length ? [{ name: 'lever',      fn: () => fetchLever(lvCompanies)      }] : []),
    ...((adzunaOpts.appId && adzunaOpts.appKey) ? [{ name: 'adzuna', fn: () => fetchAdzuna(keywords, adzunaOpts) }] : []),
    ...(joobleOpts.key ? [{ name: 'jooble', fn: () => fetchJooble(keywords, joobleOpts) }] : []),
  ];

  const raw         = [];
  const sourceStats = {};

  const settled = await Promise.allSettled(tasks.map(t => t.fn()));
  for (let i = 0; i < tasks.length; i++) {
    const { name } = tasks[i];
    const result   = settled[i];
    if (result.status === 'fulfilled') {
      const jobs = Array.isArray(result.value) ? result.value : [];
      raw.push(...jobs);
      sourceStats[name] = (sourceStats[name] || 0) + jobs.length;
    } else {
      console.error(`[Pipeline:ingestion] ${name} failed: ${result.reason?.message}`);
      sourceStats[name] = 0;
    }
  }

  return { raw, sourceStats };
}

module.exports = { ingestAll };
