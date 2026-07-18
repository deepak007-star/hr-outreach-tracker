const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hr_outreach_tracker';
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// SQLite's datetime('now') produced 'YYYY-MM-DD HH:MM:SS' in UTC — match that
// format so every route that slices/compares these columns as plain text
// keeps working unchanged.
const NOW_EXPR = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function makeStmt(sql) {
  const pgSql = toPgSql(sql);
  return {
    async run(...params) {
      const result = await pool.query(pgSql, params);
      return { changes: result.rowCount };
    },
    async get(...params) {
      const result = await pool.query(pgSql, params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await pool.query(pgSql, params);
      return result.rows;
    },
  };
}

let ready = false;

const db = {
  async exec(sql) { await pool.query(sql); return db; },
  prepare(sql) { return makeStmt(sql); },
};

// ── Proxy so routes can do: const db = require('../db/database') unchanged ─
const proxy = new Proxy({}, {
  get(_, prop) {
    if (prop === 'initialize') return initialize;
    if (!ready) throw new Error('Database not initialised yet');
    return db[prop];
  },
});

async function initialize() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      title             TEXT,
      company           TEXT,
      email             TEXT UNIQUE NOT NULL,
      email_source      TEXT NOT NULL DEFAULT 'manual',
      email_confidence  TEXT NOT NULL DEFAULT 'unknown',
      source_url        TEXT,
      status            TEXT NOT NULL DEFAULT 'New',
      date_added        TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      date_last_contacted TEXT,
      notes             TEXT,
      tags              TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS email_log (
      id            TEXT PRIMARY KEY,
      contact_id    TEXT REFERENCES contacts(id),
      sent_at       TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      subject       TEXT,
      body_snapshot TEXT,
      opened        INTEGER NOT NULL DEFAULT 0,
      bounced       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      type       TEXT NOT NULL DEFAULT 'info',
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS linkedin_posts (
      id               TEXT PRIMARY KEY,
      raw_json         TEXT NOT NULL DEFAULT '{}',
      title            TEXT NOT NULL DEFAULT '',
      description      TEXT NOT NULL DEFAULT '',
      company_name     TEXT NOT NULL DEFAULT '',
      author_name      TEXT NOT NULL DEFAULT '',
      author_headline  TEXT NOT NULL DEFAULT '',
      author_linkedin  TEXT NOT NULL DEFAULT '',
      location         TEXT NOT NULL DEFAULT '',
      job_type         TEXT NOT NULL DEFAULT '',
      tech_stack       TEXT NOT NULL DEFAULT '[]',
      post_url         TEXT NOT NULL DEFAULT '',
      posted_at        TEXT NOT NULL DEFAULT '',
      likes            INTEGER NOT NULL DEFAULT 0,
      comments         INTEGER NOT NULL DEFAULT 0,
      is_hiring        INTEGER NOT NULL DEFAULT 1,
      confidence_score REAL NOT NULL DEFAULT 0,
      status           TEXT NOT NULL DEFAULT 'new',
      scraped_at       TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      subject    TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS leads (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      mobile       TEXT,
      plan_interest TEXT,
      experience   TEXT,
      job_type     TEXT,
      other_info   TEXT,
      created_at   TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id           TEXT PRIMARY KEY REFERENCES users(id),
      full_name         TEXT,
      current_title     TEXT,
      current_company   TEXT,
      location          TEXT,
      phone             TEXT,
      linkedin_url      TEXT,
      github_url        TEXT,
      portfolio_url     TEXT,
      summary           TEXT,
      total_experience  TEXT,
      skills            TEXT NOT NULL DEFAULT '[]',
      resume_text       TEXT,
      resume_filename   TEXT,
      resume_uploaded_at TEXT,
      updated_at        TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );
  `);

  const defaults = {
    daily_send_cap:         '20',
    scheduler_enabled:      'false',
    scrape_enabled:         'false',
    smtp_config:            '{}',
    unsubscribe_footer_text:'To opt out of future emails, reply with UNSUBSCRIBE.',
  };
  const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING');
  for (const [k, v] of Object.entries(defaults)) await ins.run(k, v);

  // Migrations for DBs created before these columns existed
  await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'demo'`);
  await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);
  await db.exec(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_verified TEXT NOT NULL DEFAULT 'pending'`);
  await db.exec(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_checked_at TEXT`);
  await db.exec(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title_1 TEXT`);
  await db.exec(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title_2 TEXT`);
  await db.exec(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title_3 TEXT`);
  await db.exec(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_city TEXT`);
  await db.exec(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'`);
  await db.exec(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT`);
  await db.exec(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_url TEXT`);
  await db.exec(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS twitter_handle TEXT`);
  await db.exec(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS github_url TEXT`);
  await db.exec(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_contact TEXT`);

  // Promote first registered user to admin if no admin exists
  const adminExists = await db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const firstUser = await db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
    if (firstUser) {
      await db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', firstUser.id);
      console.log('[DB migration] Promoted first user to admin role');
    }
  }

  ready = true;
  return db;
}

module.exports = proxy;
