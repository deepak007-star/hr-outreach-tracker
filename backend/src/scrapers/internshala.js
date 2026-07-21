'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 5 — Internshala Jobs (India, SSR HTML)
 *  Not remote-specific — India entry-to-mid level jobs/internships,
 *  scraped under the 'general' category (see routes/scraper.js).
 *
 *  Usage:
 *    node scrapers/internshala.js "Java Developer" "Python Developer"
 *    node scrapers/internshala.js "Frontend Developer" --since 7d
 *
 *  Options:
 *    --since <24h|7d|30d|all>   Time window (default: 24h)
 *    --location <string>        Search location hint (default: India)
 *    --country <string>         Post-filter by country
 *    --city <string>            Post-filter by city
 *    --no-remote                Exclude remote jobs
 *    --limit <n>                Max results (default/max: 400)
 *
 *  Output: output/internshala/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path    = require('path');
const cheerio = require('cheerio');
const {
  get, applyFilters, parseArgs,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  RUN_STAMP,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'internshala');
const SCRAPER_TITLE = 'Internshala Jobs';

const GENERIC = new Set(['developer','engineer','manager','analyst','designer','architect',
  'lead','senior','junior','associate','executive','intern','specialist','consultant',
  'officer','director','head','coordinator','assistant','staff','principal']);

async function fetchKeyword(keyword) {
  const slug = keyword.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const allWords = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const specific = allWords.filter(w => !GENERIC.has(w));
  const filterWords = specific.length ? specific : [allWords[0]].filter(Boolean);

  const parsePageJobs = html => {
    const $ = cheerio.load(html);
    const jobs = [];
    $('.individual_internship').each((_, el) => {
      const titleEl = $(el).find('a.job-title-href, .job-internship-name a').first();
      const title   = titleEl.text().trim();
      if (!title) return;
      const href    = titleEl.attr('href') || '';
      const company = $(el).find('.company-name').first().text().trim();
      const items   = $(el).find('.row-1-item').map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get();
      const loc     = $(el).find('.locations').text().replace(/\s+/g, ' ').trim() || items[0] || '';
      const sal     = items[1] || '';
      const exp     = items[2] || '';
      const link    = href.startsWith('http') ? href : `https://internshala.com${href}`;
      jobs.push({
        source: 'internshala', title, company,
        location: loc, jobType: 'Full-time', salary: sal, experience: exp,
        tags: '', description: '', link, applyLink: link,
        postedAt: '', scrapedAt: new Date().toISOString(),
      });
    });
    return jobs;
  };

  const jobs = [];
  // Scrape up to 5 pages per keyword — plain SSR HTML, no bot-detection
  // arms race like LinkedIn/Naukri, so a deeper crawl is low-risk.
  for (let pg = 1; pg <= 5; pg++) {
    const url = pg === 1
      ? `https://internshala.com/jobs/${slug}-jobs/`
      : `https://internshala.com/jobs/${slug}-jobs/page-${pg}/`;
    try {
      const html  = await get(url, { delay: pg === 1 ? 2000 : 1500, lenient: true });
      const pJobs = parsePageJobs(html);
      if (!pJobs.length) break; // no more pages
      jobs.push(...pJobs);
    } catch (_) { break; }
  }

  // Internshala's category URL is fuzzy — keep only jobs with specific keyword words in title
  return filterWords.length
    ? jobs.filter(j => filterWords.some(w => j.title.toLowerCase().includes(w)))
    : jobs;
}

async function main() {
  const opts = parseArgs('India');

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/internshala.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Options:',
      '  --since <24h|7d|30d|all>   default: 24h',
      '  --location <string>        search location  default: India',
      '  --country <string>         post-filter by country',
      '  --city <string>            post-filter by city',
      '  --no-remote                exclude remote jobs',
      '  --limit <n>                max results (cap: 400)',
      '',
      'Example:',
      '  node scrapers/internshala.js "React Developer" "Frontend" --since 7d',
    ].join('\n'));
    process.exit(1);
  }

  console.log(`\n${SCRAPER_TITLE}`);
  console.log(`Titles   : ${opts.titles.join(', ')}`);
  console.log(`Location : ${opts.location} | Since: ${opts.since} | Limit: ${opts.limit}`);
  require('fs').mkdirSync(OUTPUT_DIR, { recursive: true });

  const fetched = [];
  for (let i = 0; i < opts.titles.length; i++) {
    const keyword = opts.titles[i];
    process.stdout.write(`  [internshala] "${keyword}" ... `);
    try {
      const jobs = await fetchKeyword(keyword);
      process.stdout.write(`${jobs.length} jobs\n`);
      fetched.push(...jobs);
    } catch (err) {
      process.stdout.write(`error: ${err.message}\n`);
    }
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
