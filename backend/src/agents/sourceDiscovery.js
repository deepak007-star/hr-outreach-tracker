'use strict';
const axios = require('axios');
const db = require('../db/database');

const CONFIG_KEY = 'job_intel_config';

// Derive a plausible Greenhouse/Lever slug from a company's own domain —
// "stripe.com" -> "stripe", "boards.plaid.com" -> "plaid" (the label right
// before the TLD is almost always the actual company name).
function slugFromDomain(domain) {
  if (!domain) return null;
  const parts = domain.replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // Drop a compound ccTLD like ".co.in"/".com.au" too, not just the last label
  const dropTwo = parts.length > 2 && ['co', 'com', 'net', 'org'].includes(parts[parts.length - 2]);
  const base = dropTwo ? parts.slice(0, -2) : parts.slice(0, -1);
  const slug = base[base.length - 1];
  return slug && slug.length >= 3 ? slug.toLowerCase() : null;
}

async function probeBoard(url, timeout = 6000) {
  try {
    const { data, status } = await axios.get(url, { timeout, validateStatus: () => true });
    if (status !== 200) return false;
    const jobs = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : [];
    return jobs.length > 0;
  } catch {
    return false;
  }
}

/**
 * Given this run's scanned jobs, look for company domains not already covered
 * by cfg.greenhouse_companies/lever_companies, probe whether that company also
 * has a public Greenhouse/Lever board under the obvious slug, and if so persist
 * it into job_intel_config so future runs pull from it directly. Applies the
 * pipeline's self-healing philosophy (pipelineHealth.js does this for source
 * *failure*) to source *discovery* instead — bounded to a handful of probes
 * per run so it never meaningfully slows a run down.
 */
async function discoverNewCompanyBoards(jobs, cfg, { maxCandidates = 8 } = {}) {
  try {
    const known = new Set(
      [...(cfg.greenhouse_companies || []), ...(cfg.lever_companies || [])].map(s => s.toLowerCase())
    );
    const domains = [...new Set((jobs || []).map(j => j.company_domain).filter(Boolean))];
    const candidates = [];
    for (const domain of domains) {
      const slug = slugFromDomain(domain);
      if (slug && !known.has(slug) && !candidates.includes(slug)) candidates.push(slug);
      if (candidates.length >= maxCandidates) break;
    }
    if (!candidates.length) return { checked: 0, addedGreenhouse: [], addedLever: [] };

    const addedGreenhouse = [], addedLever = [];
    for (const slug of candidates) {
      const [gh, lv] = await Promise.all([
        probeBoard(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`),
        probeBoard(`https://api.lever.co/v0/postings/${slug}?mode=json`),
      ]);
      if (gh) addedGreenhouse.push(slug);
      if (lv) addedLever.push(slug);
    }

    if (addedGreenhouse.length || addedLever.length) {
      const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(CONFIG_KEY).catch(() => null);
      let saved = {};
      try { saved = JSON.parse(row?.value || '{}'); } catch {}
      const merged = {
        ...saved,
        greenhouse_companies: [...new Set([...(saved.greenhouse_companies || cfg.greenhouse_companies || []), ...addedGreenhouse])],
        lever_companies:      [...new Set([...(saved.lever_companies      || cfg.lever_companies      || []), ...addedLever])],
      };
      await db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `).run(CONFIG_KEY, JSON.stringify(merged));
      console.log(`[Pipeline] Source discovery: +Greenhouse [${addedGreenhouse.join(', ') || '—'}] +Lever [${addedLever.join(', ') || '—'}]`);
    }
    return { checked: candidates.length, addedGreenhouse, addedLever };
  } catch (e) {
    console.warn('[sourceDiscovery] failed (non-fatal):', e.message);
    return { checked: 0, addedGreenhouse: [], addedLever: [] };
  }
}

module.exports = { discoverNewCompanyBoards, slugFromDomain };
