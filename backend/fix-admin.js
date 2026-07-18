// One-shot script: kill all locks on users table, then promote vishalchoudhary3337 to admin
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await c.connect();
  await c.query('SET statement_timeout = 0');

  // Set lock_timeout so we fail fast rather than wait forever if the table is locked
  await c.query('SET lock_timeout = 10000'); // 10 seconds

  // Promote the user — UPDATE only needs ROW EXCLUSIVE lock, much lighter than ALTER TABLE
  const fix = await c.query(`
    UPDATE public.users
    SET role = 'admin', plan = 'advanced'
    WHERE email = 'vishalchoudhary3337@gmail.com'
    RETURNING email, role, plan
  `);
  console.log(fix.rowCount > 0 ? '✓ Fixed:' : '✗ No row found for that email');
  fix.rows.forEach(r => console.log(`  ${r.email}  role=${r.role}  plan=${r.plan}`));

  // Step 3: show all users
  const all = await c.query(`SELECT email, role, plan FROM public.users ORDER BY email`);
  console.log('\nAll users now:');
  all.rows.forEach(r => console.log(`  ${r.email}  role=${r.role}  plan=${r.plan}`));

  await c.end();
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
