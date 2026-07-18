require('dotenv').config();
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;
console.log('Testing connection to:', connectionString.replace(/:([^:@]+)@/, ':***@'));

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  console.log('Connecting...');
  await client.connect();
  console.log('Connected!');

  await client.query('SET statement_timeout = 0');
  console.log('Timeout disabled');

  // Check existing tables
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log('Tables in public schema:', tables.rows.map(r => r.table_name));

  // Kill any still-blocking sessions first
  const killed = await client.query(`
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE pid != pg_backend_pid() AND state IN ('active','idle in transaction')
      AND query ILIKE '%ALTER TABLE users%'
  `);
  if (killed.rowCount > 0) console.log(`Killed ${killed.rowCount} remaining blocking sessions`);
  await new Promise(r => setTimeout(r, 1500));

  // Show all users
  const users = await client.query(`SELECT email, role, plan FROM public.users ORDER BY email`);
  console.log('Users before fix:');
  users.rows.forEach(u => console.log(`  ${u.email}  role=${u.role}  plan=${u.plan}`));

  // Fix: promote vishalchoudhary3337@gmail.com to admin + advanced
  const fix = await client.query(
    `UPDATE public.users SET role='admin', plan='advanced' WHERE email='vishalchoudhary3337@gmail.com' RETURNING email, role, plan`
  );
  if (fix.rowCount > 0) {
    console.log('Fixed:', fix.rows[0]);
  } else {
    console.log('No row matched vishalchoudhary3337@gmail.com');
  }

  // Verify
  const after = await client.query(`SELECT email, role, plan FROM public.users ORDER BY email`);
  console.log('Users after fix:');
  after.rows.forEach(u => console.log(`  ${u.email}  role=${u.role}  plan=${u.plan}`));

  await client.end();
  console.log('Done.');
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
