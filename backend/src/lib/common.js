'use strict';
/**
 * lib/common.js — shared utilities for all standalone scrapers
 * Imported by: linkedin-jobs, linkedin-hr-contact, naukri, general
 */

const axios   = require('axios');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');

// Used only for sites with broken intermediate cert chains (e.g. TimesJobs)
const LENIENT_AGENT = new https.Agent({ rejectUnauthorized: false });

// ─── Constants ────────────────────────────────────────────────────────────────

const LIMIT_MAX = 60;
const DESC_MAX  = 400;
const _d = new Date();
const TODAY     = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
// Unique stamp per scraper invocation — ensures each run writes a NEW file
const RUN_STAMP = `${TODAY}-${String(_d.getHours()).padStart(2,'0')}${String(_d.getMinutes()).padStart(2,'0')}`;

const BASE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

// ─── HTTP ─────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, { json = false, delay = 2000, headers = {}, lenient = false } = {}) {
  await sleep(delay);
  const res = await axios.get(url, {
    headers: { ...BASE_HEADERS, ...headers, Accept: json ? 'application/json' : 'text/html,application/xhtml+xml,*/*;q=0.9' },
    timeout: 20000,
    maxRedirects: 5,
    ...(lenient ? { httpsAgent: LENIENT_AGENT } : {}),
  });
  return res.data;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function stripHtml(html, max = DESC_MAX) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#x2F;/g, '/').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
    .substring(0, max);
}

