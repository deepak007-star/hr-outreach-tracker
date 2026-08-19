'use strict';
const db = require('../db/database');
const { cleanExtractedEmail } = require('../lib/contactExtract');

/**
 * Extraction-quality agent — runs once per pipeline run, after storage/sync.
 *
 * Static rules (lib/contactExtract.js's cleanExtractedEmail) catch KNOWN
 * placeholder patterns (your.name@, xyz@, example.com, ...) at extraction
 * time. This agent catches what static rules can't know in advance: it looks
 * back over what actually got extracted and sent, finds repeated/suspicious
 * patterns, and learns a persisted blocklist so the SAME mistake is never
 * repeated on a later run — this is the "don't scrape the same junk twice"
 * loop the static filter alone can't provide.
 *
 * Two independent anomaly signals:
 *  1. Cross-company reuse — the same address shows up as the "HR contact" for
 *     many unrelated companies in a short window. A real recruiter's inbox
 *     belongs to one employer; an address reused across 5+ companies is
 *     almost always page chrome (job-alert widget, shared contact-form
 *     address, an example value baked into a template) rather than a person.
 *  2. Bounce/flag correlation — pipeline-sourced contacts (job-intel,
 *     linkedin-feed, naukri) whose address later hard-bounced ("address not
 *     found") or got cross-user-flagged. That's a real-world confirmation the
 *     address was never deliverable — feed it back so it's never re-added.
 *
 * Persisted in the `settings` table (same pattern as pipelineHealth.js) —
 * no new table needed.
 */

const BLOCKLIST_KEY      = 'extraction_blocklist';
const QUALITY_REPORT_KEY = 'extraction_quality_report';

async function getBlocklist() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(BLOCKLIST_KEY).catch(() => null);
  try {
    const parsed = JSON.parse(row?.value || '{}');
    return { emails: parsed.emails || {}, domains: parsed.domains || {} };
  } catch {
    return { emails: {}, domains: {} };
  }
}

async function saveBlocklist(bl) {
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(BLOCKLIST_KEY, JSON.stringify(bl));
}

/**
 * Filter a list of already-cleaned email addresses against the learned
 * blocklist. Called by the orchestrator right after extractFromJob(), before
 * a job is stored/synced — this is the enforcement half of the loop; the
 * learning half is learnFromAnomalies() below.
 */
async function filterBlocked(emails) {
  if (!emails?.length) return emails;
  const bl = await getBlocklist();
  if (!Object.keys(bl.emails).length && !Object.keys(bl.domains).length) return emails;
  return emails.filter(e => {
    const domain = (e.split('@')[1] || '').toLowerCase();
    return !bl.emails[e] && !bl.domains[domain];
  });
}

async function isBlocked(rawEmail) {
  const clean = cleanExtractedEmail(rawEmail);
  if (!clean) return true; // already invalid per static rules
  const bl = await getBlocklist();
  const domain = clean.split('@')[1];
  return !!(bl.emails[clean] || bl.domains[domain]);
}

// ── Learning pass ────────────────────────────────────────────────────────────
async function learnFromAnomalies({ lookbackDays = 14, minCompanies = 5 } = {}) {
  const bl = await getBlocklist();
  const now = new Date().toISOString();
  const added = [];

  // Signal 1: one address reused across many unrelated companies
  try {
    const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const rows = await db.prepare(`
      SELECT extracted_emails, company FROM job_postings
      WHERE extracted_emails IS NOT NULL AND extracted_emails != '[]' AND fetched_at >= ?
    `).all(cutoff);

    const perEmailCompanies = new Map(); // email -> Set(company)
    for (const r of rows) {
      let emails = [];
      try { emails = JSON.parse(r.extracted_emails); } catch { /* skip malformed row */ }
      const company = (r.company || '').trim().toLowerCase();
      if (!company) continue;
      for (const raw of emails) {
        const e = cleanExtractedEmail(raw);
        if (!e) continue;
        if (!perEmailCompanies.has(e)) perEmailCompanies.set(e, new Set());
        perEmailCompanies.get(e).add(company);
      }
    }
    for (const [email, companies] of perEmailCompanies) {
      if (companies.size >= minCompanies && !bl.emails[email]) {
        bl.emails[email] = {
          reason: `Reused across ${companies.size} unrelated companies in ${lookbackDays}d — likely page chrome / placeholder, not a real HR inbox`,
          hitCount: companies.size,
          firstSeen: now,
        };
        added.push({ type: 'email', value: email, reason: bl.emails[email].reason });
      }
    }
  } catch (e) {
    console.warn('[ExtractionQuality] cross-company signal failed:', e.message);
  }

  // Signal 2: pipeline-sourced contacts that hard-bounced or got flagged
  try {
    const rows = await db.prepare(`
      SELECT email, email_deliverable, bounce_reason FROM contacts
      WHERE email_source IN ('job-intel', 'linkedin-feed', 'naukri')
        AND email_deliverable IN ('hard_bounce', 'flagged')
    `).all();
    for (const r of rows) {
      const e = (r.email || '').toLowerCase().trim();
      if (!e || bl.emails[e]) continue;
      bl.emails[e] = {
        reason: `${r.email_deliverable}${r.bounce_reason ? ` — ${r.bounce_reason}` : ''} (confirmed by a real send attempt)`,
        hitCount: 1,
        firstSeen: now,
      };
      added.push({ type: 'email', value: e, reason: bl.emails[e].reason });
    }
  } catch (e) {
    console.warn('[ExtractionQuality] bounce-correlation signal failed:', e.message);
  }

  if (added.length) {
    await saveBlocklist(bl);
    console.log(`[ExtractionQuality] Learned ${added.length} new blocked address(es) — blocklist now ${Object.keys(bl.emails).length} email(s), ${Object.keys(bl.domains).length} domain(s)`);
  }
  return { added, blocklistSize: Object.keys(bl.emails).length + Object.keys(bl.domains).length };
}

// ── Flagged-count reconciliation ─────────────────────────────────────────────
// "flagged" = this address hard-bounced for ANY user, so every OTHER user
// holding the same address gets marked flagged too (see routes/email.js).
// One real bounce can therefore fan out into several flagged rows — expected,
// but worth surfacing the breakdown so a wrong-looking count is checkable
// instead of taken on faith.
async function reconcileFlaggedCounts() {
  const bySource = await db.prepare(`
    SELECT email_source, email_deliverable, COUNT(*) AS n
    FROM contacts
    WHERE email_deliverable IN ('flagged', 'hard_bounce', 'soft_bounce')
    GROUP BY email_source, email_deliverable
    ORDER BY n DESC
  `).all();

  const distinct = await db.prepare(`
    SELECT COUNT(DISTINCT LOWER(email)) AS n FROM contacts WHERE email_deliverable = 'flagged'
  `).get();
  const total = await db.prepare(`
    SELECT COUNT(*) AS n FROM contacts WHERE email_deliverable = 'flagged'
  `).get();

  const report = {
    ts: new Date().toISOString(),
    bySource: bySource.map(r => ({ ...r, n: parseInt(r.n) })),
    distinctFlaggedEmails: parseInt(distinct?.n || 0),
    totalFlaggedRows: parseInt(total?.n || 0),
    fanOutRatio: distinct?.n ? +(parseInt(total.n) / parseInt(distinct.n)).toFixed(2) : 0,
  };
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(QUALITY_REPORT_KEY, JSON.stringify(report));
  return report;
}

module.exports = {
  getBlocklist, filterBlocked, isBlocked,
  learnFromAnomalies, reconcileFlaggedCounts,
  BLOCKLIST_KEY, QUALITY_REPORT_KEY,
};
