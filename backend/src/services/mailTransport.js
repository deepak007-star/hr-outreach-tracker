const nodemailer     = require('nodemailer');
const MailComposer   = require('nodemailer/lib/mail-composer');
const { google }     = require('googleapis');
const db = require('../db/database');
const { decrypt } = require('./tokenCrypto');

async function getLegacySmtpConfig() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'smtp_config'").get();
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}

function createLegacyTransport(smtp) {
  return nodemailer.createTransport({
    host:   smtp.host,
    port:   parseInt(smtp.port) || 587,
    secure: String(smtp.port) === '465',
    auth:   { user: smtp.user, pass: smtp.pass },
    tls:    { rejectUnauthorized: false },
  });
}

// Builds the same RFC822 message nodemailer's SMTP transport would send,
// without opening an SMTP connection — reuses mailOpts (from/to/subject/
// text/html/attachments) as-is so callers don't need to change anything.
function buildRawMessage(mailOpts) {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOpts).compile().build((err, message) => {
      if (err) return reject(err);
      resolve(message);
    });
  });
}

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Sends through the Gmail REST API (HTTPS, port 443) instead of raw SMTP
// (ports 25/465/587). Render's free web-service tier blocks all outbound
// SMTP ports as of Sept 2025, which made every send here fail with a
// generic "Connection timeout" regardless of OAuth vs. legacy SMTP creds —
// the Gmail API rides over normal HTTPS so it isn't affected.
// Note: gmail.send only reports synchronous failures (bad auth, malformed
// message); a bounce for a nonexistent recipient now arrives later as an
// email in the inbox rather than as an error from this call.
async function sendViaGmailApi(oauthRow, mailOpts) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: decrypt(oauthRow.refresh_token) });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const raw = toBase64Url(await buildRawMessage(mailOpts));
  const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { messageId: data.id };
}

// Returns { transport, fromEmail, fromName } for the given user's connected
// Google account, falling back to the legacy global SMTP settings, or null
// if neither is configured. `transport.sendMail(mailOpts)` works the same
// way regardless of which path was used.
async function getTransportForUser(userId) {
  const oauthRow = await db.prepare(
    "SELECT email, refresh_token FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
  ).get(userId);

  if (oauthRow) {
    return {
      transport: { sendMail: (mailOpts) => sendViaGmailApi(oauthRow, mailOpts) },
      fromEmail: oauthRow.email,
      fromName:  null,
    };
  }

  const smtp = await getLegacySmtpConfig();
  if (smtp.host && smtp.user && smtp.pass) {
    return { transport: createLegacyTransport(smtp), fromEmail: smtp.user, fromName: smtp.fromName || null };
  }

  return null;
}

module.exports = { getTransportForUser, getLegacySmtpConfig, createLegacyTransport };
