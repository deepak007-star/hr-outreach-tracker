'use strict';

// Real, logged-in LinkedIn publishing via browser automation — no official
// LinkedIn API/OAuth access exists or is planned (Partner Program approval is
// out of scope for a personal app). Same risk class and "fail safe, never
// guess success" philosophy as agents/autoApplyWorker.js, but held to an even
// stricter bar here: a false "published" (silent double-post, or claiming
// success when it didn't post) is worse than a missed application, so any
// ambiguity in detecting the composer or a success/failure signal aborts to
// status='failed' with the user notified to check linkedin.com manually —
// never assumed.
//
// The login step reuses the exact stealth/failure-detection approach already
// proven for Naukri/Instahyre. The composer-fill/post-click selectors below
// are best-effort guesses against LinkedIn's current UI — NOT yet verified
// against a real successful post. This is expected and safe by design: any
// selector miss falls through to the "could not confirm" abort path below,
// never a guessed success.

const { randomUUID } = require('crypto');
const db = require('../../db/database');
const { decrypt } = require('../../services/tokenCrypto');
const { launchStealthBrowser, newStealthContext, withBrowserLock } = require('../../lib/browserStealth');
const { markInvalidCredentials } = require('../autoApplyWorker');
const { getConfig } = require('./orchestrator');
const logger = require('../../lib/logger');

const FAILURE_TEXT_RE = /incorrect|wrong (email|password)|doesn.?t match|verify your identity|unusual activity|too many (attempts|requests)|account (is )?(locked|restricted)|captcha/i;

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function loginLinkedIn(page, { username, password }) {
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(1200 + Math.random() * 800);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.locator('button[type="submit"]').first().click({ timeout: 10000 });
  await page.waitForTimeout(4000);

  const url = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (url.includes('/checkpoint/challenge')) {
    return { ok: false, error: 'LinkedIn checkpoint/2FA challenge — cannot proceed automatically' };
  }
  if (url.includes('/login') || FAILURE_TEXT_RE.test(bodyText)) {
    return { ok: false, error: bodyText.slice(0, 300) || 'Still on login page after submit' };
  }
  return { ok: true };
}

async function fillComposer(page, content) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(1500 + Math.random() * 1000);

  const startButton = page.locator('button:has-text("Start a post")').first();
  await startButton.click({ timeout: 10000 });
  await page.waitForTimeout(1500);

  const editor = page.locator('div[role="textbox"]').first();
  await editor.click({ timeout: 8000 });
  try {
    await editor.fill(content);
  } catch (_) {
    // Contenteditable divs don't always support .fill() — fall back to typing.
    await page.keyboard.insertText(content);
  }
  await page.waitForTimeout(800);
}

async function clickPostAndVerify(page) {
  const postButton = page.locator('button:has-text("Post")').last();
  await postButton.click({ timeout: 10000 });
  await page.waitForTimeout(4000);

  // Best-effort success signal: the post editor modal closing. LinkedIn's
  // exact success-toast microcopy is unverified — treat anything short of
  // "the composer is gone" as unconfirmed, never as success.
  const composerStillOpen = await page.locator('div[role="textbox"]').count();
  if (composerStillOpen > 0) {
    return { ok: false, error: 'Could not confirm the post was published — composer still open after clicking Post' };
  }
  return { ok: true };
}

/**
 * Publishes one approved post. Never assumes success on ambiguity — marks
 * status='failed' with a clear error and notifies the user to verify
 * manually rather than guessing.
 */
