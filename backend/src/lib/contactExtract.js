'use strict';
/**
 * Shared contact-extraction utilities.
 * Used by the Naukri scraper at scrape-time and by scraped-jobs /feed-contacts
 * when re-processing already-stored descriptions without contacts.
 */

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

// Indian mobile: optional +91/91/0 prefix then 6-9 leading digit, 9 more digits.
// The `(?<!\d)` / `(?!\d)` guards are load-bearing: `\b` alone happily matches a
// 10-digit WINDOW inside a longer digit run, so every LinkedIn post URL
// (…-activity-7495869545585459201-mYSw) was yielding a bogus "phone" of
// 7495869545. Anchoring both ends to a non-digit rejects the whole run instead.
const PHONE_RE = /(?<!\d)(?:(?:\+91|91|0)[\s.\-]?)?[6-9]\d{9}(?!\d)/g;

// URLs carry long numeric ids (LinkedIn activity ids, job ids, tracking params)
// that look exactly like phone numbers once the surrounding punctuation is
// stripped. Blank them out before phone matching — never before email matching,
// since mailto: links and plain-text addresses live inside that same text.
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

// Shared across both regex extraction (this file) and the apply-page deep-fetch
// scan (agents/deepFetch.js) — keep this the single source of truth for
// "looks like an email but isn't a real HR contact" so the two don't drift.
const EMAIL_SPAM = [
  'naukri.com', 'linkedin.com', 'google.com', 'example.com',
  'noreply', 'no-reply', 'donotreply', 'sentry.io', 'amazonaws',
  'privacy@', 'legal@', 'support@', 'info@naukri', 'info@linkedin',
  'jobs@naukri', 'abuse@', 'webmaster@', 'postmaster@',
  'wa.me',       // WhatsApp phone links — 91XXXXXXXXXX@wa.me
  't.me',        // Telegram username links
  'bit.ly',      // URL shorteners occasionally scraped as "emails"
  // Page-chrome / tracking / CDN noise picked up when scanning full HTML pages
  'wixpress', 'w3.org', 'schema.org', 'godaddy', 'cloudflare',
  // ATS system addresses — real, deliverable, but not an HR contact
  'greenhouse.io', 'lever.co', 'myworkday.com', 'successfactors', 'bamboohr.com', 'workable.com',
];

// Placeholder / form-boilerplate emails. Job boards very commonly render an
// "enter your email for job alerts" widget with a pre-filled EXAMPLE value —
// e.g. Adzuna's apply-page interstitial shows "your.name@email.com" as the
// input's visible text before you type anything. That's page chrome, not a
// real HR contact, but scanning the raw page HTML (deepFetch.js) or a search
// snippet catches it exactly like a real address would. Matched against the
// FULL local part (before @) so a genuine short/real local part like
// "raj@company.com" is never caught by this — only the well-known
// placeholder tokens are.
const PLACEHOLDER_LOCAL_RE = /^(your[.\-_]?(name|email|address|id)?|you|email|e-?mail|test|demo|sample|dummy|username|firstname|lastname|first[.\-_]?last(?:name)?|john[.\-_]?doe|jane[.\-_]?doe|foo|bar|foobar|abc|xyz|someone|placeholder|enter[.\-_]?your[.\-_]?email|name)$/i;

// Domains used as generic form placeholders across job boards / templates —
// never a real employer's mail domain.
const PLACEHOLDER_DOMAINS = new Set([
  'email.com', 'example.com', 'example.org', 'example.net',
  'yourcompany.com', 'company.com', 'domain.com', 'test.com',
  'sample.com', 'yourdomain.com', 'website.com', 'acme.com',
]);

