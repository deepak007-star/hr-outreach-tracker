'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 3 — Naukri.com Jobs
 *
 *  Strategy: Launch system Edge/Chrome (non-headless) to bypass
 *  Akamai bot detection, then intercept Naukri's internal /jobapi/
 *  XHR calls to get structured JSON directly.
 *  Falls back to DOM scraping if API interception fails.
 *
 *  Usage:
 *    node scrapers/naukri.js "Java Developer" "Spring Boot"
 *    node scrapers/naukri.js "React Developer" --since 24h --location "Bangalore"
 *    node scrapers/naukri.js "Data Scientist" --since 7d --city delhi
 *
 *  Options:
 *    --since <24h|3d|7d|15d|30d|all>   Time window (default: 24h)
 *    --location <string>                Naukri location (default: India)
 *    --country <string>                 Post-filter by country
 *    --city <string>                    Post-filter by city
 *    --no-remote                        Exclude remote / work-from-home jobs
 *    --limit <n>                        Max results (default/max: 60)
 *
 *  Note: A browser window opens briefly per keyword — required to bypass
 *        Naukri's bot protection. It closes automatically when done.
 *
 *  Output: output/naukri/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs   = require('fs');
const { chromium } = require('playwright');
const {
  sleep, stripHtml, resolveRelativeDate, sinceToDays,
  applyFilters, parseArgs,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  TODAY, RUN_STAMP,
} = require('../lib/common');
const { extractContacts } = require('../lib/contactExtract');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'naukri');
const SCRAPER_TITLE = 'Naukri.com Jobs';

// ─── URL builder ──────────────────────────────────────────────────────────────

function buildUrl(keyword, location, jobAge) {
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const loc  = location && location.toLowerCase() !== 'india'
    ? `-in-${location.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    : '';
  const age  = jobAge > 0 ? `?jobAge=${jobAge}` : '';
  return `https://www.naukri.com/${slug}-jobs${loc}-1${age}`;
}

// ─── Browser launcher — tries real Edge → Chrome → headless fallback ──────────

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
  console.warn('  No system Edge/Chrome found — using headless Chromium (may be blocked by Akamai)');
  return chromium.launch({ headless: true });
}

// ─── Parse one job from Naukri's internal API JSON ────────────────────────────

function parseApiJob(job, keyword) {
  const {
    jobTitle = '', companyName = '', placeholders = [],
    jobDescription = '', jdURL = '', tagsAndSkills = '',
    salaryDetail, jobType = [], createdDate,
  } = job;

  const clean   = s => (s || '').replace(/<[^>]+>/g, '').trim();
  const getPlh  = type => clean(placeholders.find(p => p.type === type)?.label || '');

  const location = getPlh('location');
  const exp      = getPlh('experience');
  const sal      = clean(salaryDetail?.label || '') || getPlh('salary');
  const link     = jdURL ? (jdURL.startsWith('http') ? jdURL : `https://www.naukri.com${jdURL}`) : '';
  const postedAt = createdDate ? new Date(createdDate).toISOString().split('T')[0] : '';

  const descFull = stripHtml(jobDescription);
  const { contactEmail, contactPhone, allContacts } = extractContacts(descFull);

  return {
    source:       'naukri',
    title:        jobTitle,
    company:      companyName,
    location,
    jobType:      Array.isArray(jobType) ? jobType.join(', ') : String(jobType),
    salary:       sal,
    experience:   exp,
    tags:         tagsAndSkills || keyword,
    description:  descFull.slice(0, 2000),
    link,
    applyLink:    link,
    postedAt,
    scrapedAt:    new Date().toISOString(),
    contactEmail,
    contactPhone,
    allContacts,
  };
}

// ─── Scrape one keyword ───────────────────────────────────────────────────────

