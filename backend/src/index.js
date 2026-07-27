require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const database = require('./db/database');

const PORT = process.env.PORT || 3001;

async function main() {
  // Ensure required directories exist
  const uploadsDir = path.join(__dirname, '../uploads');
  const dataDir    = path.join(__dirname, '../data');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dataDir))    fs.mkdirSync(dataDir,    { recursive: true });

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
  const referralsRouter      = require('./routes/referrals');
  const resumeVersionsRouter = require('./routes/resume-versions');
  const linkedinFeedRouter   = require('./routes/linkedin-feed');
  const deliveryRouter       = require('./routes/delivery');
  const paymentsRouter       = require('./routes/payments');
  const chatbotRouter        = require('./routes/chatbot');
  const { getSettings } = require('./routes/apify');
  const { sendReminderEmail } = require('./routes/reminder');

  const cookieParser = require('cookie-parser');
  const helmet       = require('helmet');
  const { globalApiLimiter, bodySanitizer, safeErrorHandler } = require('./middleware/security');

  const app = express();

  // Trust the first proxy hop (needed for accurate req.ip behind nginx/Docker)
  app.set('trust proxy', 1);

  // ── Security headers (helmet) ──────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:', 'https:'],
        connectSrc:  ["'self'"],
        fontSrc:     ["'self'", 'https:', 'data:'],
        objectSrc:   ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // needed for PDFs / iframes in resume preview
  }));

  // ── CORS ───────────────────────────────────────────────────────────────────
  // Accept multiple origins: env var (single or comma-separated), plus localhost fallback
  const rawOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',').map(o => o.trim()).filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
      // Allow server-to-server requests (origin undefined) and any listed origin
      if (!origin || rawOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: ${origin} not allowed`));
    },
    credentials: true,
  }));

  app.use(cookieParser());
  // Preserve raw body for Razorpay webhook HMAC signature verification
  app.use(express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      if (req.originalUrl === '/api/payments/webhook') req.rawBody = buf.toString('utf8');
    },
  }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // ── Global API rate limiter + XSS body sanitizer ──────────────────────────
  app.use('/api', globalApiLimiter);
  app.use(bodySanitizer);

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
  app.use('/api/referrals',        referralsRouter);
  app.use('/api/resume-versions',  resumeVersionsRouter);
  app.use('/api/linkedin-feed',    linkedinFeedRouter);
  app.use('/api/delivery',        deliveryRouter);
  app.use('/api/payments',        paymentsRouter);
  app.use('/api/chatbot',         chatbotRouter);
  app.get('/api/health', (_, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  );

  app.use(safeErrorHandler);

  app.listen(PORT, () =>
    console.log(`HR Outreach Tracker backend → http://localhost:${PORT}`)
  );

  // Daily 7 AM IST prefetch (automatic): job listings across the 'general'
  // (linkedin-jobs, naukri, internshala, instahyre, foundit), 'remote'
  // (arbeitnow, remoteok, weworkremotely, remotive via the 'general' scraper
  // key), and 'international' (jora, across its 6 live countries) categories,
  // plus the LinkedIn feed HR-contact scraper (cold-email). Apify is NOT run
  // automatically — it only runs when an admin manually clicks "Scrape Now
  // (Apify)" in the Admin Panel. Regular users never trigger scraping
  // themselves — this is the sole automatic source of fresh data for the
  // user-facing feed.
  const { randomUUID } = require('crypto');
  const IST_OFFSET_MS  = 19_800_000; // +5:30

  // linkedin-jobs/naukri/foundit/jora each drive a real Playwright browser
  // against sites that push back on plain HTTP clients in some way (foundit
  // sits behind Akamai Bot Manager; jora 403s plain axios/curl despite
  // identical headers — some other client fingerprint check) — their real
  // per-keyword yield is bounded by a single page load regardless of
  // --limit (see scrapers/*.js), so raising this wouldn't add volume, only
  // risk. Internshala/instahyre (plain SSR HTML / a public API, neither
  // bot-protected) and the remote-boards aggregator (legitimate public
  // APIs/RSS) can safely aim much higher toward the 300-400/category/day
  // target. Run sequentially, not in parallel — avoids multiple browser
  // automations fighting for resources at once and looks less bot-like to
  // the sites hit.
  const DAILY_SCRAPE_JOBS = [
    { scraper: 'linkedin-jobs', limit: 60,  category: 'general' },
    { scraper: 'naukri',        limit: 60,  category: 'general' },
    { scraper: 'foundit',       limit: 60,  category: 'general' },
    { scraper: 'internshala',   limit: 200, category: 'general' },
    { scraper: 'instahyre',     limit: 200, category: 'general' },
    { scraper: 'general',       limit: 350, category: 'remote',
      sites: ['arbeitnow', 'remoteok', 'weworkremotely', 'remotive'] },
    { scraper: 'jora',          limit: 200, category: 'international' },
  ];

  setInterval(async () => {
    try {
      const ist = new Date(Date.now() + IST_OFFSET_MS); // use UTC getters for IST wall-clock
      if (ist.getUTCHours() !== 7) return;

      const istDateStr = ist.toISOString().slice(0, 10);
      const doneKey     = `scrape_done_${istDateStr}`;
      const already = await database.prepare('SELECT value FROM settings WHERE key = ?').get(doneKey);
      if (already) return;

      // Mark done BEFORE running — the full sequential run (2 Playwright
      // browsers + 2 API scrapers + linkedin-feed) can take several minutes,
      // longer than this interval's 5-minute tick, so this must be set first
      // or the next tick would start a second overlapping run.
      await database.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `).run(doneKey, '1');

      console.log(`[Daily scrape] 7 AM IST — starting job-feed prefetch for ${istDateStr}`);
      const s      = await getSettings();
      const titles = s.searchQueries;

      const storedByCategory = { general: 0, remote: 0, international: 0 };
      for (const job of DAILY_SCRAPE_JOBS) {
        try {
          const body = { titles, limit: job.limit, since: '7d', ...(job.sites ? { sites: job.sites } : {}) };
          const result = await scraperRouter.runScraperHeadless(job.scraper, body);
          storedByCategory[job.category] += result.stored;
          console.log(`[Daily scrape] ${job.scraper} -> ${result.stored} stored (category: ${job.category})`);
        } catch (e) {
          console.log(`[Daily scrape] ${job.scraper} skipped:`, e.message);
        }
      }

      let feedStored = 0;
      try {
        // 30-40/day target across LinkedIn/Twitter/Telegram + a title-agnostic
        // broad pass (up from 25) — broader keyword/platform coverage means
        // more real candidates to filter down to contacts.
        const result = await scraperRouter.runScraperHeadless('linkedin-feed', { titles, limit: 40 });
        feedStored = result.stored;
      } catch (e) {
        console.log('[Daily scrape] LinkedIn feed scraper skipped:', e.message);
      }

      await database.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), null, 'info', 'Daily job feed updated',
          `Morning prefetch imported ${storedByCategory.general} general jobs, ${storedByCategory.remote} remote jobs, `
          + `${storedByCategory.international} international jobs, and ${feedStored} LinkedIn feed posts.`);

      console.log(`[Daily scrape] Done —`, storedByCategory, `+ ${feedStored} LinkedIn feed posts`);
    } catch (e) { console.error('[Daily scrape] Failed:', e.message); }
  }, 5 * 60_000); // every 5 minutes

  // Reminder email scheduler — fires every minute
  // Uses IST (UTC+5:30) for time/day comparison so "send at 9:00 AM" means
  // 9 AM IST regardless of the server's system timezone (UTC in Docker).
  // IST_OFFSET_MS is already declared above (19_800_000 ms = 5h30m).
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  setInterval(async () => {
    try {
      const nowIST   = new Date(Date.now() + IST_OFFSET_MS);
      const hhmm     = `${String(nowIST.getUTCHours()).padStart(2,'0')}:${String(nowIST.getUTCMinutes()).padStart(2,'0')}`;
      const todayDay = DAYS[nowIST.getUTCDay()];
      const todayStr = nowIST.toISOString().split('T')[0];

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

  // ── Subscription expiry downgrade (startup + daily) ───────────────────────
  async function downgradeExpiredSubscriptions() {
    try {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const expired = await database.prepare(
        "SELECT user_id FROM subscriptions WHERE status = 'active' AND current_period_end < ?"
      ).all(now);
      for (const { user_id } of expired) {
        await database.prepare(
          "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE user_id = ?"
        ).run(now, user_id);
        await database.prepare("UPDATE users SET plan = 'demo' WHERE id = ?").run(user_id);
        console.log(`[Subscriptions] Expired plan downgraded for user ${user_id}`);
      }
      if (expired.length > 0) console.log(`[Subscriptions] Downgraded ${expired.length} expired subscription(s)`);
    } catch (e) {
      console.error('[Subscriptions] Expiry check error:', e.message);
    }
  }
  setTimeout(downgradeExpiredSubscriptions, 20_000);
  setInterval(downgradeExpiredSubscriptions, 24 * 3_600_000);
}

main().catch(err => { console.error('Startup failed:', err); process.exit(1); });