// Filename/asset extensions that are NOT real TLDs but are short enough to
// pass the TLD-length check below — e.g. a retina image filename like
// "logo@2x.png" syntactically matches the email regex (local="logo",
// domain="2x.png", "png" reads as a plausible 3-letter TLD).
const ASSET_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff',
  'css', 'js', 'woff', 'woff2', 'ttf', 'eot',
]);

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

  // Form-placeholder / example addresses (see PLACEHOLDER_LOCAL_RE/DOMAINS above)
  if (PLACEHOLDER_LOCAL_RE.test(local)) return null;
  if (PLACEHOLDER_DOMAINS.has(domain)) return null;

  // TLD (segment after last dot) must be 2–6 all-letter chars.
  // This rejects absorbed adjacent words like .aupostal (8 chars) while
  // accepting all common gTLDs (.com .net .io .tech) and country codes (.in .au).
  // New gTLDs with 7+ chars (.academy .solutions) are rare in Indian job boards.
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (!/^[a-z]{2,6}$/.test(tld)) return null;
  if (ASSET_EXTENSIONS.has(tld)) return null; // e.g. "logo@2x.png" — not a real TLD

  return e;
}

// ── HR-vs-candidate email disambiguation ─────────────────────────────────────
// A hiring post is followed by a comment thread in which CANDIDATES post their
// own address ("Interested! my resume — foo@gmail.com"). Any full-page scan
// mixes those in with the recruiter's address indistinguishably, and they are
// the worst possible thing to end up in Contacts: outreach mail then goes to
// fellow job-seekers. The scrapers now cut the comment thread off at the source
// (see scrapers/linkedin-feed.js's scrapePage), but search-engine snippets,
// deep-fetched board pages and re-processed legacy rows can still carry it, so
// this is the shared last-line filter every extraction path runs through.

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com',
  'rediffmail.com', 'rediff.com', 'icloud.com', 'me.com',
  'proton.me', 'protonmail.com', 'yandex.com', 'mail.ru', 'gmx.com',
]);

function isFreeMail(email) {
  const at = (email || '').lastIndexOf('@');
  return at > 0 && FREE_MAIL_DOMAINS.has(email.slice(at + 1));
}

// Unambiguous candidate-side ("I am applying") phrasing. Deliberately does NOT
// include a bare "interested" — recruiters write "if interested, mail hr@x.com"
// just as often as candidates write "interested".
const CANDIDATE_SPEAK_RE = /(my\s+(?:resume|cv|profile|mail|e-?mail|id|details|contact|number)\b|sharing\s+my\b|here\s+(?:is|are)\s+my\b|(?:please|kindly)\s+(?:do\s+)?(?:consider|review|check)\s+(?:me|my)\b|i\s*(?:'m|’m|\s+am)\s+interested\b|i\s+have\s+applied\b|pfa\s+my\b|attaching\s+my\b|looking\s+for\s+(?:a\s+)?(?:job|opportunit))/i;

// A genuine hiring post lists one contact address, occasionally two. Three or
// more FREE-MAIL addresses in one posting is the signature of a harvested
// comment thread, not a recruiter — drop every free-mail address in that case
// and keep only company-domain ones (which a comment thread rarely produces).
const FREE_MAIL_FLOOD = 3;
const MAX_HR_EMAILS   = 3;
const CONTEXT_WINDOW  = 160;

/**
 * Narrow a list of extracted emails down to the ones plausibly belonging to the
 * person doing the hiring. `text` is the source the emails came from (used for
 * the per-email context check); omit it to apply the count heuristic only.
 */
function filterHrEmails(emails, text = '') {
  if (!Array.isArray(emails) || emails.length <= 1) return emails || [];

  const flood = emails.filter(isFreeMail).length >= FREE_MAIL_FLOOD;
  const lower = (text || '').toLowerCase();

  const kept = emails.filter(e => {
    if (!isFreeMail(e)) return true;   // company domain — a commenter almost never has one
    if (flood) return false;
    const at = lower.indexOf(e);
    if (at < 0) return true;           // can't locate it in the source — no basis to judge
    return !CANDIDATE_SPEAK_RE.test(lower.slice(Math.max(0, at - CONTEXT_WINDOW), at + CONTEXT_WINDOW));
  });

  return kept.slice(0, MAX_HR_EMAILS);
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
  const rawPhones = (text.replace(URL_RE, ' ').match(PHONE_RE) || [])
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

  const emails = filterHrEmails([...new Set(rawEmails)], text);
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

module.exports = {
  extractContacts, hasOutreachIntent, cleanExtractedEmail,
  filterHrEmails, isFreeMail,
  EMAIL_RE, PHONE_RE, URL_RE,
};
