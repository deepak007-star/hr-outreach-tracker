'use strict';
/**
 * Unified LinkedIn feed endpoint.
 * Combines two sources into a single response:
 *   - linkedin_posts  (Apify-fetched — rich metadata: author, tech_stack, confidence)
 *   - scraped_jobs    (linkedin-feed Playwright scraper — has contact info: email, phone, forms)
 *
 * Both sources accumulate in the DB; neither is cleared on new fetches.
 * Posts are deduplicated by URL (scraper post wins so contact info is preserved).
 */

const express = require('express');
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

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

router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, hiring_only, since = 'all', limit = '200', page = '1' } = req.query;
    const limitNum = Math.min(parseInt(limit) || 200, 1000);
    const pageNum  = Math.max(parseInt(page)  || 1,   1);

    const daysMap = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30, '90d': 90 };
    const cutoff  = daysMap[since]
      ? new Date(Date.now() - daysMap[since] * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
      : null; // 'all' → no cutoff

    // ── 1. Apify posts ────────────────────────────────────────────────────────
    let apifyPosts = [];
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

    // ── 2. Scraper posts ──────────────────────────────────────────────────────
    let scraperPosts = [];
    try {
      let q = `SELECT * FROM scraped_jobs WHERE scraper_type = 'linkedin-feed'`;
      const params = [];
      if (cutoff) { q += ' AND created_at >= ?'; params.push(cutoff); }
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

    // ── 3. Normalise + merge (scraper wins on same URL, preserves contact info) ─
    const byUrl = new Map();

    // Apify first (lower priority)
    for (const p of apifyPosts) {
      const key = (p.post_url || p.id).trim();
      byUrl.set(key, fromApify(p));
    }

    // Scraper second (higher priority — contact info)
    for (const p of scraperPosts) {
      const key = (p.link || p.id).trim();
      if (byUrl.has(key)) {
        // Merge: keep apify metadata (author, tech_stack, confidence) but add contact info
        const existing = byUrl.get(key);
        byUrl.set(key, {
          ...existing,
          source:           'both',
          contact_email:    p.contact_email    || existing.contact_email,
          contact_phone:    p.contact_phone    || existing.contact_phone,
          google_form_link: p.google_form_link || existing.google_form_link,
          whatsapp_link:    p.whatsapp_link    || existing.whatsapp_link,
          all_contacts:     p.all_contacts     || existing.all_contacts,
          // Use newer scraped_at
          created_at:       p.created_at > existing.created_at ? p.created_at : existing.created_at,
        });
      } else {
        byUrl.set(key, fromScraper(p));
      }
    }

    // Sort newest first, paginate
    const all = [...byUrl.values()]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    const total  = all.length;
    const paged  = all.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      posts: paged,
      total,
      page:   pageNum,
      pages:  Math.ceil(total / limitNum),
      limit:  limitNum,
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
