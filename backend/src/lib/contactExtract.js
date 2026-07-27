'use strict';
/**
 * Shared contact-extraction utilities.
 * Used by the Naukri scraper at scrape-time and by scraped-jobs /feed-contacts
 * when re-processing already-stored descriptions without contacts.
 */

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

// Indian mobile: optional +91/91/0 prefix then 6-9 leading digit, 9 more digits
const PHONE_RE = /(?:(?:\+91|91|0)[\s.\-]?)?[6-9]\d{9}\b/g;

const EMAIL_SPAM = [
  'naukri.com', 'linkedin.com', 'google.com', 'example.com',
  'noreply', 'no-reply', 'donotreply', 'sentry.io', 'amazonaws',
  'privacy@', 'legal@', 'support@', 'info@naukri', 'info@linkedin',
  'jobs@naukri', 'abuse@', 'webmaster@',
];

// Patterns that strongly suggest the post contains an HR's direct contact ask.
// Ordered roughly by signal strength.
const OUTREACH_PATTERNS = [
  /share\s+(me\s+)?(?:your\s+)?(?:resume|cv|profile)/i,
  /send\s+(?:your\s+)?(?:resume|cv|profile)/i,
  /(?:resume|cv|profile)\s+(?:to|at|on)\s+\S+@/i,  // "resume to someone@..."
  /(?:updated\s+)?resume\s+(?:to|at|on)\b/i,
  /mail\s+(?:your\s+)?(?:resume|cv|profile)/i,
  /drop\s+(?:your\s+)?(?:resume|cv|profile)/i,
  /whatsapp\s+(?:your\s+)?(?:resume|cv|profile)/i,
  /share\s+(?:your\s+)?(?:resume|cv)\s+(?:on|at)\b/i,
  /share\s+resume\s+on\b/i,
  /cv\s+to\b/i,
  /if\s+interested[\s,]/i,
  /interested\s+candidates?\s+(?:can|may|please|share)/i,
  /reach\s+(?:out|us|me)\s+(?:at|on|to)\b/i,
  /contact\s+(?:hr|us|me|recruiter)\s+(?:at|on|to)\b/i,
  /apply\s+(?:via|at|to|on)\s+(?:email|mail|whatsapp)/i,
  /walk[\s\-]in\s+interview/i,
  /direct\s+(?:walkin|walk-in|hiring)/i,
  /(?:call|ping)\s+(?:at|on)\s+\+?[0-9]/i,
  /whatsapp\s+(?:at|on|:)\s+\+?[0-9]/i,
  /(?:email|mail)\s+(?:at|to|:)\s+\S+@/i,
];

function hasOutreachIntent(text) {
  return OUTREACH_PATTERNS.some(p => p.test(text));
}

/**
 * Extract emails and Indian phone numbers from free text.
 * Returns { emails, phones, contactEmail, contactPhone, allContacts, hasOutreach }.
 */
function extractContacts(text) {
  if (!text) return { emails: [], phones: [], contactEmail: null, contactPhone: null, allContacts: null, hasOutreach: false };

  const rawEmails = (text.match(EMAIL_RE) || [])
    .filter(e => !EMAIL_SPAM.some(s => e.toLowerCase().includes(s)));

  // Normalise phones: strip separators, require exactly 10 digit suffix after country code
  const rawPhones = (text.match(PHONE_RE) || [])
    .map(p => p.replace(/[\s.\-]/g, ''))
    .filter(p => {
      const stripped = p.replace(/^(?:\+91|91|0)/, '');
      return /^[6-9]\d{9}$/.test(stripped);
    })
    .map(p => {
      // Normalise to +91XXXXXXXXXX
      const stripped = p.replace(/^(?:\+91|91|0)/, '');
      return `+91${stripped}`;
    });

  const emails = [...new Set(rawEmails)];
  const phones = [...new Set(rawPhones)];

  return {
    emails,
    phones,
    contactEmail:  emails[0] || null,
    contactPhone:  phones[0] || null,
    allContacts:   (emails.length || phones.length) ? JSON.stringify({ emails, phones }) : null,
    hasOutreach:   hasOutreachIntent(text),
  };
}

module.exports = { extractContacts, hasOutreachIntent, EMAIL_RE, PHONE_RE };
