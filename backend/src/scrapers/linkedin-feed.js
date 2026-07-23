'use strict';
/**
 * SCRAPER 5 — LinkedIn Feed Posts / HR Hiring Contact Finder
 *
 * Finds public hiring posts where HR / recruiters share email, phone, Google
 * Form, or WhatsApp links, then stores them in scraped_jobs for the feed and
 * cold-email workflows.
 *
 * CONFIRMED WORKING APPROACH (July 2026):
 *   Google with site:linkedin.com/posts queries returns real LinkedIn post
 *   URLs — 19 results / ~6 unique per query in testing. DuckDuckGo HTML
 *   endpoint gets bot-challenged but is worth trying with stealth first since
 *   it was the original working approach. Bing is DROPPED — it ignores site:
 *   and quoted-phrase restrictions, returning irrelevant general-web results.
 *
 * Phase order per keyword:
 *   1. DuckDuckGo HTML with site:linkedin.com/posts (stealth + warm-up)
 *   2. Google with site:linkedin.com/posts  ← confirmed to return LinkedIn URLs
 *   3. DDG Twitter / Telegram
 *   4. Google broad (non-LinkedIn, requires EMAIL not just phone)
 *
 * Usage:
 *   node scrapers/linkedin-feed.js "Python Developer" "React Developer"
 *   node scrapers/linkedin-feed.js "Data Analyst" --limit 20
 *   node scrapers/linkedin-feed.js "Node.js" --location "Bangalore, India"
 */

const path = require('path');
const fs   = require('fs');
const { chromium } = require('playwright');
const {
  sleep, parseArgs, buildSuffix, saveCSV, saveHTML, saveRawCache, RUN_STAMP,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'linkedin-feed');
const SCRAPER_TITLE = 'LinkedIn Feed — HR Posts';

// ─── Contact extraction ───────────────────────────────────────────────────────

const RE_EMAIL = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
const RE_GFORM = /https?:\/\/(?:docs\.google\.com\/forms|forms\.gle)\/[^\s"'<>)\]]+/g;
const RE_WA    = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\s"'<>)\]]+/g;
const RE_PHONE = /(?:(?:\+91|0091|0)[\s\-]?)?[6-9]\d{9}/g;
const SPAM     = ['noreply','no-reply','example.','donotreply','linkedin.com','sentry.io',
                  'google.com','amazonaws','@2x','@3x','privacy@','legal@',
                  'support@linkedin','jobs@linkedin','unsubscribe@','bounce@','mailer@'];

function extractContact(text) {
  const t = text || '';
  return {
    emails:  [...new Set((t.match(RE_EMAIL) || []).filter(e => !SPAM.some(s => e.toLowerCase().includes(s))))],
    gforms:  [...new Set(t.match(RE_GFORM) || [])],
    phones:  [...new Set((t.match(RE_PHONE) || []).map(p => p.replace(/[\s\-]/g, '')).filter(p => p.length >= 10))],
    waLinks: [...new Set(t.match(RE_WA) || [])],
  };
}

// For non-LinkedIn pages, phone numbers alone are too noisy (random digits on
// any web page). Only require email/gform/whatsapp; skip phone-only results.
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

// Normalise a URL to reduce near-duplicate entries (different tracking params,
// trailing slashes) that would otherwise pass the seen-set dedup.
function normaliseUrl(url) {
  try {
    const u = new URL(url);
    // Drop known tracker/session params
    ['msockid','ref','refId','trackingId','lipi','mbid','source','utm_source',
     'utm_medium','utm_campaign','fbclid','gclid'].forEach(k => u.searchParams.delete(k));
    return u.origin + u.pathname.replace(/\/+$/, '') + (u.search ? u.search : '');
  } catch { return url; }
}

const JOB_BOARD_PATHS = [
  '/job-listings', '/viewjob', 'naukri.com/jobs/', 'indeed.com/jobs', 'indeed.com/rc/',
  'glassdoor.com/job-listing', 'glassdoor.com/Job/', 'monster.com/jobs/',
  'shine.com/job-search', 'foundit.in/job-detail', 'hirist.tech/job',
  'wellfound.com/jobs', 'cutshort.io/jobs', 'linkedin.com/jobs/',
  'internshala.com/internship/', 'internshala.com/job/', 'instahyre.com/job/',
  'timesjobs.com/job', 'careerjet.co.in',
  // App stores — contain random phone/numbers that aren't HR contacts
  'play.google.com/store', 'apps.apple.com', 'apps.microsoft.com',
];
function isExcluded(url) {
  const lower = url.toLowerCase();
  return JOB_BOARD_PATHS.some(p => lower.includes(p));
}

// ─── Browser + stealth ────────────────────────────────────────────────────────

async function launchBrowser() {
  const noDisplay = process.platform === 'linux' && !process.env.DISPLAY;
  const headless  = process.env.HEADLESS === '0' ? false
                  : noDisplay || process.env.NODE_ENV === 'production' || process.env.HEADLESS === '1';
  const args = [
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-infobars',
    '--disable-blink-features=AutomationControlled',
    '--disable-extensions', '--no-first-run', '--disable-default-apps', '--lang=en-US',
  ];
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ headless, channel, args }); } catch (_) {}
  }
  return chromium.launch({ headless, args });
}

