'use strict';
const { randomUUID } = require('crypto');
const db = require('../db/database');

/**
 * Write one fully-processed posting to job_postings.
 * Skips if source + external_id already exists.
 * Returns 'stored' | 'skipped'.
 */
async function storeJob(job) {
  const id = randomUUID();
  try {
    await db.prepare(`
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
    `).run(
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
    return 'stored';
  } catch (e) {
    if (e.code === '23505') return 'skipped';
    throw e;
  }
}

module.exports = { storeJob };
