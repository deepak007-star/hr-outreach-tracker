require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const database = require('./db/database');

const PORT = process.env.PORT || 3001;

async function main() {
  // Ensure upload directory exists
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Initialise DB before any routes touch it
  const dbUrl = process.env.DATABASE_URL || 'postgres://localhost/hr_outreach_tracker';
  const maskedUrl = dbUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log(`[DB] Connecting to: ${maskedUrl}`);
  await database.initialize();
  console.log('[DB] Ready');

  // Log current user roles so we can verify data on startup
  try {
    const users = await database.prepare('SELECT email, role, plan FROM users ORDER BY created_at ASC').all();
    if (users.length === 0) {
      console.log('[DB] users table is EMPTY — no accounts exist yet');
    } else {
      console.log('[DB] Users in database:');
      users.forEach(u => console.log(`  ${u.email}  role=${u.role}  plan=${u.plan}`));
    }
  } catch (e) {
    console.error('[DB] Could not read users table:', e.message);
  }

  // Wire permission cache to the live DB instance
  const { setPermCacheDb } = require('./middleware/auth');
  setPermCacheDb(database);

  const contactsRouter       = require('./routes/contacts');
  const settingsRouter       = require('./routes/settings');
  const emailRouter          = require('./routes/email');
  const statsRouter          = require('./routes/stats');
  const jobsRouter           = require('./routes/jobs');
  const authRouter           = require('./routes/auth');
  const profileRouter        = require('./routes/profile');
  const leadsRouter          = require('./routes/leads');
  const apifyRouter          = require('./routes/apify');
  const notificationsRouter  = require('./routes/notifications');
  const reminderRouter       = require('./routes/reminder');
  const rateLimitRouter      = require('./routes/rateLimitStatus');
  const emailTemplatesRouter = require('./routes/emailTemplates');
  const { checkEmailDomain } = require('./routes/emailVerify');
  const emailVerifyRouter    = require('./routes/emailVerify');
  const adminRouter          = require('./routes/admin');
  const vaultRouter          = require('./routes/vault');
  const oauthRouter          = require('./routes/oauth');
  const rbacRouter           = require('./routes/rbac');
  const scraperRouter        = require('./routes/scraper');
  const scrapedJobsRouter    = require('./routes/scraped-jobs');
  const gmailRouter          = require('./routes/gmail');
  const githubBackupRouter   = require('./routes/github-backup');
  const { performScrape, getSettings } = require('./routes/apify');
  const { sendReminderEmail } = require('./routes/reminder');

  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/contacts', contactsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/email',    emailRouter);
  app.use('/api/stats',    statsRouter);
  app.use('/api/jobs',     jobsRouter);
  app.use('/api/auth',     authRouter);
  app.use('/api/profile',  profileRouter);
  app.use('/api/leads',    leadsRouter);
  app.use('/api/apify',         apifyRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reminder',      reminderRouter);
  app.use('/api/rate-limit',      rateLimitRouter);
  app.use('/api/email-templates', emailTemplatesRouter);
  app.use('/api/email-verify',    emailVerifyRouter);
  app.use('/api/admin',           adminRouter);
  app.use('/api/vault',           vaultRouter);
  app.use('/api/oauth',           oauthRouter);
  app.use('/api/rbac',            rbacRouter);
  app.use('/api/scraper',         scraperRouter);
  app.use('/api/scraped-jobs',    scrapedJobsRouter);
  app.use('/api/gmail',           gmailRouter);
  app.use('/api/github-backup',   githubBackupRouter);
  app.get('/api/health', (_, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  );

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  app.listen(PORT, () =>
    console.log(`HR Outreach Tracker backend → http://localhost:${PORT}`)
  );

  // 24h auto-fetch: check every hour, run if >23h since last scrape
  const { randomUUID } = require('crypto');
  setInterval(async () => {
    try {
      const lastVal = (await database.prepare('SELECT value FROM settings WHERE key = ?').get('apify_last_scrape'))?.value;
      if (lastVal) {
        const hoursSince = (Date.now() - new Date(lastVal).getTime()) / 3_600_000;
        if (hoursSince < 23) return;
      }
      const s = await getSettings();
      if (!s.apiKey || !s.actorId || !s.searchQueries?.length) return;
      console.log('[Auto-scrape] 24h elapsed — starting scheduled LinkedIn fetch…');
      const result = await performScrape();
      if (result.error) { console.log('[Auto-scrape] Skipped:', result.error); return; }
      await database.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `).run('apify_last_scrape', new Date().toISOString());
      await database.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), null, 'info', 'LinkedIn posts updated', `Auto-sync imported ${result.imported} new job posts from LinkedIn.`);
      console.log(`[Auto-scrape] Done — imported ${result.imported}/${result.total} posts`);
    } catch (e) { console.error('[Auto-scrape] Failed:', e.message); }
  }, 3_600_000); // every 1h

  // Reminder email scheduler — fires every minute
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  setInterval(async () => {
    try {
      const now      = new Date();
      const hhmm     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const todayDay = DAYS[now.getDay()];
      const todayStr = now.toISOString().split('T')[0];

      const rows = await database.prepare("SELECT key, value FROM settings WHERE key LIKE 'reminder_%'").all();
      for (const row of rows) {
        if (row.key.includes('_email_sent_')) continue; // skip tracking keys
        const userId = row.key.slice('reminder_'.length);
        let config;
        try { config = JSON.parse(row.value); } catch { continue; }

        if (!config.enabled || !config.deliveryEmail) continue;
        if (!config.time || config.time !== hhmm) continue;
        if (config.days?.length && !config.days.includes(todayDay)) continue;

        // Check if already sent today
        const sentKey = `reminder_email_sent_${userId}_${todayStr}`;
        const alreadySent = await database.prepare('SELECT value FROM settings WHERE key = ?').get(sentKey);
        if (alreadySent) continue;

        const user = await database.prepare('SELECT email, name FROM users WHERE id = ?').get(userId);
        if (!user) continue;

        try {
          await sendReminderEmail(userId, user.email, user.name, config);
          await database.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          `).run(sentKey, '1');
          console.log(`[Reminder] Email sent to ${user.email}`);
        } catch (e) {
          console.error(`[Reminder] Failed to send to ${user.email}:`, e.message);
        }
      }
    } catch (e) { console.error('[Reminder scheduler]', e.message); }
  }, 60_000); // every 1 minute

  // Daily email verification — runs once on startup then every 24h
  async function runEmailVerification() {
    try {
      const cutoff = new Date(Date.now() - 23 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
      const contacts = await database.prepare(
        `SELECT id, email FROM contacts
         WHERE email_verified IN ('pending','unverifiable')
            OR email_checked_at IS NULL
            OR email_checked_at < ?`
      ).all(cutoff);
      let updated = 0;
      for (const c of contacts) {
        const status = await checkEmailDomain(c.email);
        const checkedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
        await database.prepare(`UPDATE contacts SET email_verified = ?, email_checked_at = ? WHERE id = ?`)
          .run(status, checkedAt, c.id);
        updated++;
      }
      if (updated > 0) console.log(`[Email verify] Checked ${updated} contact emails`);
    } catch (e) { console.error('[Email verify]', e.message); }
  }
  setTimeout(runEmailVerification, 15_000); // startup check after 15s
  setInterval(runEmailVerification, 24 * 3_600_000); // every 24h

  // ── Daily scraper-job purge + GitHub backup ─────────────────────────────────
  async function runDailyPurgeAndBackup() {
    try {
      const purgeRow = await database.prepare("SELECT value FROM settings WHERE key='purge_config'").get();
      let purgeCfg = {};
      try { purgeCfg = JSON.parse(purgeRow?.value || '{}'); } catch {}

      if (purgeCfg.enabled !== false) {
        const retentionDays = Math.max(parseInt(purgeCfg.retention_days) || 30, 1);
        const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
        const result = await database.prepare('DELETE FROM scraped_jobs WHERE created_at < ?').run(cutoff);
        if (result.changes > 0) {
          console.log(`[Purge] Removed ${result.changes} scraped jobs older than ${retentionDays} days`);
        }
        purgeCfg.last_purge = new Date().toISOString().slice(0, 10);
        await database.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
          .run('purge_config', JSON.stringify(purgeCfg));
      }

      // GitHub backup if configured
      const ghRow = await database.prepare("SELECT value FROM settings WHERE key='github_backup_config'").get();
      let ghCfg = {};
      try { ghCfg = JSON.parse(ghRow?.value || '{}'); } catch {}

      if (ghCfg.enabled && ghCfg.token && ghCfg.owner && ghCfg.repo) {
        try {
          // Trigger backup by calling the route logic directly
          const { Octokit } = require('@octokit/rest');
          const octokit = new Octokit({ auth: ghCfg.token });
          const today   = new Date().toISOString().slice(0, 10);
          const d30     = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

          const [jobs, contacts] = await Promise.all([
            database.prepare('SELECT * FROM scraped_jobs WHERE created_at >= ? ORDER BY created_at DESC').all(d30),
            database.prepare('SELECT id,name,email,status,company,title,date_added FROM contacts ORDER BY date_added DESC LIMIT 500').all(),
          ]);

          const snapshotContent = JSON.stringify({ date: today, jobs, contacts }, null, 2);
          let sha;
          try {
            const ex = await octokit.repos.getContent({ owner: ghCfg.owner, repo: ghCfg.repo, path: `snapshots/${today}.json` });
            sha = ex.data.sha;
          } catch {}
          await octokit.repos.createOrUpdateFileContents({
            owner:   ghCfg.owner,
            repo:    ghCfg.repo,
            path:    `snapshots/${today}.json`,
            message: `snapshot: daily data for ${today}`,
            content: Buffer.from(snapshotContent).toString('base64'),
            ...(sha ? { sha } : {}),
          });
          await database.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
            .run('github_backup_config', JSON.stringify({ ...ghCfg, last_backup: new Date().toISOString() }));
          console.log(`[GitHub backup] Snapshot pushed for ${today}`);
        } catch (e) {
          console.error('[GitHub backup] Failed:', e.message);
        }
      }
    } catch (e) {
      console.error('[Daily purge/backup]', e.message);
    }
  }

  // Run purge once at startup (after 30s) then every 24h
  setTimeout(runDailyPurgeAndBackup, 30_000);
  setInterval(runDailyPurgeAndBackup, 24 * 3_600_000);
}

main().catch(err => { console.error('Startup failed:', err); process.exit(1); });
