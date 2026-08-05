'use strict';
const { randomUUID }      = require('crypto');
const db                  = require('../db/database');
const { cleanContactName } = require('../lib/nameUtils');
const { cleanExtractedEmail } = require('../lib/contactExtract');
const { ingestAll }       = require('./ingestion/index');
const { normalizeAll }    = require('./normalization');
const { deduplicateBatch }= require('./deduplication');
const { extractFromJob }  = require('./extraction');
const { classifyJob }     = require('./classification');
const { storeJob }        = require('./storage');
const { qaCheck }         = require('./qa');
const proxyRotator        = require('../lib/proxyRotator');

// Lazy-required to avoid circular-require at module load time
function getScraperRouter() { return require('../routes/scraper'); }
function getSettings()      { return require('../routes/apify').getSettings(); }

const CONFIG_KEY = 'job_intel_config';

const DEFAULT_CONFIG = {
  enabled:              false,
  run_every_hours:      6,
  keywords:             ['Backend Developer', 'Node.js Developer', 'Java Developer', 'React Developer', 'Frontend Developer'],
  locations:            ['India', 'Remote'],
  greenhouse_companies: [],
  lever_companies:      [],
  adzuna_app_id:        '',
  adzuna_key:           '',
  jooble_key:           '',
  classify:             false, // disabled by default — contact extraction doesn't need job relevance scoring
  min_confidence:       0.5,
  internal_lookback_days: 60,  // how many days back to read from scraped_jobs / linkedin_posts
};

async function getConfig() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(CONFIG_KEY).catch(() => null);
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(row?.value || '{}') }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

async function saveConfig(cfg) {
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(CONFIG_KEY, JSON.stringify(cfg));
}

let _running = false;

/**
 * Full pipeline run. Safe to call concurrently — will skip if already running.
 * Returns summary { runId, fetched, new: stored, duplicates, errors, durationMs }
 */
