'use strict';
const { randomUUID } = require('crypto');
const db = require('../db/database');

/**
 * Write one fully-processed posting to job_postings.
 * Only persists rows where at least one email was extracted —
 * the pipeline's goal is HR contacts, not a job board.
 * Returns 'inserted' (truly new row) | 'updated' (existing row refreshed) | 'skipped' | 'no_contact'.
 */
async function storeJob(job) {
  // Gate: only keep rows that have a real extracted email
  let emails = [];
  try { emails = JSON.parse(job.extracted_emails || '[]'); } catch {}
  if (!emails.length) return 'no_contact';
  const id = randomUUID();
  try {
    // RETURNING (xmax = 0) AS is_new: xmax=0 means a fresh INSERT; xmax!=0 means ON CONFLICT UPDATE
    const row = await db.prepare(`
      INSERT INTO job_postings (
        id, source, external_id, title, company, company_domain,
        location, description, apply_url, posted_at,
        extracted_emails, extracted_contact_name, extraction_method,
        is_relevant, seniority, classification_confidence, classification_reason,
        fingerprint, duplicate_of,
        needs_review, review_reason
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (source, external_id) DO UPDATE SET
        description           = EXCLUDED.description,
        extracted_emails      = COALESCE(NULLIF(EXCLUDED.extracted_emails,'[]'), job_postings.extracted_emails),
        extracted_contact_name= COALESCE(EXCLUDED.extracted_contact_name, job_postings.extracted_contact_name),
        extraction_method     = COALESCE(EXCLUDED.extraction_method, job_postings.extraction_method),
        is_relevant           = COALESCE(EXCLUDED.is_relevant, job_postings.is_relevant),
        classification_confidence = COALESCE(EXCLUDED.classification_confidence, job_postings.classification_confidence),
        classification_reason = COALESCE(EXCLUDED.classification_reason, job_postings.classification_reason),
        needs_review          = EXCLUDED.needs_review,
        review_reason         = EXCLUDED.review_reason
      RETURNING (xmax = 0) AS is_new
    `).get(
      id,
      job.source,
      job.external_id || id,
      job.title,
      job.company          || '',
      job.company_domain   || null,
      job.location         || '',
      job.description      || '',
      job.apply_url        || '',
      job.posted_at        || null,
      job.extracted_emails || '[]',
      job.extracted_contact_name || null,
      job.extraction_method      || null,
      job.is_relevant != null ? job.is_relevant : null,
      job.seniority        || null,
      job.classification_confidence != null ? job.classification_confidence : null,
      job.classification_reason    || null,
      job.fingerprint      || null,
      job.duplicate_of     || null,
      job.needs_review     || 0,
      job.review_reason    || null,
    );
    return row?.is_new ? 'inserted' : 'updated';
  } catch (e) {
    if (e.code === '23505') return 'skipped';
    throw e;
  }
}

module.exports = { storeJob };
