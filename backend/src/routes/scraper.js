'use strict';

const express  = require('express');
const { spawn } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const db       = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const SCRAPERS_DIR = path.join(__dirname, '..', 'scrapers');
const OUTPUT_BASE  = path.join(__dirname, '..', 'output');

// Maps scraper key → script path + output dir + category for DB storage
const SCRAPER_CONFIGS = {
  'linkedin-jobs':       { script: 'scrapers/linkedin-jobs.js',      outDir: 'linkedin',      category: 'general'    },
  'naukri':              { script: 'scrapers/naukri.js',              outDir: 'naukri',         category: 'general'    },
  'general':             { script: 'scrapers/general.js',             outDir: 'general',        category: 'remote'     },
  'linkedin-feed':       { script: 'scrapers/linkedin-feed.js',       outDir: 'linkedin-feed',  category: 'cold-email' },
  'linkedin-hr-contact': { script: 'scrapers/linkedin-hr-contact.js', outDir: 'linkedin-hr',    category: 'cold-email' },
};

// ─── Build CLI args from request body ────────────────────────────────────────

function buildArgs(script, body) {
  const { titles = [], since, location, country, city, noRemote, limit, sites } = body;
  const args = [script];
  if (Array.isArray(titles)) titles.forEach(t => args.push(t));
  if (since)                 args.push('--since', since);
  if (location)              args.push('--location', location);
  if (country)               args.push('--country', country);
  if (city)                  args.push('--city', city);
  if (noRemote)              args.push('--no-remote');
  if (limit)                 args.push('--limit', String(limit));
  if (sites && sites.length) args.push('--sites', sites.join(','));
  return args;
}

// ─── Parse latest JSON output file for a scraper and upsert into DB ──────────

async function storeScrapedJobs(scraperType, category, outDir) {
  const dir = path.join(OUTPUT_BASE, outDir);
  if (!fs.existsSync(dir)) return 0;

  // Find the most recent *.json file (raw cache)
  const jsonFiles = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
  if (!jsonFiles.length) return 0;

  let jobs = [];
  try {
    const raw = fs.readFileSync(path.join(dir, jsonFiles[0]), 'utf8');
    jobs = JSON.parse(raw);
    if (!Array.isArray(jobs)) return 0;
  } catch {
    return 0;
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let stored = 0;

  for (const job of jobs) {
    const id = crypto.createHash('sha256')
      .update(`${job.link || job.applyLink || job.title}|${job.company}`)
      .digest('hex')
      .slice(0, 32);

    try {
      await db.prepare(`
        INSERT INTO scraped_jobs (
          id, scraper_type, job_category, title, company, location, job_type,
          salary, experience, tags, description, link, apply_link, posted_at,
          scraped_at, is_remote, contact_email, contact_phone, google_form_link,
          whatsapp_link, all_contacts, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (id) DO UPDATE SET
          email_status   = EXCLUDED.email_status,
          scraped_at     = EXCLUDED.scraped_at
      `).run(
        id, scraperType, category,
        job.title || '', job.company || '', job.location || '',
        job.jobType || '', job.salary || '', job.experience || '',
        job.tags || '', (job.description || '').slice(0, 600),
        job.link || '', job.applyLink || job.link || '',
        job.postedAt || '', job.scrapedAt || now,
        /remote|worldwide|anywhere|global|work from home|wfh/i.test(job.location || '') ? 1 : 0,
        job.contactEmail || null, job.contactPhone || null,
        job.googleFormLink || null, job.whatsappLink || null,
        job.allContacts || null, now
      );
      stored++;
    } catch { /* ignore individual dup errors */ }
  }

  return stored;
}

// ─── POST /api/scraper/run — SSE streaming scrape ─────────────────────────────

router.post('/run', requireAuth, (req, res) => {
  const { scraper } = req.body;
  const cfg = SCRAPER_CONFIGS[scraper];

  if (!cfg) {
    return res.status(400).json({ error: `Unknown scraper: ${scraper}. Valid: ${Object.keys(SCRAPER_CONFIGS).join(', ')}` });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (type, data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 5000);

  const args = buildArgs(cfg.script, req.body);
  const cwd  = path.join(__dirname, '..');

  send('log', `$ node ${args.join(' ')}\n`);

  const proc = spawn('node', args, {
    cwd,
    env: { ...process.env, SCRAPER_NO_OPEN: '1', FORCE_COLOR: '0' },
  });

  proc.stdout.on('data', d => send('log', d.toString('utf8')));
  proc.stderr.on('data', d => send('err', d.toString('utf8')));

  proc.on('close', async (code) => {
    clearInterval(hb);
    let stored = 0;
    if (code === 0) {
      try { stored = await storeScrapedJobs(scraper, cfg.category, cfg.outDir); }
      catch (e) { send('err', `DB store failed: ${e.message}\n`); }
    }
    send('done', { code, stored });
    res.end();
  });

  res.on('close', () => {
    clearInterval(hb);
    if (!proc.killed && proc.exitCode == null) proc.kill();
  });
});

// ─── GET /api/scraper/configs ─────────────────────────────────────────────────

router.get('/configs', (req, res) => {
  res.json(Object.entries(SCRAPER_CONFIGS).map(([key, cfg]) => ({
    key,
    category: cfg.category,
    outDir:   cfg.outDir,
  })));
});

module.exports = router;
module.exports.storeScrapedJobs = storeScrapedJobs;
