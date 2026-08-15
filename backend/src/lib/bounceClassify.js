'use strict';

/**
 * Shared bounce-text classifier — was previously duplicated inline in
 * routes/email.js's classifyBounce(err) (SMTP catch-block only). Extracted
 * so gmail.js can apply the exact same vocabulary to a bounce-notification
 * email's subject/body, which is the only way to detect a bounce at all for
 * Gmail-API sends (see looksLikeBounceNotification below) — the Gmail API
 * accepts a send and only bounces asynchronously via a mailer-daemon
 * message delivered later into the same thread, so there is no synchronous
 * SMTP error to catch the way there is for legacy SMTP sends.
 */

const HARD_PATTERNS = [
  'does not exist', 'no such user', 'user unknown', 'user not found',
  'invalid address', 'invalid recipient', 'bad destination', 'address rejected',
  'recipient rejected', 'mailbox not found', 'mailbox unavailable',
  'no mailbox', 'account does not exist', 'undeliverable', 'non-existent',
  'address invalid', 'no route to host', '5.1.1', '5.1.2',
  // Exchange/Outlook NDR phrasing — "wasn't delivered ... couldn't be found"
  // doesn't share any substring with the patterns above, so a dead address
  // on an O365/Exchange recipient fell through entirely and got treated as
  // a genuine reply (confirmed: this exact phrasing is Microsoft's default
  // NDR wording, not a rare edge case).
  "wasn't delivered", 'was not delivered', "couldn't be found", 'could not be found',
  'recipient not found', 'message blocked', 'delivery incomplete',
];
const SOFT_PATTERNS = [
  'mailbox full', 'quota', 'over quota', 'temporarily', 'try again', 'service unavailable',
  'mailbox is full', // "mailbox full" alone missed the equally common "the recipient's mailbox is full"
];

// text: lowercase-able free text (SMTP response + message, or a bounce
// notification's subject + snippet). code: SMTP response code if known.
// Returns 'hard_bounce' | 'soft_bounce' | null (no bounce signal found).
function classifyBounceText(text, code = 0) {
  const t = (text || '').toLowerCase();
  if (HARD_PATTERNS.some(p => t.includes(p)) || (code >= 550 && code <= 554)) return 'hard_bounce';
  if (SOFT_PATTERNS.some(p => t.includes(p)) || (code >= 400 && code < 500)) return 'soft_bounce';
  if (code >= 500) return 'hard_bounce';
  return null;
}

// Classify a caught SMTP send error (nodemailer err object) — same
// signature/behavior as the original routes/email.js classifyBounce.
function classifyBounce(err) {
  const code = err.responseCode || 0;
  const text = (err.message || '') + ' ' + (err.response || '');
  return classifyBounceText(text, code) || 'failed';
}

const BOUNCE_SENDER_PATTERNS = [
  'mailer-daemon', 'postmaster@', 'mail delivery subsystem', 'delivery status notification',
  'microsoft outlook', 'exchange online protection', 'mail delivery system',
];
// "message not delivered" alone missed Microsoft's actual default wording,
// "Your message wasn't delivered to X" — verified against a real Exchange/
// O365 NDR subject line, which shares no substring with the original list.
const BOUNCE_SUBJECT_RE = /undeliverable|delivery (has |status )?fail|mail delivery (failed|subsystem)|returned to sender|delivery status notification|message (was )?not delivered|message wasn'?t delivered|failure notice|couldn'?t be delivered|could not be delivered/i;

// Does an inbound thread message look like an automated bounce/NDR rather
// than a genuine human reply? Checked BEFORE treating "not from my own
// address" as a reply in gmail.js's syncGmailForUser — without this, a
// bounce notification landing in the same thread as the original send gets
// misdetected as the recipient having replied.
function looksLikeBounceNotification({ from = '', subject = '' } = {}) {
  const f = from.toLowerCase();
  if (BOUNCE_SENDER_PATTERNS.some(p => f.includes(p))) return true;
  return BOUNCE_SUBJECT_RE.test(subject || '');
}

module.exports = { classifyBounce, classifyBounceText, looksLikeBounceNotification };
