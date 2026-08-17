'use strict';
const { randomUUID } = require('crypto');
const db = require('../../db/database');
const { buildUserContext } = require('./contextBuilder');
const { generateTopics } = require('./topicGenerator');
const { generateCandidates } = require('./candidateGenerator');
const { isDuplicate } = require('./duplicateCheck');

const CONFIG_KEY = 'content_pipeline_config';

const DEFAULT_CONTENT_CONFIG = {
  enabled:                    false,
  schedule_mode:              'weekly', // 'daily' | 'weekly' | 'biweekly' | 'custom'
  custom_cron_hours:          168,
  candidates_per_topic:       3,
  topics_per_run:             1,
  auto_publish:               false, // if true, Approve defaults scheduled_for to now
  dry_run:                    true,  // SAFETY DEFAULT — publisher logs "would publish" without touching the browser
  min_days_between_publishes: 1,
};

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function getConfig() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(CONFIG_KEY).catch(() => null);
  try { return { ...DEFAULT_CONTENT_CONFIG, ...JSON.parse(row?.value || '{}') }; }
  catch { return { ...DEFAULT_CONTENT_CONFIG }; }
}

async function saveConfig(cfg) {
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(CONFIG_KEY, JSON.stringify(cfg));
}

let _running = false;

/**
 * Full generation cycle for every user with an active LinkedIn credential
 * (same "iterate every user with an active credential row" shape as
 * autoApplyWorker.js's runAutoApplyCycle). Safe to call concurrently — skips
 * if already running.
 */
async function runContentPipeline(triggeredBy = 'scheduler') {
  if (_running) return { skipped: true, reason: 'already running' };
  _running = true;

  const runId = randomUUID();
  const startedAt = nowStr();
  const errors = {};
  let topicsGenerated = 0, candidatesGenerated = 0, candidatesDroppedDuplicate = 0;

  console.log(`[ContentAI] Run ${runId} started (trigger: ${triggeredBy})`);

  await db.prepare(`
    INSERT INTO content_pipeline_runs (id, started_at, status) VALUES (?, ?, 'running')
  `).run(runId, startedAt);

  try {
    const cfg = await getConfig();

    const users = await db.prepare(
      `SELECT DISTINCT user_id FROM portal_credentials WHERE status = 'active' AND portal = 'linkedin'`
    ).all();

    for (const { user_id: userId } of users) {
      try {
        const context = await buildUserContext(userId);
        const topics = await generateTopics(context, cfg.topics_per_run);
        topicsGenerated += topics.length;

        for (const topic of topics) {
          const batchId = randomUUID();
          const candidates = await generateCandidates(topic, context, cfg.candidates_per_topic);

          for (const candidate of candidates) {
            if (await isDuplicate(candidate.content, userId)) {
              candidatesDroppedDuplicate++;
              continue;
            }
            await db.prepare(`
              INSERT INTO content_posts
                (id, user_id, batch_id, topic, variant_label, content, original_content, source_signals)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              randomUUID(), userId, batchId, topic, candidate.variant_label,
              candidate.content, candidate.content, JSON.stringify({ profile: !!context.profile, github: !!context.github })
            );
            candidatesGenerated++;
          }
        }

        if (topics.length) {
          await db.prepare(`
            INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'info', ?, ?)
          `).run(
            randomUUID(), userId, 'Content AI: new post drafts ready',
            `${candidatesGenerated} new LinkedIn post draft(s) across ${topics.length} topic(s) are waiting for your review.`
          );
        }
      } catch (e) {
        console.error('[ContentAI] user cycle failed:', e.message);
        errors[userId] = e.message;
      }
    }

    await db.prepare(`
      UPDATE content_pipeline_runs SET
        finished_at = ?, status = 'success',
        topics_generated = ?, candidates_generated = ?, candidates_dropped_duplicate = ?, errors = ?
      WHERE id = ?
    `).run(nowStr(), topicsGenerated, candidatesGenerated, candidatesDroppedDuplicate, JSON.stringify(errors), runId);

    return { runId, topicsGenerated, candidatesGenerated, candidatesDroppedDuplicate, errors };
  } catch (e) {
    console.error('[ContentAI] Fatal error:', e.message);
    await db.prepare(`UPDATE content_pipeline_runs SET status = 'failed', finished_at = ?, errors = ? WHERE id = ?`)
      .run(nowStr(), JSON.stringify({ fatal: e.message }), runId);
    throw e;
  } finally {
    _running = false;
  }
}

const SCHEDULE_HOURS = { daily: 24, weekly: 168, biweekly: 336 };

/**
 * Self-rescheduling setTimeout with jitter, mirroring agents/orchestrator.js's
 * schedulePipeline() — deliberately not setInterval, so the pipeline doesn't
 * fire at a mechanically exact period. Called once from index.js at startup.
 */
async function scheduleContentPipeline() {
  const cfg = await getConfig();
  if (!cfg.enabled) {
    console.log('[ContentAI] Disabled — enable via Admin Panel → Content AI Pipeline');
    return;
  }

  const hours = cfg.schedule_mode === 'custom' ? (cfg.custom_cron_hours || 168) : (SCHEDULE_HOURS[cfg.schedule_mode] || 168);
  const intervalMs = Math.max(1, hours) * 3_600_000;
  console.log(`[ContentAI] Scheduling every ~${hours}h (±15% jitter, mode: ${cfg.schedule_mode})`);

  function jittered(ms) {
    const jitter = ms * 0.15;
    return ms + (Math.random() * 2 - 1) * jitter;
  }
  function scheduleNext() {
    setTimeout(() => {
      runContentPipeline('scheduler')
        .catch(e => console.error('[ContentAI] Scheduled run failed:', e.message))
        .finally(scheduleNext);
    }, jittered(intervalMs));
  }

  // Fixed startup delay later than the job-intel pipeline's 30s so both
  // don't compete for boot resources.
  setTimeout(() => runContentPipeline('startup').catch(e => console.error('[ContentAI] Startup run failed:', e.message)), 60_000);
  scheduleNext();
}

module.exports = { runContentPipeline, scheduleContentPipeline, getConfig, saveConfig, DEFAULT_CONTENT_CONFIG };
