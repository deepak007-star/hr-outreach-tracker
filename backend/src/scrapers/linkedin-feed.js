'use strict';
/**
 * SCRAPER 5 — LinkedIn Feed Posts (HR "We're Hiring" posts)
 *
 * Finds public hiring posts (LinkedIn, Twitter/X, Telegram) where HR /
 * recruiters share:
 *   - Email addresses
 *   - Google Form / Docs links
 *   - WhatsApp links
 *   - Phone numbers
 *
 * Strategy:
 *   1. Per configured job title, run a handful of OR-grouped hiring-phrase
 *      queries (not just "we are hiring" — also "hiring for X", "X is
 *      hiring", "urgently hiring", "job opening", "join our team", etc.)
 *      against LinkedIn via DuckDuckGo HTML (bot-friendly, primary), plus
 *      lighter Twitter/X and Telegram passes for the same keyword. Queries
 *      are deliberately few-but-wide (OR groups inside 2-3 queries, not a
 *      dozen narrow ones) — DDG's bot-challenge triggers on request *volume*
 *      per IP, not query complexity.
 *   2. Fallback to Bing then Google if DDG returns too few LinkedIn results.
 *   3. After all titles are searched, run a title-agnostic "broad" pass
 *      (same hiring phrases, no specific job title) across all three
 *      platforms so posts for roles outside the configured title list still
 *      get picked up — fills the remainder of the day's target.
 *   4. Decode redirect URLs in Node.js (Buffer available), NOT in browser
 *   5. Fast path: extract contact from search snippet (used for all
 *      platforms)
 *   6. Slow path (LinkedIn only): visit the post, use og:description meta
 *      tag (populated server-side, works without login) — Twitter/Telegram
 *      rely on the snippet alone since there's no DOM-scrape support for them.
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
const SPAM     = ['noreply','no-reply','example.','donotreply','linkedin.com','sentry.io','google.com','amazonaws','@2x','@3x'];

function extractContact(text) {
  const t = text || '';
  return {
    emails:  [...new Set((t.match(RE_EMAIL) || []).filter(e => !SPAM.some(s => e.toLowerCase().includes(s))))],
    gforms:  [...new Set(t.match(RE_GFORM) || [])],
    phones:  [...new Set((t.match(RE_PHONE) || []).map(p => p.replace(/[\s\-]/g, '')).filter(p => p.length >= 10))],
    waLinks: [...new Set(t.match(RE_WA) || [])],
  };
}

const hasContact = c => c.emails.length || c.gforms.length || c.phones.length || c.waLinks.length;

// ─── Query builders — broad, "smart not strict" hiring-phrase coverage ───────
// Real recruiter posts use many phrasings besides the literal "we are hiring":
// "hiring for X", "we're hiring", "X is hiring", "urgently hiring", "now
// hiring", "job opening", "join our team", etc. All of that breadth is
// packed into a handful of OR-grouped queries per keyword (not one query per
// phrase) — search engines rate-limit/CAPTCHA aggressively on *request
// volume* per IP far more than on query complexity, so a dozen short queries
// per keyword is actually worse for coverage than 3 wide ones.

function buildSiteQueries(sitePrefix, keyword) {
  return [
    `${sitePrefix} "${keyword}" ("hiring" OR "we're hiring" OR "we are hiring" OR "is hiring" OR "now hiring" OR "hiring for ${keyword}")`,
    `${sitePrefix} "${keyword}" ("urgently hiring" OR "immediate joiner" OR "job opening" OR "vacancy" OR "open position" OR "join our team")`,
    `${sitePrefix} "${keyword}" (email OR "apply now" OR "send resume" OR "send cv" OR "looking to hire")`,
  ];
}

// Title/keyword-agnostic queries — catches posts for roles outside the
// configured title list entirely ("broaden beyond specific job titles").
function buildGenericQueries(sitePrefix) {
  return [
    `${sitePrefix} ("we are hiring" OR "we're hiring" OR "hiring for" OR "urgently hiring") India email apply`,
    `${sitePrefix} ("job opening" OR "now hiring" OR "immediate joiner") India (tech OR developer OR engineer) contact`,
  ];
}

// site: filters use DDG's own syntax — `(site:a OR site:b)` to OR across
// domains, since `site:(a OR b)` grouping (valid on Google) isn't supported.
const PLATFORMS = {
  linkedin: { site: 'site:linkedin.com/posts', urlTest: u => u.includes('linkedin.com/posts/') },
  twitter:  { site: '(site:twitter.com OR site:x.com)', urlTest: u => /(?:twitter\.com|x\.com)\/[^/]+\/status\//.test(u) },
  telegram: { site: 'site:t.me', urlTest: u => /t\.me\/[A-Za-z0-9_]+\/\d+/.test(u) },
};

// ─── Browser ──────────────────────────────────────────────────────────────────

async function launchBrowser() {
  // Force headless when: production, HEADLESS=1, or Linux without a display (no X server)
  const noDisplay = process.platform === 'linux' && !process.env.DISPLAY;
  const headless  = process.env.HEADLESS === '0' ? false
                  : noDisplay || process.env.NODE_ENV === 'production' || process.env.HEADLESS === '1';
  const args     = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-infobars'];
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ headless, channel, args });
    } catch (_) {}
  }
  return chromium.launch({ headless, args });
}

// ─── URL decoding (Node.js context — Buffer available here) ──────────────────

function decodeBingUrl(href) {
  if (!href) return '';
  // /ck/a?...u=a1<base64url>...
  const m = href.match(/[?&]u=a1([A-Za-z0-9_\-]+)/);
  if (m) {
    try {
      const b64     = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (decoded.startsWith('http')) return decoded.split('\x00')[0]; // strip null bytes
    } catch (_) {}
  }
  // /l/?uddg=<pct-encoded>
  const u = href.match(/uddg=([^&]+)/);
  if (u) {
    try {
      const decoded = decodeURIComponent(u[1]);
      if (decoded.startsWith('http')) return decoded;
    } catch (_) {}
  }
  return href;
}

function decodeDDGUrl(href) {
  if (!href) return '';
  // DuckDuckGo: //duckduckgo.com/l/?uddg=<pct-encoded>
  const u = href.match(/uddg=([^&]+)/);
  if (u) {
    try {
      const decoded = decodeURIComponent(u[1]);
      if (decoded.startsWith('http')) return decoded;
    } catch (_) {}
  }
  if (!href.startsWith('http')) return 'https:' + href;
  return href;
}

// ─── DuckDuckGo search (primary — simpler HTML, no base64 encoding) ──────────
// Generalized over `platform` (linkedin/twitter/telegram, see PLATFORMS above)
// and an explicit query list, so the same crawl logic serves per-keyword
// searches, title-agnostic broad searches, and non-LinkedIn sources alike.
//
// Owns its own page (created from `browser`, closed on return) rather than
// reusing one shared page across a whole run — a single page reused across
// hundreds of navigations (many titles x platforms) can eventually crash
// Chromium's renderer. Also recovers mid-batch: if a navigation
// crashes/closes the page, a fresh one is opened so the remaining queries in
// this batch aren't lost to one bad request.
//
// DDG serves a "select all squares with a duck" CAPTCHA page once it decides
// a client is automated — this tends to trigger on burst *request volume*
// per IP, not per-query complexity. Once seen, `ddgBlocked` short-circuits
// all further DDG calls for the rest of this process run (falls through to
// Bing/Google instead of continuing to hammer a wall that won't clear until
// the block naturally expires).

let ddgBlocked = false;

async function searchDDGRaw(browser, queries, urlTest, maxResults, platformTag) {
  const seen    = new Set();
  const results = [];
  if (ddgBlocked) return results;

  let page = await browser.newPage();

  for (const q of queries) {
    if (results.length >= maxResults) break;
    if (ddgBlocked) break;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`;
      console.log(`  [ddg/${platformTag}] ${q}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);

      // Collect raw hrefs in browser (no Node APIs needed); also flag DDG's
      // bot-challenge modal so we can stop hammering it for the rest of the run.
      const { rawItems, challenged } = await page.evaluate(() => ({
        rawItems: [...document.querySelectorAll('a.result__a')].map(a => {
          const parent  = a.closest('.result, .web-result');
          const snippet = parent?.querySelector('.result__snippet')?.innerText?.trim() || '';
          return { rawHref: a.getAttribute('href') || '', snippet };
        }),
        challenged: !!document.querySelector('.anomaly-modal, #challenge-form'),
      }));

      if (challenged) {
        ddgBlocked = true;
        console.warn('  [ddg] bot-challenge detected — pausing DDG for the rest of this run, falling back to Bing/Google');
        break;
      }

      console.log(`    ${rawItems.length} raw links`);

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        const url = decodeDDGUrl(item.rawHref);
        if (urlTest(url) && !seen.has(url)) {
          seen.add(url);
          results.push({ url, snippet: item.snippet, engine: 'ddg', platform: platformTag });
          console.log(`    + ${url.substring(0, 80)}`);
        }
      }
    } catch (err) {
      console.error(`  [ddg/${platformTag}] error: ${err.message}`);
      if (page.isClosed() || /crashed|closed/i.test(err.message)) {
        try { await page.close(); } catch (_) {}
        page = await browser.newPage();
      }
    }

    await sleep(3500); // deliberately slower than Bing/Google — DDG's bot-detection is the most burst-sensitive
  }

  try { await page.close(); } catch (_) {}
  return results;
}

async function searchDDG(browser, keyword, maxResults = 20) {
  const { site, urlTest } = PLATFORMS.linkedin;
  return searchDDGRaw(browser, buildSiteQueries(site, keyword), urlTest, maxResults, 'linkedin');
}

async function searchDDGPlatform(browser, keyword, platformKey, maxResults) {
  const { site, urlTest } = PLATFORMS[platformKey];
  return searchDDGRaw(browser, buildSiteQueries(site, keyword), urlTest, maxResults, platformKey);
}

async function searchDDGGeneric(browser, platformKey, maxResults) {
  const { site, urlTest } = PLATFORMS[platformKey];
  return searchDDGRaw(browser, buildGenericQueries(site), urlTest, maxResults, platformKey);
}

// ─── Bing search (fallback) ───────────────────────────────────────────────────

async function searchBing(browser, keyword, maxResults = 20) {
  const queries = buildSiteQueries('site:linkedin.com/posts', keyword);

  const seen    = new Set();
  const results = [];
  let page = await browser.newPage();

  for (const q of queries) {
    if (results.length >= maxResults) break;

    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10&mkt=en-IN&setlang=en`;
      console.log(`  [bing] ${q}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);

      // Accept cookie consent if shown
      try {
        const btn = page.locator('button#bnp_btn_accept, #bnp_hfly_cta2, button[id*="accept"]').first();
        if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await sleep(1000); }
      } catch (_) {}

      // Collect raw hrefs in browser context ONLY (no Buffer / Node APIs)
      const rawItems = await page.evaluate(() =>
        [...document.querySelectorAll('.b_algo h2 a, .b_algo h3 a')].map(a => {
          const parent  = a.closest('.b_algo');
          const snippet = parent?.querySelector('.b_caption p, .b_algoSlug, .b_snippet')?.innerText?.trim() || '';
          return { rawHref: a.getAttribute('href') || '', snippet };
        })
      );

      console.log(`    ${rawItems.length} raw links`);

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        // Decode in Node.js — Buffer is available here
        const url = decodeBingUrl(item.rawHref);
        if (url.includes('linkedin.com/posts/') && !seen.has(url)) {
          seen.add(url);
          results.push({ url, snippet: item.snippet, engine: 'bing', platform: 'linkedin' });
          console.log(`    + ${url.substring(0, 80)}`);
        }
      }
    } catch (err) {
      console.error(`  [bing] error: ${err.message}`);
      if (page.isClosed() || /crashed|closed/i.test(err.message)) {
        try { await page.close(); } catch (_) {}
        page = await browser.newPage();
      }
    }

    await sleep(2000);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Google search (tertiary fallback) ───────────────────────────────────────

async function searchGoogle(browser, keyword, maxResults = 15) {
  const queries = [
    `site:linkedin.com/posts "${keyword}" hiring`,
    `site:linkedin.com/posts "${keyword}" "we're hiring" OR "hiring for"`,
  ];

  const seen    = new Set();
  const results = [];
  let page = await browser.newPage();

  for (const q of queries) {
    if (results.length >= maxResults) break;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=10&hl=en&gl=in`;
    console.log(`  [google] ${q}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);

      const rawItems = await page.evaluate(() =>
        [...document.querySelectorAll('a[jsname], .yuRUbf a, #search a[href*="linkedin.com/posts"]')].map(a => {
          const href = a.href || '';
          const parent = a.closest('.g, [data-sokoban-container], .MjjYud');
          const snippet = parent?.querySelector('.VwiC3b, .s3v9rd, .st')?.innerText?.trim() || '';
          return { rawHref: href, snippet };
        }).filter(i => i.rawHref.includes('linkedin.com/posts/'))
      );

      console.log(`    ${rawItems.length} raw links`);

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        if (!seen.has(item.rawHref)) {
          seen.add(item.rawHref);
          results.push({ url: item.rawHref, snippet: item.snippet, engine: 'google', platform: 'linkedin' });
          console.log(`    + ${item.rawHref.substring(0, 80)}`);
        }
      }
    } catch (err) {
      console.error(`  [google] error: ${err.message}`);
      if (page.isClosed() || /crashed|closed/i.test(err.message)) {
        try { await page.close(); } catch (_) {}
        page = await browser.newPage();
      }
    }

    await sleep(2000);
  }

  try { await page.close(); } catch (_) {}
  return results;
}

// ─── Scrape individual LinkedIn post page ─────────────────────────────────────

async function scrapePostPage(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);

    const data = await page.evaluate(() => {
      // og:description is server-side rendered and contains post text even without login
      const ogDesc  = document.querySelector('meta[property="og:description"]')?.content  || '';
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content         || '';

      // Structured JSON-LD (sometimes has contact info)
      let jsonLd = '';
      try {
        const ldEl = document.querySelector('script[type="application/ld+json"]');
        if (ldEl) jsonLd = ldEl.textContent || '';
      } catch (_) {}

      // DOM selectors for authenticated view
      const DOM_SELECTORS = [
        '.feed-shared-update-v2__description-wrapper',
        '.update-components-text',
        '.feed-shared-text',
        '.attributed-text-segment-list__content',
        '[data-test-id="main-feed-activity-card__commentary"]',
        '.main-feed-activity-card__commentary',
        '.base-main-card__description',
        '.description__text',
        '.comment-body',
        'section.description',
        'article .artdeco-card',
      ];

      let domText = '';
      for (const sel of DOM_SELECTORS) {
        const el = document.querySelector(sel);
        const t  = el?.textContent?.trim();
        if (t && t.length > 30) { domText = t; break; }
      }

      // Full body text as broad fallback (truncated to avoid huge strings)
      const bodyText = document.body?.innerText?.slice(0, 10000) || '';

      return { ogDesc, ogTitle, jsonLd, domText, bodyText };
    });

    // Combine text sources — og:description is most reliable for post content
    const combined = [data.ogDesc, data.domText, data.jsonLd, data.bodyText]
      .filter(Boolean).join('\n');

    return { text: combined, ogDesc: data.ogDesc, ogTitle: data.ogTitle };
  } catch (err) {
    console.error(`  [post] error: ${err.message}`);
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
      'Searches LinkedIn public posts for HR hiring announcements.',
      'Extracts: email, phone, Google Form, WhatsApp.',
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

  const browser = await launchBrowser();
  const posts   = [];

  // Reserve ~20% of the overall target for the title-agnostic "broad" pass
  // (catches hiring posts for roles outside the configured title list).
  const broadShare  = Math.max(3, Math.round(opts.limit * 0.2));
  const perTitleBudget = Math.max(1, opts.limit - broadShare);
  const perTitle    = Math.ceil(perTitleBudget / opts.titles.length);

  // Extract-and-collect a batch of search results into `posts`, up to `cap`
  // more entries. Slow-path page visits (DOM scrape) only make sense for
  // LinkedIn — Twitter/Telegram rely on the search-snippet fast path only.
  async function collectFromResults(searchResults, keyword, cap) {
    let found = 0;
    for (const result of searchResults) {
      if (found >= cap) break;

      let contact  = extractContact(result.snippet);
      let postText = result.snippet;
      let ogDesc   = result.snippet;

      if (!hasContact(contact)) {
        if (result.platform !== 'linkedin') continue; // no snippet contact, and no page-scrape support for this platform

        process.stdout.write(`  [${found + 1}/${cap}] visiting post... `);
        const pageData = await scrapePostPage(browser, result.url);
        postText = pageData.text;
        ogDesc   = pageData.ogDesc;
        contact  = extractContact(postText);

        if (!hasContact(contact)) {
          process.stdout.write('no contact info found\n');
          await sleep(1000);
          continue;
        }
      }

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
        }),
        postedAt:  '',
        scrapedAt: new Date().toISOString(),
      });

      found++;
      await sleep(1500);
    }
    return found;
  }

  try {
    for (const keyword of opts.titles) {
      if (posts.length >= opts.limit) break;
      console.log(`\n[keyword] "${keyword}" — target: ${perTitle} posts with contact`);

      // Phase 1: collect post URLs across platforms
      let searchResults = await searchDDG(browser, keyword, perTitle * 5);
      console.log(`  [ddg/linkedin] ${searchResults.length} posts found`);

      // Extra platforms — smaller budget each, fast-path (snippet) only
      const twitterR  = await searchDDGPlatform(browser, keyword, 'twitter',  Math.ceil(perTitle * 1.5));
      const telegramR = await searchDDGPlatform(browser, keyword, 'telegram', Math.ceil(perTitle * 1.5));
      console.log(`  [ddg/twitter] ${twitterR.length} posts, [ddg/telegram] ${telegramR.length} posts`);
      searchResults = searchResults.concat(twitterR, telegramR);

      if (searchResults.filter(r => r.platform === 'linkedin').length < 5) {
        console.log('  Trying Bing as well...');
        const bingR   = await searchBing(browser, keyword, perTitle * 5);
        const seenUrls = new Set(searchResults.map(r => r.url));
        for (const r of bingR) {
          if (!seenUrls.has(r.url)) { searchResults.push(r); seenUrls.add(r.url); }
        }
        console.log(`  [combined] ${searchResults.length} posts after Bing merge`);
      }

      if (searchResults.filter(r => r.platform === 'linkedin').length < 3) {
        console.log('  Trying Google as fallback...');
        const gR      = await searchGoogle(browser, keyword, perTitle * 3);
        const seenUrls = new Set(searchResults.map(r => r.url));
        for (const r of gR) {
          if (!seenUrls.has(r.url)) { searchResults.push(r); seenUrls.add(r.url); }
        }
        console.log(`  [combined] ${searchResults.length} posts after Google merge`);
      }

      if (!searchResults.length) {
        console.log(`  No post URLs found for "${keyword}". Skipping.`);
        continue;
      }

      // Phase 2: extract contact info from each post
      const found = await collectFromResults(searchResults, keyword, Math.min(perTitle, opts.limit - posts.length));
      console.log(`\n  -> ${found} posts with contact info collected for "${keyword}"`);

      // Save progress after every title, not just at the very end — a run
      // spanning many titles x platforms can take long enough to hit
      // runScraperHeadless's 10-minute safety kill, and saveRawCache merges
      // with what's already on disk, so this is safe to call repeatedly.
      if (found > 0) saveRawCache(posts, OUTPUT_DIR);
    }

    // Broad pass: title-agnostic hiring queries, so posts for roles outside
    // the configured title list still get picked up ("don't have to search
    // based on other keywords or job titles" — this catches those too).
    if (posts.length < opts.limit) {
      const remaining = opts.limit - posts.length;
      console.log(`\n[broad] title-agnostic hiring search — target: ${remaining} more posts`);

      let broadResults = await searchDDGGeneric(browser, 'linkedin', remaining * 4);
      const twitterB   = await searchDDGGeneric(browser, 'twitter',  remaining * 2);
      const telegramB  = await searchDDGGeneric(browser, 'telegram', remaining * 2);
      broadResults = broadResults.concat(twitterB, telegramB);
      console.log(`  [broad total] ${broadResults.length} posts found across platforms`);

      const found = await collectFromResults(broadResults, 'Hiring (General)', remaining);
      console.log(`\n  -> ${found} posts collected from broad pass`);
      if (found > 0) saveRawCache(posts, OUTPUT_DIR);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total posts with contact: ${posts.length}`);
  console.log(`${'='.repeat(60)}`);

  if (!posts.length) {
    console.log('Nothing to save. Try different keywords or check if LinkedIn posts are indexed.');
    return;
  }

  saveRawCache(posts, OUTPUT_DIR); // saves YYYY-MM-DD.json — required for storeScrapedJobs() to write contacts to DB

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
