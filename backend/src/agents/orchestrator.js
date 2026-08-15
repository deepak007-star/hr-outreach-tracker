'use strict';
const { randomUUID }      = require('crypto');
const db                  = require('../db/database');
const { cleanContactName } = require('../lib/nameUtils');
const { cleanExtractedEmail } = require('../lib/contactExtract');
const { ingestAll }       = require('./ingestion/index');
const { normalizeAll }    = require('./normalization');
const { filterRelevant }  = require('./relevanceFilter');
const { deduplicateBatch }= require('./deduplication');
const { extractFromJob }  = require('./extraction');
const { classifyJob }     = require('./classification');
const { storeJob }        = require('./storage');
const { qaCheck }         = require('./qa');
const { categorize, CATEGORY_LABELS, isLikelyStaffingAgency } = require('./categorize');
const { lightweightSkillMatch, parseSkills } = require('../lib/skillMatch');
const DEFAULT_KEYWORDS    = require('./defaultKeywords');
const proxyRotator        = require('../lib/proxyRotator');
const { pickWeightedKeywordWindow, recordBatch, refreshOutcomeWeights } = require('../lib/categoryYield');
const { discoverNewCompanyBoards } = require('./sourceDiscovery');
const { runHealthChecks } = require('./pipelineHealth');
const { embedTexts } = require('../lib/embeddingMatch');

// Lazy-required to avoid circular-require at module load time
function getScraperRouter() { return require('../routes/scraper'); }
function getSettings()      { return require('../routes/apify').getSettings(); }

const CONFIG_KEY = 'job_intel_config';