async function runPipeline(triggeredBy = 'scheduler') {
  if (_running) return { skipped: true, reason: 'already running' };
  _running = true;

  const runId     = randomUUID();
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const errors    = {};
  let   totalFetched = 0, totalNew = 0, totalDupes = 0;

  console.log(`[Pipeline] Run ${runId} started (trigger: ${triggeredBy})`);

  await db.prepare(`
    INSERT INTO pipeline_runs (id, started_at, status, sources_run) VALUES (?, ?, 'running', '[]')
    ON CONFLICT DO NOTHING
  `).run(runId, startedAt);

  try {
    const cfg = await getConfig();

    // ── 0a. Proxy pool setup: load from DB, health-check, pick best proxy ─
    let scraperExtraEnv = {};
    try {
      const proxyRow = await db.prepare(`SELECT value FROM settings WHERE key = 'proxy_list'`).get().catch(() => null);
      const manualList = (proxyRow?.value || '').split('\n').map(l => l.trim()).filter(Boolean);

      // Merge in auto-sourced + validated proxies (fetched from free providers,
      // refreshed on a schedule) so the pool stays large and fresh automatically.
      let autoProxies = [];
      try {
        const { getFreshProxies } = require('../services/proxyFetcher');
        const auto = await getFreshProxies(db);
        autoProxies = auto.proxies || [];
        if (autoProxies.length) console.log(`[Pipeline] Auto-proxy: +${autoProxies.length} validated (cache ${auto.ts || 'n/a'})`);
      } catch (e) {
        console.warn('[Pipeline] auto-proxy fetch failed (non-fatal):', e.message);
      }

      const proxyStr = [...new Set([...manualList, ...autoProxies])].join('\n');
      if (proxyStr.trim()) {
        const loaded = proxyRotator.loadFromString(proxyStr);
        console.log(`[Pipeline] Proxy pool: ${loaded} configured — health-checking…`);
        const health = await proxyRotator.healthCheckAll(8000);
        console.log(`[Pipeline] Proxies: ${health.alive}/${health.total} alive, dead=${health.dead}` +
          (health.latencies.length ? `, latencies=${health.latencies.join(',')}ms` : ''));

        if (health.alive > 0) {
          // Pass the full pool as comma-sep to the scraper child process;
          // it calls proxyRotator.loadFromEnv() to reconstruct the pool.
          scraperExtraEnv.PROXY_URLS = proxyRotator.toCsvEnv();
          // Also provide a single PROXY_URL (the next round-robin pick) as
          // the initial proxy for the Playwright browser --proxy-server arg.
          scraperExtraEnv.PROXY_URL  = proxyRotator.next() || '';
          console.log(`[Pipeline] Proxy injection: PROXY_URL=${scraperExtraEnv.PROXY_URL.replace(/:[^:@]+@/, ':***@')}`);
        } else {
          console.warn('[Pipeline] All proxies dead — scraping without proxy (may hit IP blocks)');
          // Store anti-bot warning in settings for the UI to surface
          await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
            .run('antibot_status', JSON.stringify({ ts: new Date().toISOString(), status: 'proxy_pool_dead', alive: 0, total: health.total }));
        }
      } else {
        console.log('[Pipeline] No proxies configured — scraping direct (set "proxy_list" in settings to enable rotation)');
      }
    } catch (e) {
      console.error('[Pipeline] Proxy setup failed (non-fatal):', e.message);
    }

    // ── 0b. Live scrape: fetch fresh LinkedIn posts BEFORE ingestion ───────
    // The external APIs (Arbeitnow, WWR, etc.) return the same job listings
    // every call — no new contacts come from re-processing them. LinkedIn Feed
    // posts are the only real source of fresh HR emails. Scraping here ensures
    // every pipeline run actively pulls new posts instead of re-processing stale data.
    let scrapeStart = startedAt;
    let freshlyScraped = 0;
    try {
      const settings    = await getSettings().catch(() => ({}));
      const cfgKeywords = Array.isArray(cfg.keywords) && cfg.keywords.length ? cfg.keywords : [];
      const sqKeywords  = Array.isArray(settings.searchQueries) && settings.searchQueries.length ? settings.searchQueries : [];
      // Combine both keyword lists, deduplicate, cap at 15 to bound scrape time
      const titles = [...new Set([...sqKeywords, ...cfgKeywords])].slice(0, 15);
      if (titles.length === 0) {
        titles.push('HR Manager', 'Recruiter', 'Talent Acquisition', 'Human Resources');
      }
      scrapeStart = new Date().toISOString().replace('T', ' ').slice(0, 19);
      console.log(`[Pipeline] Scraping LinkedIn Feed — ${titles.length} keywords, limit 100/keyword`);
      const scraperResult = await getScraperRouter().runScraperHeadless('linkedin-feed', {
        titles,
        limit: 100,
      }, () => {}, scraperExtraEnv);
      freshlyScraped = scraperResult.stored || 0;
      console.log(`[Pipeline] LinkedIn Feed: ${freshlyScraped} fresh posts stored (exit ${scraperResult.code})`);

      // ── 0c. Anti-bot quality audit ─────────────────────────────────────
      // If the scrape returned significantly fewer results than the keyword
      // count suggests, flag a potential IP-block event so the UI can warn.
      const expectedMin = Math.min(titles.length * 2, 10); // very conservative lower bound
      if (freshlyScraped < expectedMin) {
        const antiBotMsg = `Low yield: ${freshlyScraped} posts from ${titles.length} keywords (expected ≥${expectedMin}). Possible IP block or anti-bot trigger.`;
        console.warn(`[Pipeline] Anti-bot audit: ${antiBotMsg}`);
        await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
          .run('antibot_status', JSON.stringify({
            ts: new Date().toISOString(),
            status: 'low_yield',
            freshlyScraped,
            keywords: titles.length,
            expectedMin,
            message: antiBotMsg,
          }));
      } else {
        // Clear any previous anti-bot warning on a successful run
        await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
          .run('antibot_status', JSON.stringify({ ts: new Date().toISOString(), status: 'ok', freshlyScraped }));
      }
    } catch (e) {
      console.error('[Pipeline] Live scrape failed (non-fatal):', e.message);
    }
    // Pass scrape timestamp to ingestion so db-scraped.js reads only fresh rows
    cfg.pipeline_scrape_start = scrapeStart;
    cfg.freshly_scraped_count = freshlyScraped;

    // ── 1. Ingestion ───────────────────────────────────────────────────────
    let raw = [], sourceStats = {};
    try {
      ({ raw, sourceStats } = await ingestAll(cfg));
      totalFetched = raw.length;
      console.log(`[Pipeline] Ingested ${totalFetched} raw postings from ${Object.keys(sourceStats).join(', ')}`);
    } catch (e) {
      errors.ingestion = e.message;
    }

    // ── 2. Normalization ───────────────────────────────────────────────────
    const normalized = normalizeAll(raw);
    console.log(`[Pipeline] Normalized: ${normalized.length}`);

    // ── 3. Deduplication ──────────────────────────────────────────────────
    const { unique, duplicateCount } = await deduplicateBatch(normalized);
    totalDupes = duplicateCount;
    console.log(`[Pipeline] Dedup: ${unique.length} unique, ${duplicateCount} duplicates`);

    // ── 3.5 Deep-fetch apply pages for emails (BIGGEST yield lever) ─────────
    // API snippets rarely carry an HR email (~5%); the full apply page usually
    // does. Fetch those pages through the proxy pool (loaded in Stage 0a) and
    // scan for mailto:/emails, then let extractFromJob pick them up.
    if (cfg.deep_fetch !== false) {
      try {
        const { enrichWithPageEmails, enrichWithBrowser } = require('./deepFetch');
        const http = await enrichWithPageEmails(unique, {
          cap:         cfg.deep_fetch_cap || 200,
          concurrency: cfg.deep_fetch_concurrency || 10,
          timeoutMs:   cfg.deep_fetch_timeout_ms || 12000,
        });
        console.log(`[Pipeline] Deep-fetch (http): enriched ${http.enriched}/${http.attempted} apply pages`);
        // Bounded Playwright fallback for JS-rendered pages (opt-out via cfg.deep_fetch_browser=false)
        if (cfg.deep_fetch_browser !== false && http.jsFallback?.length) {
          const br = await enrichWithBrowser(http.jsFallback, { cap: cfg.deep_fetch_browser_cap || 25 });
          if (br.enriched) console.log(`[Pipeline] Deep-fetch (browser): enriched ${br.enriched}/${br.attempted} JS pages`);
        }
      } catch (e) {
        console.warn('[Pipeline] deep-fetch failed (non-fatal):', e.message);
      }
    }

    // ── 4. Extract → store if email found (classification disabled for contacts pipeline) ─
    // Classification (job relevance scoring) is skipped here — this pipeline's goal is
    // extracting HR contact emails, not ranking job fit. Enable via cfg.classify if needed.
    const classEnabled = cfg.classify === true; // explicit opt-in only
    let llmCalls = 0, scanned = 0;
    for (const job of unique) {
      try {
        scanned++;
        // Extraction — primary gate: only continue if an email is found
        const extraction = await extractFromJob(job);
        Object.assign(job, extraction);

        let emails = [];
        try { emails = JSON.parse(job.extracted_emails || '[]'); } catch {}
        if (!emails.length) continue; // no contact found — skip classify/store

        // Classification (optional, off by default — wastes LLM budget on contact-only pipeline)
        let classResult = null;
        if (classEnabled) {
          try {
            classResult = await classifyJob(job, cfg);
            if (classResult) {
              Object.assign(job, classResult);
              llmCalls++;
              if (llmCalls % 10 === 0) await new Promise(r => setTimeout(r, 1000));
            }
          } catch (e) {
            // Classification failures are non-fatal — proceed without scoring
          }
        }

        // QA
        const qa = qaCheck(job, classResult);
        Object.assign(job, qa);

        // Store — 'inserted' = truly new row, 'updated' = existing row refreshed
        const outcome = await storeJob(job);
        if (outcome === 'inserted') totalNew++;
      } catch (e) {
        errors[`store:${job.source}:${job.external_id}`] = e.message;
      }
    }

    console.log(`[Pipeline] Scanned ${scanned} unique jobs — ${totalNew} HR contacts found (${llmCalls} LLM calls)`);

    // ── 5. Update run record ───────────────────────────────────────────────
    const finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(`
      UPDATE pipeline_runs SET
        finished_at = ?, status = 'success',
        sources_run = ?, total_fetched = ?, total_new = ?,
        total_duplicates = ?, errors = ?
      WHERE id = ?
    `).run(
      finishedAt,
      JSON.stringify(Object.keys(sourceStats)),
      totalFetched, totalNew, totalDupes,
      JSON.stringify(errors), runId
    );

    // ── 6. Sync extracted emails → admin's contacts page ──────────────────────
    const contactsSynced = await syncJobIntelContacts();

    // Notification
    const scrapeNote = cfg.freshly_scraped_count > 0
      ? `Scraped ${cfg.freshly_scraped_count} fresh LinkedIn posts. `
      : '';
    const notifBody = totalNew > 0
      ? `${scrapeNote}Scanned ${totalFetched} job posts — found ${totalNew} NEW HR contacts with email. ${contactsSynced} added to Contacts.`
      : `${scrapeNote}Scanned ${totalFetched} job posts — no new HR email contacts found in this batch.`;
    await db.prepare(`INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), null, 'info', 'Job Intel: HR contacts extracted', notifBody);

    const durationMs = Date.now() - new Date(startedAt.replace(' ', 'T') + 'Z').getTime();
    return { runId, fetched: totalFetched, new: totalNew, duplicates: totalDupes, contactsSynced, errors, durationMs };

  } catch (e) {
    console.error('[Pipeline] Fatal error:', e.message);
    await db.prepare(`UPDATE pipeline_runs SET status='failed', finished_at=?, errors=? WHERE id=?`)
      .run(new Date().toISOString().replace('T', ' ').slice(0, 19), JSON.stringify({ fatal: e.message }), runId);
    throw e;
  } finally {
    _running = false;
  }
}

/**
 * Schedule the pipeline to run every N hours based on DB config.
 * Called once from index.js after DB is ready.
 */
async function schedulePipeline() {
  const cfg = await getConfig();
  if (!cfg.enabled) {
    console.log('[Pipeline] Disabled — enable via Admin Panel → Job Intel');
    return;
  }

  const intervalMs = Math.max(1, cfg.run_every_hours || 6) * 3_600_000;
  console.log(`[Pipeline] Scheduling every ${cfg.run_every_hours}h`);

  // Run once after 30s to populate on startup, then on interval
  setTimeout(() => runPipeline('startup').catch(e => console.error('[Pipeline] Startup run failed:', e.message)), 30_000);
  setInterval(() => runPipeline('scheduler').catch(e => console.error('[Pipeline] Scheduled run failed:', e.message)), intervalMs);
}

/**
 * Sync HR contacts extracted by the job-intel pipeline into the admin user's
 * contacts table. Runs automatically after every pipeline run and on a daily
 * schedule from index.js.
 *
 * - Only upserts contacts where extracted_emails is non-empty.
 * - ON CONFLICT: only overwrites name/company/source_url if the existing row
 *   was also job-intel sourced — never stomps manually-added contacts.
 * - Returns the number of rows affected.
 */
/**
 * @param {number|null} sinceMs  Only sync postings fetched after this epoch-ms.
 *   null = sync all (used after a full pipeline run).
 *   Pass Date.now() - N to do a lightweight incremental sync.
 */
async function syncJobIntelContacts(sinceMs = null) {
  try {
    const admin = await db.prepare(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
    ).get();
    if (!admin) {
      console.log('[Pipeline] syncJobIntelContacts: no admin user found, skipping');
      return 0;
    }
    const adminId = admin.id;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // Periodic (5-min) sync: only look at postings from the last 30 minutes to keep it lightweight.
    // Full pipeline run passes sinceMs=null to sync everything.
    const cutoff = sinceMs != null
      ? new Date(sinceMs).toISOString().replace('T', ' ').slice(0, 19)
      : null;

    const postings = cutoff
      ? await db.prepare(
          `SELECT id, company, title, apply_url, source, extracted_emails, extracted_contact_name
           FROM job_postings
           WHERE extracted_emails != '[]' AND extracted_emails IS NOT NULL
           AND fetched_at >= ?`
        ).all(cutoff)
      : await db.prepare(
          `SELECT id, company, title, apply_url, source, extracted_emails, extracted_contact_name
           FROM job_postings
           WHERE extracted_emails != '[]' AND extracted_emails IS NOT NULL`
        ).all();

    let synced = 0;
    for (const posting of postings) {
      let emails = [];
      try { emails = JSON.parse(posting.extracted_emails); } catch {}

      for (const rawEmail of emails) {
        const email = cleanExtractedEmail(rawEmail);
        if (!email) continue;

        const name      = cleanContactName(posting.extracted_contact_name, email);
        const company   = (posting.company  || '').trim();
        const jobTitle  = (posting.title    || '').trim();
        const sourceUrl = (posting.apply_url || '').trim();
        const notes     = `[Job Intel] ${jobTitle}${company ? ` · ${company}` : ''}${posting.source ? ` (${posting.source})` : ''}`.trim();

        // RETURNING (xmax = 0) AS is_new detects true INSERT vs ON CONFLICT UPDATE
        const row = await db.prepare(`
          INSERT INTO contacts
            (id, user_id, name, email, company, title, email_source, status, source_url, notes, date_added, tags, email_verified)
          VALUES
            (?, ?, ?, ?, ?, ?, 'job-intel', 'New', ?, ?, ?, '[]', 'pending')
          ON CONFLICT (email, user_id) DO UPDATE SET
            name       = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.name END,
            company    = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.company END,
            title      = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.title END,
            source_url = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.source_url END,
            notes      = CASE WHEN contacts.email_source = 'job-intel' THEN ? ELSE contacts.notes END
          RETURNING (xmax = 0) AS is_new
        `).get(
          randomUUID(), adminId, name, email, company, jobTitle, sourceUrl, notes, now,
          name, name,
          company, company,
          jobTitle, jobTitle,
          sourceUrl, sourceUrl,
          notes
        );

        if (row?.is_new) synced++;
      }
    }

    console.log(`[Pipeline] syncJobIntelContacts: synced ${synced} contacts to admin's list`);
    return synced;
  } catch (e) {
    console.error('[Pipeline] syncJobIntelContacts failed:', e.message);
    return 0;
  }
}

module.exports = { runPipeline, schedulePipeline, syncJobIntelContacts, getConfig, saveConfig, DEFAULT_CONFIG };
