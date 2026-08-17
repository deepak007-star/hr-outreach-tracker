'use strict';

// Deep-fetch step — the biggest yield lever for the Job Intel pipeline.
//
// Job-board APIs almost never put an HR email in the short description they
// return (~5% in practice), but the FULL apply page very often does (mailto:
// links, "send your CV to …", recruiter contact blocks). This step fetches the
// apply_url for every new job that lacks a snippet email and scans the full page
// for emails — through the proxy pool loaded by the orchestrator (Stage 0a), so
// it rotates IPs like the scrapers do.
//
// HTTP-first (fast, covers static Greenhouse/Lever/company pages). A bounded
// Playwright fallback renders JS-heavy pages that returned little usable text.

const { extractContacts, cleanExtractedEmail } = require('../lib/contactExtract');
const common = require('../lib/common');

const MAILTO_RE = /mailto:\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
// Login-walled or emails-never-present hosts — skip to save budget
const SKIP_HOSTS = /(linkedin\.com|indeed\.com|glassdoor\.|ziprecruiter\.com|naukri\.com)/i;
// Domain/asset-extension denials (sentry, ATS noise, image filenames like
// "logo@2x.png") are centralized in cleanExtractedEmail (lib/contactExtract.js)
// so this file and regex extraction can't drift out of sync — this list is
// only for `mailto:` matches, which skip straight past that gate.
function pageEmails(html) {
  const text = typeof html === 'string' ? html : JSON.stringify(html || '');
  const out = new Set();
  let m;
  while ((m = MAILTO_RE.exec(text))) {
    const e = cleanExtractedEmail(m[1]);
    if (e) out.add(e);
  }
  for (const e of extractContacts(text).emails) {
    out.add(e);
  }
  return [...out];
}

function needsFetch(job) {
  return job.apply_url
    && /^https?:\/\//i.test(job.apply_url)
    && !SKIP_HOSTS.test(job.apply_url)
    && !extractContacts(job.description || '').emails.length;
}

// LinkedIn post URLs are login-walled (no static HTML to scan), so SKIP_HOSTS
// excludes them from needsFetch() above — but Stage 0b's LinkedIn feed scrape
// is the pipeline's single richest source, so those jobs never got deep-fetched
// at all. Instead of the (login-walled) post URL, guess the COMPANY'S OWN
// domain from its name and fetch that. Guesses are frequently wrong, so a
// same-company sanity check on the fetched page gates whether anything found
// there is trusted — this must never attach a real email to the wrong company.
const COMPANY_SUFFIXES = /\b(pvt\.?|private|ltd\.?|limited|llc|inc\.?|corp\.?|corporation|technologies|technology|solutions|systems|labs|software|services|group|co\.?)\b/gi;
function guessCompanyDomain(companyName) {
  if (!companyName) return null;
  const slug = companyName.toLowerCase().replace(COMPANY_SUFFIXES, '').replace(/[^a-z0-9]+/g, '').trim();
  if (slug.length < 3) return null;
  return `https://www.${slug}.com`;
}
function needsGuessedFetch(job) {
  return job.apply_url
    && /linkedin\.com/i.test(job.apply_url)
    && !extractContacts(job.description || '').emails.length
    && !!guessCompanyDomain(job.company || job.company_name);
}

// Interleave candidates across sources (round-robin) before applying the cap.
// ingestAll() pushes sources in a fixed order (internal DB, then Arbeitnow,
// Remotive, RemoteOK, WWR, Himalayas, Jobicy, then Greenhouse/Lever LAST) —
// slicing straight to `cap` in that order meant Greenhouse alone (by far the
// single biggest raw source, and real company career pages are a much
// higher-value deep-fetch target than generic aggregator listings) could
// structurally never get a single page fetched: the smaller upstream sources
// filled the entire 200-slot cap before the array ever reached it.
function roundRobinBySource(list) {
  const bySource = new Map();
  for (const job of list) {
    const key = job.source || 'unknown';
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(job);
  }
  const buckets = [...bySource.values()];
  const out = [];
  for (let i = 0; out.length < list.length; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) out.push(bucket[i]);
    }
  }
  return out;
}