async function newStealthPage(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'hi'] });
    const oq = window.navigator.permissions?.query;
    if (oq) window.navigator.permissions.query =
      p => p.name === 'notifications' ? Promise.resolve({ state: 'denied' }) : oq(p);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8' });
  return page;
}

// ─── URL decoding ─────────────────────────────────────────────────────────────

function decodeDDGUrl(href) {
  if (!href) return '';
  const u = href.match(/uddg=([^&]+)/);
  if (u) { try { const d = decodeURIComponent(u[1]); if (d.startsWith('http')) return d; } catch (_) {} }
  if (!href.startsWith('http')) return 'https:' + href;
  return href;
}

// ─── Query builders ───────────────────────────────────────────────────────────

// Confirmed working on Google (returns real LinkedIn post URLs — tested July 2026)
function buildLinkedInGoogleQueries(keyword) {
  return [
    `site:linkedin.com/posts "${keyword}" ("we are hiring" OR "we're hiring" OR "is hiring" OR "urgently hiring") email`,
    `site:linkedin.com/posts "${keyword}" ("job opening" OR "vacancy" OR "now hiring" OR "immediate joiner") email`,
    `site:linkedin.com/posts "${keyword}" ("send resume" OR "send cv" OR "apply now" OR "contact") email`,
    `site:linkedin.com/posts "${keyword}" hiring WhatsApp`,
    `site:linkedin.com/posts "${keyword}" hiring "send your resume"`,
  ];
}

