'use strict';
/**
 * SCRAPER 5 — LinkedIn Feed Posts / HR Hiring Contact Finder
 *
 * Finds public hiring posts where HR / recruiters share email, phone, Google
 * Form, or WhatsApp links, then stores them in scraped_jobs.
 *
 * ─── Search engine phase order (per keyword) ──────────────────────────────
 *  1.  DuckDuckGo HTML (stealth + warm-up)          ← privacy-first, tries first
 *  2.  Google   site:linkedin.com/posts              ← high quality but strict anti-bot
 *  3.  Bing     site:linkedin.com/posts              ← NEW: very lenient anti-bot
 *  4.  Brave    site:linkedin.com/posts              ← NEW: virtually no bot detection
 *  5.  Yahoo    site:linkedin.com/posts              ← NEW: additional fallback
 *  6.  DuckDuckGo Twitter / Telegram posts
 *  7.  Google broad (non-LinkedIn, email required)
 *
 * Anti-bot measures:
 *  - User-agent rotation (pool of 14 realistic UAs)
 *  - Viewport + locale randomisation
 *  - WebDriver / automation property masking
 *  - CAPTCHA/bot-challenge detection via captchaDetector.js
 *  - Per-engine blocked state with configurable cooldown
 *  - Proxy support via PROXY_URL env var (single proxy for this run;
 *    orchestrator rotates across runs via PROXY_URLS → proxyRotator.js)
 *  - Exponential back-off + jitter on challenge detection
 *  - Graceful engine skip when bot-blocked (switches to next engine automatically)
 *
 * Env vars:
 *   PROXY_URL      single http/socks5 proxy URL for this run (optional)
 *   HEADLESS       '0' = show browser, '1' or omitted = headless
 *   SCRAPER_NO_OPEN  '1' = skip opening result HTML
 */

const path   = require('path');
const fs     = require('fs');
const { chromium } = require('playwright');
const {
  sleep, parseArgs, buildSuffix, saveCSV, saveHTML, saveRawCache, RUN_STAMP,
} = require('../lib/common');
const { detectBotChallenge, EngineState } = require('../lib/captchaDetector');
const proxyRotator = require('../lib/proxyRotator');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'linkedin-feed');
const SCRAPER_TITLE = 'LinkedIn Feed — HR Posts';
// Single-proxy fallback when no PROXY_URLS pool is configured.
// Orchestrator passes PROXY_URL (initial round-robin pick) + PROXY_URLS (full pool).
const PROXY_URL = process.env.PROXY_URL || '';

// ── User-agent pool ────────────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.90 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768  },
  { width: 1440, height: 900  },
  { width: 1536, height: 864  },
  { width: 1280, height: 800  },
  { width: 1600, height: 900  },
];
function randomUA()  { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }
function randomVP()  { return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]; }

// ─── Contact extraction ───────────────────────────────────────────────────────

const RE_EMAIL = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
const RE_GFORM = /https?:\/\/(?:docs\.google\.com\/forms|forms\.gle)\/[^\s"'<>)\]]+/g;
const RE_WA    = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\s"'<>)\]]+/g;
const RE_PHONE = /(?:(?:\+91|0091|0)[\s\-]?)?[6-9]\d{9}/g;
const SPAM     = ['noreply','no-reply','example.','donotreply','linkedin.com','sentry.io',
                  'google.com','amazonaws','@2x','@3x','privacy@','legal@',
                  'support@linkedin','jobs@linkedin','unsubscribe@','bounce@','mailer@',
                  'bing.com','yahoo.com','brave.com','duckduckgo.com'];

function extractContact(text) {
  const t = text || '';
  return {
    emails:  [...new Set((t.match(RE_EMAIL) || []).filter(e => !SPAM.some(s => e.toLowerCase().includes(s))))],
    gforms:  [...new Set(t.match(RE_GFORM) || [])],
    phones:  [...new Set((t.match(RE_PHONE) || []).map(p => p.replace(/[\s\-]/g, '')).filter(p => p.length >= 10))],
    waLinks: [...new Set(t.match(RE_WA) || [])],
  };
}
function hasContactStrict(c) { return c.emails.length || c.gforms.length || c.waLinks.length; }
const hasContact = c => c.emails.length || c.gforms.length || c.phones.length || c.waLinks.length;

// ─── Platform / URL helpers ───────────────────────────────────────────────────

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (url.includes('linkedin.com/posts/') || url.includes('linkedin.com/pulse/')) return 'linkedin';
  if (/(?:twitter\.com|x\.com)\/[^/]+\/status\//.test(url)) return 'twitter';
  if (/t\.me\/[A-Za-z0-9_]+/.test(url)) return 'telegram';
  return 'web';
}

function normaliseUrl(url) {
  try {
    const u = new URL(url);
    ['msockid','ref','refId','trackingId','lipi','mbid','source','utm_source',
     'utm_medium','utm_campaign','fbclid','gclid'].forEach(k => u.searchParams.delete(k));
    return u.origin + u.pathname.replace(/\/+$/, '') + (u.search ? u.search : '');
  } catch { return url; }
}

const JOB_BOARD_PATHS = [
  '/job-listings','/viewjob','naukri.com/jobs/','indeed.com/jobs','indeed.com/rc/',
  'glassdoor.com/job-listing','glassdoor.com/Job/','monster.com/jobs/',
  'shine.com/job-search','foundit.in/job-detail','hirist.tech/job',
  'wellfound.com/jobs','cutshort.io/jobs','linkedin.com/jobs/',
  'internshala.com/internship/','internshala.com/job/','instahyre.com/job/',
  'timesjobs.com/job','careerjet.co.in',
  'play.google.com/store','apps.apple.com','apps.microsoft.com',
  // Search engine pages — never results
  'google.com/search','bing.com/search','search.yahoo.com','search.brave.com','duckduckgo.com',
];
function isExcluded(url) {
  const lower = url.toLowerCase();
  return JOB_BOARD_PATHS.some(p => lower.includes(p));
}

// ─── Browser ──────────────────────────────────────────────────────────────────

async function launchBrowser(proxyUrl = '') {
  const noDisplay = process.platform === 'linux' && !process.env.DISPLAY;
  const headless  = process.env.HEADLESS === '0' ? false
                  : noDisplay || process.env.NODE_ENV === 'production' || process.env.HEADLESS === '1';
  const args = [
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-infobars',
    '--disable-blink-features=AutomationControlled',
    '--disable-extensions', '--no-first-run', '--disable-default-apps',
    '--lang=en-IN',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ];
  if (proxyUrl) {
    args.push(`--proxy-server=${proxyUrl}`);
    console.log(`[browser] Using proxy: ${proxyUrl.replace(/:[^:@]+@/, ':***@')}`);
  }
  // Try real browsers first (better fingerprint), fall back to bundled Chromium
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ headless, channel, args }); } catch (_) {}
  }
  return chromium.launch({ headless, args });
}

