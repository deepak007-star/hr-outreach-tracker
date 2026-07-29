/**
 * Smart contact name cleaner.
 *
 * Handles the common mess that arrives from CSV imports, job-intel scrapes,
 * LinkedIn feed contacts, Gmail sync, etc.:
 *   - Email addresses stored as the name  ("smouni@deloitte.com" → "Smouni")
 *   - Full names where only first name is wanted  ("John Smith" → "John")
 *   - Role/department labels, not people  ("HR Team" → guess from email)
 *   - Mixed garbage  ("Hiring Manager | Apply Now" → guess from email)
 *
 * Returns a cleaned first name, or '' if nothing sensible can be derived.
 */

// Words that strongly suggest a department/role, not a person's first name.
const ROLE_RE = /^(hr|human|talent|recruit|recruiting|recruiter|hiring|staffing|admin|team|manager|department|noreply|no.reply|careers|jobs|support|info|contact|hello|apply|head|director|chief|executive|officer|vp|president|vice|internship|intern|trainee|fresher|campus|placement|notification|alert|update|newsletter|donotreply|do.not.reply|mailer|postmaster|bounce|automated|bot|system|service|feedback|help|accounts|billing|finance|sales|marketing|growth|partnerships|legal|compliance|operations|engineering|product|design|data|analytics|business|corporate|general|global|regional|india|delhi|mumbai|bangalore|hyderabad|pune|kolkata|chennai)$/i;

/**
 * Derive a first name from an email address local part.
 * e.g. vishal.choudhary@gmail.com → "Vishal"
 *      hr_team@company.com → ""   (role keyword)
 */
function guessFirstNameFromEmail(email) {
  if (!email || !email.includes('@')) return '';
  const local = email.split('@')[0];
  // Take the first segment before any separator (dot, dash, underscore, plus, digits)
  const segment = local.split(/[.\-_+0-9]/)[0];
  const letters = segment.replace(/[^a-zA-Z]/g, '');
  if (!letters || letters.length < 2) return '';
  if (ROLE_RE.test(letters)) return '';
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

/**
 * Clean any incoming name value to a single, properly-cased first name.
 *
 * @param {string} rawName  - Whatever arrived in the name field
 * @param {string} email    - The contact's email (used as fallback)
 * @returns {string}        - First name only, or '' if nothing usable found
 */
function cleanContactName(rawName, email = '') {
  const raw = (rawName || '').trim();

  // Value looks like an email address itself
  if (raw.includes('@')) {
    return guessFirstNameFromEmail(raw) || guessFirstNameFromEmail(email) || '';
  }

  // Nothing provided — try the email
  if (!raw) {
    return guessFirstNameFromEmail(email) || '';
  }

  // Split on common separators and take the first meaningful token
  const firstToken = raw.split(/[\s,.|\/\\()[\];:@&+]+/)[0].trim();
  const letters    = firstToken.replace(/[^a-zA-Z''-]/g, '');

  // Too short to be a real name
  if (letters.length < 2) {
    return guessFirstNameFromEmail(email) || '';
  }

  // Matches a role/department keyword
  if (ROLE_RE.test(letters)) {
    return guessFirstNameFromEmail(email) || '';
  }

  // Preserve natural mixed-case ("McDonald", "O'Brien")
  const isMixedCase = letters !== letters.toUpperCase() && letters !== letters.toLowerCase();
  if (isMixedCase) return letters;

  // Normalize to Title Case
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

module.exports = { cleanContactName, guessFirstNameFromEmail };
