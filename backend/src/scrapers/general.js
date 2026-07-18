'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 4 — General / Multi-site Jobs
 *  Aggregates across multiple public job boards by keyword.
 *
 *  Sites:
 *    internshala  — India, SSR HTML, entry-to-mid level
 *    arbeitnow    — Global API with keyword search
 *    remoteok     — Remote-only API (filtered by keyword)
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
 *    --limit <n>                Max results (default/max: 60)
 *    --sites <a,b,c>            Comma-separated: internshala, arbeitnow, remoteok
 *                               (default: all)
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

const SITES = {

  // ── Internshala (India, SSR HTML) ──────────────────────────────────────────
  internshala: {
    name: 'internshala',
    async fetch(keyword) {
      const slug = keyword.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      // Specific (non-generic) words filter: "Python developer" → ["python"]
      const GENERIC = new Set(['developer','engineer','manager','analyst','designer','architect',
        'lead','senior','junior','associate','executive','intern','specialist','consultant',
        'officer','director','head','coordinator','assistant','staff','principal']);
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
      // Scrape up to 3 pages to get enough relevant results
      for (let pg = 1; pg <= 3; pg++) {
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
    },
  },

  // ── Arbeitnow (Global API — client-side keyword filter applied after fetch) ──
  arbeitnow: {
    name: 'arbeitnow',
    async fetch(keyword) {
      const url  = `https://arbeitnow.com/api/job-board-api?search=${encodeURIComponent(keyword)}&page=1`;
      const data = await get(url, { json: true, delay: 1500 });
      // Arbeitnow's ?search= does fuzzy/broad matching — apply strict keyword filter.
      // Use specific (non-generic) words: "Python developer" → filter by "python" not "developer".
      const GENERIC = new Set(['developer','engineer','manager','analyst','designer','architect',
        'lead','senior','junior','associate','executive','intern','specialist','consultant',
        'officer','director','head','coordinator','assistant','staff','principal']);
      const all = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const specific = all.filter(w => !GENERIC.has(w));
      const filterWords = specific.length ? specific : [all[0]].filter(Boolean);
      const items = (data.data || []).filter(j => {
        if (!j.title) return false;
        const text = (j.title + ' ' + (j.tags || []).join(' ')).toLowerCase();
        return !filterWords.length || filterWords.some(w => text.includes(w));
      });
      return items.map(j => ({
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
      '                             choices: internshala, arbeitnow, remoteok',
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
