// Set a new password for a user directly in the database.
//
// The app has no forgot-password route, and accounts created via "Sign in with
// Google" get a deliberately random password_hash (see routes/oauth.js), so
// password login is impossible for them until a real password is set here.
//
//   node scripts/reset-password.js <email> <newPassword>
//   node scripts/reset-password.js --list
//
// WARNING: backend/.env points DATABASE_URL at the shared Supabase instance
// that production (Render + Vercel) also uses. A password changed here changes
// it everywhere, and bumping token_version signs the account out of all
// existing sessions, including the live site.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const MIN_LENGTH = 6; // matches routes/auth.js
const BCRYPT_ROUNDS = 10; // matches routes/auth.js

function connect() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
}

async function list(client) {
  const { rows } = await client.query(`
    SELECT u.email, u.role, u.plan,
           (o.user_id IS NOT NULL) AS google_linked
      FROM users u
      LEFT JOIN oauth_accounts o
        ON o.user_id = u.id AND o.provider = 'google'
     ORDER BY u.created_at
  `);
  console.log('\nAccounts:\n');
  for (const r of rows) {
    const google = r.google_linked ? 'google-linked' : 'password-only';
    console.log(`  ${r.email.padEnd(46)} ${r.role.padEnd(6)} ${r.plan.padEnd(9)} ${google}`);
  }
  console.log(
    '\n"google-linked" accounts were created through Google sign-in and have a\n' +
    'random password_hash — they cannot log in with a password until you set one.\n'
  );
}

async function main() {
  const [emailArg, newPassword] = process.argv.slice(2);

  const client = connect();
  await client.connect();

  try {
    if (emailArg === '--list' || !emailArg) {
      await list(client);
      if (!emailArg) {
        console.log('Usage: node scripts/reset-password.js <email> <newPassword>');
        process.exitCode = 1;
      }
      return;
    }

    if (!newPassword) {
      console.error('Missing <newPassword>.');
      console.error('Usage: node scripts/reset-password.js <email> <newPassword>');
      process.exitCode = 1;
      return;
    }

    if (newPassword.length < MIN_LENGTH) {
      console.error(`Password must be at least ${MIN_LENGTH} characters (the app rejects shorter).`);
      process.exitCode = 1;
      return;
    }

    const email = emailArg.trim().toLowerCase();
    const { rows } = await client.query(
      'SELECT id, email, role FROM users WHERE LOWER(email) = $1',
      [email]
    );

    if (rows.length === 0) {
      console.error(`No account found for "${emailArg}".`);
      console.error('Run with --list to see the exact addresses on file.');
      process.exitCode = 1;
      return;
    }

    const user = rows[0];
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Bump token_version so existing sessions are invalidated, matching the
    // behaviour of PUT /api/auth/change-password.
    const updated = await client.query(
      `UPDATE users
          SET password_hash = $1, token_version = token_version + 1
        WHERE id = $2
    RETURNING email, role, token_version`,
      [hash, user.id]
    );

    const row = updated.rows[0];
    console.log(`\n✓ Password updated for ${row.email} (role=${row.role})`);
    console.log(`  token_version is now ${row.token_version} — all existing sessions signed out.`);
    console.log('  You can now log in with this email and the password you just set.\n');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
