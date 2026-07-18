'use strict';
/**
 * ════════════════════════════════════════════════════════════════
 *  SCRAPER 2 — LinkedIn HR Contact Jobs
 *  Finds LinkedIn job posts that include HR contact details:
 *    • Email addresses
 *    • Google Form / Google Docs links
 *    • WhatsApp / phone numbers
 *
 *  Workflow: search LinkedIn (guest API) → fetch each job's full
 *  description → extract contact info → keep only jobs that have it.
 *
 *  Usage:
 *    node scrapers/linkedin-hr-contact.js "HR Manager" "Recruiter"
 *    node scrapers/linkedin-hr-contact.js "Talent Acquisition" --since 7d --location "Mumbai, India"
 *    node scrapers/linkedin-hr-contact.js "People Operations" --country india --city bangalore
 *
 *  Options:
 *    --since <24h|7d|30d|YYYY-MM-DD|all>   Time window (default: 24h)
 *    --location <string>                    LinkedIn location (default: India)
 *    --country <string>                     Post-filter by country
 *    --city <string>                        Post-filter by city
 *    --no-remote                            Exclude remote jobs
 *    --limit <n>                            Max results (default/max: 60)
 *
 *  ⚠ Slower than linkedin-jobs.js — fetches each job's description
 *    individually. Expect 3-6 seconds per job due to rate limiting.
 *
 *  Output: output/linkedin-hr/YYYY-MM-DD--<filters>.{html,csv}
 * ════════════════════════════════════════════════════════════════
 */

const path    = require('path');
const cheerio = require('cheerio');
const {
  get, sleep, stripHtml,
  resolveRelativeDate, sinceToSeconds, parseSince, jobDate,
  matchesLocation, applyFilters, parseArgs,
  saveRawCache, buildSuffix, saveCSV, saveHTML,
  TODAY, RUN_STAMP, DESC_MAX,
} = require('../lib/common');

const OUTPUT_DIR    = path.join(__dirname, '..', 'output', 'linkedin-hr');
const SCRAPER_TITLE = 'LinkedIn — HR Contact Jobs';

const LI_SEARCH  = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const LI_DETAIL  = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
const LI_HEADERS = { 'Referer': 'https://www.linkedin.com/jobs/search/' };

// ─── Contact info extraction ──────────────────────────────────────────────────

