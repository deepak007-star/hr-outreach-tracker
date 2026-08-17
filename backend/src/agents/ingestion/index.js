'use strict';
const fetchArbeitnow        = require('./arbeitnow');
const fetchRemotive         = require('./remotive');
const fetchRemoteOK         = require('./remoteok');
const fetchWWR              = require('./wwr');
const fetchHimalayas        = require('./himalayas');
const fetchJobicy           = require('./jobicy');
const fetchGreenhouse       = require('./greenhouse');
const fetchLever            = require('./lever');
const fetchAdzuna           = require('./adzuna');
const fetchJooble           = require('./jooble');
const fetchLinkedinPostsDB  = require('./db-linkedin-posts');
const fetchScrapedJobsDB    = require('./db-scraped');
const { pickWeightedKeywordWindow } = require('../../lib/categoryYield');
const { nextWindow }        = require('../../lib/keywordRotation');
const { isSourceDisabled }  = require('../pipelineHealth');

// Internal DB sources are never auto-disabled by pipelineHealth — a "0 results"
// run from these reflects the local DB state (e.g. nothing fresh scraped this
// cycle), not an external API going bad, so it isn't the kind of persistent
// failure the source-health check should act on.
const NEVER_DISABLE = new Set(['linkedin-posts-db', 'scraped-db']);

/**
 * Run all enabled ingestion agents in parallel batches.
 * cfg: the parsed job_intel_config settings object.
 * Returns { raw: [...], sourceStats: { source: count }, sourceErrors: { source: message } }
 * sourceErrors only contains sources that actually threw/rejected — a source
 * that legitimately returned 0 results is NOT an error (see pipelineHealth.js,
 * which only tracks/auto-disables based on sourceErrors, not a raw 0 count).
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

  // One country/location per run, rotating through the configured list (same
  // nextWindow() helper the keyword rotation below uses) — keeps call volume
  // flat (still ~5 calls/run each) while cycling through every configured
  // country/location over successive runs instead of only ever querying the
  // first one.
  const adzunaCountries = Array.isArray(cfg.adzuna_countries) && cfg.adzuna_countries.length ? cfg.adzuna_countries : ['in'];
  const joobleLocations = Array.isArray(cfg.jooble_locations) && cfg.jooble_locations.length ? cfg.jooble_locations : ['India'];
  const [[adzunaCountry], [joobleLocation]] = await Promise.all([
    nextWindow('adzuna_country', adzunaCountries, 1),
    nextWindow('jooble_location', joobleLocations, 1),
  ]);
  const adzunaOpts  = { appId: cfg.adzuna_app_id, appKey: cfg.adzuna_key, country: adzunaCountry, location: cfg.adzuna_location || '' };
  const joobleOpts  = { key: cfg.jooble_key, location: joobleLocation || cfg.jooble_location || 'India' };

  // Adzuna/Jooble only take 5 keywords/run (rate-limit budget). With a large
  // target-role list (100+ entries), always taking the first 5 would mean the
  // rest of the list never gets searched — pick a category-yield-weighted
  // window each run (lib/categoryYield.js) so both coverage AND the actually-
  // productive categories get more of the limited call budget over time.
  const [adzunaKeywords, joobleKeywords] = await Promise.all([
    (adzunaOpts.appId && adzunaOpts.appKey) ? pickWeightedKeywordWindow(keywords, 5, 'adzuna') : [],
    joobleOpts.key ? pickWeightedKeywordWindow(keywords, 5, 'jooble') : [],
  ]);

  let tasks = [
    // ── Internal DB sources (fast, high email yield) ──────────────────────────
    { name: 'linkedin-posts-db', fn: () => fetchLinkedinPostsDB(cfg) },
    { name: 'scraped-db',        fn: () => fetchScrapedJobsDB(cfg)   },
    // ── External API sources (slower, low email yield but good for discovery) ─
    { name: 'arbeitnow',  fn: () => fetchArbeitnow() },
    { name: 'remotive',   fn: () => fetchRemotive(keywords) },
    { name: 'remoteok',   fn: () => fetchRemoteOK() },
    { name: 'wwr',        fn: () => fetchWWR() },
    { name: 'himalayas',  fn: () => fetchHimalayas() },
    { name: 'jobicy',     fn: () => fetchJobicy() },
    ...(ghCompanies.length ? [{ name: 'greenhouse', fn: () => fetchGreenhouse(ghCompanies) }] : []),
    ...(lvCompanies.length ? [{ name: 'lever',      fn: () => fetchLever(lvCompanies)      }] : []),
    ...((adzunaOpts.appId && adzunaOpts.appKey) ? [{ name: 'adzuna', fn: () => fetchAdzuna(adzunaKeywords, adzunaOpts) }] : []),
    ...(joobleOpts.key ? [{ name: 'jooble', fn: () => fetchJooble(joobleKeywords, joobleOpts) }] : []),
  ];

  // Skip sources the health layer auto-disabled after repeated real failures
  // (reversible — re-enabled from Admin Panel, see routes/job-intelligence.js).
  const disableChecks = await Promise.all(
    tasks.map(t => NEVER_DISABLE.has(t.name) ? Promise.resolve(false) : isSourceDisabled(t.name))
  );
  const skipped = tasks.filter((_, i) => disableChecks[i]).map(t => t.name);
  tasks = tasks.filter((_, i) => !disableChecks[i]);
  if (skipped.length) console.log(`[Pipeline:ingestion] skipping auto-disabled source(s): ${skipped.join(', ')}`);

  const raw          = [];
  const sourceStats  = {};
  const sourceErrors = {};

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
      sourceStats[name]  = 0;
      sourceErrors[name] = result.reason?.message || 'unknown error';
    }
  }

  return { raw, sourceStats, sourceErrors };
}

module.exports = { ingestAll };
