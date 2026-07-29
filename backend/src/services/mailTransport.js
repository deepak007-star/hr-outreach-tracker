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

// Sends through the Gmail REST API (HTTPS, port 443) instead of raw SMTP.
// Render's free tier blocks outbound SMTP ports; Gmail API rides over HTTPS.
async function sendViaGmailApi(oauthRow, mailOpts) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: decrypt(oauthRow.refresh_token) });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  try {
    const raw = toBase64Url(await buildRawMessage(mailOpts));
    const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return { messageId: data.id };
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    // invalid_grant = refresh token revoked or expired (common after 7 days in
    // Google's Testing mode, or if the user revoked access in their Google account).
    // Clear the dead token immediately so the next send attempt shows a clear
    // "please reconnect" error instead of silently failing forever.
    if (msg.includes('invalid_grant') || err.code === 401 || err.status === 401) {
      try {
        await db.prepare(
          "DELETE FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
        ).run(oauthRow.userId);
      } catch (dbErr) {
        console.error('[mailTransport] Failed to clear stale OAuth token:', dbErr.message);
      }
      const clean = new Error(
        'Google OAuth token expired or revoked. Please reconnect your Google account in Email / SMTP Settings.'
      );
      clean.code = 'OAUTH_EXPIRED';
      throw clean;
    }
    throw err;
  }
}

// Returns { transport, fromEmail, fromName } for userId, falling back to
// legacy SMTP if no OAuth account is connected, or null if nothing is set up.
async function getTransportForUser(userId) {
  const oauthRow = await db.prepare(
    "SELECT user_id, email, refresh_token FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
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
