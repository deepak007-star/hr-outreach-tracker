'use strict';

const express = require('express');
const db      = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getBackupConfig() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'github_backup_config'").get();
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}

async function saveBackupConfig(cfg) {
  await db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
    .run('github_backup_config', JSON.stringify(cfg));
}

function buildOctokit(token) {
  const { Octokit } = require('@octokit/rest');
  return new Octokit({ auth: token });
}

async function upsertFile(octokit, owner, repo, filePath, content, message) {
  let sha;
  try {
    const existing = await octokit.repos.getContent({ owner, repo, path: filePath });
    sha = existing.data.sha;
  } catch { /* file doesn't exist yet */ }

  await octokit.repos.createOrUpdateFileContents({
    owner, repo,
    path:    filePath,
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

// ─── Collect data to back up ──────────────────────────────────────────────────

async function collectDailySnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  const d30   = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

  const [jobs, contacts, gmailEmails] = await Promise.all([
    db.prepare('SELECT * FROM scraped_jobs WHERE created_at >= ? ORDER BY created_at DESC').all(d30),
    db.prepare('SELECT id, name, email, status, company, title, date_added, date_last_contacted FROM contacts ORDER BY date_added DESC LIMIT 500').all(),
    db.prepare('SELECT id, contact_email, contact_name, subject, sent_at, email_status, replied_at FROM gmail_tracked_emails WHERE sent_at >= ? ORDER BY sent_at DESC').all(d30),
  ]);

  return { date: today, jobs, contacts, gmailEmails };
}

// ─── GET /api/github-backup/config ────────────────────────────────────────────

router.get('/config', requireAdmin, async (req, res) => {
  try {
    const cfg = await getBackupConfig();
    // Never expose raw token to client
    res.json({ ...cfg, token: cfg.token ? '***configured***' : '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/github-backup/config ────────────────────────────────────────────

router.put('/config', requireAdmin, async (req, res) => {
  try {
    const existing = await getBackupConfig();
    const { enabled, token, owner, repo, retention_days } = req.body;

    const updated = {
      ...existing,
      enabled:        enabled !== undefined ? !!enabled : existing.enabled,
      owner:          owner   !== undefined ? owner     : existing.owner,
      repo:           repo    !== undefined ? repo      : existing.repo,
      retention_days: retention_days ? parseInt(retention_days) : (existing.retention_days || 30),
      // Only update token if a real value was provided (not the placeholder)
      token: token && token !== '***configured***' ? token : existing.token,
    };

    await saveBackupConfig(updated);
    res.json({ ok: true, owner: updated.owner, repo: updated.repo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/github-backup/run — trigger a backup ──────────────────────────

router.post('/run', requireAdmin, async (req, res) => {
  try {
    const cfg = await getBackupConfig();
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      return res.status(400).json({ error: 'GitHub backup not fully configured (token, owner, repo required)' });
    }

    const octokit = buildOctokit(cfg.token);
    const today   = new Date().toISOString().slice(0, 10);
    const data    = await collectDailySnapshot();
    const ts      = new Date().toISOString();

    let uploaded = 0;

    // 1. Daily snapshot (snapshots/YYYY-MM-DD.json)
    await upsertFile(
      octokit, cfg.owner, cfg.repo,
      `snapshots/${today}.json`,
      JSON.stringify(data, null, 2),
      `snapshot: daily data for ${today}`
    );
    uploaded++;

    // 2. Purge data older than retention days — push to backup folder
    const retentionDays = cfg.retention_days || 30;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const oldJobs = await db.prepare('SELECT * FROM scraped_jobs WHERE created_at < ?').all(cutoff);

    if (oldJobs.length > 0) {
      // Group by date
      const byDate = {};
      for (const job of oldJobs) {
        const d = (job.created_at || '').slice(0, 10);
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(job);
      }
      for (const [date, jobs] of Object.entries(byDate)) {
        await upsertFile(
          octokit, cfg.owner, cfg.repo,
          `backup/scraped-jobs/${date}.json`,
          JSON.stringify(jobs, null, 2),
          `backup: scraped jobs for ${date} (purged from DB)`
        );
        uploaded++;
      }

      // Purge from DB
      await db.prepare('DELETE FROM scraped_jobs WHERE created_at < ?').run(cutoff);
    }

    // 3. Update config with last backup time
    await saveBackupConfig({ ...cfg, last_backup: ts });

    res.json({ ok: true, uploaded, purgedJobs: oldJobs.length, timestamp: ts });
  } catch (err) {
    console.error('[GitHub backup]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/github-backup/status ────────────────────────────────────────────

router.get('/status', requireAdmin, async (req, res) => {
  try {
    const cfg = await getBackupConfig();
    const purgeRow = await db.prepare("SELECT value FROM settings WHERE key='purge_config'").get();
    let purge = {};
    try { purge = JSON.parse(purgeRow?.value || '{}'); } catch {}

    const oldJobs = await db.prepare(`
      SELECT COUNT(*) as c FROM scraped_jobs
      WHERE created_at < ?
    `).get(new Date(Date.now() - (cfg.retention_days || 30) * 86_400_000).toISOString().replace('T', ' ').slice(0, 19));

    res.json({
      configured:     !!(cfg.token && cfg.owner && cfg.repo),
      enabled:        !!cfg.enabled,
      last_backup:    cfg.last_backup || null,
      retention_days: cfg.retention_days || 30,
      jobs_to_purge:  parseInt(oldJobs?.c || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