// Regexes for contact info patterns
const RE_EMAIL   = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
const RE_GFORM   = /https?:\/\/(?:docs\.google\.com\/forms|forms\.gle)\/[^\s"'<>)\]]+/g;
const RE_WA      = /https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^\s"'<>)\]]+/g;
// India mobile: 10 digits starting 6-9, optionally prefixed +91 or 0
const RE_PHONE   = /(?:(?:\+91|0091|0)[\s\-]?)?[6-9]\d{9}/g;

const SPAM_EMAILS = ['noreply','no-reply','example.','donotreply','support@','info@linkedin'];

function extractContact(text) {
  const emails = [...new Set((text.match(RE_EMAIL) || [])
    .filter(e => !SPAM_EMAILS.some(s => e.toLowerCase().includes(s)))
  )];
  const gforms = [...new Set((text.match(RE_GFORM) || []))];
  const phones = [...new Set((text.match(RE_PHONE) || [])
    .map(p => p.replace(/[\s\-]/g,''))
    .filter(p => p.length >= 10)
  )];
  const waLinks = [...new Set((text.match(RE_WA) || []))];

  return {
    emails,
    gforms,
    phones,
    waLinks,
    hasContact: emails.length > 0 || gforms.length > 0 || phones.length > 0 || waLinks.length > 0,
  };
}

// ─── LinkedIn search (same as linkedin-jobs) ──────────────────────────────────

async function fetchSearchPage(keyword, location, since, start) {
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

function parseSearchPage(html, keyword) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('li').each((_, el) => {
    const urn   = $(el).find('[data-entity-urn]').first().attr('data-entity-urn') || '';
    const jobId = urn.split(':').pop();
    if (!jobId || !/^\d+$/.test(jobId)) return;

    const title   = $(el).find('h3').first().text().trim();
    const company = $(el).find('h4 a, .base-search-card__subtitle a').first().text().trim()
                 || $(el).find('h4').first().text().trim();
    const location= $(el).find('.job-search-card__location').first().text().trim();
    const href    = $(el).find('a[href*="/jobs/view/"]').first().attr('href') || '';
    const dateEl  = $(el).find('time');
    const postedAt = dateEl.attr('datetime')
      ? dateEl.attr('datetime').split('T')[0]
      : resolveRelativeDate(dateEl.text().trim());

    if (!title) return;
    jobs.push({ jobId, title, company, location, postedAt, href: href.split('?')[0], searchKeyword: keyword });
  });

  return jobs;
}

// ─── Fetch full job description ───────────────────────────────────────────────

async function fetchJobDetail(jobId) {
  try {
    const html = await get(`${LI_DETAIL}/${jobId}`, { delay: 3000, headers: LI_HEADERS });
    const $    = cheerio.load(html);

    const descHtml  = $('.description__text, .show-more-less-html__markup').html() || '';
    const descText  = stripHtml(descHtml, 2000); // keep more text for contact regex matching
    const applyHref = $('a[data-tracking-control-name*="apply"], .apply-button').first().attr('href') || '';

    return { descText, applyHref };
  } catch (_) {
    return { descText: '', applyHref: '' };
  }
}

// ─── Main fetch loop ──────────────────────────────────────────────────────────

async function scrapeWithContacts(opts) {
  const since   = parseSince(opts.since);
  const allMeta = [];

  // Step 1: collect job metadata from search — fetch only what's needed per title
  const perTitle = Math.ceil(opts.limit / opts.titles.length);
  for (let ti = 0; ti < opts.titles.length; ti++) {
    const keyword = opts.titles[ti];
    console.log(`  [search] "${keyword}" (max ${perTitle})`);
    let collected = 0;
    for (let page = 0; page < 3; page++) {
      try {
        const html = await fetchSearchPage(keyword, opts.location, opts.since, page * 25);
        const jobs = parseSearchPage(html, keyword);
        allMeta.push(...jobs);
        collected += jobs.length;
        if (jobs.length < 25 || collected >= perTitle) break;
      } catch (err) {
        console.error(`    page ${page + 1}: ${err.message}`);
        break;
      }
    }
    if (ti < opts.titles.length - 1) await sleep(2000);
  }

  // Deduplicate by jobId before fetching details
  const seenIds = new Set();
  const uniqMeta = allMeta.filter(j => {
    if (seenIds.has(j.jobId)) return false;
    seenIds.add(j.jobId);
    return true;
  });

  // Pre-filter by time + location before fetching descriptions (saves requests)
  const preFiltered = uniqMeta.filter(j => {
    if (since) {
      const d = jobDate({ postedAt: j.postedAt });
      if (d !== null && d < since) return false;
    }
    return matchesLocation({ location: j.location }, opts.country, opts.city, opts.noRemote);
  });

  console.log(`\nMeta fetched: ${uniqMeta.length} | Pre-filtered: ${preFiltered.length}`);
  console.log(`Fetching descriptions (${preFiltered.length} jobs, ~${Math.round(preFiltered.length * 3.5)}s)...`);

  // Step 2: fetch descriptions + extract contact info
  const results = [];
  for (let i = 0; i < preFiltered.length; i++) {
    const meta = preFiltered[i];
    process.stdout.write(`  [${i + 1}/${preFiltered.length}] ${meta.title.substring(0, 40).padEnd(40)} `);

    const { descText, applyHref } = await fetchJobDetail(meta.jobId);
    const contact = extractContact(descText);

    if (!contact.hasContact) {
      process.stdout.write('x no contact\n');
      continue;
    }

    process.stdout.write(`+ ${contact.emails[0] || contact.gforms[0] || contact.phones[0] || ''}\n`);

    const jobLink = meta.href || `https://www.linkedin.com/jobs/view/${meta.jobId}`;

    results.push({
      source:         'linkedin-hr',
      title:          meta.title,
      company:        meta.company,
      location:       meta.location,
      jobType:        '',
      salary:         '',
      experience:     '',
      tags:           meta.searchKeyword,
      description:    descText.substring(0, DESC_MAX),
      link:           jobLink,
      applyLink:      applyHref || jobLink,
      // Contact fields (shown in the HTML viewer contact bar)
      contactEmail:   contact.emails[0]  || '',
      contactPhone:   contact.phones[0]  || '',
      googleFormLink: contact.gforms[0]  || '',
      whatsappLink:   contact.waLinks[0] || '',
      // All found contacts as JSON (goes to CSV)
      allContacts:    JSON.stringify({ emails: contact.emails, phones: contact.phones, gforms: contact.gforms }),
      postedAt:       meta.postedAt,
      scrapedAt:      new Date().toISOString(),
    });
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs('India');

  if (!opts.titles.length) {
    console.error([
      '',
      'Usage: node scrapers/linkedin-hr-contact.js "Job Title 1" "Job Title 2" [options]',
      '',
      'Finds LinkedIn job posts that mention HR email / Google Form / WhatsApp.',
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
      '  node scrapers/linkedin-hr-contact.js "Software Engineer" --since 7d --location "India"',
    ].join('\n'));
    process.exit(1);
  }

  console.log(`\n${SCRAPER_TITLE}`);
  console.log(`Titles   : ${opts.titles.join(', ')}`);
  console.log(`Location : ${opts.location} | Since: ${opts.since} | Limit: ${opts.limit}`);
  require('fs').mkdirSync(OUTPUT_DIR, { recursive: true });

  const results  = await scrapeWithContacts(opts);
  console.log(`\nWith contact info: ${results.length}`);

  if (!results.length) {
    console.log('No jobs with contact info found. Try --since 7d or broader titles.');
    return;
  }

  const cached   = saveRawCache(results, OUTPUT_DIR);
  const filtered = applyFilters(cached, opts);
  console.log(`Filtered : ${filtered.length} match all criteria`);

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
