'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 1 — LinkedIn Jobs
 *  Searches LinkedIn public job listings for multiple job titles.
 *  Uses LinkedIn's guest API (no login required).
 *
 *  Usage:
 *    node scrapers/linkedin-jobs.js "Software Engineer" "React Developer"
 *    node scrapers/linkedin-jobs.js "Data Scientist" --since 7d --location "Bangalore, India"
 *    node scrapers/linkedin-jobs.js "Java Developer" --country india --city hyderabad
 *    node scrapers/linkedin-jobs.js "Frontend Dev" --since 24h --limit 30 --no-remote
 *
 *  Options:
 *    --since <24h|7d|30d|YYYY-MM-DD|all>   Time window (default: 24h)
 *    --location <string>                    LinkedIn location (default: India)
 *    --country <string>                     Post-filter by country
 *    --city <string>                        Post-filter by city
 *    --no-remote                            Exclude remote jobs
 *    --limit <n>                            Max results (default/max: 60)
 *
 *  Output: output/linkedin/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path    = require('path');
const cheerio = require('cheerio');
const {
  get, sleep,
  resolveRelativeDate, sinceToSeconds,
  applyFilters, parseArgs,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  TODAY, RUN_STAMP,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'linkedin');
const SCRAPER_TITLE = 'LinkedIn Jobs';

// LinkedIn guest search API — returns HTML job cards (no login needed)
const LI_SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const LI_HEADERS = {
  'Referer':      'https://www.linkedin.com/jobs/search/',
  'X-Requested-With': 'XMLHttpRequest',
};

// ─── Fetch + parse ────────────────────────────────────────────────────────────

async function fetchPage(keyword, location, since, start) {
  const secs   = sinceToSeconds(since);
  const params = new URLSearchParams({
    keywords: keyword,
    location: location || 'India',
    ...(secs ? { f_TPR: `r${secs}` } : {}),
    start: String(start),
    count: '25',
  });
  return get(`${LI_SEARCH}?${params}`, { delay: start === 0 ? 2500 : 3500, headers: LI_HEADERS });
}

function parsePage(html, keyword) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('li').each((_, el) => {
    // Job ID lives in data-entity-urn="urn:li:jobPosting:XXXXXXXXXX"
    const urn   = $(el).find('[data-entity-urn]').first().attr('data-entity-urn') || '';
    const jobId = urn.split(':').pop();
    if (!jobId || !/^\d+$/.test(jobId)) return;

    const title   = $(el).find('h3').first().text().trim()
                 || $(el).find('.base-search-card__title').first().text().trim();
    const company = $(el).find('h4 a, .base-search-card__subtitle a').first().text().trim()
                 || $(el).find('h4').first().text().trim();
    const location= $(el).find('.job-search-card__location').first().text().trim();
    const href    = $(el).find('a[href*="/jobs/view/"]').first().attr('href') || '';
    const dateEl  = $(el).find('time');
    const postedAt = dateEl.attr('datetime')
      ? dateEl.attr('datetime').split('T')[0]
      : resolveRelativeDate(dateEl.text().trim());

    if (!title) return;

    jobs.push({
      source:      'linkedin',
      title,
      company,
      location,
      jobType:     '',
      salary:      '',
      experience:  '',
      tags:        keyword,
      description: '',
      link:        href ? href.split('?')[0] : `https://www.linkedin.com/jobs/view/${jobId}`,
      applyLink:   href ? href.split('?')[0] : `https://www.linkedin.com/jobs/view/${jobId}`,
      postedAt,
      scrapedAt:   new Date().toISOString(),
    });
  });

  return jobs;
}

async function scrapeTitle(keyword, opts, maxJobs = 60) {
  console.log(`  [linkedin] Searching: "${keyword}" (max ${maxJobs})`);
  const all = [];

  for (let page = 0; page < 3; page++) {
    try {
      const html = await fetchPage(keyword, opts.location, opts.since, page * 25);
      const jobs = parsePage(html, keyword);
      all.push(...jobs);
      if (jobs.length < 25 || all.length >= maxJobs) break;
    } catch (err) {
      console.error(`    page ${page + 1}: ${err.message}`);
      break;
    }
  }

  const result = all.slice(0, maxJobs);
  console.log(`    -> ${result.length} found`);
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs('India');

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/linkedin-jobs.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Options:',
      '  --since <24h|7d|30d|all>   default: 24h',
      '  --location <string>        LinkedIn location  default: India',
      '  --country <string>         post-filter by country',
      '  --city <string>            post-filter by city',
      '  --no-remote                exclude remote jobs',
      '  --limit <n>                max results (cap: 60)',
      '',
      'Example:',
      '  node scrapers/linkedin-jobs.js "React Developer" "Node.js Developer" --since 7d --location "Bangalore, India"',
    ].join('\n'));
    process.exit(1);
  }

  console.log(`\n${SCRAPER_TITLE}`);
  console.log(`Titles   : ${opts.titles.join(', ')}`);
  console.log(`Location : ${opts.location} | Since: ${opts.since} | Limit: ${opts.limit}`);
  require('fs').mkdirSync(OUTPUT_DIR, { recursive: true });

  // Fetch only what's needed: divide limit equally across titles
  const perTitle = Math.ceil(opts.limit / opts.titles.length);
  const fetched = [];
  for (let i = 0; i < opts.titles.length; i++) {
    const jobs = await scrapeTitle(opts.titles[i], opts, perTitle);
    fetched.push(...jobs);
    if (i < opts.titles.length - 1) await sleep(2000);
  }

  console.log(`\nFetched  : ${fetched.length} total`);
  const cached   = saveRawCache(fetched, OUTPUT_DIR);
  const filtered = applyFilters(cached, opts);
  console.log(`Filtered : ${filtered.length} match criteria (limit ${opts.limit})`);

  if (!filtered.length) {
    console.log('No jobs matched. Try --since 7d or a different location/title.');
    return;
  }

  const suffix = buildSuffix(opts);
  const base   = require('path').join(OUTPUT_DIR, `${RUN_STAMP}${suffix}`);
  saveCSV(filtered, base + '.csv');
  saveHTML(filtered, opts, base + '.html', SCRAPER_TITLE);
  if (!process.env.SCRAPER_NO_OPEN) require('child_process').exec(`start "" "${base}.html"`);

  console.log(`\nSaved:`);
  console.log(`  CSV  -> ${base}.csv`);
  console.log(`  HTML -> ${base}.html`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
