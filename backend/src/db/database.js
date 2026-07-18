const { Pool, Client } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hr_outreach_tracker';
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const sslConfig = isLocal ? false : { rejectUnauthorized: false };

// Pool for all regular runtime queries after initialization
const pool = new Pool({ connectionString, ssl: sslConfig });

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
  // Use a dedicated Client (not the pool) for the entire initialization so that
  // SET statement_timeout = 0 is guaranteed to apply to every DDL + seed query.
  // Supabase and other hosted Postgres impose short per-statement timeouts on the
  // pooler; this single persistent connection bypasses that for init only.
  const initClient = new Client({ connectionString, ssl: sslConfig });
  await initClient.connect();
  await initClient.query('SET statement_timeout = 0');

  // Thin wrappers so the rest of initialize() keeps using the same syntax
  const iExec = (sql) => initClient.query(sql);
  const iRun  = async (sql, ...params) => { const r = await initClient.query(toPgSql(sql), params); return { changes: r.rowCount }; };
  const iGet  = async (sql, ...params) => { const r = await initClient.query(toPgSql(sql), params); return r.rows[0]; };

  const _origExec    = db.exec.bind(db);
  const _origPrepare = db.prepare.bind(db);
  db.exec    = (sql) => iExec(sql).then(() => db);
  db.prepare = (sql) => ({
    run:  (...p) => iRun(sql, ...p),
    get:  (...p) => iGet(sql, ...p),
    all:  async (...p) => { const r = await initClient.query(toPgSql(sql), p); return r.rows; },
  });

  try {
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

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      user_id       TEXT NOT NULL REFERENCES users(id),
      provider      TEXT NOT NULL,
      email         TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      scope         TEXT,
      created_at    TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      updated_at    TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      PRIMARY KEY (user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS scraped_jobs (
      id               TEXT PRIMARY KEY,
      scraper_type     TEXT NOT NULL,
      job_category     TEXT NOT NULL DEFAULT 'general',
      title            TEXT NOT NULL DEFAULT '',
      company          TEXT NOT NULL DEFAULT '',
      location         TEXT NOT NULL DEFAULT '',
      job_type         TEXT NOT NULL DEFAULT '',
      salary           TEXT NOT NULL DEFAULT '',
      experience       TEXT NOT NULL DEFAULT '',
      tags             TEXT NOT NULL DEFAULT '',
      description      TEXT NOT NULL DEFAULT '',
      link             TEXT NOT NULL DEFAULT '',
      apply_link       TEXT NOT NULL DEFAULT '',
      posted_at        TEXT NOT NULL DEFAULT '',
      scraped_at       TEXT NOT NULL,
      is_remote        INTEGER NOT NULL DEFAULT 0,
      contact_email    TEXT,
      contact_phone    TEXT,
      google_form_link TEXT,
      whatsapp_link    TEXT,
      all_contacts     TEXT,
      created_at       TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS gmail_tokens (
      user_id       TEXT PRIMARY KEY REFERENCES users(id),
      gmail_email   TEXT NOT NULL,
      access_token  TEXT,
      refresh_token TEXT NOT NULL,
      token_expiry  TEXT,
      created_at    TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      updated_at    TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS gmail_tracked_emails (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL REFERENCES users(id),
      gmail_message_id TEXT,
      gmail_thread_id  TEXT,
      contact_email    TEXT NOT NULL,
      contact_name     TEXT NOT NULL DEFAULT '',
      subject          TEXT NOT NULL DEFAULT '',
      body_snippet     TEXT NOT NULL DEFAULT '',
      full_body        TEXT NOT NULL DEFAULT '',
      sent_at          TEXT NOT NULL,
      email_status     TEXT NOT NULL DEFAULT 'sent',
      replied_at       TEXT,
      reply_snippet    TEXT,
      last_synced_at   TEXT,
      created_at       TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS roles (
      id          TEXT PRIMARY KEY,
      name        TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id          TEXT PRIMARY KEY,
      name        TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      resource    TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS password_vault (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      username     TEXT NOT NULL DEFAULT '',
      password_enc TEXT NOT NULL,
      iv           TEXT NOT NULL,
      tag          TEXT NOT NULL,
      url          TEXT NOT NULL DEFAULT '',
      category     TEXT NOT NULL DEFAULT 'general',
      notes        TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      updated_at   TEXT NOT NULL DEFAULT (${NOW_EXPR})
    );

    CREATE TABLE IF NOT EXISTS referral_requests (
      id           TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject      TEXT NOT NULL DEFAULT '',
      message      TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (${NOW_EXPR}),
      UNIQUE(from_user_id, to_user_id)
    );
  `);

  const defaults = {
    daily_send_cap:         '20',
    scheduler_enabled:      'false',
    scrape_enabled:         'false',
    smtp_config:            '{}',
    unsubscribe_footer_text:'To opt out of future emails, reply with UNSUBSCRIBE.',
    purge_config:           JSON.stringify({ enabled: true, retention_days: 30, last_purge: null }),
    github_backup_config:   JSON.stringify({ enabled: false, token: '', owner: '', repo: '', last_backup: null }),
    scraper_defaults:       JSON.stringify({ since: '7d', limit: 50, location: 'India' }),
  };
  const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING');
  for (const [k, v] of Object.entries(defaults)) await ins.run(k, v);

  // Migrations — skip if column already exists to avoid ACCESS EXCLUSIVE lock on
  // live tables (ALTER TABLE IF NOT EXISTS still locks even when column is present)
  const colExists = async (table, col) => {
    const r = await db.prepare(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND column_name=?`
    ).get(table, col);
    return !!r;
  };
  const addCol = async (table, col, def) => {
    if (!(await colExists(table, col))) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  await addCol('users',    'plan',             `TEXT NOT NULL DEFAULT 'demo'`);
  await addCol('users',    'role',             `TEXT NOT NULL DEFAULT 'user'`);
  await addCol('contacts', 'email_verified',   `TEXT NOT NULL DEFAULT 'pending'`);
  await addCol('contacts', 'email_checked_at', `TEXT`);
  await addCol('profiles', 'job_title_1',      `TEXT`);
  await addCol('profiles', 'job_title_2',      `TEXT`);
  await addCol('profiles', 'job_title_3',      `TEXT`);
  await addCol('profiles', 'preferred_city',   `TEXT`);
  await addCol('leads',    'status',           `TEXT NOT NULL DEFAULT 'new'`);
  await addCol('leads',    'notes',            `TEXT`);
  await addCol('leads',    'linkedin_url',     `TEXT`);
  await addCol('leads',    'twitter_handle',   `TEXT`);
  await addCol('leads',    'github_url',       `TEXT`);
  await addCol('leads',    'preferred_contact',`TEXT`);
  // scraped_jobs index for fast date-range queries
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scraped_jobs_created_at ON scraped_jobs (created_at)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_scraped_jobs_category ON scraped_jobs (job_category)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_gmail_tracked_user ON gmail_tracked_emails (user_id, sent_at)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_gmail_tracked_status ON gmail_tracked_emails (user_id, email_status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_password_vault_user ON password_vault (user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_requests_from ON referral_requests (from_user_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_requests_to ON referral_requests (to_user_id)`);

  // ── RBAC seed ────────────────────────────────────────────────────────────────
  const PERMISSIONS = [
    // Contacts
    { id: 'perm_contacts_read',    name: 'contacts:read',    description: 'View contacts list',        resource: 'contacts' },
    { id: 'perm_contacts_write',   name: 'contacts:write',   description: 'Add and edit contacts',     resource: 'contacts' },
    { id: 'perm_contacts_delete',  name: 'contacts:delete',  description: 'Delete contacts',           resource: 'contacts' },
    { id: 'perm_contacts_import',  name: 'contacts:import',  description: 'Import contacts from file', resource: 'contacts' },
    { id: 'perm_contacts_export',  name: 'contacts:export',  description: 'Export contacts to Excel',  resource: 'contacts' },
    // Email
    { id: 'perm_email_send',       name: 'email:send',       description: 'Send outreach emails',      resource: 'email' },
    { id: 'perm_email_templates',  name: 'email:templates',  description: 'Manage email templates',    resource: 'email' },
    // Jobs & Scraper
    { id: 'perm_scraper_run',      name: 'scraper:run',      description: 'Run job scrapers',          resource: 'jobs' },
    { id: 'perm_jobs_read',        name: 'jobs:read',        description: 'View scraped jobs',         resource: 'jobs' },
    { id: 'perm_gmail_connect',    name: 'gmail:connect',    description: 'Connect and sync Gmail',    resource: 'jobs' },
    // Profile
    { id: 'perm_profile_read',     name: 'profile:read',     description: 'View own profile',          resource: 'profile' },
    { id: 'perm_profile_write',    name: 'profile:write',    description: 'Edit own profile',          resource: 'profile' },
    // Admin
    { id: 'perm_admin_access',     name: 'admin:access',     description: 'Access admin panel',        resource: 'admin' },
    { id: 'perm_admin_users',      name: 'admin:users',      description: 'Manage users',              resource: 'admin' },
    { id: 'perm_admin_roles',      name: 'admin:roles',      description: 'Manage roles & permissions',resource: 'admin' },
    { id: 'perm_admin_settings',   name: 'admin:settings',   description: 'Manage system settings',    resource: 'admin' },
    { id: 'perm_admin_data',       name: 'admin:data',       description: 'Manage data backup & purge',resource: 'admin' },
  ];

  const ROLES = [
    {
      id: 'role_admin', name: 'admin', description: 'Full system access', is_system: 1,
      permissions: PERMISSIONS.map(p => p.id),
    },
    {
      id: 'role_user', name: 'user', description: 'Standard user access', is_system: 1,
      permissions: ['perm_contacts_read','perm_contacts_write','perm_contacts_delete',
                    'perm_contacts_import','perm_contacts_export','perm_email_send',
                    'perm_email_templates','perm_scraper_run','perm_jobs_read',
                    'perm_gmail_connect','perm_profile_read','perm_profile_write'],
    },
    {
      id: 'role_demo', name: 'demo', description: 'Limited demo access (10 contacts cap)', is_system: 1,
      permissions: ['perm_contacts_read','perm_contacts_write','perm_jobs_read',
                    'perm_profile_read','perm_profile_write'],
    },
    {
      id: 'role_guest', name: 'guest', description: 'Read-only guest access (5 contacts cap)', is_system: 1,
      permissions: ['perm_contacts_read','perm_jobs_read','perm_profile_read'],
    },
  ];

  const insPerm = db.prepare('INSERT INTO permissions (id,name,description,resource) VALUES (?,?,?,?) ON CONFLICT (name) DO NOTHING');
  for (const p of PERMISSIONS) await insPerm.run(p.id, p.name, p.description, p.resource);

  const insRole = db.prepare('INSERT INTO roles (id,name,description,is_system) VALUES (?,?,?,?) ON CONFLICT (name) DO NOTHING');
  for (const r of ROLES) {
    await insRole.run(r.id, r.name, r.description, r.is_system);
    // Seed permissions only if role has none yet
    const existing = await db.prepare('SELECT COUNT(*) as n FROM role_permissions WHERE role_id = ?').get(r.id);
    if (parseInt(existing?.n) === 0) {
      const insRp = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?) ON CONFLICT DO NOTHING');
      for (const pid of r.permissions) await insRp.run(r.id, pid);
    }
  }

  // ── Promote first registered user to admin if no admin exists
  const adminExists = await db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const firstUser = await db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
    if (firstUser) {
      await db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', firstUser.id);
      console.log('[DB migration] Promoted first user to admin role');
    }
  }

  } finally {
    // Restore pool-based db methods and close the init connection
    db.exec    = _origExec;
    db.prepare = _origPrepare;
    await initClient.end();
  }

  ready = true;
  return db;
}

module.exports = proxy;