const escH = s =>
  (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ─── Time ─────────────────────────────────────────────────────────────────────

// "24h" → ms offset; "7d" → ms offset; "2026-07-10" → Date; "all" → null
function parseSince(str) {
  if (!str || str === 'all') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00.000Z');
  const n = parseInt(str), u = str.slice(-1).toLowerCase(), now = Date.now();
  if (u === 'h') return new Date(now - n * 3_600_000);
  if (u === 'd') return new Date(now - n * 86_400_000);
  if (u === 'w') return new Date(now - n * 604_800_000);
  return null;
}

// "24h" → 86400 seconds (for LinkedIn f_TPR param)
function sinceToSeconds(str) {
  if (!str || str === 'all') return 0;
  const n = parseInt(str), u = str.slice(-1).toLowerCase();
  if (u === 'h') return n * 3600;
  if (u === 'd') return n * 86400;
  if (u === 'w') return n * 7 * 86400;
  return 86400;
}

// "24h" → 1 day (for Naukri jobAge param, min 1)
function sinceToDays(str) {
  if (!str || str === 'all') return 0;
  const n = parseInt(str), u = str.slice(-1).toLowerCase();
  if (u === 'h') return Math.max(1, Math.ceil(n / 24));
  if (u === 'd') return n;
  if (u === 'w') return n * 7;
  return 1;
}

// Resolve display strings like "2 days ago", "Just now", "4d", "3 weeks ago" → YYYY-MM-DD
function resolveRelativeDate(str) {
  if (!str) return '';
  const s = str.trim().toLowerCase();
  if (['just now','today','new','an hour ago','few minutes ago'].some(k => s.includes(k))) return TODAY;

  let n = 0, ms = 0;
  // "4d" or "3h" or "2w"
  const shortMatch = s.match(/^(\d+)([hdw])$/);
  if (shortMatch) {
    n = parseInt(shortMatch[1]);
    const u = shortMatch[2];
    ms = u === 'h' ? n * 3_600_000 : u === 'd' ? n * 86_400_000 : n * 604_800_000;
    return new Date(Date.now() - ms).toISOString().split('T')[0];
  }
  // "3 days ago" / "2 weeks ago" / "1 month ago"
  const longMatch = s.match(/(\d+)\s+(hour|day|week|month)/);
  if (longMatch) {
    n = parseInt(longMatch[1]);
    const u = longMatch[2];
    if (u === 'hour')  ms = n * 3_600_000;
    if (u === 'day')   ms = n * 86_400_000;
    if (u === 'week')  ms = n * 604_800_000;
    if (u === 'month') ms = n * 30 * 86_400_000;
    return new Date(Date.now() - ms).toISOString().split('T')[0];
  }
  return str; // return as-is if unrecognised (ISO dates etc)
}

function jobDate(job) {
  if (!job.postedAt) return null;
  const d = new Date(job.postedAt);
  return isNaN(d) ? null : d;
}

// ─── Location ─────────────────────────────────────────────────────────────────

const REMOTE_TERMS = ['remote','worldwide','anywhere','global','distributed','work from home','wfh','fully remote'];

const COUNTRY_TERMS = {
  us:          ['united states','usa','u.s.a.','america','us only'],
  uk:          ['united kingdom','britain','england','u.k.'],
  india:       ['india'],
  germany:     ['germany','deutschland'],
  canada:      ['canada'],
  australia:   ['australia'],
  france:      ['france'],
  netherlands: ['netherlands','holland'],
  singapore:   ['singapore'],
  japan:       ['japan'],
  brazil:      ['brazil','brasil'],
  spain:       ['spain'],
  poland:      ['poland'],
  portugal:    ['portugal'],
  ukraine:     ['ukraine'],
  pakistan:    ['pakistan'],
  nigeria:     ['nigeria'],
  europe:      ['europe','emea'],
};

function isRemote(loc) {
  const l = (loc || '').toLowerCase();
  return !l || REMOTE_TERMS.some(t => l.includes(t));
}

function expandCountry(input) {
  const key = input.toLowerCase().trim();
  if (COUNTRY_TERMS[key]) return [key, ...COUNTRY_TERMS[key]];
  for (const [k, vals] of Object.entries(COUNTRY_TERMS)) {
    if (vals.includes(key)) return [k, ...COUNTRY_TERMS[k]];
  }
  return [key];
}

function matchesLocation(job, country, city, noRemote) {
  const locRaw = (job.location  || '').toLowerCase();
  const desc   = (job.description || '').toLowerCase();
  const loc    = locRaw + ' ' + desc;
  if (isRemote(locRaw) && noRemote) return false;   // always apply no-remote check first
  if (!country && !city) return true;
  if (isRemote(locRaw)) return !noRemote;
  if (city    && !loc.includes(city))                                    return false;
  if (country && !expandCountry(country).some(t => loc.includes(t)))    return false;
  return true;
}

// ─── Filter + sort + limit ────────────────────────────────────────────────────

function applyFilters(jobs, opts) {
  const since = parseSince(opts.since);

  // Build discriminator words: strip generic role words so "Python developer" → ["python"],
  // not ["python", "developer"] (which matches every developer job).
  // Fall back to the first word if all words are generic.
  const GENERIC = new Set(['developer','engineer','manager','analyst','designer','architect',
    'lead','senior','junior','associate','executive','intern','specialist','consultant',
    'officer','director','head','coordinator','assistant','staff','principal']);
  const kwWords = (opts.titles && opts.titles.length)
    ? opts.titles.map(t => {
        const all = t.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const specific = all.filter(w => !GENERIC.has(w));
        return specific.length ? specific : [all[0]].filter(Boolean); // fallback to first word
      }).flat().filter(Boolean)
    : [];

  const filtered = jobs.filter(job => {
    if (since) {
      const d = jobDate(job);
      if (d !== null && d < since) return false;
    }
    if (kwWords.length) {
      // Only check title — tags can be global/synthetic and produce false positives
      const title = (job.title || '').toLowerCase();
      if (!kwWords.some(w => title.includes(w))) return false;
    }
    return matchesLocation(job, opts.country, opts.city, opts.noRemote);
  });
  const NOW = new Date();
  filtered.sort((a, b) => {
    const da = jobDate(a) || NOW;
    const db = jobDate(b) || NOW;
    return db - da;
  });

  // Round-robin across search keywords so all titles are represented in output.
  // Uses job.tags (which scrapers set to the search keyword) to group.
  if (opts.titles && opts.titles.length > 1) {
    const groups = opts.titles.map(t => {
      const first = t.toLowerCase().split(/\s+/).filter(w => w.length > 2)[0] || t.toLowerCase();
      return filtered.filter(j => (j.tags || '').toLowerCase().includes(first));
    });
    // Jobs that didn't match any title tag go into the first bucket as fallback
    const grouped = new Set(groups.flat().map(j => j.link || j.title));
    const unmatched = filtered.filter(j => !grouped.has(j.link || j.title));
    if (groups.length) groups[0].push(...unmatched);

    const result = [];
    const maxLen = Math.max(...groups.map(g => g.length));
    for (let i = 0; i < maxLen && result.length < opts.limit; i++) {
      for (const g of groups) {
        if (i < g.length && result.length < opts.limit) result.push(g[i]);
      }
    }
    return result;
  }

  return filtered.slice(0, opts.limit);
}

// ─── CLI arg parser ───────────────────────────────────────────────────────────
// Positional args (no -- prefix) = job titles; named args = options

function parseArgs(defaultLocation = '', skipFlags = []) {
  const argv = process.argv.slice(2);
  const skip = new Set(skipFlags);
  const opts = {
    titles:   [],
    since:    '24h',
    limit:    LIMIT_MAX,
    location: defaultLocation,
    country:  null,
    city:     null,
    noRemote: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-remote') { opts.noRemote = true;                                    continue; }
    if (a === '--since')     { opts.since    = argv[++i] || '24h';                      continue; }
    if (a === '--location')  { opts.location = argv[++i] || '';                         continue; }
    if (a === '--country')   { opts.country  = (argv[++i] || '').toLowerCase().trim();  continue; }
    if (a === '--city')      { opts.city     = (argv[++i] || '').toLowerCase().trim();  continue; }
    if (a === '--limit') {
      const req = parseInt(argv[++i]) || LIMIT_MAX;
      if (req > LIMIT_MAX) console.warn(`  [!] limit capped at ${LIMIT_MAX}`);
      opts.limit = Math.min(req, LIMIT_MAX);
      continue;
    }
    if (skip.has(a)) { i++; continue; }       // skip caller-declared flags + their value
    if (a.startsWith('--')) continue;          // skip unknown flags (no value consumed)
    opts.titles.push(a);
  }
  return opts;
}

// ─── Dedup + cache ────────────────────────────────────────────────────────────

function deduplicate(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    const key = j.applyLink || j.link || `${j.title}|${j.company}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function saveRawCache(jobs, outputDir) {
  const file = path.join(outputDir, `${TODAY}.json`);
  let existing = [];
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  }
  const merged = deduplicate([...jobs, ...existing]); // new first → fresher data wins
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  return merged;
}

function buildSuffix(opts) {
  const p = [];
  if (opts.since && opts.since !== 'all') p.push(`since-${opts.since}`);
  if (opts.location) p.push(`loc-${opts.location.replace(/[^a-z0-9]/gi,'-').toLowerCase()}`);
  if (opts.country)  p.push(`country-${opts.country}`);
  if (opts.city)     p.push(`city-${opts.city.replace(/\s+/g,'-')}`);
  if (opts.noRemote) p.push('onsite');
  return p.length ? '--' + p.join('--') : '';
}

function saveCSV(jobs, file, extraCols = []) {
  const BASE = ['source','title','company','location','jobType','salary','experience','tags','description','link','applyLink','contactEmail','postedAt'];
  const COLS = extraCols.length
    ? [...BASE, ...extraCols.filter(c => !BASE.includes(c))]
    : BASE;
  const esc = v => `"${(v || '').replace(/"/g,'""')}"`;
  fs.writeFileSync(file, [COLS.join(','), ...jobs.map(j => COLS.map(c => esc(j[c])).join(','))].join('\n'));
}