// DDG queries (site:linkedin.com/posts — worked pre-bot-challenge)
function buildLinkedInDDGQueries(keyword) {
  return [
    `site:linkedin.com/posts "${keyword}" ("hiring" OR "we are hiring" OR "is hiring" OR "now hiring")`,
    `site:linkedin.com/posts "${keyword}" ("urgently hiring" OR "immediate joiner" OR "job opening" OR "vacancy")`,
    `site:linkedin.com/posts "${keyword}" (email OR "apply now" OR "send resume" OR "send cv")`,
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

// Generic Google queries (no site: restriction) for the title-agnostic broad pass
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

async function searchDDGRaw(browser, queries, urlFilter, maxResults, tag) {
  const seen    = new Set();
  const results = [];
  if (ddgBlocked) return results;

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
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500 + Math.random() * 1000);

        const { rawItems, challenged } = await page.evaluate(() => ({
          rawItems: [...document.querySelectorAll('a.result__a')].map(a => {
            const parent  = a.closest('.result, .web-result');
            const snippet = parent?.querySelector('.result__snippet')?.innerText?.trim() || '';
            return { rawHref: a.getAttribute('href') || '', snippet };
          }),
          challenged: !!document.querySelector('.anomaly-modal, #challenge-form, [class*="challenge"]'),
        }));

        if (challenged) {
          if (retried) { ddgBlocked = true; console.warn('  [ddg] blocked — switching to Google'); break retry; }
          console.warn(`  [ddg/${tag}] challenge — waiting 20s...`);
          await sleep(20000);
          try {
            await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(3000 + Math.random() * 2000);
          } catch (_) {}
          retried = true;
          continue;
        }

        console.log(`    ${rawItems.length} raw links`);

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

// ─── Google search (primary for LinkedIn posts — confirmed working) ───────────

async function searchGoogle(browser, queries, urlFilter, maxResults, tag) {
  const seen    = new Set();
  const results = [];
  let page = await newStealthPage(browser);

  for (const q of queries) {
    if (results.length >= maxResults) break;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20&hl=en&gl=in`;
    console.log(`  [google/${tag}] ${q.substring(0, 100)}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000 + Math.random() * 1000);

      try {
        const consent = page.locator('button[id*="accept"], form[action*="consent"] button').first();
        if (await consent.isVisible({ timeout: 2000 })) { await consent.click(); await sleep(1000); }
      } catch (_) {}

      const rawItems = await page.evaluate(() =>
        [...document.querySelectorAll('.yuRUbf a, #search a[href^="http"], .g a[href^="http"]')].map(a => {
          const href = a.href || '';
          const parent = a.closest('.g, [data-sokoban-container], .MjjYud');
          const snippet = parent?.querySelector('.VwiC3b, .s3v9rd, .IsZvec')?.innerText?.trim() || '';
          return { rawHref: href, snippet };
        }).filter(i => i.rawHref.startsWith('http') && !i.rawHref.includes('google.com'))
      );

      console.log(`    ${rawItems.length} raw links`);

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
    await sleep(2500 + Math.random() * 1000);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Page scraper ─────────────────────────────────────────────────────────────

async function scrapePage(browser, url) {
  const page = await newStealthPage(browser);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2000);

    const data = await page.evaluate(() => {
      const ogDesc  = document.querySelector('meta[property="og:description"]')?.content || '';
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content        || '';
      const desc    = document.querySelector('meta[name="description"]')?.content         || '';

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
      return { ogDesc, ogTitle, desc, jsonLd, domText, bodyText };
    });

    const combined = [data.ogDesc, data.desc, data.domText, data.jsonLd, data.bodyText]
      .filter(Boolean).join('\n');

    return { text: combined, ogDesc: data.ogDesc || data.desc, ogTitle: data.ogTitle };
  } catch (err) {
    console.error(`  [page] ${url.slice(0, 60)}: ${err.message.split('\n')[0]}`);
    return { text: '', ogDesc: '', ogTitle: '' };
  } finally {
    await page.close();
  }
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
    ].join('\n'));
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(SCRAPER_TITLE);
  console.log(`${'='.repeat(60)}`);
  console.log(`Keywords : ${opts.titles.join(', ')}`);
  console.log(`Limit    : ${opts.limit}`);
  console.log(`Location : ${opts.location || 'India'}`);
  console.log(`${'='.repeat(60)}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser  = await launchBrowser();
  const posts    = [];
  const seenUrls = new Set();

  const broadShare     = Math.max(3, Math.round(opts.limit * 0.2));
  const perTitleBudget = Math.max(1, opts.limit - broadShare);
  const perTitle       = Math.ceil(perTitleBudget / opts.titles.length);

  // isLinkedIn: phone numbers are acceptable (recruiter posts); for general web
  // pages, phone-only is too noisy — insist on email/gform/whatsapp.
  async function collectFromResults(searchResults, keyword, cap) {
    let found = 0;
    for (const result of searchResults) {
      if (found >= cap) break;
      const normUrl = normaliseUrl(result.url);
      if (seenUrls.has(normUrl)) continue;

      const isLinkedIn = result.platform === 'linkedin';
      const checkContact = isLinkedIn ? hasContact : hasContactStrict;

      let contact  = isLinkedIn ? extractContact(result.snippet) : hasContactStrict(extractContact(result.snippet))
                                                                    ? extractContact(result.snippet) : { emails:[], gforms:[], phones:[], waLinks:[] };
      let postText = result.snippet;
      let ogDesc   = result.snippet;

      if (!checkContact(contact)) {
        process.stdout.write(`  visiting [${result.platform}] ${result.url.slice(0, 65)}... `);
        const pageData = await scrapePage(browser, result.url);
        postText = pageData.text;
        ogDesc   = pageData.ogDesc || result.snippet;
        contact  = extractContact(postText);

        if (!checkContact(contact)) {
          process.stdout.write('no contact\n');
          await sleep(800);
          continue;
        }
      }

      seenUrls.add(normUrl);
      const firstContact =
        contact.emails[0]  || contact.gforms[0] ||
        contact.waLinks[0] || contact.phones[0]  || '';

      process.stdout.write(`OK [${result.platform}] — ${firstContact}\n`);

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
          emails:  contact.emails,
          phones:  contact.phones,
          gforms:  contact.gforms,
          waLinks: contact.waLinks,
          platform: result.platform,
          engine:   result.engine,
        }),
        postedAt:  '',
        scrapedAt: new Date().toISOString(),
      });

      found++;
      await sleep(1200);
    }
    return found;
  }

  try {
    for (const keyword of opts.titles) {
      if (posts.length >= opts.limit) break;
      console.log(`\n[keyword] "${keyword}" — target: ${perTitle} posts with contact`);

      const target = Math.min(perTitle, opts.limit - posts.length);
      const liFilter = u => u.includes('linkedin.com/posts/') || u.includes('linkedin.com/pulse/');

      // ── Phase 1: DDG LinkedIn (may work with stealth; confirmed worked Jul 19) ─
      const ddgLI = await searchDDGRaw(
        browser, buildLinkedInDDGQueries(keyword), liFilter, target * 5, 'linkedin');
      console.log(`  [ddg/linkedin] ${ddgLI.length} posts`);

      // ── Phase 2: Google LinkedIn (CONFIRMED to return real LinkedIn URLs) ─────
      const googleLI = await searchGoogle(
        browser, buildLinkedInGoogleQueries(keyword), liFilter, target * 6, 'linkedin');
      const googleLINew = googleLI.filter(r => !ddgLI.some(x => normaliseUrl(x.url) === normaliseUrl(r.url)));
      console.log(`  [google/linkedin] ${googleLINew.length} new posts`);

      let allResults = [...ddgLI, ...googleLINew];

      // ── Phase 3: DDG Twitter + Telegram ──────────────────────────────────────
      if (!ddgBlocked) {
        const twFilter  = u => /(?:twitter\.com|x\.com)\/[^/]+\/status\//.test(u);
        const tgFilter  = u => /t\.me\/[A-Za-z0-9_]+/.test(u);
        const tw = await searchDDGRaw(browser, buildTwitterDDGQueries(keyword), twFilter, Math.ceil(target * 1.5), 'twitter');
        const tg = await searchDDGRaw(browser, buildTelegramDDGQueries(keyword), tgFilter, Math.ceil(target * 1.5), 'telegram');
        const extra = [...tw, ...tg].filter(r => !allResults.some(x => normaliseUrl(x.url) === normaliseUrl(r.url)));
        allResults = allResults.concat(extra);
        console.log(`  [ddg/tw+tg] +${extra.length} posts`);
      }

      // ── Phase 4: Google broad (non-LinkedIn, email required) ─────────────────
      if (allResults.filter(r => r.platform === 'linkedin').length < 3) {
        console.log('  LinkedIn results low — trying Google broad...');
        const gBroad = await searchGoogle(
          browser, buildLinkedInGoogleQueries(keyword), null, target * 4, 'broad');
        const gBNew = gBroad.filter(r =>
          !allResults.some(x => normaliseUrl(x.url) === normaliseUrl(r.url)) && !isExcluded(r.url));
        allResults = allResults.concat(gBNew);
        console.log(`  [google/broad] +${gBNew.length} new URLs`);
      }

      if (!allResults.length) {
        console.log(`  No URLs found for "${keyword}". Skipping.`);
        continue;
      }

      const byPlatform = allResults.reduce((a, r) => {
        a[r.platform] = (a[r.platform] || 0) + 1; return a;
      }, {});
      console.log(`  Platform breakdown: ${JSON.stringify(byPlatform)}`);

      const found = await collectFromResults(allResults, keyword, target);
      console.log(`\n  -> ${found} posts with contact info for "${keyword}"`);

      if (found > 0) saveRawCache(posts, OUTPUT_DIR);
    }

    // ── Broad (title-agnostic) pass ──────────────────────────────────────────
    if (posts.length < opts.limit) {
      const remaining = opts.limit - posts.length;
      console.log(`\n[broad] title-agnostic hiring search — target: ${remaining} more posts`);

      const liFilter  = u => u.includes('linkedin.com/posts/') || u.includes('linkedin.com/pulse/');
      let broadResults = await searchGoogle(
        browser, buildGenericLinkedInQueries(), liFilter, remaining * 5, 'generic-li');

      if (!ddgBlocked) {
        const ddgGeneric = await searchDDGRaw(
          browser, buildGenericLinkedInQueries(), liFilter, remaining * 3, 'generic-li');
        const ddgNew = ddgGeneric.filter(r =>
          !broadResults.some(x => normaliseUrl(x.url) === normaliseUrl(r.url)));
        broadResults = broadResults.concat(ddgNew);
      }

      console.log(`  [broad total] ${broadResults.length} URLs found`);
      const found = await collectFromResults(broadResults, 'Hiring (General)', remaining);
      console.log(`\n  -> ${found} posts from broad pass`);
      if (found > 0) saveRawCache(posts, OUTPUT_DIR);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total posts with contact: ${posts.length}`);
  console.log(`${'='.repeat(60)}`);

  if (!posts.length) {
    console.log('Nothing to save. Try again later — bot-challenges may be blocking search engines.');
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
