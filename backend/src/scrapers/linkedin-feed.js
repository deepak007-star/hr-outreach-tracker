'use strict';
/**
 * SCRAPER 5 — LinkedIn Feed Posts (HR "We're Hiring" posts)
 *
 * Finds public LinkedIn POSTS where HR / recruiters share:
 *   - Email addresses
 *   - Google Form / Docs links
 *   - WhatsApp links
 *   - Phone numbers
 *
 * Strategy:
 *   1. Search DuckDuckGo HTML (bot-friendly) for LinkedIn post URLs
 *   2. Fallback to Bing if DDG returns too few results
 *   3. Decode redirect URLs in Node.js (Buffer available), NOT in browser
 *   4. Fast path: extract contact from search snippet
 *   5. Slow path: visit LinkedIn post, use og:description meta tag
 *      (populated server-side, works without login)
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

// ─── Browser ──────────────────────────────────────────────────────────────────

async function launchBrowser() {
  const headless = process.env.NODE_ENV === 'production' || process.env.HEADLESS === '1';
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

async function searchDDG(page, keyword, maxResults = 20) {
  const queries = [
    `site:linkedin.com/posts "${keyword}" hiring`,
    `site:linkedin.com/posts "${keyword}" "we are hiring" email`,
    `site:linkedin.com/posts "${keyword}" "apply" OR "reach" OR "contact"`,
  ];

  const seen    = new Set();
  const results = [];

  for (const q of queries) {
    if (results.length >= maxResults) break;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`;
      console.log(`  [ddg] ${q}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);

      // Collect raw hrefs in browser (no Node APIs needed)
      const rawItems = await page.evaluate(() =>
        [...document.querySelectorAll('a.result__a')].map(a => {
          const parent  = a.closest('.result, .web-result');
          const snippet = parent?.querySelector('.result__snippet')?.innerText?.trim() || '';
          return { rawHref: a.getAttribute('href') || '', snippet };
        })
      );

      console.log(`    ${rawItems.length} raw links`);

      for (const item of rawItems) {
        if (results.length >= maxResults) break;
        const url = decodeDDGUrl(item.rawHref);
        if (url.includes('linkedin.com/posts/') && !seen.has(url)) {
          seen.add(url);
          results.push({ url, snippet: item.snippet, engine: 'ddg' });
          console.log(`    + ${url.substring(0, 80)}`);
        }
      }
    } catch (err) {
      console.error(`  [ddg] error: ${err.message}`);
    }

    await sleep(2000);
  }

  return results;
}

// ─── Bing search (fallback) ───────────────────────────────────────────────────

async function searchBing(page, keyword, maxResults = 20) {
  const queries = [
    `site:linkedin.com/posts "${keyword}" hiring`,
    `site:linkedin.com/posts "${keyword}" email apply`,
  ];

  const seen    = new Set();
  const results = [];

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
          results.push({ url, snippet: item.snippet, engine: 'bing' });
          console.log(`    + ${url.substring(0, 80)}`);
        }
      }
    } catch (err) {
      console.error(`  [bing] error: ${err.message}`);
    }

    await sleep(2000);
  }

  return results;
}

// ─── Google search (tertiary fallback) ───────────────────────────────────────

async function searchGoogle(page, keyword, maxResults = 15) {
  const q   = `site:linkedin.com/posts "${keyword}" hiring`;
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

    const seen    = new Set();
    const results = [];
    for (const item of rawItems) {
      if (!seen.has(item.rawHref) && results.length < maxResults) {
        seen.add(item.rawHref);
        results.push({ url: item.rawHref, snippet: item.snippet, engine: 'google' });
        console.log(`    + ${item.rawHref.substring(0, 80)}`);
      }
    }
    return results;
  } catch (err) {
    console.error(`  [google] error: ${err.message}`);
    return [];
  }
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

  try {
    const searchPage = await browser.newPage();
    const perTitle   = Math.ceil(opts.limit / opts.titles.length);

    for (const keyword of opts.titles) {
      console.log(`\n[keyword] "${keyword}" — target: ${perTitle} posts with contact`);

      // Phase 1: collect LinkedIn post URLs from search engines
      let searchResults = await searchDDG(searchPage, keyword, perTitle * 5);
      console.log(`  [ddg total] ${searchResults.length} posts found`);

      if (searchResults.length < 5) {
        console.log('  Trying Bing as well...');
        const bingR   = await searchBing(searchPage, keyword, perTitle * 5);
        const seenUrls = new Set(searchResults.map(r => r.url));
        for (const r of bingR) {
          if (!seenUrls.has(r.url)) { searchResults.push(r); seenUrls.add(r.url); }
        }
        console.log(`  [combined] ${searchResults.length} posts after Bing merge`);
      }

      if (searchResults.length < 3) {
        console.log('  Trying Google as fallback...');
        const gR      = await searchGoogle(searchPage, keyword, perTitle * 3);
        const seenUrls = new Set(searchResults.map(r => r.url));
        for (const r of gR) {
          if (!seenUrls.has(r.url)) { searchResults.push(r); seenUrls.add(r.url); }
        }
        console.log(`  [combined] ${searchResults.length} posts after Google merge`);
      }

      if (!searchResults.length) {
        console.log(`  No LinkedIn post URLs found for "${keyword}". Skipping.`);
        continue;
      }

      // Phase 2: extract contact info from each post
      let found = 0;
      for (const result of searchResults) {
        if (found >= perTitle) break;

        // Fast path: contact already in search snippet
        let contact  = extractContact(result.snippet);
        let postText = result.snippet;
        let ogDesc   = '';

        if (!hasContact(contact)) {
          // Slow path: visit LinkedIn post page
          process.stdout.write(`  [${found + 1}/${perTitle}] visiting post... `);
          const pageData = await scrapePostPage(browser, result.url);
          postText = pageData.text;
          ogDesc   = pageData.ogDesc;
          contact  = extractContact(postText);

          if (!hasContact(contact)) {
            process.stdout.write('no contact info found\n');
            await sleep(1000);
            continue;
          }
        } else {
          ogDesc = result.snippet;
        }

        const firstContact =
          contact.emails[0]  || contact.gforms[0] ||
          contact.waLinks[0] || contact.phones[0]  || '';

        process.stdout.write(`OK — ${firstContact}\n`);

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

      console.log(`\n  -> ${found} posts with contact info collected for "${keyword}"`);
    }

    await searchPage.close();
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
