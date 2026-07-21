'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 7 — Instahyre Jobs (India tech hiring platform)
 *
 *  Strategy: plain HTTP GET against Instahyre's own public search API —
 *  no browser needed, no auth, no bot protection encountered. The site's
 *  own frontend calls this same endpoint; the real filter param is
 *  `skills=<keyword>` (its URL query string uses `q=`, but that param is
 *  cosmetic — the API silently ignores it and returns its default feed).
 *
 *  Usage:
 *    node scrapers/instahyre.js "Java Developer" "Python Developer"
 *    node scrapers/instahyre.js "React Developer" --since 7d
 *
 *  Options:
 *    --since <24h|7d|30d|all>   Time window (default: 24h)
 *    --location <string>        Post-filter location hint (default: India)
 *    --country <string>         Post-filter by country
 *    --city <string>            Post-filter by city
 *    --no-remote                Exclude remote jobs
 *    --limit <n>                Max results (default/max: 400)
 *
 *  Output: output/instahyre/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path = require('path');
const {
  get, stripHtml, applyFilters, parseArgs,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  RUN_STAMP,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'instahyre');
const SCRAPER_TITLE = 'Instahyre Jobs';

async function fetchKeyword(keyword) {
  const jobs   = [];
  let offset   = 0;
  const PAGE   = 35; // Instahyre's own page size

  // Up to 3 pages per keyword — plenty for a single search term, keeps this
  // in line with the other SSR-style scrapers' per-keyword page cap.
  for (let page = 0; page < 3; page++) {
    const url = `https://www.instahyre.com/api/v1/job_search?`
      + `skills=${encodeURIComponent(keyword)}&offset=${offset}&source=opportunities&company_size=0&job_type=0`;
    let data;
    try {
      data = await get(url, { json: true, delay: 1200 });
    } catch (err) {
      if (page === 0) console.error(`    Error: ${err.message}`);
      break;
    }
    const items = data.objects || [];
    if (!items.length) break;

    jobs.push(...items.map(j => ({
      source:      'instahyre',
      title:       j.title || j.candidate_title || '',
      company:     j.employer?.company_name || '',
      location:    (j.locations || '').split(',')[0]?.trim() || '',
      jobType:     '',
      salary:      '',
      experience:  '',
      tags:        Array.isArray(j.keywords) ? j.keywords.join(', ') : keyword,
      description: stripHtml(j.employer?.instahyre_note || '').slice(0, 500),
      link:        j.public_url || '',
      applyLink:   j.public_url || '',
      postedAt:    '',
      scrapedAt:   new Date().toISOString(),
    })));

    if (!data.meta?.next) break;
    offset += PAGE;
  }

  return jobs;
}

async function main() {
  const opts = parseArgs('India');

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/instahyre.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Options:',
      '  --since <24h|7d|30d|all>   default: 24h',
      '  --location <string>        post-filter location  default: India',
      '  --country <string>         post-filter by country',
      '  --city <string>            post-filter by city',
      '  --no-remote                exclude remote jobs',
      '  --limit <n>                max results (cap: 400)',
      '',
      'Example:',
      '  node scrapers/instahyre.js "React Developer" "Node.js Developer" --since 7d',
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
    process.stdout.write(`  [instahyre] "${keyword}" ... `);
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
    console.log('No jobs matched. Try a different title/location.');
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