const DEFAULT_CONFIG = {
  enabled:              false,
  run_every_hours:      6,
  keywords:             DEFAULT_KEYWORDS, // 340+ role variants (Java/Python/Frontend/DevOps/AI/...) — rotated, see keywordRotation.js
  locations:            ['India', 'Remote'],
  // Live-verified (real HTTP call, 200 + non-empty board) as of 2026-08-15 — mix of
  // global tech (with India offices posting India-location roles) and India-native
  // companies (postman, groww, freshworks, meesho, cred).
  greenhouse_companies: ['stripe', 'airbnb', 'figma', 'coinbase', 'discord', 'robinhood', 'asana', 'databricks', 'gitlab', 'postman', 'groww'],
  lever_companies:      ['plaid', 'freshworks', 'meesho', 'cred'],
  adzuna_app_id:        '',
  adzuna_key:           '',
  jooble_key:           '',
  classify:             false, // disabled by default — contact extraction doesn't need job relevance scoring
  relevance_filter:     true,  // deterministic keyword/location gate — set false to disable
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

  // Captured across stages for the end-of-run health snapshot (pipelineHealth.js).
  let proxyHealthSnapshot = null, expectedMinSnapshot = 0, relevanceDroppedCount = 0, relevanceKeptCount = 0;

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
        proxyHealthSnapshot = health;
        console.log(`[Pipeline] Proxies: ${health.alive}/${health.total} alive, dead=${health.dead}` +
          (health.latencies.length ? `, latencies=${health.latencies.join(',')}ms` : ''));

        if (health.alive > 0) {
          // Pass the full pool as comma-sep to the scraper child process;
          // it calls proxyRotator.loadFromEnv() to reconstruct the pool.
          scraperExtraEnv.PROXY_URLS = proxyRotator.toCsvEnv();
          // Also provide a single PROXY_URL for the Playwright browser
          // --proxy-server arg. Prefer an HTTP-validated proxy — socks entries
          // only get a TCP check and often hang the browser with no fallback.
          scraperExtraEnv.PROXY_URL  = proxyRotator.nextHttp() || proxyRotator.next() || '';
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
      const cfgKeywords = Array.isArray(cfg.keywords) && cfg.keywords.length ? [...new Set(cfg.keywords)] : [];
      const sqKeywords  = Array.isArray(settings.searchQueries) && settings.searchQueries.length ? settings.searchQueries : [];
      // Explicit Apify search queries always get a slot; the rest of the 15-keyword
      // budget is filled from the full cfg.keywords list, biased toward categories
      // that have historically actually yielded HR emails (lib/categoryYield.js) —
      // a large target list (100+ role variants) would otherwise either always
      // truncate to the same first few entries, or rotate blind to which ones
      // are actually worth the scrape budget.
      const remainingSlots  = Math.max(0, 15 - sqKeywords.length);
      const rotatedKeywords = remainingSlots > 0 ? await pickWeightedKeywordWindow(cfgKeywords, remainingSlots, 'linkedin_titles') : [];
      const titles = [...new Set([...sqKeywords, ...rotatedKeywords])].slice(0, 15);
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
      expectedMinSnapshot = expectedMin;
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
    let raw = [], sourceStats = {}, sourceErrors = {};
    try {
      ({ raw, sourceStats, sourceErrors } = await ingestAll(cfg));
      totalFetched = raw.length;
      console.log(`[Pipeline] Ingested ${totalFetched} raw postings from ${Object.keys(sourceStats).join(', ')}`);
    } catch (e) {
      errors.ingestion = e.message;
    }

    // ── 2. Normalization ───────────────────────────────────────────────────
    const normalized = normalizeAll(raw);
    console.log(`[Pipeline] Normalized: ${normalized.length}`);

    // ── 2.5 Relevance filter — deterministic keyword/location gate ─────────
    // Runs before dedup/deep-fetch/extraction so an irrelevant-industry or
    // wrong-location posting can't reach Contacts just because it happens to
    // contain *some* email. LLM classification (optional, off by default)
    // never gated storage — this replaces "has an email" as the sole gate.
    let relevant = normalized;
    if (cfg.relevance_filter !== false) {
      const { kept, dropped } = filterRelevant(normalized, cfg);
      relevant = kept;
      relevanceKeptCount    = kept.length;
      relevanceDroppedCount = dropped.length;
      if (dropped.length) console.log(`[Pipeline] Relevance filter: dropped ${dropped.length}/${normalized.length} irrelevant (kept ${kept.length})`);
    }

    // ── 3. Deduplication ──────────────────────────────────────────────────
    const { unique, duplicateCount } = await deduplicateBatch(relevant);
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
          concurrency: cfg.deep_fetch_concurrency || 15,
          timeoutMs:   cfg.deep_fetch_timeout_ms || 10000,
          budgetMs:    cfg.deep_fetch_budget_ms || 90000, // hard overall cap
        });
        console.log(`[Pipeline] Deep-fetch (http): enriched ${http.enriched}/${http.attempted} apply pages` +
          (http.guessedEnriched ? ` (${http.guessedEnriched} via guessed company domain, e.g. LinkedIn-sourced jobs)` : ''));
        // Playwright fallback for JS-rendered pages — opt-IN only (heavy in-process)
        if (cfg.deep_fetch_browser === true && http.jsFallback?.length) {
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
    let llmCalls = 0, embedCalls = 0, scanned = 0;
    const categoryTally = {}; // {category: {scanned, withEmail}} — fed to categoryYield.recordBatch after the loop
    for (const job of unique) {
      try {
        scanned++;
        // Extraction — primary gate: only continue if an email is found
        const extraction = await extractFromJob(job);
        Object.assign(job, extraction);

        // Tag with a tech-stack category (Java/Python/DevOps/AI/...) so the
        // frontend can filter by profile, and so category-weighted keyword
        // rotation (lib/categoryYield.js) can learn which categories actually
        // yield contacts. Computed for every scanned job — not just ones with
        // an email — so the yield rate is measured against the true denominator.
        job.category = categorize(job);

        let emails = [];
        try { emails = JSON.parse(job.extracted_emails || '[]'); } catch {}
        const tally = categoryTally[job.category] || (categoryTally[job.category] = { scanned: 0, withEmail: 0 });
        tally.scanned++;
        if (emails.length) tally.withEmail++;

        // No email AND no secondary contact channel (e.g. WhatsApp phone,
        // see extraction.js) — genuinely no contact found, skip classify/store.
        if (!emails.length && !job.contact_channel) continue;

        // Embed the posting (title+description) for the semantic skill-match
        // tier in /contacts (lib/embeddingMatch.js). Best-effort and
        // self-disabling: embedTexts() returns null with zero further network
        // calls for a while after any failure (wrong model access, rate
        // limit, no key configured) — /contacts falls back to the free
        // synonym+fuzzy matcher (lib/skillMatch.js) for rows with no embedding.
        // Skipped for phone-only leads — not worth the API call for a channel
        // that isn't ranked by skill-match anyway.
        if (emails.length) try {
          const vecs = await embedTexts([`${job.title} ${job.description || ''}`.slice(0, 2000)]);
          if (vecs?.[0]) {
            job.embedding = vecs[0];
            embedCalls++;
            if (embedCalls % 10 === 0) await new Promise(r => setTimeout(r, 500));
          }
        } catch (e) {
          // non-fatal — job.embedding stays unset
        }

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
        const qa = qaCheck(job, classResult, cfg.min_confidence);
        Object.assign(job, qa);

        // Store — 'inserted' = truly new row, 'updated' = existing row refreshed
        const outcome = await storeJob(job);
        if (outcome === 'inserted') totalNew++;
      } catch (e) {
        errors[`store:${job.source}:${job.external_id}`] = e.message;
      }
    }

    console.log(`[Pipeline] Scanned ${scanned} unique jobs — ${totalNew} HR contacts found (${llmCalls} LLM classify calls, ${embedCalls} embed calls)`);
    await recordBatch(categoryTally);
    // Refresh the reply/bounce outcome signal once per run (piggybacks on the
    // pipeline's own 6h-default cadence — outcome data changes slowly, no
    // need for its own separate interval).
    await refreshOutcomeWeights();
    // Probe a handful of newly-seen company domains for a public Greenhouse/
    // Lever board, auto-growing the seed list beyond the static 15 companies.
    await discoverNewCompanyBoards(unique, cfg);

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

    // ── 5.5 Self-healing health checks ──────────────────────────────────────
    // Reads this run's own stats (not live state) — never blocks or fails the
    // run; a health-check error is logged and swallowed.
    await runHealthChecks({
      sourceStats, sourceErrors, totalFetched, totalNew,
      freshlyScraped: cfg.freshly_scraped_count, expectedMin: expectedMinSnapshot,
      proxyHealth: proxyHealthSnapshot,
      relevanceKept: relevanceKeptCount, relevanceDropped: relevanceDroppedCount,
    }).catch(e => console.warn('[Pipeline] health checks failed (non-fatal):', e.message));

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
    // `contacts` is a SHARED pool — every admin/subscriber sees every row
    // regardless of who owns it (see lib/contactVisibility.js's canSeePool:
    // the pool query has NO user_id filter at all), with per-viewer status/
    // notes layered separately via contact_user_state. So exactly ONE row
    // per email is correct and sufficient; every admin already sees it.
    //
    // This briefly looped over every admin instead (one row inserted per
    // admin per email) on the theory that "most contacts aren't showing up
    // for other admins" meant they needed their own copies — but that
    // symptom was actually an artifact of checking raw per-user-id counts
    // directly against the DB rather than through the pool-aware endpoint;
    // admins already had full pool visibility the whole time. The loop just
    // produced N duplicate rows per email (N = admin count) that showed up
    // as repeated entries in the pool view — exactly the "so many duplicacy
    // for one single record" bug — so it's reverted back to a single owner.
    const owner = await db.prepare(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
    ).get();
    if (!owner) {
      console.log('[Pipeline] syncJobIntelContacts: no admin user found, skipping');
      return 0;
    }
    const adminId = owner.id;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // Periodic (5-min) sync: only look at postings from the last 30 minutes to keep it lightweight.
    // Full pipeline run passes sinceMs=null to sync everything.
    const cutoff = sinceMs != null
      ? new Date(sinceMs).toISOString().replace('T', ' ').slice(0, 19)
      : null;

    const postings = cutoff
      ? await db.prepare(
          `SELECT id, company, title, description, category, apply_url, source, extracted_emails, extracted_contact_name
           FROM job_postings
           WHERE extracted_emails != '[]' AND extracted_emails IS NOT NULL
           AND fetched_at >= ?`
        ).all(cutoff)
      : await db.prepare(
          `SELECT id, company, title, description, category, apply_url, source, extracted_emails, extracted_contact_name
           FROM job_postings
           WHERE extracted_emails != '[]' AND extracted_emails IS NOT NULL`
        ).all();

    // Auto-tagging: match every synced posting against the owner admin's own
    // profile skills (these contacts land in their Contacts page) so each one
    // gets a category tag + up to 5 matched-skill tags — reuses the same
    // matcher from /contacts personalization (lib/skillMatch.js).
    const adminProfile = await db.prepare('SELECT skills FROM profiles WHERE user_id = ?').get(adminId).catch(() => null);
    const adminSkills = parseSkills(adminProfile?.skills);

    let totalSynced = 0;
    for (const posting of postings) {
      let emails = [];
      try { emails = JSON.parse(posting.extracted_emails); } catch {}
      if (!emails.length) continue;

      const categoryLabel  = CATEGORY_LABELS[posting.category] || null;
      const staffingTag    = isLikelyStaffingAgency(posting.company) ? '🏢 Staffing Agency' : null;
      const matchedSkills = adminSkills.length
        ? lightweightSkillMatch(adminSkills, `${posting.title || ''} ${posting.description || ''}`).matched.slice(0, 5)
        : [];
      const tags = JSON.stringify([...new Set([categoryLabel, staffingTag, ...matchedSkills].filter(Boolean))]);

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
            (?, ?, ?, ?, ?, ?, 'job-intel', 'New', ?, ?, ?, ?, 'pending')
          ON CONFLICT (email, user_id) DO UPDATE SET
            name       = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.name END,
            company    = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.company END,
            title      = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.title END,
            source_url = CASE WHEN contacts.email_source = 'job-intel' AND ? != '' THEN ? ELSE contacts.source_url END,
            notes      = CASE WHEN contacts.email_source = 'job-intel' THEN ? ELSE contacts.notes END,
            tags       = CASE WHEN contacts.email_source = 'job-intel' THEN ? ELSE contacts.tags END
          RETURNING (xmax = 0) AS is_new
        `).get(
          randomUUID(), adminId, name, email, company, jobTitle, sourceUrl, notes, now, tags,
          name, name,
          company, company,
          jobTitle, jobTitle,
          sourceUrl, sourceUrl,
          notes,
          tags,
        );

        if (row?.is_new) totalSynced++;
      }
    }
    console.log(`[Pipeline] syncJobIntelContacts: synced ${totalSynced} contacts to admin ${adminId}'s list`);

    // settings.value is NOT NULL — 'null' (the JSON literal, as a string) clears
    // the error, not a real SQL NULL, which would violate that constraint.
    await db.prepare(`
      INSERT INTO settings (key, value) VALUES ('job_intel_sync_error', 'null')
      ON CONFLICT (key) DO UPDATE SET value = 'null'
    `).run().catch(() => {});
    return totalSynced;
  } catch (e) {
    console.error('[Pipeline] syncJobIntelContacts failed:', e.message);
    // A bug anywhere in this function previously failed completely silently —
    // caught here, logged to a console nobody was watching, and returned 0,
    // indistinguishable from a legitimate "nothing new to sync" run. Surface
    // it somewhere visible (Admin Panel reads this via GET /job-intel/health)
    // so a future regression here gets noticed within one run, not weeks later.
    await db.prepare(`
      INSERT INTO settings (key, value) VALUES ('job_intel_sync_error', ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `).run(JSON.stringify({ ts: new Date().toISOString(), message: e.message })).catch(() => {});
    return 0;
  }
}

module.exports = { runPipeline, schedulePipeline, syncJobIntelContacts, getConfig, saveConfig, DEFAULT_CONFIG };