// Fetch + scan apply pages concurrently. Mutates jobs in place (sets the
// _pre_contact_email / _pre_all_contacts fast-path fields extractFromJob reads).
async function enrichWithPageEmails(jobs, { cap = 150, concurrency = 8, timeoutMs = 10000, budgetMs = 90000 } = {}) {
  const direct  = jobs.filter(needsFetch);
  const guessed = jobs.filter(j => !needsFetch(j) && needsGuessedFetch(j));
  const targets = roundRobinBySource([...direct, ...guessed]).slice(0, cap);
  let enriched = 0, guessedEnriched = 0, jsFallbackList = [], idx = 0, loggedOneFailure = false;
  const deadline = Date.now() + budgetMs;   // hard overall cap so a run never bogs down

  async function worker() {
    while (idx < targets.length && Date.now() < deadline) {
      const job = targets[idx++];
      const isGuessed = !needsFetch(job); // already filtered to direct-or-guessed above
      const fetchUrl  = isGuessed ? guessCompanyDomain(job.company || job.company_name) : job.apply_url;
      try {
        // Direct (noProxy): apply pages don't IP-block, and routing them through
        // slow free proxies is what stalled the pipeline.
        const html = await common.get(fetchUrl, { delay: 0, timeout: timeoutMs, noProxy: true });
        if (isGuessed) {
          // Guessed domain must actually mention the company before we trust
          // anything on it — otherwise a wrong guess silently misattributes a
          // real email (from an unrelated company) to this job posting.
          const textLc = (typeof html === 'string' ? html : '').toLowerCase();
          const firstWord = (job.company || job.company_name || '').toLowerCase().split(/\s+/)[0];
          if (!firstWord || firstWord.length < 3 || !textLc.includes(firstWord)) continue;
        }
        const emails = pageEmails(html);
        if (emails.length) {
          job._pre_contact_email = emails[0];
          job._pre_all_contacts  = JSON.stringify({ emails });
          job._deep = isGuessed ? 'http-guessed-domain' : 'http';
          enriched++;
          if (isGuessed) guessedEnriched++;
        } else if (!isGuessed && typeof html === 'string' && html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 400) {
          jsFallbackList.push(job); // sparse HTML → likely JS-rendered
        }
      } catch (e) {
        // Expected per-page (dead proxy / timeout / 4xx / guessed domain doesn't
        // exist) — not worth logging every occurrence, but a systemic bug here
        // would otherwise be completely invisible (only symptom: enriched count
        // silently at 0).
        if (!loggedOneFailure) { loggedOneFailure = true; console.warn('[deepFetch] first failure this run (further ones suppressed):', e.message); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  return { attempted: targets.length, enriched, guessedEnriched, jsFallback: jsFallbackList };
}

// Optional Playwright fallback for a small set of JS-rendered apply pages.
// Bounded hard because a headful render is ~2-5s each. Uses the proxy via
// PROXY_URL when present. Best-effort: any failure is swallowed.
async function enrichWithBrowser(jobs, { cap = 25, timeoutMs = 15000 } = {}) {
  if (!jobs.length) return { attempted: 0, enriched: 0 };
  let browser, enriched = 0;
  const list = jobs.slice(0, cap);
  try {
    const { chromium } = require('playwright');
    const { parseProxyForLaunch } = require('../lib/common');
    // parseProxyForLaunch splits out username/password into their own field —
    // passing them embedded in `server` (as this used to) silently fails to
    // authenticate against any credentialed (paid) proxy.
    const proxy = parseProxyForLaunch(process.env.PROXY_URL || '');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], proxy });
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' });
    for (const job of list) {
      const page = await ctx.newPage();
      try {
        await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        const html = await page.content();
        const emails = pageEmails(html);
        if (emails.length) {
          job._pre_contact_email = emails[0];
          job._pre_all_contacts  = JSON.stringify({ emails });
          job._deep = 'browser';
          enriched++;
        }
      } catch { /* skip */ } finally { try { await page.close(); } catch {} }
    }
  } catch (e) {
    console.warn('[deepFetch] browser fallback unavailable:', e.message);
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
  return { attempted: list.length, enriched };
}

module.exports = { enrichWithPageEmails, enrichWithBrowser, pageEmails };