// ─── HTML card viewer ─────────────────────────────────────────────────────────

function saveHTML(jobs, opts, file, scraperTitle) {
  const srcCounts = {};
  jobs.forEach(j => { srcCounts[j.source] = (srcCounts[j.source] || 0) + 1; });
  const srcSummary = Object.entries(srcCounts).map(([s,n]) => `${s}(${n})`).join(' · ');

  const filterPills = [];
  if (opts.titles?.length)               filterPills.push(`🔍 ${opts.titles.join(' / ')}`);
  if (opts.since && opts.since !== 'all') filterPills.push(`⏱ Last ${opts.since}`);
  if (opts.location)                      filterPills.push(`📍 ${opts.location}`);
  if (opts.country)                       filterPills.push(`🌍 ${opts.country}`);
  if (opts.city)                          filterPills.push(`🏙 ${opts.city}`);
  if (opts.noRemote)                      filterPills.push('🏢 On-site only');
  const pillsHTML = filterPills.map(l => `<span class="fpill">${escH(l)}</span>`).join('');

  const cards = jobs.map(j => {
    const remote   = isRemote(j.location);
    const applyBtn = j.applyLink
      ? `<a class="btn btn-apply" href="${escH(j.applyLink)}" target="_blank" rel="noopener">Apply →</a>` : '';
    const viewBtn  = j.link && j.link !== j.applyLink
      ? `<a class="btn btn-view"  href="${escH(j.link)}"      target="_blank" rel="noopener">View</a>`   : '';

    const locChip  = j.location   ? `<span class="chip cloc">${remote?'🌐':'📍'} ${escH(j.location)}</span>`  : '';
    const salChip  = j.salary     ? `<span class="chip csal">💰 ${escH(j.salary)}</span>`                     : '';
    const expChip  = j.experience ? `<span class="chip cexp">🧑‍💼 ${escH(j.experience)}</span>`               : '';
    const typChip  = j.jobType    ? `<span class="chip ctyp">${escH(j.jobType)}</span>`                       : '';
    const posted   = j.postedAt   ? `<span class="posted">📅 ${escH(j.postedAt)}</span>`                      : '';

    // HR Contact special block
    const hasContact = j.contactEmail || j.googleFormLink || j.contactPhone || j.whatsappLink;
    const contactBlock = hasContact ? `<div class="contact-bar">
      ${j.contactEmail  ? `<span class="ci email">&#9993; ${escH(j.contactEmail)}</span>` : ''}
      ${j.contactPhone  ? `<span class="ci phone">&#128222; ${escH(j.contactPhone)}</span>` : ''}
      ${j.googleFormLink? `<a class="ci gform" href="${escH(j.googleFormLink)}" target="_blank" rel="noopener">&#128203; Google Form</a>` : ''}
      ${j.whatsappLink  ? `<a class="ci gform" href="${escH(j.whatsappLink)}" target="_blank" rel="noopener">&#128172; WhatsApp</a>` : ''}
    </div>` : '';

    const tags = j.tags ? j.tags.split(',').map(t=>`<span class="tag">${escH(t.trim())}</span>`).join('') : '';
    const desc = j.description
      ? `<p class="desc">${escH(j.description)}${j.description.length >= DESC_MAX ? '…' : ''}</p>` : '';

    return `
<div class="card" data-source="${escH(j.source)}" data-type="${escH(j.jobType)}" data-remote="${remote}">
  <div class="card-head">
    <div class="title-row">
      <h3><a href="${escH(j.link || j.applyLink)}" target="_blank" rel="noopener">${escH(j.title)}</a></h3>
      <span class="badge">${escH(j.source)}</span>
    </div>
    <div class="meta-row">
      <span class="company">${escH(j.company)}</span>
      ${locChip}${salChip}${expChip}${typChip}
    </div>
  </div>
  ${contactBlock}${desc}
  ${tags ? `<div class="tags">${tags}</div>` : ''}
  <div class="card-foot">
    ${posted}
    <div class="actions">${viewBtn}${applyBtn}</div>
  </div>
</div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escH(scraperTitle)} — ${TODAY}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9;color:#1e293b}
header{background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;padding:18px 28px}
header h1{font-size:1.3rem;font-weight:700}
.hrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.hsub{font-size:.8rem;opacity:.65}
.fpill{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.28);padding:3px 10px;border-radius:12px;font-size:.74rem;font-weight:600}
.toolbar{background:#fff;border-bottom:1px solid #e2e8f0;padding:12px 28px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;position:sticky;top:0;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.06)}
#search{flex:1;min-width:200px;padding:8px 13px;border:1.5px solid #cbd5e1;border-radius:7px;font-size:.9rem;background:#f8fafc}
#search:focus{outline:none;border-color:#3b82f6;background:#fff}
.frow{display:flex;gap:5px;flex-wrap:wrap}
.fchip{padding:5px 12px;border:1.5px solid #cbd5e1;border-radius:20px;background:#fff;cursor:pointer;font-size:.77rem;font-weight:500;color:#475569;white-space:nowrap;transition:all .15s}
.fchip:hover{border-color:#3b82f6;color:#2563eb}
.fchip.on{background:#0f172a;border-color:#0f172a;color:#fff}
#cnt{font-size:.8rem;color:#64748b;margin-left:auto;font-weight:600;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:15px;padding:20px 28px}
.card{background:#fff;border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:11px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1.5px solid transparent;transition:all .15s}
.card:hover{border-color:#3b82f6;box-shadow:0 4px 18px rgba(59,130,246,.12);transform:translateY(-1px)}
.card.hidden{display:none!important}
.card-head{display:flex;flex-direction:column;gap:6px}
.title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.title-row h3{font-size:.94rem;font-weight:700;line-height:1.35}
.title-row h3 a{color:#1e293b;text-decoration:none}
.title-row h3 a:hover{color:#2563eb}
.badge{background:#dbeafe;color:#1d4ed8;padding:3px 9px;border-radius:11px;font-size:.7rem;font-weight:700;text-transform:uppercase;white-space:nowrap;flex-shrink:0}
.meta-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.company{font-size:.83rem;font-weight:600;color:#334155}
.chip{padding:2px 8px;border-radius:9px;font-size:.73rem;font-weight:500}
.cloc{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
.csal{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
.cexp{background:#ede9fe;color:#5b21b6;border:1px solid #ddd6fe}
.ctyp{background:#fef9c3;color:#854d0e;border:1px solid #fde68a}
.contact-bar{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 12px;display:flex;flex-wrap:wrap;gap:10px}
.ci{font-size:.82rem;font-weight:500;color:#166534}
.ci.gform{color:#1d4ed8;text-decoration:none}
.ci.gform:hover{text-decoration:underline}
.desc{font-size:.82rem;color:#475569;line-height:1.6}
.tags{display:flex;flex-wrap:wrap;gap:4px}
.tag{background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:7px;font-size:.74rem;border:1px solid #e2e8f0}
.card-foot{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-top:10px;border-top:1px solid #f1f5f9}
.posted{font-size:.74rem;color:#94a3b8}
.actions{display:flex;gap:6px}
.btn{padding:6px 15px;border-radius:7px;font-size:.8rem;font-weight:600;text-decoration:none;transition:all .15s;white-space:nowrap}
.btn-view{background:#f1f5f9;color:#334155;border:1.5px solid #cbd5e1}
.btn-view:hover{background:#e2e8f0}
.btn-apply{background:#2563eb;color:#fff;border:1.5px solid #2563eb}
.btn-apply:hover{background:#1d4ed8}
#noRes{display:none;text-align:center;padding:60px;color:#94a3b8;grid-column:1/-1}
</style>
</head>
<body>
<header>
  <h1>${escH(scraperTitle)}</h1>
  <div class="hrow">
    <span class="hsub"><strong>${jobs.length}</strong> jobs &nbsp;·&nbsp; ${srcSummary}</span>
    ${pillsHTML}
  </div>
</header>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search title, company, location, skills…" autofocus>
  <div class="frow" id="srcF"></div>
  <div class="frow" id="typeF"></div>
  <div class="frow" id="remF">
    <button class="fchip on" data-r="all">All</button>
    <button class="fchip" data-r="true">🌐 Remote</button>
    <button class="fchip" data-r="false">🏢 On-site</button>
  </div>
  <span id="cnt">${jobs.length} jobs</span>
</div>
<div class="grid" id="grid">
${cards}
<p id="noRes">No jobs match — try widening the search.</p>
</div>
<script>
(function(){
  const $=id=>document.getElementById(id),all=[...$('grid').querySelectorAll('.card')];
  let src='',type='',rem='all';
  const srcs=[...new Set(all.map(c=>c.dataset.source).filter(Boolean))];
  const types=[...new Set(all.map(c=>c.dataset.type).filter(Boolean))].slice(0,8);
  srcs.forEach(v=>chip('srcF',v,()=>{src=src===v?'':v;filter();}));
  types.forEach(v=>chip('typeF',v,()=>{type=type===v?'':v;filter();}));
  $('remF').querySelectorAll('[data-r]').forEach(b=>{
    b.onclick=()=>{rem=b.dataset.r;$('remF').querySelectorAll('.fchip').forEach(c=>c.classList.toggle('on',c===b));filter();};
  });
  function chip(pid,label,fn){
    const b=document.createElement('button');b.className='fchip';b.textContent=label;
    b.onclick=()=>{fn();b.classList.toggle('on');filter();};$(pid).appendChild(b);
  }
  function filter(){
    const q=$('search').value.toLowerCase();let n=0;
    all.forEach(c=>{
      const r=c.dataset.remote==='true';
      const ok=(!q||c.textContent.toLowerCase().includes(q))&&(!src||c.dataset.source===src)&&(!type||c.dataset.type===type)&&(rem==='all'||(rem==='true'?r:!r));
      c.classList.toggle('hidden',!ok);if(ok)n++;
    });
    $('cnt').textContent=n+' jobs';$('noRes').style.display=n?'none':'block';
  }
  $('search').addEventListener('input',filter);
})();
</script>
</body>
</html>`;
  fs.writeFileSync(file, html);
}

module.exports = {
  sleep, get, stripHtml, escH,
  TODAY, RUN_STAMP, parseSince, sinceToSeconds, sinceToDays, resolveRelativeDate, jobDate,
  isRemote, matchesLocation,
  applyFilters, parseArgs,
  deduplicate, saveRawCache, buildSuffix, saveCSV, saveHTML,
  LIMIT_MAX, DESC_MAX,
};
