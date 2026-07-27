'use strict';

const STRIP_HTML = /<[^>]+>/g;

/**
 * Map any ingestion agent's raw posting to the common job_postings schema.
 * Normalizes fields, strips HTML, ensures consistent date format.
 */
function normalize(raw) {
  const title       = (raw.title       || '').replace(STRIP_HTML, '').trim();
  const company     = (raw.company     || '').replace(STRIP_HTML, '').trim();
  const location    = (raw.location    || '').replace(STRIP_HTML, '').trim();
  const description = (raw.description || '').replace(STRIP_HTML, '').trim().slice(0, 3000);
  const apply_url   = (raw.apply_url   || '').trim();
  const external_id = String(raw.external_id || raw.apply_url || title).slice(0, 512);

  let posted_at = '';
  if (raw.posted_at) {
    const d = new Date(raw.posted_at);
    if (!isNaN(d)) posted_at = d.toISOString().slice(0, 10);
  }

  // Derive company domain from apply_url heuristic
  let company_domain = null;
  try {
    const u = new URL(apply_url);
    company_domain = u.hostname.replace(/^www\./, '');
  } catch (_) {}

  return {
    source:         raw.source   || 'unknown',
    external_id,
    title,
    company,
    company_domain,
    location,
    description,
    apply_url,
    posted_at:      posted_at || null,
  };
}

function normalizeAll(raws) {
  return raws.map(normalize).filter(j => j.title && j.source);
}

module.exports = { normalize, normalizeAll };
