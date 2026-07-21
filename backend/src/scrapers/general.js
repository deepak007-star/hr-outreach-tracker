'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 4 — Remote Job Boards
 *  Aggregates across multiple public *remote-hiring* job boards by keyword.
 *  (Internshala — not remote-specific — lives in scrapers/internshala.js
 *  and is scraped under the 'general' category instead.)
 *
 *  Sites:
 *    arbeitnow       — Global remote-friendly API, paginated (up to 3 pages)
 *    remoteok        — Remote-only API (filtered by keyword)
 *    weworkremotely  — Remote-only, RSS feeds (programming + all-jobs)
 *    remotive        — Remote-only API (filtered by keyword)
 *
 *  Usage:
 *    node scrapers/general.js "Full Stack Developer" "Node.js"
 *    node scrapers/general.js "Python Developer" --since 24h
 *    node scrapers/general.js "React Native" --since 7d --city bangalore
 *    node scrapers/general.js "Machine Learning" --sites arbeitnow,remoteok
 *
 *  Options:
 *    --since <24h|7d|30d|all>   Time window (default: 24h)
 *    --location <string>        Search location hint (default: India)
 *    --country <string>         Post-filter by country
 *    --city <string>            Post-filter by city
 *    --no-remote                Exclude remote jobs
 *    --limit <n>                Max results (default/max: 400)
 *    --sites <a,b,c>            Comma-separated: arbeitnow, remoteok,
 *                               weworkremotely, remotive (default: all)
 *
 *  Output: output/general/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path    = require('path');
const cheerio = require('cheerio');
const {
  get, sleep, stripHtml,
  applyFilters, parseArgs,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  TODAY, RUN_STAMP,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'general');
const SCRAPER_TITLE = 'General Job Search';

// ─── Site definitions ─────────────────────────────────────────────────────────

// Shared "specific word" extractor — sites whose search/filter is fuzzy need
// to filter client-side on the non-generic words of a title ("Python
// developer" → "python", not "developer", which would match every dev job).
const GENERIC_ROLE_WORDS = new Set(['developer','engineer','manager','analyst','designer','architect',
  'lead','senior','junior','associate','executive','intern','specialist','consultant',
  'officer','director','head','coordinator','assistant','staff','principal']);
function specificWords(keyword) {
  const all = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const specific = all.filter(w => !GENERIC_ROLE_WORDS.has(w));
  return specific.length ? specific : [all[0]].filter(Boolean);
}

