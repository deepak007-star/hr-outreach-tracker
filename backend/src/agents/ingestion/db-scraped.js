'use strict';
const db = require('../../db/database');

/**
 * Internal ingestion source: reads from the scraped_jobs table populated
 * by the existing Playwright scrapers (Naukri, Instahyre, Internshala, etc.).
 * Two passes:
 *   1. Rows that already have contact_email extracted by the scraper.
 *   2. Rows whose description text contains an email pattern (missed by scraper).
 */
module.exports = async function fetchFromScrapedJobsDB(cfg) {
  const days   = cfg?.internal_lookback_days || 60;
  const cutoff = new Date(Date.now() - days * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19);

  // Pass 1: rows already enriched with contact_email by the Naukri/feed scrapers
  const withEmail = await db.prepare(`
    SELECT id, scraper_type, title, company, location, description,
           link, apply_link, contact_email, contact_phone, all_contacts,
           posted_at, scraped_at
    FROM scraped_jobs
    WHERE contact_email IS NOT NULL AND contact_email != ''
    AND scraped_at >= ?
    ORDER BY scraped_at DESC
    LIMIT 600
  `).all(cutoff).catch(e => {
    console.error('[db-scraped] pass-1 query failed:', e.message);
    return [];
  });

  // Pass 2: rows with no stored contact_email but description has an email pattern
  const withEmailInDesc = await db.prepare(`
    SELECT id, scraper_type, title, company, location, description,
           link, apply_link, contact_email, contact_phone, all_contacts,
           posted_at, scraped_at
    FROM scraped_jobs
    WHERE (contact_email IS NULL OR contact_email = '')
    AND description ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'
    AND scraped_at >= ?
    ORDER BY scraped_at DESC
    LIMIT 400
  `).all(cutoff).catch(e => {
    console.error('[db-scraped] pass-2 query failed:', e.message);
    return [];
  });

  const combined = [...withEmail, ...withEmailInDesc];
  console.log(`[db-scraped] fetched ${withEmail.length} pre-extracted + ${withEmailInDesc.length} email-in-desc rows`);

  return combined.map(row => ({
    source:             `scraped:${row.scraper_type || 'unknown'}`,
    external_id:        String(row.id),
    title:              row.title    || '',
    company:            row.company  || '',
    location:           row.location || '',
    description:        (row.description || '').slice(0, 3000),
    apply_url:          row.apply_link || row.link || '',
    posted_at:          (row.posted_at  || row.scraped_at || '').slice(0, 10),
    // Pre-extracted contacts — extraction agent uses these directly, skipping regex/LLM
    _pre_contact_email: row.contact_email || null,
    _pre_contact_phone: row.contact_phone || null,
    _pre_all_contacts:  row.all_contacts  || null,
  }));
};