async function newStealthPage(browser) {
  const ua   = randomUA();
  const vp   = randomVP();
  // Playwright sets user-agent / viewport / locale / headers on the browser
  // CONTEXT, not the page (page.setUserAgent is a Puppeteer-only API and throws
  // "page.setUserAgent is not a function" here). Create a fresh stealth context
  // per page so each request rotates its fingerprint.
  const context = await browser.newContext({
    userAgent: ua,
    viewport:  vp,
    locale:    'en-IN',
    extraHTTPHeaders: {
      'Accept-Language':           'en-IN,en-US;q=0.9,en;q=0.8,hi;q=0.7',
      'sec-ch-ua':                 '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile':          '?0',
      'sec-ch-ua-platform':        '"Windows"',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    // Hide webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Fake Chrome runtime so navigator.chrome exists
    if (!window.chrome) window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    // Fake plugins (non-zero length signals human browser)
    Object.defineProperty(navigator, 'plugins', { get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ]});
    Object.defineProperty(navigator, 'languages',    { get: () => ['en-IN', 'en-US', 'en', 'hi'] });
    Object.defineProperty(navigator, 'platform',     { get: () => 'Win32' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    // Override permissions to look human
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = p =>
        p.name === 'notifications' ? Promise.resolve({ state: 'denied' }) : origQuery(p);
    }
    // Mask Playwright-specific properties
    delete window.__playwright;
    delete window.__pw_manual;
  });

  const page = await context.newPage();
  // Callers only call page.close(); tear the context down with it so contexts
  // don't accumulate across keywords / phases / retries.
  page.once('close', () => { context.close().catch(() => {}); });
  return page;
}

// ─── URL decode (DuckDuckGo) ──────────────────────────────────────────────────

function decodeDDGUrl(href) {
  if (!href) return '';
  const u = href.match(/uddg=([^&]+)/);
  if (u) { try { const d = decodeURIComponent(u[1]); if (d.startsWith('http')) return d; } catch (_) {} }
  if (!href.startsWith('http')) return 'https:' + href;
  return href;
}

// ─── Query builders ───────────────────────────────────────────────────────────

function buildLinkedInGoogleQueries(keyword) {
  return [
    `site:linkedin.com/posts "${keyword}" ("we are hiring" OR "we're hiring" OR "is hiring" OR "urgently hiring") email`,
    `site:linkedin.com/posts "${keyword}" ("job opening" OR "vacancy" OR "now hiring" OR "immediate joiner") email`,
    `site:linkedin.com/posts "${keyword}" ("send resume" OR "send cv" OR "apply now" OR "contact") email`,
    `site:linkedin.com/posts "${keyword}" hiring WhatsApp`,
    `site:linkedin.com/posts "${keyword}" hiring "send your resume"`,
  ];
}

function buildLinkedInDDGQueries(keyword) {
  return [
    `site:linkedin.com/posts "${keyword}" ("hiring" OR "we are hiring" OR "is hiring" OR "now hiring")`,
    `site:linkedin.com/posts "${keyword}" ("urgently hiring" OR "immediate joiner" OR "job opening" OR "vacancy")`,
    `site:linkedin.com/posts "${keyword}" (email OR "apply now" OR "send resume" OR "send cv")`,
  ];
}

function buildLinkedInBingQueries(keyword) {
  return [
    `site:linkedin.com/posts "${keyword}" "hiring" email`,
    `site:linkedin.com/posts "${keyword}" ("we are hiring" OR "now hiring" OR "urgently hiring") email`,
    `site:linkedin.com/posts "${keyword}" ("send resume" OR "send cv" OR "apply now") email`,
    `site:linkedin.com/posts "${keyword}" hiring WhatsApp`,
  ];
}

function buildLinkedInBraveQueries(keyword) {
  return [
    `site:linkedin.com/posts "${keyword}" hiring email`,
    `site:linkedin.com/posts "${keyword}" ("we are hiring" OR "is hiring") email`,
    `site:linkedin.com/posts "${keyword}" ("send resume" OR "contact us") email`,
  ];
}

function buildLinkedInYahooQueries(keyword) {
  return [
    `site:linkedin.com/posts "${keyword}" hiring email`,
    `site:linkedin.com/posts "${keyword}" "we are hiring" email`,
    `site:linkedin.com/posts "${keyword}" "job opening" email`,
  ];
}

function buildTwitterDDGQueries(keyword) {
  return [
    `(site:twitter.com OR site:x.com) "${keyword}" hiring email`,
    `(site:twitter.com OR site:x.com) "${keyword}" "we are hiring" (email OR WhatsApp)`,
  ];
}

function buildTelegramDDGQueries(keyword) {
  return [
    `site:t.me "${keyword}" hiring`,
    `site:t.me "${keyword}" "job opening" email`,
  ];
}

function buildGenericLinkedInQueries() {
  return [
    `site:linkedin.com/posts ("we are hiring" OR "urgently hiring" OR "now hiring") India email`,
    `site:linkedin.com/posts ("immediate joiner" OR "job opening") India email apply`,
    `site:linkedin.com/posts "hiring" India (email OR WhatsApp) "send resume"`,
  ];
}

// ─── DuckDuckGo search ────────────────────────────────────────────────────────

let ddgBlocked  = false;
let ddgWarmedUp = false;

async function warmUpDDG(browser) {
  if (ddgWarmedUp || ddgBlocked) return;
  try {
    const p = await newStealthPage(browser);
    await p.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2500 + Math.random() * 1500);
    await p.close();
    ddgWarmedUp = true;
    console.log('  [ddg] session warmed up');
  } catch (_) {}
}