const SITES = {

  // ── Arbeitnow (Global API — paginated, client-side keyword filter) ─────────
  arbeitnow: {
    name: 'arbeitnow',
    async fetch(keyword) {
      const filterWords = specificWords(keyword);
      const items = [];
      // Up to 3 pages per keyword — real yield is bounded by Arbeitnow's own
      // result count (its `links.next` disappears once exhausted).
      for (let pg = 1; pg <= 3; pg++) {
        const url = `https://arbeitnow.com/api/job-board-api?search=${encodeURIComponent(keyword)}&page=${pg}`;
        try {
          const data = await get(url, { json: true, delay: 1200 });
          const pageItems = data.data || [];
          if (!pageItems.length) break;
          items.push(...pageItems);
          if (!data.links || !data.links.next) break;
        } catch (_) { break; }
      }
      const filtered = items.filter(j => {
        if (!j.title) return false;
        const text = (j.title + ' ' + (j.tags || []).join(' ')).toLowerCase();
        return !filterWords.length || filterWords.some(w => text.includes(w));
      });
      return filtered.map(j => ({
        source:      'arbeitnow',
        title:       j.title        || '',
        company:     j.company_name || '',
        location:    j.location     || '',
        jobType:     Array.isArray(j.job_types) ? j.job_types.join(', ') : (j.remote ? 'Remote' : ''),
        salary:      '',
        experience:  '',
        tags:        Array.isArray(j.tags) ? j.tags.join(', ') : keyword,
        description: stripHtml(j.description).slice(0, 500),
        link:        j.url || '',
        applyLink:   j.url || '',
        postedAt:    j.created_at ? new Date(j.created_at * 1000).toISOString().split('T')[0] : '',
        scrapedAt:   new Date().toISOString(),
      }));
    },
  },

  // ── RemoteOK (Remote-only API, filter by keyword) ──────────────────────────
  remoteok: {
    name: 'remoteok',
    _cache: null,
    async fetch(keyword) {
      if (!this._cache) {
        // Do NOT use lenient SSL agent — RemoteOK has a valid cert
        const data = await get('https://remoteok.com/api', { json: true, delay: 1500 });
        this._cache = (Array.isArray(data) ? data : []).filter(j => j.position);
      }
      // RemoteOK tags are global category lists (not job-specific) — filter by title only
      const firstWord = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2)[0];
      return this._cache
        .filter(j => !firstWord || j.position.toLowerCase().includes(firstWord))
        .map(j => ({
          source:      'remoteok',
          title:       j.position || '',
          company:     j.company  || '',
          location:    j.location || 'Remote',
          jobType:     'Remote',
          salary:      j.salary_min ? `$${Math.round(j.salary_min / 1000)}k–$${Math.round(j.salary_max / 1000)}k` : '',
          experience:  '',
          tags:        Array.isArray(j.tags) ? j.tags.join(', ') : '',
          description: stripHtml(j.description).slice(0, 500),
          link:        j.url       || '',
          applyLink:   j.apply_url || j.url || '',
          postedAt:    j.date      ? j.date.split('T')[0] : '',
          scrapedAt:   new Date().toISOString(),
        }));
    },
  },

  // ── WeWorkRemotely (Remote-only, public RSS feeds) ──────────────────────────
  weworkremotely: {
    name: 'weworkremotely',
    _cache: null,
    async fetch(keyword) {
      if (!this._cache) {
        const feeds = [
          'https://weworkremotely.com/categories/remote-programming-jobs.rss',
          'https://weworkremotely.com/remote-jobs.rss',
        ];
        const all = [];
        for (const feedUrl of feeds) {
          try {
            const xml = await get(feedUrl, { delay: 1000 });
            const $ = cheerio.load(xml, { xmlMode: true });
            $('item').each((_, el) => {
              const $el      = $(el);
              const rawTitle = $el.find('title').text().trim();
              // WWR titles are formatted "Company: Job Title"
              const sep      = rawTitle.indexOf(':');
              const company  = sep > -1 ? rawTitle.slice(0, sep).trim() : '';
              const title    = sep > -1 ? rawTitle.slice(sep + 1).trim() : rawTitle;
              const link     = $el.find('link').text().trim();
              const pubDate  = $el.find('pubDate').text().trim();
              all.push({
                source:      'weworkremotely',
                title, company,
                location:    $el.find('region').text().trim() || 'Remote',
                jobType:     'Remote',
                salary:      '',
                experience:  '',
                tags:        $el.find('category').first().text().trim(),
                description: '',
                link, applyLink: link,
                postedAt:    pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
                scrapedAt:   new Date().toISOString(),
              });
            });
          } catch (_) { /* one feed failing shouldn't sink the other */ }
        }
        this._cache = all;
      }
      const filterWords = specificWords(keyword);
      return this._cache.filter(j => !filterWords.length || filterWords.some(w => j.title.toLowerCase().includes(w)));
    },
  },

  // ── Remotive (Remote-only API, filter by keyword) ───────────────────────────
  // Remotive's terms ask for max ~4 requests/day — cached like RemoteOK so one
  // scraper run (however many titles) makes exactly one HTTP call.
  remotive: {
    name: 'remotive',
    _cache: null,
    async fetch(keyword) {
      if (!this._cache) {
        const data = await get('https://remotive.com/api/remote-jobs', { json: true, delay: 1500 });
        this._cache = (data.jobs || []).filter(j => j.title);
      }
      const filterWords = specificWords(keyword);
      return this._cache
        .filter(j => !filterWords.length || filterWords.some(w => j.title.toLowerCase().includes(w)))
        .map(j => ({
          source:      'remotive',
          title:       j.title            || '',
          company:     j.company_name     || '',
          location:    j.candidate_required_location || 'Remote',
          jobType:     j.job_type || 'Remote',
          salary:      j.salary || '',
          experience:  '',
          tags:        Array.isArray(j.tags) ? j.tags.join(', ') : (j.category || ''),
          description: stripHtml(j.description).slice(0, 500),
          link:        j.url || '',
          applyLink:   j.url || '',
          postedAt:    j.publication_date ? j.publication_date.split('T')[0] : '',
          scrapedAt:   new Date().toISOString(),
        }));
    },
  },

};

// ─── Extended CLI parsing (adds --sites) ─────────────────────────────────────

function parseGeneralArgs() {
  const opts = parseArgs('India', ['--sites']);
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sites') {
      opts.sites = (argv[++i] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  return opts;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseGeneralArgs();

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/general.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Options:',
      '  --since <24h|7d|30d|all>   default: 24h',
      '  --location <string>        search location  default: India',
      '  --country <string>         post-filter by country',
      '  --city <string>            post-filter by city',
      '  --no-remote                exclude remote jobs',
      '  --limit <n>                max results (cap: 60)',
      '  --sites <a,b,c>            sites to use (default: all)',
      '                             choices: arbeitnow, remoteok, weworkremotely, remotive',
      '',
      'Example:',
      '  node scrapers/general.js "React Developer" "Frontend" --since 7d',
      '  node scrapers/general.js "Node.js" --sites arbeitnow,remoteok --city bangalore',
    ].join('\n'));
    process.exit(1);
  }

  const siteKeys  = opts.sites || Object.keys(SITES);
  const activeSites = siteKeys.map(k => SITES[k]).filter(Boolean);
  if (!activeSites.length) {
    console.error(`Unknown sites: ${siteKeys.join(', ')}. Valid: ${Object.keys(SITES).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n${SCRAPER_TITLE}`);
  console.log(`Titles   : ${opts.titles.join(', ')}`);
  console.log(`Sites    : ${activeSites.map(s => s.name).join(', ')}`);
  console.log(`Location : ${opts.location} | Since: ${opts.since} | Limit: ${opts.limit}`);
  require('fs').mkdirSync(OUTPUT_DIR, { recursive: true });

  const fetched = [];

  for (const site of activeSites) {
    for (let ti = 0; ti < opts.titles.length; ti++) {
      const keyword = opts.titles[ti];
      process.stdout.write(`  [${site.name}] "${keyword}" ... `);
      try {
        const jobs = await site.fetch(keyword);
        process.stdout.write(`${jobs.length} jobs\n`);
        fetched.push(...jobs);
      } catch (err) {
        process.stdout.write(`error: ${err.message}\n`);
      }
      if (ti < opts.titles.length - 1) await sleep(1000);
    }
    await sleep(1000);
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
