'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 8 — Jora Jobs (international, 'international' category)
 *  Aggregates across Jora's country sites. A plain axios/curl request
 *  with identical browser-like headers still gets a 403 (some kind of
 *  TLS/HTTP2 client fingerprinting — curl and a real browser both get
 *  200, axios doesn't), so this launches a real browser like naukri.js/
 *  foundit.js and parses the rendered job cards.
 *
 *  Jora (SEEK/Recruit Holdings network) is only live in these six
 *  countries today — its .ca/.ph/.th/.vn/etc. subdomains redirect to a
 *  "no longer available here" landing page or a different SEEK-owned
 *  brand entirely, so don't add more without re-checking first.
 *
 *  Usage:
 *    node scrapers/jora.js "Java Developer" "Python Developer"
 *    node scrapers/jora.js "React Developer" --countries au,sg
 *
 *  Options:
 *    --since <24h|7d|30d|all>   Time window (default: 24h)
 *    --location <string>        Post-filter location hint
 *    --country <string>         Post-filter by country (matches COUNTRY_TERMS)
 *    --city <string>            Post-filter by city
 *    --no-remote                Exclude remote jobs
 *    --limit <n>                Max results (default/max: 400)
 *    --countries <a,b,c>        Comma-separated Jora sites to use
 *                               (default: all — au, sg, hk, id, my, nz)
 *
 *  Output: output/jora/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs   = require('fs');
const { chromium } = require('playwright');
const {
  resolveRelativeDate, applyFilters, parseArgs,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  RUN_STAMP,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'jora');
const SCRAPER_TITLE = 'Jora Jobs (International)';

const SITES = {
  au: { domain: 'au.jora.com', label: 'Australia' },
  sg: { domain: 'sg.jora.com', label: 'Singapore' },
  hk: { domain: 'hk.jora.com', label: 'Hong Kong' },
  id: { domain: 'id.jora.com', label: 'Indonesia' },
  my: { domain: 'my.jora.com', label: 'Malaysia' },
  nz: { domain: 'nz.jora.com', label: 'New Zealand' },
};

// ─── Browser launcher — same fallback chain as naukri.js/foundit.js ───────

async function launchBrowser() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      const b = await chromium.launch({
        headless: false,
        channel,
        args: ['--no-sandbox', '--disable-infobars'],
      });
      console.log(`  Browser : system ${channel}`);
      return b;
    } catch (_) {}
  }
  console.warn('  No system Edge/Chrome found — using headless Chromium (may still be blocked)');
  return chromium.launch({ headless: true });
}

async function fetchCountry(browser, countryKey, keyword) {
  const site = SITES[countryKey];
  const url  = `https://${site.domain}/j?q=${encodeURIComponent(keyword)}`;
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(1500);

    const cards = await page.evaluate(() => {
      return [...document.querySelectorAll('h2.job-title')].map(h2 => {
        const a = h2.querySelector('a');
        if (!a) return null;
        const container = h2.closest('.job-card') || h2.closest('.top-container')?.parentElement;
        const bullets = container ? [...container.querySelectorAll('.job-abstract li')].map(li => li.innerText.trim()) : [];
        return {
          title:    a.innerText.trim(),
          href:     a.href,
          company:  container?.querySelector('.job-company')?.innerText.trim() || '',
          location: container?.querySelector('.job-location')?.innerText.trim() || '',
          posted:   container?.querySelector('.job-listed-date')?.innerText.replace(/^Posted\s*/i, '').trim() || '',
          bullets,
        };
      }).filter(Boolean);
    });

    return cards.map(c => ({
      source: 'jora', title: c.title, company: c.company,
      location: c.location ? `${c.location}, ${site.label}` : site.label,
      jobType: '', salary: '', experience: '',
      tags: keyword,
      description: c.bullets.join(' '),
      link: c.href, applyLink: c.href,
      postedAt: resolveRelativeDate(c.posted),
      scrapedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.error(`    Error scraping ${countryKey} "${keyword}": ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── Extended CLI parsing (adds --countries) ───────────────────────────────

function parseJoraArgs() {
  const opts = parseArgs('', ['--countries']);
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--countries') {
      opts.countries = (argv[++i] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  return opts;
}

async function main() {
  const opts = parseJoraArgs();

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/jora.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Options:',
      '  --since <24h|7d|30d|all>   default: 24h',
      '  --country <string>         post-filter by country',
      '  --city <string>            post-filter by city',
      '  --no-remote                exclude remote jobs',
      '  --limit <n>                max results (cap: 400)',
      '  --countries <a,b,c>        Jora sites to use (default: all)',
      `                             choices: ${Object.keys(SITES).join(', ')}`,
      '',
      'Note: Opens a browser window briefly per country — Jora blocks plain',
      '      HTTP clients (axios/curl-without-a-browser-fingerprint).',
      '',
      'Example:',
      '  node scrapers/jora.js "React Developer" --countries au,sg --since 7d',
    ].join('\n'));
    process.exit(1);
  }

  const countryKeys = (opts.countries && opts.countries.length ? opts.countries : Object.keys(SITES))
    .filter(k => SITES[k]);
  if (!countryKeys.length) {
    console.error(`No valid countries. Choices: ${Object.keys(SITES).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n${SCRAPER_TITLE}`);
  console.log(`Titles    : ${opts.titles.join(', ')}`);
  console.log(`Countries : ${countryKeys.map(k => SITES[k].label).join(', ')}`);
  console.log(`Since: ${opts.since} | Limit: ${opts.limit}\n`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await launchBrowser();
  const fetched = [];

  try {
    for (const countryKey of countryKeys) {
      for (const keyword of opts.titles) {
        process.stdout.write(`  [jora:${countryKey}] "${keyword}" ... `);
        const jobs = await fetchCountry(browser, countryKey, keyword);
        process.stdout.write(`${jobs.length} jobs\n`);
        fetched.push(...jobs);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nFetched  : ${fetched.length} total`);
  const cached   = saveRawCache(fetched, OUTPUT_DIR);
  const filtered = applyFilters(cached, opts);
  console.log(`Filtered : ${filtered.length} match criteria (limit ${opts.limit})`);

  if (!filtered.length) {
    console.log('No jobs matched. Try --since 7d or a different title.');
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
