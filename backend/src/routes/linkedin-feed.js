'use strict';
/**
 * LinkedIn feed endpoint.
 * Primary source: scraped_jobs (linkedin-feed Playwright scraper — has contact info).
 * Optional secondary: linkedin_posts (Apify — rich metadata, no contact info).
 *
 * Default: source=scraper (scraper-only). Pass source=all to include Apify posts.
 */

const express = require('express');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const IST_OFFSET_MS = 19_800_000; // +5:30

// Most recently-passed 7 AM IST boundary, as a 'YYYY-MM-DD HH:MM:SS' UTC string
// (matches the TEXT-column date format used throughout this app). If it's
// currently before 7 AM IST, this is yesterday's 7 AM IST; otherwise today's.
function getIst7amCutoff() {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const istHour   = ist.getUTCHours();
  const todayAt7  = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 7, 0, 0) - IST_OFFSET_MS;
  const boundary  = istHour < 7 ? todayAt7 - 86_400_000 : todayAt7;
  return new Date(boundary).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Normalise ────────────────────────────────────────────────────────────────

function fromApify(p) {
  return {
    id:               p.id,
    source:           'apify',
    title:            p.title            || '',
    company:          p.company_name     || '',
    location:         p.location         || '',
    description:      p.description      || '',
    link:             p.post_url         || '',
    author_name:      p.author_name      || '',
    author_headline:  p.author_headline  || '',
    author_linkedin:  p.author_linkedin  || '',
    tech_stack:       (() => { try { return JSON.parse(p.tech_stack || '[]'); } catch { return []; } })(),
    job_type:         p.job_type         || '',
    confidence_score: p.confidence_score || 0,
    is_hiring:        p.is_hiring        ?? 1,
    likes:            p.likes            || 0,
    comments:         p.comments         || 0,
    status:           p.status           || 'new',
    contact_email:    null,
    contact_phone:    null,
    google_form_link: null,
    whatsapp_link:    null,
    all_contacts:     null,
    created_at:       p.scraped_at || '',
  };
}

function fromScraper(p) {
  return {
    id:               p.id,
    source:           'scraper',
    title:            p.title            || '',
    company:          p.company          || '',
    location:         p.location         || '',
    description:      p.description      || '',
    link:             p.link             || '',
    author_name:      '',
    author_headline:  '',
    author_linkedin:  '',
    tech_stack:       [],
    job_type:         p.job_type         || '',
    confidence_score: null,
    is_hiring:        1,
    likes:            0,
    comments:         0,
    status:           null,
    contact_email:    p.contact_email    || null,
    contact_phone:    p.contact_phone    || null,
    google_form_link: p.google_form_link || null,
    whatsapp_link:    p.whatsapp_link    || null,
    all_contacts:     p.all_contacts     || null,
    created_at:       p.created_at       || '',
  };
}

// ─── GET /api/linkedin-feed ───────────────────────────────────────────────────
// Query: search, hiring_only (true|false), since (7d|30d|90d|all), limit, page

// source param: 'scraper' (default) = scraper-only; 'all' = scraper + Apify merged
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, hiring_only, since = 'today', limit = '200', page = '1', source = 'scraper' } = req.query;
    const limitNum   = Math.min(parseInt(limit) || 200, 1000);
    const pageNum    = Math.max(parseInt(page)  || 1,   1);
    const includeApify = source === 'all';

    const daysMap = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30, '90d': 90 };
    const cutoff  = since === 'today'
      ? getIst7amCutoff()
      : daysMap[since]
        ? new Date(Date.now() - daysMap[since] * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
        : null;

    // ── 1. Scraper posts (always fetched — primary source) ────────────────────
    let scraperPosts = [];
    try {
      let q = `SELECT * FROM scraped_jobs WHERE scraper_type = 'linkedin-feed'`;
      const params = [];
      // scraped_at (last confirmed still-live), not created_at (first-ever-seen) —
      // same fix as routes/scraped-jobs.js: a post re-surfacing in search results
      // days after it was first found should still count as "today" if rescraped today.
      if (cutoff) { q += ' AND scraped_at >= ?'; params.push(cutoff); }
      if (search) {
        q += ' AND (title ILIKE ? OR company ILIKE ? OR description ILIKE ? OR contact_email ILIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }
      q += ' ORDER BY created_at DESC LIMIT 2000';
      scraperPosts = await db.prepare(q).all(...params);
    } catch (e) {
      console.error('[linkedin-feed] scraper query failed:', e.message);
    }

    // ── 2. Apify posts (optional secondary source) ────────────────────────────
    let apifyPosts = [];
    if (includeApify) {
      try {
        let q = 'SELECT * FROM linkedin_posts WHERE 1=1';
        const params = [];
        if (hiring_only === 'true') { q += ' AND is_hiring = 1'; }
        if (cutoff) { q += ' AND scraped_at >= ?'; params.push(cutoff); }
        if (search) {
          q += ' AND (title ILIKE ? OR description ILIKE ? OR company_name ILIKE ? OR author_name ILIKE ?)';
          const s = `%${search}%`;
          params.push(s, s, s, s);
        }
        q += ' ORDER BY scraped_at DESC LIMIT 2000';
        apifyPosts = await db.prepare(q).all(...params);
      } catch (e) {
        console.error('[linkedin-feed] apify query failed:', e.message);
      }
    }

    // ── 3. Build map: scraper first (primary), Apify supplements where no URL match ─
    const byUrl = new Map();

    // Scraper first (primary — wins on all conflicts)
    for (const p of scraperPosts) {
      const key = (p.link || p.id).trim();
      byUrl.set(key, fromScraper(p));
    }

    // Apify second (only adds posts NOT already found by scraper)
    if (includeApify) {
      for (const p of apifyPosts) {
        const key = (p.post_url || p.id).trim();
        if (byUrl.has(key)) {
          // Enrich existing scraper post with Apify metadata (author, tech_stack, etc.)
          const existing = byUrl.get(key);
          byUrl.set(key, {
            ...fromApify(p),
            source:           'both',
            // Preserve scraper contact info
            contact_email:    existing.contact_email    || null,
            contact_phone:    existing.contact_phone    || null,
            google_form_link: existing.google_form_link || null,
            whatsapp_link:    existing.whatsapp_link    || null,
            all_contacts:     existing.all_contacts     || null,
            created_at:       existing.created_at > (p.scraped_at || '') ? existing.created_at : (p.scraped_at || ''),
          });
        } else {
          byUrl.set(key, fromApify(p));
        }
      }
    }

    // Sort newest first, paginate
    const all   = [...byUrl.values()].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const total = all.length;
    const paged = all.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      posts:          paged,
      total,
      page:           pageNum,
      pages:          Math.ceil(total / limitNum),
      limit:          limitNum,
      source_filter:  source,
    });
  } catch (err) {
    console.error('[linkedin-feed]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/linkedin-feed/:id/status — update apify post status ───────────
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const VALID = ['new', 'viewed', 'contacted', 'applied', 'rejected'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    await db.prepare('UPDATE linkedin_posts SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