// Navigation timeout, tunable. Free proxies are slow, so a lower ceiling makes a
// bad proxy fail fast (and be counted) instead of wasting the full 30s per query.
const NAV_TIMEOUT = Math.max(8000, parseInt(process.env.NAV_TIMEOUT_MS || '20000'));
let navTimeoutCount = 0;   // module-level running count of goto timeouts (proxy-slowness signal)

// page.goto wrapper: uses NAV_TIMEOUT and counts timeouts so the run loop can
// react (rotate the proxy or fall back to direct) instead of stalling.
async function gotoTracked(page, url) {
  try {
    return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  } catch (e) {
    if (/Timeout/i.test(e.message || '')) navTimeoutCount++;
    throw e;
  }
}

async function searchDDGRaw(browser, queries, urlFilter, maxResults, tag, engineState) {
  const seen    = new Set();
  const results = [];
  if (ddgBlocked || engineState.isBlocked('duckduckgo')) return results;

  await warmUpDDG(browser);
  let page = await newStealthPage(browser);

  for (const q of queries) {
    if (results.length >= maxResults || ddgBlocked) break;

    let retried = false;
    retry:
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`;
        console.log(`  [ddg/${tag}] ${q.substring(0, 100)}`);
        await gotoTracked(page, url);
        await sleep(2500 + Math.random() * 1000);

        const challenge = await detectBotChallenge(page);
        if (challenge.detected) {
          if (retried) {
            ddgBlocked = true;
            engineState.markBlocked('duckduckgo', 8 * 60_000);
            console.warn('  [ddg] persistently blocked — switching to other engines');
            break retry;
          }
          console.warn(`  [ddg/${tag}] challenge detected (${challenge.type}) — waiting 20s...`);
          await sleep(20000 + Math.random() * 5000);
          try {
            await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(3000 + Math.random() * 2000);
          } catch (_) {}
          retried = true;
          continue;
        }

        const rawItems = await page.evaluate(() =>
          [...document.querySelectorAll('a.result__a')].map(a => {
            const parent  = a.closest('.result, .web-result');
            const snippet = parent?.querySelector('.result__snippet')?.innerText?.trim() || '';
            return { rawHref: a.getAttribute('href') || '', snippet };
          })
        );

        console.log(`    ${rawItems.length} raw links`);
        engineState.markSuccess('duckduckgo');

        for (const item of rawItems) {
          if (results.length >= maxResults) break;
          const decoded = normaliseUrl(decodeDDGUrl(item.rawHref));
          if (!decoded.startsWith('http') || isExcluded(decoded)) continue;
          if (urlFilter && !urlFilter(decoded)) continue;
          if (seen.has(decoded)) continue;
          seen.add(decoded);
          results.push({ url: decoded, snippet: item.snippet, engine: 'ddg', platform: detectPlatform(decoded) });
          console.log(`    + ${decoded.substring(0, 80)}`);
        }
        break retry;
      } catch (err) {
        console.error(`  [ddg/${tag}] error: ${err.message.split('\n')[0]}`);
        if (page.isClosed() || /crashed|closed/i.test(err.message)) {
          try { await page.close(); } catch (_) {}
          page = await newStealthPage(browser);
        }
        break retry;
      }
    }

    await sleep(3500 + Math.random() * 1500);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Google search ────────────────────────────────────────────────────────────

let googleBlocked  = false;
let googleBlockedAt = 0;
const GOOGLE_COOLDOWN_MS = 10 * 60_000; // 10-minute cooldown after block

async function searchGoogle(browser, queries, urlFilter, maxResults, tag, engineState) {
  const seen    = new Set();
  const results = [];

  // Respect cooldown from previous block
  if (googleBlocked && Date.now() - googleBlockedAt < GOOGLE_COOLDOWN_MS) {
    console.log(`  [google/${tag}] skipping — in cooldown (${Math.round((GOOGLE_COOLDOWN_MS - (Date.now() - googleBlockedAt)) / 60_000)}min left)`);
    return results;
  }
  if (engineState.isBlocked('google')) return results;
  googleBlocked = false;

  let page = await newStealthPage(browser);

  for (const q of queries) {
    if (results.length >= maxResults || googleBlocked) break;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20&hl=en&gl=in`;
    console.log(`  [google/${tag}] ${q.substring(0, 100)}`);
    try {
      await gotoTracked(page, url);
      await sleep(3000 + Math.random() * 2000);

      // Accept consent dialogs
      try {
        const consent = page.locator('button[id*="accept"], form[action*="consent"] button').first();
        if (await consent.isVisible({ timeout: 2000 })) { await consent.click(); await sleep(1000); }
      } catch (_) {}

      // Check for CAPTCHA / bot block
      const challenge = await detectBotChallenge(page);
      if (challenge.detected) {
        console.warn(`  [google/${tag}] bot-block detected (${challenge.type}) — cooling down`);
        googleBlocked  = true;
        googleBlockedAt = Date.now();
        engineState.markBlocked('google', GOOGLE_COOLDOWN_MS);
        break;
      }

      const rawItems = await page.evaluate(() =>
        [...document.querySelectorAll('.yuRUbf a, #search a[href^="http"], .g a[href^="http"]')].map(a => {
          const href   = a.href || '';
          const parent = a.closest('.g, [data-sokoban-container], .MjjYud');
          const snippet = parent?.querySelector('.VwiC3b, .s3v9rd, .IsZvec')?.innerText?.trim() || '';
          return { rawHref: href, snippet };
        }).filter(i => i.rawHref.startsWith('http') && !i.rawHref.includes('google.com'))
      );

      console.log(`    ${rawItems.length} raw links`);
      engineState.markSuccess('google');

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        const decoded = normaliseUrl(item.rawHref);
        if (isExcluded(decoded) || seen.has(decoded)) continue;
        if (urlFilter && !urlFilter(decoded)) continue;
        seen.add(decoded);
        results.push({ url: decoded, snippet: item.snippet, engine: 'google', platform: detectPlatform(decoded) });
        console.log(`    + [${detectPlatform(decoded)}] ${decoded.substring(0, 80)}`);
      }
    } catch (err) {
      console.error(`  [google/${tag}] error: ${err.message.split('\n')[0]}`);
      if (page.isClosed() || /crashed|closed/i.test(err.message)) {
        try { await page.close(); } catch (_) {}
        page = await newStealthPage(browser);
      }
    }
    await sleep(2500 + Math.random() * 1500);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Bing search (NEW — much more lenient anti-bot than Google) ──────────────

async function searchBing(browser, queries, urlFilter, maxResults, tag, engineState) {
  const seen    = new Set();
  const results = [];
  if (engineState.isBlocked('bing')) {
    console.log(`  [bing/${tag}] skipping — engine blocked`);
    return results;
  }

  let page = await newStealthPage(browser);

  for (const q of queries) {
    if (results.length >= maxResults) break;
    // Bing's site: operator works reliably; count=50 gets up to 50 results
    const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=50&mkt=en-IN&setlang=en&cc=IN`;
    console.log(`  [bing/${tag}] ${q.substring(0, 100)}`);
    try {
      await gotoTracked(page, url);
      await sleep(2000 + Math.random() * 1500);

      const challenge = await detectBotChallenge(page);
      if (challenge.detected) {
        console.warn(`  [bing/${tag}] blocked (${challenge.type})`);
        engineState.markBlocked('bing', 5 * 60_000);
        break;
      }

      const rawItems = await page.evaluate(() => {
        // Bing: .b_algo li contains each result; h2 a is the title link
        const items = [];
        document.querySelectorAll('li.b_algo').forEach(li => {
          const a = li.querySelector('h2 a, h2 > a');
          if (!a) return;
          const href    = a.href || '';
          const snippet = li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3')?.innerText?.trim() || '';
          if (href.startsWith('http')) items.push({ rawHref: href, snippet });
        });
        // Also catch sidebar / featured results
        document.querySelectorAll('#b_results .b_algo h2 a').forEach(a => {
          const href = a.href || '';
          if (href.startsWith('http') && !items.some(i => i.rawHref === href)) {
            items.push({ rawHref: href, snippet: '' });
          }
        });
        return items;
      });

      console.log(`    ${rawItems.length} raw links`);
      engineState.markSuccess('bing');

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        const decoded = normaliseUrl(item.rawHref);
        if (isExcluded(decoded) || seen.has(decoded)) continue;
        if (urlFilter && !urlFilter(decoded)) continue;
        seen.add(decoded);
        results.push({ url: decoded, snippet: item.snippet, engine: 'bing', platform: detectPlatform(decoded) });
        console.log(`    + [${detectPlatform(decoded)}] ${decoded.substring(0, 80)}`);
      }
    } catch (err) {
      console.error(`  [bing/${tag}] error: ${err.message.split('\n')[0]}`);
      if (page.isClosed() || /crashed|closed/i.test(err.message)) {
        try { await page.close(); } catch (_) {}
        page = await newStealthPage(browser);
      }
    }
    await sleep(2000 + Math.random() * 1000);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Brave Search (NEW — privacy-focused, virtually no anti-bot) ─────────────

async function searchBrave(browser, queries, urlFilter, maxResults, tag, engineState) {
  const seen    = new Set();
  const results = [];
  if (engineState.isBlocked('brave')) {
    console.log(`  [brave/${tag}] skipping — engine blocked`);
    return results;
  }

  let page = await newStealthPage(browser);

  for (const q of queries) {
    if (results.length >= maxResults) break;
    const url = `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web&country=in`;
    console.log(`  [brave/${tag}] ${q.substring(0, 100)}`);
    try {
      await gotoTracked(page, url);
      await sleep(1800 + Math.random() * 1200);

      const challenge = await detectBotChallenge(page);
      if (challenge.detected) {
        console.warn(`  [brave/${tag}] blocked (${challenge.type})`);
        engineState.markBlocked('brave', 5 * 60_000);
        break;
      }

      const rawItems = await page.evaluate(() => {
        // Brave: .fdb or .snippet elements; title link varies by version
        const items = [];
        const selectors = [
          // Brave Web (2024-2025 layout)
          '.snippet .heading-serpresult a',
          '.fdb .snippet-title a',
          '[data-type="result"] .title a',
          // More generic fallback
          '#results a[href^="http"]:not([href*="brave.com"])',
        ];
        for (const sel of selectors) {
          try {
            document.querySelectorAll(sel).forEach(a => {
              const href = a.href || '';
              if (!href.startsWith('http') || href.includes('brave.com')) return;
              const container = a.closest('[data-type], .snippet, .fdb');
              const snippet   = container?.querySelector('.snippet-description, .description')?.innerText?.trim() || '';
              if (!items.some(i => i.rawHref === href)) items.push({ rawHref: href, snippet });
            });
          } catch (_) {}
          if (items.length > 0) break;
        }
        return items;
      });

      console.log(`    ${rawItems.length} raw links`);
      engineState.markSuccess('brave');

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        const decoded = normaliseUrl(item.rawHref);
        if (isExcluded(decoded) || seen.has(decoded)) continue;
        if (urlFilter && !urlFilter(decoded)) continue;
        seen.add(decoded);
        results.push({ url: decoded, snippet: item.snippet, engine: 'brave', platform: detectPlatform(decoded) });
        console.log(`    + [${detectPlatform(decoded)}] ${decoded.substring(0, 80)}`);
      }
    } catch (err) {
      console.error(`  [brave/${tag}] error: ${err.message.split('\n')[0]}`);
      if (page.isClosed() || /crashed|closed/i.test(err.message)) {
        try { await page.close(); } catch (_) {}
        page = await newStealthPage(browser);
      }
    }
    await sleep(1500 + Math.random() * 1000);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Yahoo Search (NEW — useful fallback) ────────────────────────────────────

async function searchYahoo(browser, queries, urlFilter, maxResults, tag, engineState) {
  const seen    = new Set();
  const results = [];
  if (engineState.isBlocked('yahoo')) {
    console.log(`  [yahoo/${tag}] skipping — engine blocked`);
    return results;
  }

  let page = await newStealthPage(browser);

  for (const q of queries) {
    if (results.length >= maxResults) break;
    const url = `https://search.yahoo.com/search?p=${encodeURIComponent(q)}&n=20&ei=UTF-8&vm=p`;
    console.log(`  [yahoo/${tag}] ${q.substring(0, 100)}`);
    try {
      await gotoTracked(page, url);
      await sleep(2000 + Math.random() * 1500);

      const challenge = await detectBotChallenge(page);
      if (challenge.detected) {
        console.warn(`  [yahoo/${tag}] blocked (${challenge.type})`);
        engineState.markBlocked('yahoo', 5 * 60_000);
        break;
      }

      const rawItems = await page.evaluate(() => {
        const items = [];
        // Yahoo SERP layout — try multiple selector variants
        const selectors = [
          '#web .algo h3 a',
          '#web .compTitle a',
          '.algo-sr h3 a',
          '#web li h3 a',
        ];
        for (const sel of selectors) {
          try {
            document.querySelectorAll(sel).forEach(a => {
              const href = a.href || a.getAttribute('href') || '';
              const realHref = href.includes('r.search.yahoo.com')
                ? (decodeURIComponent(href.match(/RU=([^/]+)/)?.[1] || '') || href)
                : href;
              if (!realHref.startsWith('http') || realHref.includes('yahoo.com')) return;
              const li      = a.closest('li, .algo');
              const snippet = li?.querySelector('.compText, p, .fc-2nd')?.innerText?.trim() || '';
              if (!items.some(i => i.rawHref === realHref)) items.push({ rawHref: realHref, snippet });
            });
          } catch (_) {}
          if (items.length > 0) break;
        }
        return items;
      });

      console.log(`    ${rawItems.length} raw links`);
      engineState.markSuccess('yahoo');

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        const decoded = normaliseUrl(item.rawHref);
        if (isExcluded(decoded) || seen.has(decoded)) continue;
        if (urlFilter && !urlFilter(decoded)) continue;
        seen.add(decoded);
        results.push({ url: decoded, snippet: item.snippet, engine: 'yahoo', platform: detectPlatform(decoded) });
        console.log(`    + [${detectPlatform(decoded)}] ${decoded.substring(0, 80)}`);
      }
    } catch (err) {
      console.error(`  [yahoo/${tag}] error: ${err.message.split('\n')[0]}`);
      if (page.isClosed() || /crashed|closed/i.test(err.message)) {
        try { await page.close(); } catch (_) {}
        page = await newStealthPage(browser);
      }
    }
    await sleep(2000 + Math.random() * 1000);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Page scraper ─────────────────────────────────────────────────────────────

async function scrapePage(browser, url) {
  const page = await newStealthPage(browser);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(1800 + Math.random() * 800);

    // Quick CAPTCHA check — skip the page if it's behind a wall
    const challenge = await detectBotChallenge(page);
    if (challenge.detected) {
      console.log(`    [page] bot-block (${challenge.type}) — skipping ${url.slice(0, 50)}`);
      return { text: '', ogDesc: '', ogTitle: '' };
    }

    const data = await page.evaluate(() => {
      const ogDesc   = document.querySelector('meta[property="og:description"]')?.content || '';
      const ogTitle  = document.querySelector('meta[property="og:title"]')?.content        || '';
      const metaDesc = document.querySelector('meta[name="description"]')?.content         || '';

      let jsonLd = '';
      try {
        const el = document.querySelector('script[type="application/ld+json"]');
        if (el) jsonLd = el.textContent || '';
      } catch (_) {}

      const DOM_LI = [
        '.feed-shared-update-v2__description-wrapper',
        '.update-components-text', '.feed-shared-text',
        '.attributed-text-segment-list__content',
        '[data-test-id="main-feed-activity-card__commentary"]',
        '.main-feed-activity-card__commentary',
        '.base-main-card__description', '.description__text',
      ];
      let domText = '';
      for (const sel of DOM_LI) {
        const el = document.querySelector(sel);
        const t  = el?.textContent?.trim();
        if (t && t.length > 30) { domText = t; break; }
      }

      const bodyText = document.body?.innerText?.slice(0, 8000) || '';
      return { ogDesc, ogTitle, metaDesc, jsonLd, domText, bodyText };
    });

    const combined = [data.ogDesc, data.metaDesc, data.domText, data.jsonLd, data.bodyText]
      .filter(Boolean).join('\n');

    return { text: combined, ogDesc: data.ogDesc || data.metaDesc, ogTitle: data.ogTitle };
  } catch (err) {
    console.error(`  [page] ${url.slice(0, 60)}: ${err.message.split('\n')[0]}`);
    return { text: '', ogDesc: '', ogTitle: '' };
  } finally {
    await page.close();
  }
}

// ─── Deduplicate results from multiple engines ────────────────────────────────

function mergeResults(arrays) {
  const seen = new Set();
  const out  = [];
  for (const arr of arrays) {
    for (const r of arr) {
      const norm = normaliseUrl(r.url);
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(r);
      }
    }
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs('India');

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/linkedin-feed.js "Python Developer" "React Developer"',
      '',
      'Options:',
      '  --limit <n>        Max posts with contact info (default: 30)',
      '  --location <str>   Location hint (default: India)',
      '',
      'Env vars:',
      '  PROXY_URL          Single proxy (http://host:port or socks5://host:port)',
      '  HEADLESS           0 = show browser',
      '',
    ].join('\n'));
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(SCRAPER_TITLE);
  console.log(`${'='.repeat(60)}`);
  // Load proxy pool from PROXY_URLS env var (set by orchestrator).
  // Falls back to the single PROXY_URL if no pool is configured.
  proxyRotator.loadFromEnv();
  // Prefer an HTTP-validated proxy — socks entries only get a TCP check and
  // often hang the browser (which has no per-request fallback).
  let currentProxy = proxyRotator.size > 0 ? (proxyRotator.nextHttp() || proxyRotator.next() || PROXY_URL) : PROXY_URL;

  console.log(`Keywords   : ${opts.titles.join(', ')}`);
  console.log(`Limit      : ${opts.limit}`);
  console.log(`Location   : ${opts.location || 'India'}`);
  if (proxyRotator.total > 0) {
    console.log(`Proxy pool : ${proxyRotator.total} configured, ${proxyRotator.size} alive`);
    if (currentProxy) console.log(`Proxy      : ${currentProxy.replace(/:[^:@]+@/, ':***@')}`);
  } else if (currentProxy) {
    console.log(`Proxy      : ${currentProxy.replace(/:[^:@]+@/, ':***@')} (single)`);
  }
  console.log(`Engines    : DDG → Google → Bing → Brave → Yahoo → Twitter/TG → Broad`);
  console.log(`${'='.repeat(60)}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const engineState = new EngineState();
  let browser       = await launchBrowser(currentProxy);
  const posts       = [];
  const seenUrls    = new Set();

  // Quick reachability probe: navigate to a light page through the current proxy.
  // A dead proxy (common with TCP-only-validated socks) otherwise hangs every
  // phase's first navigation until timeout.
  async function probeBrowser(timeoutMs = 9000) {
    let page;
    try {
      page = await browser.newPage();
      await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return true;
    } catch { return false; }
    finally { if (page) try { await page.close(); } catch {} }
  }

  // Ensure we start on a WORKING browser: probe the current proxy; if dead, try
  // other proxies (http-first), and if none work, relaunch DIRECT so a bad
  // proxy can never stall the whole run.
  async function ensureWorkingBrowser() {
    if (!currentProxy) return;               // already direct
    if (await probeBrowser()) return;        // current proxy works
    console.log(`[proxy] ${currentProxy.replace(/:[^:@]+@/, ':***@')} failed reachability probe — switching`);
    for (let i = 0; i < 3; i++) {
      proxyRotator.markFailed(currentProxy);
      const next = proxyRotator.nextHttp() || proxyRotator.next();
      if (!next || next === currentProxy) break;
      try { await browser.close(); } catch {}
      currentProxy = next;
      browser = await launchBrowser(currentProxy);
      if (await probeBrowser()) { console.log(`[proxy] using working proxy ${currentProxy.replace(/:[^:@]+@/, ':***@')}`); return; }
    }
    console.log('[proxy] no working proxy — relaunching DIRECT (no proxy) to avoid stalling');
    try { await browser.close(); } catch {}
    currentProxy = '';
    browser = await launchBrowser('');
  }
  await ensureWorkingBrowser();

  const broadShare     = Math.max(3, Math.round(opts.limit * 0.2));
  const perTitleBudget = Math.max(1, opts.limit - broadShare);
  const perTitle       = Math.ceil(perTitleBudget / opts.titles.length);

  // Rotate to the next alive proxy and relaunch the browser.
  // Called when one or more engines are blocked — a new IP clears the block.
  // Returns true if a new proxy was picked and the browser was relaunched.
  async function tryRotateProxy(reason, { penalize = true } = {}) {
    if (proxyRotator.size === 0) return false;
    // penalize=false for PROACTIVE rotation — don't mark a still-working IP dead.
    if (penalize && currentProxy) proxyRotator.markFailed(currentProxy);
    const next = proxyRotator.nextHttp() || proxyRotator.next();
    if (!next || next === currentProxy) {
      console.log(`[proxy] No alternative proxy available — continuing with current IP`);
      return false;
    }
    console.log(`[proxy] Rotating after ${reason} — new proxy: ${next.replace(/:[^:@]+@/, ':***@')}`);
    try { await browser.close(); } catch {}
    currentProxy = next;
    browser = await launchBrowser(currentProxy);
    // If the freshly-picked proxy is itself dead, probe + fall back to direct
    await ensureWorkingBrowser();
    return true;
  }

  async function collectFromResults(searchResults, keyword, cap) {
    let found = 0;
    for (const result of searchResults) {
      if (found >= cap) break;
      const normUrl   = normaliseUrl(result.url);
      if (seenUrls.has(normUrl)) continue;

      const isLinkedIn   = result.platform === 'linkedin';
      const checkContact = isLinkedIn ? hasContact : hasContactStrict;

      let contact  = isLinkedIn
        ? extractContact(result.snippet)
        : (hasContactStrict(extractContact(result.snippet)) ? extractContact(result.snippet) : { emails:[], gforms:[], phones:[], waLinks:[] });
      let postText = result.snippet;
      let ogDesc   = result.snippet;

      if (!checkContact(contact)) {
        process.stdout.write(`  visiting [${result.platform}/${result.engine}] ${result.url.slice(0, 60)}... `);
        const pageData = await scrapePage(browser, result.url);
        postText = pageData.text;
        ogDesc   = pageData.ogDesc || result.snippet;
        contact  = extractContact(postText);

        if (!checkContact(contact)) {
          process.stdout.write('no contact\n');
          await sleep(600 + Math.random() * 400);
          continue;
        }
      }

      seenUrls.add(normUrl);
      const firstContact =
        contact.emails[0]  || contact.gforms[0] ||
        contact.waLinks[0] || contact.phones[0]  || '';

      process.stdout.write(`OK [${result.platform}/${result.engine}] — ${firstContact}\n`);

      posts.push({
        source:         'linkedin-feed',
        title:          keyword,
        company:        '',
        location:       opts.location || 'India',
        jobType:        'Feed Post',
        salary:         '',
        experience:     '',
        tags:           keyword,
        description:    (ogDesc || postText).slice(0, 600).replace(/\s+/g, ' ').trim(),
        link:           result.url,
        applyLink:      firstContact.startsWith('http') ? firstContact : result.url,
        contactEmail:   contact.emails[0]  || '',
        contactPhone:   contact.phones[0]  || '',
        googleFormLink: contact.gforms[0]  || '',
        whatsappLink:   contact.waLinks[0] || '',
        allContacts:    JSON.stringify({
          emails:   contact.emails,
          phones:   contact.phones,
          gforms:   contact.gforms,
          waLinks:  contact.waLinks,
          platform: result.platform,
          engine:   result.engine,
        }),
        postedAt:  '',
        scrapedAt: new Date().toISOString(),
      });

      found++;
      await sleep(1000 + Math.random() * 500);
    }
    return found;
  }

  // Proactively rotate the IP every N keywords (default 3) so a long scrape is
  // spread across multiple IPs instead of building a footprint on one — even
  // when no block has happened yet. Reactive (on-block) rotation still runs too.
  const ROTATE_EVERY = Math.max(0, parseInt(process.env.ROTATE_EVERY_KEYWORDS || '3'));
  const TIMEOUT_GIVEUP = Math.max(2, parseInt(process.env.PROXY_TIMEOUT_GIVEUP || '3'));
  let kwIndex = 0;
  let proxyDisabled = false;   // set once we give up on slow proxies and go direct

  try {
    for (const keyword of opts.titles) {
      if (posts.length >= opts.limit) break;

      // Slow-proxy guard: free proxies often pass the reachability probe but are
      // too slow for real search navigation (30s goto timeouts). Once timeouts
      // pile up, fall back to DIRECT for the rest of the run — direct is fast and
      // the engine cascade (Brave/Bing are lenient) handles the occasional block.
      if (!proxyDisabled && currentProxy && navTimeoutCount >= TIMEOUT_GIVEUP) {
        console.log(`[proxy] ${navTimeoutCount} navigation timeouts — proxy too slow, switching to DIRECT for the rest of the run`);
        try { await browser.close(); } catch {}
        currentProxy = '';
        browser = await launchBrowser('');
        proxyDisabled = true;
        navTimeoutCount = 0;
      }

      // Proactive rotation (don't penalize the current still-working IP)
      if (!proxyDisabled && ROTATE_EVERY > 0 && proxyRotator.size > 1 && kwIndex > 0 && kwIndex % ROTATE_EVERY === 0) {
        await tryRotateProxy(`proactive rotation (every ${ROTATE_EVERY} keywords)`, { penalize: false });
        navTimeoutCount = 0;
      }
      kwIndex++;

      // If any engines were blocked during the previous keyword, rotate proxy now
      // so this keyword gets a fresh IP across all phases.
      const blocked = ['google', 'bing', 'duckduckgo', 'brave', 'yahoo'].filter(e => engineState.isBlocked(e));
      if (!proxyDisabled && blocked.length > 0) {
        const rotated = await tryRotateProxy(blocked.join('+') + ' blocked from prev keyword');
        if (rotated) {
          // Clear block states — new IP makes these engines available again
          for (const e of blocked) engineState.markSuccess(e);
          navTimeoutCount = 0;
        }
      }

      console.log(`\n[keyword] "${keyword}" — target: ${perTitle} posts with contact`);

      const target   = Math.min(perTitle, opts.limit - posts.length);
      const liFilter = u => u.includes('linkedin.com/posts/') || u.includes('linkedin.com/pulse/');

      // ── Phase 1: DuckDuckGo LinkedIn ──────────────────────────────────────
      const ddgLI = await searchDDGRaw(
        browser, buildLinkedInDDGQueries(keyword), liFilter, target * 5, 'linkedin', engineState);
      console.log(`  [ddg/linkedin] ${ddgLI.length} posts`);

      // ── Phase 2: Google LinkedIn ──────────────────────────────────────────
      const googleLI = await searchGoogle(
        browser, buildLinkedInGoogleQueries(keyword), liFilter, target * 6, 'linkedin', engineState);
      console.log(`  [google/linkedin] ${googleLI.length} posts`);

      // ── Phase 3: Bing LinkedIn (NEW) ──────────────────────────────────────
      const bingLI = await searchBing(
        browser, buildLinkedInBingQueries(keyword), liFilter, target * 5, 'linkedin', engineState);
      console.log(`  [bing/linkedin] ${bingLI.length} posts`);

      // ── Phase 4: Brave Search LinkedIn (NEW) ─────────────────────────────
      const braveLI = await searchBrave(
        browser, buildLinkedInBraveQueries(keyword), liFilter, target * 4, 'linkedin', engineState);
      console.log(`  [brave/linkedin] ${braveLI.length} posts`);

      // ── Phase 5: Yahoo LinkedIn (NEW — only if still under target) ────────
      let yahooLI = [];
      const alreadyFound = mergeResults([ddgLI, googleLI, bingLI, braveLI]).length;
      if (alreadyFound < target * 3) {
        yahooLI = await searchYahoo(
          browser, buildLinkedInYahooQueries(keyword), liFilter, target * 3, 'linkedin', engineState);
        console.log(`  [yahoo/linkedin] ${yahooLI.length} posts`);
      }

      // Merge + dedup all LinkedIn results from all engines
      let allResults = mergeResults([ddgLI, googleLI, bingLI, braveLI, yahooLI]);

      // ── Phase 6: DuckDuckGo Twitter + Telegram ────────────────────────────
      if (!ddgBlocked && !engineState.isBlocked('duckduckgo')) {
        const twFilter = u => /(?:twitter\.com|x\.com)\/[^/]+\/status\//.test(u);
        const tgFilter = u => /t\.me\/[A-Za-z0-9_]+/.test(u);
        const tw = await searchDDGRaw(browser, buildTwitterDDGQueries(keyword), twFilter, Math.ceil(target * 1.5), 'twitter', engineState);
        const tg = await searchDDGRaw(browser, buildTelegramDDGQueries(keyword), tgFilter, Math.ceil(target * 1.5), 'telegram', engineState);
        const extra = mergeResults([tw, tg]).filter(r =>
          !allResults.some(x => normaliseUrl(x.url) === normaliseUrl(r.url)));
        allResults = allResults.concat(extra);
        console.log(`  [ddg/tw+tg] +${extra.length} posts`);
      }

      // ── Phase 7: Google broad (only when LinkedIn-specific results are low) ─
      const liCount = allResults.filter(r => r.platform === 'linkedin').length;
      if (liCount < 3) {
        console.log('  LinkedIn results low — trying Google broad...');
        const gBroad = await searchGoogle(
          browser, buildLinkedInGoogleQueries(keyword), null, target * 4, 'broad', engineState);
        const gBNew = gBroad.filter(r =>
          !allResults.some(x => normaliseUrl(x.url) === normaliseUrl(r.url)) && !isExcluded(r.url));
        allResults = allResults.concat(gBNew);
        console.log(`  [google/broad] +${gBNew.length} new URLs`);
      }

      if (!allResults.length) {
        console.log(`  No URLs found for "${keyword}" across all engines. Skipping.`);
        continue;
      }

      const byEngine = allResults.reduce((a, r) => { a[r.engine] = (a[r.engine] || 0) + 1; return a; }, {});
      const byPlatform = allResults.reduce((a, r) => { a[r.platform] = (a[r.platform] || 0) + 1; return a; }, {});
      console.log(`  Engines: ${JSON.stringify(byEngine)}`);
      console.log(`  Platforms: ${JSON.stringify(byPlatform)}`);

      const found = await collectFromResults(allResults, keyword, target);
      console.log(`\n  -> ${found} posts with contact info for "${keyword}"`);

      if (found > 0) saveRawCache(posts, OUTPUT_DIR);
    }

    // ── Broad (title-agnostic) pass ──────────────────────────────────────────
    if (posts.length < opts.limit) {
      const remaining = opts.limit - posts.length;

      // Rotate proxy before broad pass if multiple engines are still blocked
      const blockedNow = ['google', 'bing', 'duckduckgo'].filter(e => engineState.isBlocked(e));
      if (blockedNow.length >= 2) {
        const rotated = await tryRotateProxy('multi-engine-block before broad pass');
        if (rotated) {
          for (const e of blockedNow) engineState.markSuccess(e);
        }
      }

      console.log(`\n[broad] title-agnostic hiring search — target: ${remaining} more posts`);

      const liFilter  = u => u.includes('linkedin.com/posts/') || u.includes('linkedin.com/pulse/');
      const googleGen = await searchGoogle(browser, buildGenericLinkedInQueries(), liFilter, remaining * 5, 'generic-li', engineState);
      const bingGen   = await searchBing(browser, buildGenericLinkedInQueries(), liFilter, remaining * 4, 'generic-li', engineState);
      const braveGen  = await searchBrave(browser, buildGenericLinkedInQueries(), liFilter, remaining * 3, 'generic-li', engineState);
      let broadResults = mergeResults([googleGen, bingGen, braveGen]);

      if (!ddgBlocked && !engineState.isBlocked('duckduckgo')) {
        const ddgGen = await searchDDGRaw(browser, buildGenericLinkedInQueries(), liFilter, remaining * 3, 'generic-li', engineState);
        broadResults = mergeResults([...broadResults, ddgGen]);
      }

      console.log(`  [broad total] ${broadResults.length} URLs from all engines`);
      const found = await collectFromResults(broadResults, 'Hiring (General)', remaining);
      console.log(`\n  -> ${found} posts from broad pass`);
      if (found > 0) saveRawCache(posts, OUTPUT_DIR);
    }

  } finally {
    await browser.close();
  }

  // ── Engine state summary ──────────────────────────────────────────────────
  const summary = engineState.summary();
  if (Object.keys(summary).length) {
    console.log('\n[engine-summary]', JSON.stringify(summary, null, 2));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total posts with contact: ${posts.length}`);
  console.log(`${'='.repeat(60)}`);

  if (!posts.length) {
    console.log('Nothing found. Search engines may be blocking this IP — set PROXY_URLS (comma-sep pool) or PROXY_URL (single) env var, or configure the proxy list in Admin Panel → Job Intel.');
    return;
  }

  saveRawCache(posts, OUTPUT_DIR);

  const suffix = buildSuffix(opts);
  const base   = path.join(OUTPUT_DIR, `${RUN_STAMP}${suffix}`);
  saveCSV(posts, base + '.csv', ['contactPhone', 'googleFormLink', 'whatsappLink', 'allContacts', 'scrapedAt']);
  saveHTML(posts, opts, base + '.html', SCRAPER_TITLE);
  if (!process.env.SCRAPER_NO_OPEN) require('child_process').exec(`start "" "${base}.html"`);

  console.log(`\nSaved:`);
  console.log(`  CSV  -> ${base}.csv`);
  console.log(`  HTML -> ${base}.html`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
