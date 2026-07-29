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
  'wa.me',       // WhatsApp phone links — 91XXXXXXXXXX@wa.me
  't.me',        // Telegram username links
  'bit.ly',      // URL shorteners occasionally scraped as "emails"
];

/**
 * Validates and normalises a raw extracted email string.
 * Rejects: spam domains, no dot in domain (e.g. hr@contact), all-digit local
 * parts (phone numbers), and TLDs > 6 chars (concatenation artefacts like
 * @jgcorp.com.aupostal where "postal" was absorbed because there was no space).
 * Returns the lowercased, trimmed email or null if it should be discarded.
 */
function cleanExtractedEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  if (EMAIL_SPAM.some(s => e.includes(s))) return null;

  const at = e.indexOf('@');
  if (at < 1 || at !== e.lastIndexOf('@')) return null; // no @ or multiple @

  const local  = e.slice(0, at);
  const domain = e.slice(at + 1);

  if (!local || !domain) return null;
  if (!domain.includes('.')) return null;          // e.g. hr@contact (no TLD)

  // Phone numbers masquerading as emails (e.g. 8650032095@wa.me)
  if (/^\d+$/.test(local)) return null;

  // TLD (segment after last dot) must be 2–6 all-letter chars.
  // This rejects absorbed adjacent words like .aupostal (8 chars) while
  // accepting all common gTLDs (.com .net .io .tech) and country codes (.in .au).
  // New gTLDs with 7+ chars (.academy .solutions) are rare in Indian job boards.
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (!/^[a-z]{2,6}$/.test(tld)) return null;

  return e;
}

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
    .map(e => cleanExtractedEmail(e))
    .filter(Boolean);

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

module.exports = { extractContacts, hasOutreachIntent, cleanExtractedEmail, EMAIL_RE, PHONE_RE };
