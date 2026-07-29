'use strict';
const db = require('../../db/database');

/**
 * Internal ingestion source: reads from the linkedin_posts table.
 * This table contains historical Apify data only — no new data is added.
 *
 * When the pipeline has a live scrape (cfg.pipeline_scrape_start), skip
 * rows already present in job_postings (they've been processed before and
 * won't yield new contacts). Only include posts NOT yet in job_postings.
 * On a first run (no pipeline_scrape_start), process all eligible posts.
 */
module.exports = async function fetchFromLinkedinPostsDB(cfg) {
  const days   = cfg?.internal_lookback_days || 60;
  const cutoff = new Date(Date.now() - days * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19);

  // When the pipeline embedded a live scrape, skip already-processed linkedin_posts
  // (they're all ON CONFLICT DO UPDATE — no new contacts come from them).
  // Only skip when we have fresh scraped data to process instead.
  const alreadyProcessedFilter = cfg?.pipeline_scrape_start
    ? `AND id::text NOT IN (SELECT external_id FROM job_postings WHERE source = 'linkedin-posts')`
    : '';

  const rows = await db.prepare(`
    SELECT id, title, description, company_name, author_name,
           author_headline, location, post_url, posted_at, scraped_at
    FROM linkedin_posts
    WHERE (
      description ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'
      OR description ILIKE '%whatsapp%'
      OR description ILIKE '%contact hr%'
      OR description ILIKE '%send resume%'
      OR description ILIKE '%share resume%'
      OR description ILIKE '%drop your cv%'
      OR description ILIKE '%drop your resume%'
      OR description ILIKE '%share your cv%'
      OR description ILIKE '%reach out to%'
      OR description ILIKE '%if interested%'
    )
    AND scraped_at >= ?
    ${alreadyProcessedFilter}
    ORDER BY scraped_at DESC
    LIMIT 2000
  `).all(cutoff).catch(e => {
    console.error('[db-linkedin-posts] query failed:', e.message);
    return [];
  });

  const mode = cfg?.pipeline_scrape_start ? 'unprocessed-only' : 'all';
  console.log(`[db-linkedin-posts] fetched ${rows.length} LinkedIn posts (${mode})`);

  return rows.map(row => ({
    source:           'linkedin-posts',
    external_id:      String(row.id),
    title:            row.title || '',
    company:          row.company_name || '',
    location:         row.location || '',
    description:      (row.description || '').slice(0, 3000),
    apply_url:        row.post_url || '',
    posted_at:        (row.posted_at || row.scraped_at || '').slice(0, 10),
    _author_name:     row.author_name     || null,
    _author_headline: row.author_headline || null,
  }));
};