async function scrapeKeyword(browser, keyword, opts) {
  console.log(`  [naukri] Searching: "${keyword}"`);
  const days = sinceToDays(opts.since);
  const url  = buildUrl(keyword, opts.location, days);
  console.log(`    URL: ${url}`);

  const page = await browser.newPage();
  const apiJobs = [];

  // Intercept Naukri's internal jobapi XHR to get structured JSON
  page.on('response', async response => {
    const ru = response.url();
    if (!ru.includes('jobapi') && !ru.includes('/v3/search') && !ru.includes('/v3/jobSearch')) return;
    try {
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const body = await response.text();
      if (!body.includes('jobDetails')) return;
      const data = JSON.parse(body);
      if (Array.isArray(data.jobDetails) && data.jobDetails.length) {
        console.log(`    API hit: ${ru.slice(0, 80)} -> ${data.jobDetails.length} jobs`);
        apiJobs.push(...data.jobDetails);
      }
    } catch (_) {}
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000); // let SPA fully render

    if (apiJobs.length) {
      console.log(`    -> ${apiJobs.length} jobs from API intercept`);
      await page.close();
      return apiJobs.map(j => parseApiJob(j, keyword));
    }

    // API intercept failed — fall back to DOM scraping
    console.log('    API not captured; attempting DOM scrape...');
    const domJobs = await page.evaluate((kw) => {
      const CARD = 'article.jobTuple, [class*="cust-job-tuple"], [class*="job-tuple"], article[data-job-id]';
      return [...document.querySelectorAll(CARD)].map(el => {
        const q = s => el.querySelector(s)?.innerText?.trim() || '';
        const titleEl = el.querySelector('a.title, a[class*="jobtitle"], h2 a, a[href*="naukri.com"]');
        return {
          title:   titleEl?.innerText?.trim() || '',
          href:    titleEl?.href || '',
          company: q('a.subTitle, .comp-name a, .comp-name'),
          loc:     q('.locWdth, .location, [class*="location"]'),
          sal:     q('.salary, [class*="salary"]'),
          exp:     q('.experience, [class*="experience"]'),
          rawDate: q('.job-post-day, [class*="posted"]'),
          skills:  [...el.querySelectorAll('.tag-li a, .keyskills a')].map(t => t.innerText?.trim()).join(', '),
          kw,
        };
      }).filter(j => j.title);
    }, keyword);

    console.log(`    -> ${domJobs.length} jobs from DOM`);
    await page.close();
    return domJobs.map(j => ({
      source:      'naukri',
      title:       j.title,
      company:     j.company,
      location:    j.loc,
      jobType:     '',
      salary:      j.sal,
      experience:  j.exp,
      tags:        j.skills || j.kw,
      description: '',
      link:        j.href,
      applyLink:   j.href,
      postedAt:    resolveRelativeDate(j.rawDate),
      scrapedAt:   new Date().toISOString(),
    }));
  } catch (err) {
    await page.close();
    console.error(`    Error scraping "${keyword}": ${err.message}`);
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs('India');

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/naukri.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Options:',
      '  --since <24h|3d|7d|15d|30d|all>   default: 24h',
      '  --location <string>                Naukri search location  default: India',
      '  --country <string>                 post-filter by country',
      '  --city <string>                    post-filter by city',
      '  --no-remote                        exclude work-from-home jobs',
      '  --limit <n>                        max results (cap: 60)',
      '',
      'Note: Opens a browser window briefly per keyword to bypass Naukri bot',
      '      protection. Prefers system Edge (always on Windows), then Chrome.',
      '',
      'Example:',
      '  node scrapers/naukri.js "Java Developer" "Spring Boot" --since 3d --location "Pune"',
    ].join('\n'));
    process.exit(1);
  }

  console.log(`\n${SCRAPER_TITLE}`);
  console.log(`Titles   : ${opts.titles.join(', ')}`);
  console.log(`Location : ${opts.location} | Since: ${opts.since} (jobAge=${sinceToDays(opts.since)}d) | Limit: ${opts.limit}`);
  console.log(`Note     : Browser window will open briefly per keyword (auto-closes when done)\n`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await launchBrowser();
  const fetched = [];

  try {
    for (let i = 0; i < opts.titles.length; i++) {
      const jobs = await scrapeKeyword(browser, opts.titles[i], opts);
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
    console.log('No jobs matched. Try --since 7d or a different location.');
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
