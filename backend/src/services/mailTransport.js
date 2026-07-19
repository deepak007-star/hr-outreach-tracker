const nodemailer = require('nodemailer');
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

// Returns { transport, fromEmail, fromName } for the given user's connected
// Google account, falling back to the legacy global SMTP settings, or null
// if neither is configured.
async function getTransportForUser(userId) {
  const oauthRow = await db.prepare(
    "SELECT email, refresh_token FROM oauth_accounts WHERE user_id = ? AND provider = 'google'"
  ).get(userId);

  if (oauthRow) {
    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type:         'OAuth2',
        user:         oauthRow.email,
        clientId:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: decrypt(oauthRow.refresh_token),
      },
    });
    return { transport, fromEmail: oauthRow.email, fromName: null };
  }

  // Fall back to a Gmail connected via the separate "Gmail Sync" flow
  // (routes/gmail.js, gmail_tokens table) — different table, same gmail.send
  // scope, so it can send mail even though it wasn't connected through Settings.
  const gmailTokenRow = await db.prepare(
    'SELECT gmail_email, refresh_token FROM gmail_tokens WHERE user_id = ?'
  ).get(userId);

  if (gmailTokenRow) {
    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type:         'OAuth2',
        user:         gmailTokenRow.gmail_email,
        clientId:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: gmailTokenRow.refresh_token,
      },
    });
    return { transport, fromEmail: gmailTokenRow.gmail_email, fromName: null };
  }

  const smtp = await getLegacySmtpConfig();
  if (smtp.host && smtp.user && smtp.pass) {
    return { transport: createLegacyTransport(smtp), fromEmail: smtp.user, fromName: smtp.fromName || null };
  }

  return null;
}

module.exports = { getTransportForUser, getLegacySmtpConfig, createLegacyTransport };
