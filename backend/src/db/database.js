const initSqlJs = require('sql.js');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'contacts.db');

let _db = null;

// ── Thin wrapper matching the better-sqlite3 synchronous API ───────────────
function makeWrapper(sqldb) {
  function persist() {
    fs.writeFileSync(DB_PATH, Buffer.from(sqldb.export()));
  }

  function makeStmt(sql) {
    return {
      run(...params) {
        const stmt = sqldb.prepare(sql);
        stmt.run(params);
        const changes = sqldb.getRowsModified();
        stmt.free();
        if (changes > 0) persist();
        return { changes };
      },
      get(...params) {
        const stmt = sqldb.prepare(sql);
        stmt.bind(params);
        const row = stmt.step() ? { ...stmt.getAsObject() } : undefined;
        stmt.free();
        return row;
      },
      all(...params) {
        const stmt = sqldb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push({ ...stmt.getAsObject() });
        stmt.free();
        return rows;
      },
    };
  }

  return {
    exec(sql) { sqldb.run(sql); return this; },
    prepare(sql) { return makeStmt(sql); },
  };
}

// ── Proxy so routes can do: const db = require('../db/database') unchanged ─
const proxy = new Proxy({}, {
  get(_, prop) {
    if (prop === 'initialize') return initialize;
    if (!_db) throw new Error('Database not initialised yet');
    return _db[prop];
  },
});

async function initialize() {
  const SQL = await initSqlJs();

  let sqldb;
  if (fs.existsSync(DB_PATH)) {
    sqldb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    sqldb = new SQL.Database();
  }

  _db = makeWrapper(sqldb);

  _db.exec(`
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
      date_added        TEXT NOT NULL DEFAULT (datetime('now')),
      date_last_contacted TEXT,
      notes             TEXT,
      tags              TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS email_log (
      id            TEXT PRIMARY KEY,
      contact_id    TEXT REFERENCES contacts(id),
      sent_at       TEXT NOT NULL DEFAULT (datetime('now')),
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
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      type       TEXT NOT NULL DEFAULT 'info',
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      scraped_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      subject    TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const defaults = {
    daily_send_cap:         '20',
    scheduler_enabled:      'false',
    scrape_enabled:         'false',
    smtp_config:            '{}',
    unsubscribe_footer_text:'To opt out of future emails, reply with UNSUBSCRIBE.',
  };
  const ins = _db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);

  // Migrations for DBs created before these columns existed
  try { _db.exec(`ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'demo'`); } catch {}
  try { _db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`); } catch {}
  try { _db.exec(`ALTER TABLE contacts ADD COLUMN email_verified TEXT NOT NULL DEFAULT 'pending'`); } catch {}
  try { _db.exec(`ALTER TABLE contacts ADD COLUMN email_checked_at TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE profiles ADD COLUMN job_title_1 TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE profiles ADD COLUMN job_title_2 TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE profiles ADD COLUMN job_title_3 TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE profiles ADD COLUMN preferred_city TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE leads ADD COLUMN status TEXT NOT NULL DEFAULT 'new'`); } catch {}
  try { _db.exec(`ALTER TABLE leads ADD COLUMN notes TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE leads ADD COLUMN linkedin_url TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE leads ADD COLUMN twitter_handle TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE leads ADD COLUMN github_url TEXT`); } catch {}
  try { _db.exec(`ALTER TABLE leads ADD COLUMN preferred_contact TEXT`); } catch {}

  // Promote first registered user to admin if no admin exists
  try {
    const adminExists = _db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
    if (!adminExists) {
      const firstUser = _db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
      if (firstUser) {
        _db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', firstUser.id);
        console.log('[DB migration] Promoted first user to admin role');
      }
    }
  } catch {}
  try {
    _db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      type       TEXT NOT NULL DEFAULT 'info',
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}

  return _db;
}

module.exports = proxy;
