'use strict';
/**
 * One-off backfill: purge candidate emails harvested from LinkedIn comment
 * threads, plus the fake phone numbers parsed out of post URLs.
 *
 * Background: scrapers/linkedin-feed.js used to concatenate a LinkedIn post
 * page's raw JSON-LD blob into the text it scanned for contacts. LinkedIn's
 * `SocialMediaPosting` node carries `comment[]` — every reply verbatim — so
 * every job-seeker who commented "Interested! my resume: x@gmail.com" was
 * extracted as if they were the recruiter, then synced into Contacts. The same
 * blob's escaped "\n" pairs glued a stray "n" onto the following address
 * ("nanushkapatil.it@gmail.com"). Separately, the phone regex matched a
 * 10-digit window inside the 19-digit activity id in every post URL.
 *
 * The scrape-time causes are fixed (linkedin-feed.js scrapePage + the shared
 * lib/contactExtract.js filters). This script cleans what already landed in
 * scraped_jobs, job_postings and contacts.
 *
 * Usage:
 *   node scripts/purgeCommentEmails.js            # dry run — reports only
 *   node scripts/purgeCommentEmails.js --apply    # write changes
 */

require('dotenv').config();
const { Pool } = require('pg');
const { filterHrEmails, cleanExtractedEmail, PHONE_RE, URL_RE } = require('../src/lib/contactExtract');

const APPLY = process.argv.includes('--apply');
const pool  = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const log = (...a) => console.log(...a);

/**
 * Drop "\n-glued" duplicates. The raw JSON-LD blob contained literal backslash-n
 * escape pairs; the "n" survived the backslash and attached itself to the front
 * of the following address, so a single real contact was stored twice —
 * "p.priyanka@shrasits.com" AND "np.priyanka@shrasits.com". Only removes an
 * address when the un-prefixed twin is present in the SAME list, so a genuine
 * address that happens to start with "n" is never touched.
 */
function dropGluedDuplicates(emails) {
  const set = new Set(emails);
  return emails.filter(e => {
    const at = e.indexOf('@');
    if (at < 2 || e[0] !== 'n') return true;
    return !set.has(e.slice(1));
  });
}

// Re-run the phone extractor with the fixed (URL-stripped, digit-anchored)
// rules over the text the number should have come from.
function validPhones(list, text) {
  const legit = new Set((String(text || '').replace(URL_RE, ' ').match(PHONE_RE) || [])
    .map(x => x.replace(/[\s.\-]/g, '').replace(/^(?:\+91|0091|91|0)/, '')));
  return (list || []).filter(p => legit.has(String(p).replace(/[\s.\-]/g, '').replace(/^(?:\+91|0091|91|0)/, '')));
}

async function cleanScrapedJobs(client) {
  const { rows } = await client.query(
    `SELECT id, description, link, contact_email, contact_phone, all_contacts
       FROM scraped_jobs
      WHERE scraper_type = 'linkedin-feed'
        AND (contact_email IS NOT NULL OR all_contacts IS NOT NULL)`);

  let changed = 0, emailsDropped = 0, phonesDropped = 0;
  const purged = new Set(), survivors = new Set();

  for (const r of rows) {
    let ac;
    try { ac = JSON.parse(r.all_contacts || '{}'); } catch { ac = {}; }
    const before = [...new Set([r.contact_email, ...(ac.emails || [])].filter(Boolean))]
      .map(cleanExtractedEmail).filter(Boolean);

    // The stored description is the post's own og:description — never the
    // comment thread — so it is the right context for the filter to judge against.
    const kept   = dropGluedDuplicates(filterHrEmails(before, r.description || ''));
    const phones = validPhones(ac.phones, `${r.description || ''} ${r.link || ''}`);

    kept.forEach(e => survivors.add(e));
    const emailDelta = before.filter(e => !kept.includes(e));
    const phoneDelta = (ac.phones || []).filter(x => !phones.includes(x));
    if (!emailDelta.length && !phoneDelta.length) continue;

    emailDelta.forEach(e => purged.add(e));
    emailsDropped += emailDelta.length;
    phonesDropped += phoneDelta.length;
    changed++;

    if (APPLY) {
      await client.query(
        `UPDATE scraped_jobs
            SET contact_email = $2, contact_phone = $3, all_contacts = $4
          WHERE id = $1`,
        [r.id, kept[0] || null, phones[0] || null,
         JSON.stringify({ ...ac, emails: kept, phones })]);
    }
  }
  log(`scraped_jobs   : ${changed}/${rows.length} rows cleaned — ${emailsDropped} emails, ${phonesDropped} phones dropped`);
  return { purged, survivors };
}

