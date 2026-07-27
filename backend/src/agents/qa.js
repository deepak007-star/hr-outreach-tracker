'use strict';

/**
 * Validate a job posting and flag low-quality rows for human review.
 * Returns { needs_review: 0|1, review_reason: string|null }
 */
function qaCheck(job, classResult) {
  const issues = [];

  if (!job.title)   issues.push('missing title');
  if (!job.company) issues.push('missing company');
  if (!job.apply_url && !job.description) issues.push('no URL and no description');

  const conf = classResult?.classification_confidence;
  if (conf != null && conf < 0.55) issues.push(`low classification confidence (${conf.toFixed(2)})`);

  return {
    needs_review: issues.length > 0 ? 1 : 0,
    review_reason: issues.length ? issues.join('; ') : null,
  };
}

module.exports = { qaCheck };
