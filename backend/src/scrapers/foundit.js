'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 6 — Foundit.in Jobs (formerly Monster India)
 *
 *  Strategy: Foundit sits behind Akamai Bot Manager — a plain HTTP
 *  request (axios/curl) gets a 403 even with browser-like headers, but
 *  a real browser gets the page through fine. No separate JSON API was
 *  found (job data is server-rendered straight into the DOM, not fetched
 *  via a visible XHR call), so this parses the rendered job cards
 *  directly — same "launch a real browser" strategy as naukri.js, but
 *  DOM-parsing instead of XHR interception since there's no API to catch.
 *
 *  Usage:
 *    node scrapers/foundit.js "Java Developer" "Python Developer"
 *    node scrapers/foundit.js "React Developer" --since 7d --city bangalore
 *
 *  Options:
 *    --since <24h|7d|30d|all>   Time window (default: 24h)
 *    --location <string>        Post-filter location hint (default: India)
 *    --country <string>         Post-filter by country
 *    --city <string>            Post-filter by city
 *    --no-remote                Exclude remote jobs
 *    --limit <n>                Max results (default/max: 400)
 *
 *  Output: output/foundit/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs   = require('fs');
const { chromium } = require('playwright');
const {
  sleep, applyFilters, parseArgs, proxyLaunchOption, ensureBrowserReachable, rotateBrowserProxy,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  RUN_STAMP,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'foundit');
const SCRAPER_TITLE = 'Foundit.in Jobs';

// ─── Browser launcher — same fallback chain as naukri.js ──────────────────

async function launchBrowser() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      const b = await chromium.launch({
        headless: false,
        channel,
        args: ['--no-sandbox', '--disable-infobars'],
        proxy: proxyLaunchOption(),
      });
      console.log(`  Browser : system ${channel}`);
      return b;
    } catch (_) {}
  }
  console.warn('  No system Edge/Chrome found — using headless Chromium (may be blocked by Akamai)');
  return chromium.launch({ headless: true, args: ['--no-sandbox'], proxy: proxyLaunchOption() });
}

// ─── Parse one keyword's search results page ───────────────────────────────

async function scrapeKeyword(browser, keyword) {
  console.log(`  [foundit] Searching: "${keyword}"`);
  const slug = keyword.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const url  = `https://www.foundit.in/search/${slug}-jobs`;

  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    const cards = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/job/"]')];
      const seen = new Set();
      const out = [];
      for (const a of links) {
        if (seen.has(a.href) || !a.innerText.trim()) continue;
        seen.add(a.href);
        let node = a, card = null;
        for (let i = 0; i < 8 && node.parentElement; i++) {
          node = node.parentElement;
          const text = node.innerText || '';
          if (text.length > 60 && text.length < 1200) { card = node; break; }
        }
        out.push({ href: a.href, title: a.innerText.trim(), cardText: card ? card.innerText : '' });
      }
      return out;
    });

    return cards.map(c => parseCard(c, keyword)).filter(Boolean);
  } catch (err) {
    console.error(`    Error scraping "${keyword}": ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}

// Foundit's card text is consistently ordered: title, company, (single-
// letter logo-avatar fallback, optional), experience range (optional),
// location, then "Skills:" followed by the skill list.
function parseCard(raw, keyword) {
  const lines = raw.cardText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const title = raw.title || lines[0];
  let company = '', experience = '', location = '';
  let i = 1;
  let skillsStartIdx = lines.length;

  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^skills:?$/i.test(l)) { skillsStartIdx = i + 1; break; }
    if (/^[a-z]$/i.test(l)) continue;                       // single-letter logo-avatar fallback
    if (/^\d+\s*[-–]\s*\d+\s*yrs?$/i.test(l)) { experience = l; continue; }
    if (!company) { company = l; continue; }
    if (!location) { location = l; continue; }
  }

  const tail = lines.slice(skillsStartIdx).join(',');
  const stopAt = tail.search(/in jd:|early applicant/i);
  const skillsRaw = stopAt > -1 ? tail.slice(0, stopAt) : tail;
  const skills = skillsRaw.split(',').map(s => s.trim()).filter(s => s && s.length < 40);

  return {
    source:      'foundit',
    title, company, location,
    jobType:     '',
    salary:      '',
    experience,
    tags:        skills.length ? skills.join(', ') : keyword,
    description: '',
    link:        raw.href,
    applyLink:   raw.href,
    postedAt:    '',
    scrapedAt:   new Date().toISOString(),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs('India');

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/foundit.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Options:',
      '  --since <24h|7d|30d|all>   default: 24h',
      '  --location <string>        post-filter location  default: India',
      '  --country <string>         post-filter by country',
      '  --city <string>            post-filter by city',
      '  --no-remote                exclude remote jobs',
      '  --limit <n>                max results (cap: 400)',
      '',
      'Note: Opens a browser window briefly per keyword — Foundit sits behind',
      '      Akamai Bot Manager, which blocks plain HTTP requests.',
      '',
      'Example:',
      '  node scrapers/foundit.js "Java Developer" "Python Developer" --since 7d',
    ].join('\n'));
    process.exit(1);
  }

  console.log(`\n${SCRAPER_TITLE}`);
  console.log(`Titles   : ${opts.titles.join(', ')}`);
  console.log(`Location : ${opts.location} | Since: ${opts.since} | Limit: ${opts.limit}`);
  console.log(`Note     : Browser window will open briefly per keyword (auto-closes when done)\n`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let browser = await launchBrowser();
  browser = await ensureBrowserReachable(browser, launchBrowser);
  const fetched = [];

  const ROTATE_EVERY = Math.max(0, parseInt(process.env.ROTATE_EVERY_KEYWORDS || '3'));
  try {
    for (let i = 0; i < opts.titles.length; i++) {
      if (ROTATE_EVERY > 0 && i > 0 && i % ROTATE_EVERY === 0) {
        browser = await rotateBrowserProxy(browser, launchBrowser);
      }
      const jobs = await scrapeKeyword(browser, opts.titles[i]);
      fetched.push(...jobs);
      if (i < opts.titles.length - 1) await sleep(2500);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nFetched  : ${fetched.length} total`);
  const cached   = saveRawCache(fetched, OUTPUT_DIR);
  const filtered = applyFilters(cached, opts);
  console.log(`Filtered : ${filtered.length} match criteria (limit ${opts.limit})`);

  if (!filtered.length) {
    console.log('No jobs matched. Try --since 7d or a different title/location.');
    return;
  }

  const suffix = buildSuffix(opts);
  const base   = path.join(OUTPUT_DIR, `${RUN_STAMP}${suffix}`);
  saveCSV(filtered, base + '.csv');
  saveHTML(filtered, opts, base + '.html', SCRAPER_TITLE);
  if (!process.env.SCRAPER_NO_OPEN) require('child_process').exec(`start "" "${base}.html"`);

  console.log(`\nSaved:`);
  console.log(`  CSV  -> ${base}.csv`);
  console.log(`  HTML -> ${base}.html`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