async function cleanJobPostings(client) {
  const { rows } = await client.query(
    `SELECT id, description, apply_url, extracted_emails
       FROM job_postings
      WHERE extracted_emails IS NOT NULL AND extracted_emails <> '[]'`);

  let changed = 0, dropped = 0, emptied = 0;
  const purged = new Set(), survivors = new Set(), sample = [];

  for (const r of rows) {
    let list;
    try { list = JSON.parse(r.extracted_emails); } catch { continue; }
    if (!Array.isArray(list) || !list.length) continue;

    const kept  = dropGluedDuplicates(filterHrEmails(list.map(cleanExtractedEmail).filter(Boolean), r.description || ''));
    kept.forEach(e => survivors.add(e));
    const delta = list.filter(e => !kept.includes(e));
    if (!delta.length) continue;
    if (sample.length < 8) sample.push(`  ${(r.apply_url || '').slice(0, 70)}\n    drop: ${delta.join(', ')}\n    keep: ${kept.join(', ') || '(none)'}`);
    delta.forEach(e => purged.add(e));
    dropped += delta.length;
    changed++;
    if (!kept.length) emptied++;

    if (APPLY) {
      await client.query(`UPDATE job_postings SET extracted_emails = $2 WHERE id = $1`,
        [r.id, JSON.stringify(kept)]);
    }
  }
  log(`job_postings   : ${changed}/${rows.length} rows cleaned — ${dropped} emails dropped (${emptied} left with none)`);
  log('sample:\n' + sample.join('\n'));
  return { purged, survivors };
}

// Only remove a contact if it was created BY the pipeline and no surviving
// job posting still vouches for it. A manually-added contact that happens to
// share an address with a purged comment is never touched.
/**
 * Reconcile Contacts against the (now-cleaned) job_postings table rather than
 * against this run's purge set: a pipeline-created contact is only justified by
 * a job posting that still lists its address. That makes the step idempotent
 * and correct even when the column cleanup above ran in an earlier invocation.
 *
 * `survivors` is passed in and unioned with the DB state so a DRY run — which
 * has written nothing yet — still reports the right numbers.
 */
async function cleanContacts(client, purged, survivors) {
  const { rows: referenced } = await client.query(
    `SELECT DISTINCT lower(e.value) AS email
       FROM job_postings jp, json_array_elements_text(jp.extracted_emails::json) e
      WHERE jp.extracted_emails IS NOT NULL AND jp.extracted_emails <> '[]'`);
  const justified = new Set([...referenced.map(r => r.email), ...survivors]);

  const { rows: all } = await client.query(
    `SELECT lower(email) AS email FROM contacts WHERE email_source = 'job-intel'`);
  const doomed = [...new Set(all.map(r => r.email))].filter(e => e && !justified.has(e));

  if (!doomed.length) { log('contacts       : every job-intel contact is still backed by a job posting — none removed'); return; }

  // `status` alone under-reports history: a send that bounced or failed leaves
  // an email_log row while the contact stays 'New', and email_log.contact_id is
  // a FK, so deleting those rows errors out anyway. Treat any logged mail as
  // history.
  const { rows: matched } = await client.query(
    `SELECT c.id, c.email, c.status,
            (SELECT count(*) FROM email_log l WHERE l.contact_id = c.id) AS log_count
       FROM contacts c
      WHERE c.email_source = 'job-intel' AND lower(c.email) = ANY($1::text[])`, [doomed]);

  // Never silently delete a contact with outreach history — that would erase
  // the record of mail we actually sent. Only never-contacted rows go without
  // asking; the rest are listed and need --include-contacted.
  const INCLUDE_CONTACTED = process.argv.includes('--include-contacted');
  const isUntouched = c =>
    (!c.status || String(c.status).toLowerCase() === 'new') && Number(c.log_count) === 0;
  const safe    = matched.filter(isUntouched);
  const touched = matched.filter(c => !isUntouched(c));
  const doomedRows = INCLUDE_CONTACTED ? matched : safe;

  if (APPLY && doomedRows.length) {
    const ids = doomedRows.map(c => c.id);
    // email_log.contact_id is a FK with no cascade — clear the log rows first
    // (only reachable via --include-contacted; the default set has none).
    await client.query(`DELETE FROM email_log WHERE contact_id = ANY($1::text[])`, [ids]);
    await client.query(`DELETE FROM contacts  WHERE id         = ANY($1::text[])`, [ids]);
  }
  log(`contacts       : ${doomedRows.length} job-intel contacts removed (${safe.length} never-contacted` +
      (INCLUDE_CONTACTED ? `, ${touched.length} with history — --include-contacted)` : `)`));
  if (touched.length && !INCLUDE_CONTACTED) {
    log(`  ${touched.length} KEPT because outreach already went out — rerun with --include-contacted to remove:`);
    touched.forEach(c => log(`    ${c.email} [${c.status}, ${c.log_count} logged send(s)]`));
  }
}

(async () => {
  const client = await pool.connect();
  try {
    log(APPLY ? '=== APPLYING CHANGES ===' : '=== DRY RUN (pass --apply to write) ===');
    const a = await cleanScrapedJobs(client);
    const b = await cleanJobPostings(client);
    await cleanContacts(
      client,
      new Set([...a.purged,    ...b.purged]),
      new Set([...a.survivors, ...b.survivors]));
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