async function publishPost(postId) {
  // Atomically claim the post before touching anything else — the old
  // SELECT-then-check here was a TOCTOU race: two processes (e.g. two live
  // instances both polling runPublishCycle every 60s, or a local dev box
  // left running alongside the deployed one — same shared-DB multi-instance
  // risk already documented/fixed for the Job Intel pipeline and auto-apply
  // cycle elsewhere in this app) could both read status='approved' and both
  // actually publish to the SAME real LinkedIn account. A duplicate visible
  // post is a real, hard-to-undo mistake — worse than the analogous
  // duplicate-scrape/duplicate-login issues, which are just wasteful. The
  // claim below succeeds for exactly one caller; everyone else gets 0 rows
  // and backs off immediately, before ever launching a browser.
  const post = await db.prepare(
    `UPDATE content_posts SET status = 'publishing', updated_at = ? WHERE id = ? AND status = 'approved' RETURNING *`
  ).get(nowStr(), postId);
  if (!post) return { ok: false, error: 'not_claimable — already claimed/published by another process, not found, or not approved' };

  const cfg = await getConfig();

  await db.prepare('UPDATE content_posts SET publish_attempts = publish_attempts + 1, updated_at = ? WHERE id = ?')
    .run(nowStr(), postId);

  if (cfg.dry_run) {
    logger.info(`[ContentAI] DRY RUN — would publish post ${postId}: ${post.content.slice(0, 80)}`);
    await db.prepare(`UPDATE content_posts SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`)
      .run(nowStr(), nowStr(), postId);
    return { ok: true, dryRun: true };
  }

  const credRow = await db.prepare(
    `SELECT username, password_encrypted FROM portal_credentials WHERE user_id = ? AND portal = 'linkedin' AND status = 'active'`
  ).get(post.user_id);
  if (!credRow) {
    await db.prepare(`UPDATE content_posts SET status = 'failed', publish_error = ?, updated_at = ? WHERE id = ?`)
      .run('No active LinkedIn credentials connected', nowStr(), postId);
    return { ok: false, error: 'no_credentials' };
  }

  const password = decrypt(credRow.password_encrypted);

  // Serialized with the auto-apply worker's browser too — see
  // lib/browserStealth.js's withBrowserLock. Two simultaneous Chromium
  // instances is exactly the kind of compounding that tips a 512MB
  // container over the edge.
  return withBrowserLock(async () => {
  let browser, ctx;
  try {
    browser = await launchStealthBrowser();
    ctx = await newStealthContext(browser);
    const page = await ctx.newPage();

    const login = await loginLinkedIn(page, { username: credRow.username, password });
    if (!login.ok) {
      await markInvalidCredentials(post.user_id, 'linkedin', login.error);
      await db.prepare(`UPDATE content_posts SET status = 'failed', publish_error = ?, updated_at = ? WHERE id = ?`)
        .run(`Login failed: ${login.error}`.slice(0, 500), nowStr(), postId);
      return { ok: false, error: 'login_failed' };
    }
    await db.prepare(`UPDATE portal_credentials SET last_login_at = ?, last_login_error = NULL WHERE user_id = ? AND portal = 'linkedin'`)
      .run(nowStr(), post.user_id);

    await fillComposer(page, post.content);
    const result = await clickPostAndVerify(page);

    if (!result.ok) {
      await db.prepare(`UPDATE content_posts SET status = 'failed', publish_error = ?, updated_at = ? WHERE id = ?`)
        .run(result.error.slice(0, 500), nowStr(), postId);
      await db.prepare(`INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'warn', ?, ?)`)
        .run(randomUUID(), post.user_id, 'Content AI: publish needs manual check',
          `Could not confirm a post was published to LinkedIn — please check linkedin.com/feed manually and reconcile before retrying. Error: ${result.error.slice(0, 200)}`);
      return { ok: false, error: result.error };
    }

    await db.prepare(`UPDATE content_posts SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`)
      .run(nowStr(), nowStr(), postId);
    return { ok: true };
  } catch (e) {
    await db.prepare(`UPDATE content_posts SET status = 'failed', publish_error = ?, updated_at = ? WHERE id = ?`)
      .run(String(e.message || e).slice(0, 500), nowStr(), postId);
    return { ok: false, error: e.message };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
  });
}

let _cycleRunning = false;

/**
 * Publishes every approved post whose scheduled_for has arrived. Sequential,
 * one browser session at a time — same reasoning as autoApplyWorker.js.
 */
async function runPublishCycle() {
  if (_cycleRunning) return { skipped: true, reason: 'already running' };
  _cycleRunning = true;
  try {
    const now = nowStr();
    const due = await db.prepare(
      `SELECT id FROM content_posts WHERE status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for <= ?`
    ).all(now);

    let published = 0, failed = 0;
    for (const { id } of due) {
      const result = await publishPost(id);
      if (result.ok) published++; else failed++;
    }
    return { published, failed, total: due.length };
  } finally {
    _cycleRunning = false;
  }
}

module.exports = { publishPost, runPublishCycle };
