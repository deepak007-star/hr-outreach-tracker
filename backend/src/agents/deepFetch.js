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
// Boilerplate/no-contact addresses that show up in page chrome
const DENY_EMAIL = /(no-?reply|do-?not-?reply|noreply|sentry|wixpress|example\.|@sentry|@2x|\.png|\.jpg|\.gif|@w3\.org|@schema\.org|godaddy|cloudflare|@sentry\.io|postmaster|abuse@|privacy@|@example\.com)/i;

function pageEmails(html) {
  const text = typeof html === 'string' ? html : JSON.stringify(html || '');
  const out = new Set();
  let m;
  while ((m = MAILTO_RE.exec(text))) {
    const e = cleanExtractedEmail(m[1]);
    if (e && !DENY_EMAIL.test(e)) out.add(e.toLowerCase());
  }
  for (const e of extractContacts(text).emails) {
    if (e && !DENY_EMAIL.test(e)) out.add(e.toLowerCase());
  }
  return [...out];
}

function needsFetch(job) {
  return job.apply_url
    && /^https?:\/\//i.test(job.apply_url)
    && !SKIP_HOSTS.test(job.apply_url)
    && !extractContacts(job.description || '').emails.length;
}

// Fetch + scan apply pages concurrently. Mutates jobs in place (sets the
// _pre_contact_email / _pre_all_contacts fast-path fields extractFromJob reads).
async function enrichWithPageEmails(jobs, { cap = 150, concurrency = 8, timeoutMs = 10000, budgetMs = 90000 } = {}) {
  const targets = jobs.filter(needsFetch).slice(0, cap);
  let enriched = 0, jsFallbackList = [], idx = 0;
  const deadline = Date.now() + budgetMs;   // hard overall cap so a run never bogs down

  async function worker() {
    while (idx < targets.length && Date.now() < deadline) {
      const job = targets[idx++];
      try {
        // Direct (noProxy): apply pages don't IP-block, and routing them through
        // slow free proxies is what stalled the pipeline.
        const html = await common.get(job.apply_url, { delay: 0, timeout: timeoutMs, noProxy: true });
        const emails = pageEmails(html);
        if (emails.length) {
          job._pre_contact_email = emails[0];
          job._pre_all_contacts  = JSON.stringify({ emails });
          job._deep = 'http';
          enriched++;
        } else if (typeof html === 'string' && html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 400) {
          jsFallbackList.push(job); // sparse HTML → likely JS-rendered
        }
      } catch { /* dead proxy / timeout / 4xx — skip */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  return { attempted: targets.length, enriched, jsFallback: jsFallbackList };
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
    const proxy = process.env.PROXY_URL && /^(https?|socks[45]):\/\//i.test(process.env.PROXY_URL)
      ? { server: process.env.PROXY_URL } : undefined;
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(proxy ? { proxy } : {}) });
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
