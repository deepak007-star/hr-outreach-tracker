'use strict';

// Real, logged-in auto-apply for Naukri, Instahyre, and Foundit. Foundit's
// login handler is UNVERIFIED even at the page-load level — its homepage
// returned a WAF "Access Denied" on every attempt from this dev sandbox
// (default Chromium, real-browser-channel stealth, and twice more through
// different residential proxy exit IPs). It's included anyway since that
// block may be specific to this sandbox's network rather than foundit.in
// broadly — worth retesting once actually deployed. Every design choice
// here optimizes for "fail safe," never "assume success":
//   - A failed login marks the credential 'invalid' and STOPS — never
//     retries with a possibly-wrong password (a fast way to get an account
//     flagged for suspicious activity).
//   - A screening question with no answer-bank match aborts that ONE
//     submission into status='needs_review' — never partially submits, never
//     guesses. The existing manual Apply Queue is the safety net for every
//     case this can't confidently handle.
//   - The apply-button/question-detection selectors below are best-effort
//     guesses across common patterns on these two sites — NOT yet verified
//     against a real logged-in session. This is expected and by design per
//     the approved plan: the login step is real and tested; the apply-click
//     step must be hardened live, portal by portal, with the user's own test
//     credentials entered through the app's encrypted storage (never pasted
//     into a chat) before enabling this for real. Until then, treat any
//     apply-click uncertainty as `needs_review`, not a submission.
//   - N consecutive submission failures on a portal auto-pauses it.
//   - One portal's browser session at a time; human-like delay between
//     applications.

const crypto = require('crypto');
const db = require('../db/database');
const { decrypt } = require('../services/tokenCrypto');
const { checkAutoApplyAllowed, saveQueueConfig, getQueueConfig } = require('./applyQueue');
const logger = require('../lib/logger');
const { launchStealthBrowser, newStealthContext, withBrowserLock } = require('../lib/browserStealth');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const CONSECUTIVE_FAILURE_LIMIT = 3;

const FAILURE_TEXT_RE = /invalid|incorrect|doesn.?t match|does not match|wrong password|captcha|verify you.?re (a )?human|too many (attempts|requests)|account (is )?locked|something went wrong/i;

// ── Browser / stealth: launchStealthBrowser/newStealthContext now live in
// lib/browserStealth.js, shared with agents/content/linkedinPublisher.js ──

// ── Login handlers — real, verified selectors (confirmed live against the
// actual public login pages this session; the form fill/submit flow itself
// has NOT been confirmed against a real successful login yet, since that
// requires real credentials — the failure-detection heuristic below is the
// safety net for that gap: default to "not logged in" unless clearly proven
// otherwise). ──

function hasFailureText(text) {
  return FAILURE_TEXT_RE.test(text || '');
}

const LOGIN_HANDLERS = {
  // Confirmed selectors: #usernameField, #passwordField, submit button
  // text "Login" (a second "Use OTP to Login" button exists — must not match that).
  naukri: async (page, { username, password }) => {
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1500 + Math.random() * 1000);
    await page.fill('#usernameField', username);
    await page.fill('#passwordField', password);
    const loginBtn = page.locator('button:has-text("Login")').filter({ hasNotText: 'OTP' }).first();
    await loginBtn.click({ timeout: 10000 });
    await page.waitForTimeout(4000);
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (url.includes('/nlogin/login') || hasFailureText(bodyText)) {
      return { ok: false, error: bodyText.slice(0, 300) || 'Still on login page after submit' };
    }
    return { ok: true };
  },
  // Confirmed selectors: nav link "LOGIN" opens a modal with input[name=email],
  // input[name=password], and a submit button labeled "Login".
  instahyre: async (page, { username, password }) => {
    await page.goto('https://www.instahyre.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200 + Math.random() * 800);
    await page.locator('text=LOGIN').first().click({ timeout: 8000 });
    await page.waitForTimeout(1000);
    await page.fill('input[name="email"]', username);
    await page.fill('input[name="password"]', password);
    await page.locator('button:has-text("Login"), input[type="submit"][value="Login"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(4000);
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const stillHasForm = await page.locator('input[name="password"]').count();
    if (stillHasForm > 0 || hasFailureText(bodyText)) {
      return { ok: false, error: bodyText.slice(0, 300) || 'Login form still present after submit' };
    }
    return { ok: true };
  },
  // UNVERIFIED — foundit.in's homepage returned a WAF "Access Denied" on
  // every attempt this session (default Chromium, real-browser-channel
  // stealth, and twice more through two different residential proxy exit
  // IPs) — never once got far enough to see a real page, let alone the
  // login form. Selectors below are generic guesses (common seeker-portal
  // patterns), not confirmed against real markup like naukri/instahyre's
  // are. Could genuinely work once run from Render's network instead of
  // this dev sandbox's — that's untested. Fails safe either way: an
  // unreachable/changed page just returns ok:false and the credential gets
  // marked invalid with the real error message, it never assumes success.
  foundit: async (page, { username, password }) => {
    await page.goto('https://www.foundit.in/seeker/login', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1500 + Math.random() * 1000);
    const bodyTextBefore = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (/access denied|blocked|forbidden/i.test(bodyTextBefore)) {
      return { ok: false, error: `Page blocked before a login form ever loaded: ${bodyTextBefore.slice(0, 200)}` };
    }
    const emailField = page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]').first();
    const passField  = page.locator('input[type="password"]').first();
    if (await emailField.count() === 0 || await passField.count() === 0) {
      return { ok: false, error: 'No recognizable login form found on foundit.in — selectors need live verification' };
    }
    await emailField.fill(username);
    await passField.fill(password);
    await page.locator('button:has-text("Login"), button[type="submit"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(4000);
    const bodyText2 = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const stillHasForm2 = await passField.count();
    if (stillHasForm2 > 0 || hasFailureText(bodyText2)) {
      return { ok: false, error: bodyText2.slice(0, 300) || 'Login form still present after submit' };
    }
    return { ok: true };
  },
};

async function loginPortal(page, portal, creds) {
  const handler = LOGIN_HANDLERS[portal];
  if (!handler) return { ok: false, error: `no login handler for portal '${portal}'` };
  try {
    return await handler(page, creds);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Answer matching — deliberately dumb and literal. No fuzzy/LLM guessing:
// a screening question is exactly the place a wrong guess does the most
// damage, so only an explicit, user-authored substring match counts. ──

function matchAnswer(questionText, bank) {
  const q = (questionText || '').toLowerCase();
  for (const entry of bank) {
    if (entry.question_pattern && q.includes(entry.question_pattern.toLowerCase())) return entry.answer;
  }
  return null;
}

// ── Apply-click + screening-question handling — BEST-EFFORT, NOT YET
// VERIFIED against a real logged-in apply flow. Generic selectors across
// common patterns; every branch that can't confirm what it's looking at
// returns needs_review instead of guessing or submitting. This function is
// the one that most needs live hardening (see file header). ──

const APPLY_BUTTON_SELECTORS = [
  'button:has-text("Apply")', 'button:has-text("Quick Apply")', 'button:has-text("Easy Apply")',
  'a:has-text("Apply")', '[class*="apply-button"]', '[class*="btn-apply"]',
];
// Common screening-question container patterns — a real question block
// almost always pairs a label/question text with an input/select/textarea.
const QUESTION_BLOCK_SELECTOR = 'form label, [class*="question"], [class*="form-group"]';

async function attemptApply(page, job, bank) {
  const log = { job_id: job.id, title: job.title, company: job.company, questions: [] };
  try {
    await page.goto(job.apply_link || job.link, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000 + Math.random() * 1500);

    let applyBtn = null;
    for (const sel of APPLY_BUTTON_SELECTORS) {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) { applyBtn = loc; break; }
    }
    if (!applyBtn) {
      log.error = 'No recognizable Apply button found on the job page';
      return { status: 'needs_review', log };
    }
    await applyBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2500 + Math.random() * 1500);

    // Detect screening questions: any labeled input/select/textarea that
    // appeared after the apply click. If the portal's quick-apply has NO
    // extra questions (the common case for a fully-completed profile), this
    // finds nothing and we proceed straight to the final-submit check below.
    const questionBlocks = await page.evaluate((sel) => {
      const blocks = [...document.querySelectorAll(sel)];
      return blocks
        .map(b => {
          const label = b.innerText?.trim().slice(0, 200) || '';
          const hasField = !!b.querySelector('input, select, textarea');
          return { label, hasField };
        })
        .filter(b => b.label && b.hasField);
    }, QUESTION_BLOCK_SELECTOR).catch(() => []);

    for (const qb of questionBlocks) {
      const answer = matchAnswer(qb.label, bank);
      log.questions.push({ label: qb.label, matched: !!answer, answer: answer || null });
      if (!answer) {
        // Unmatched question — stop here. Nothing has been submitted yet;
        // this deliberately does NOT attempt to fill/submit partially.
        log.error = `Unmatched screening question: "${qb.label}"`;
        return { status: 'needs_review', log };
      }
    }

    // All detected questions matched (or there were none) — fill them, then
    // look for a final submit control. Filling is intentionally simple
    // (first input/select/textarea inside each matched block) since the
    // exact form structure per posting is still unverified; this is the
    // step most likely to need adjustment once tested live.
    for (const qb of questionBlocks) {
      // Re-locate live (the earlier pass was read-only via evaluate()).
      const block = page.locator(QUESTION_BLOCK_SELECTOR).filter({ hasText: qb.label }).first();
      const answer = matchAnswer(qb.label, bank);
      const field = block.locator('input, select, textarea').first();
      const tag = await field.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input');
      if (tag === 'select') await field.selectOption({ label: answer }).catch(() => field.selectOption(answer).catch(() => {}));
      else await field.fill(String(answer)).catch(() => {});
    }

    const submitBtn = page.locator('button:has-text("Submit"), button[type="submit"]:has-text("Apply")').first();
    if (await submitBtn.count() === 0) {
      log.error = 'No final submit control found after filling questions';
      return { status: 'needs_review', log };
    }
    await submitBtn.click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (hasFailureText(bodyText) || /error|failed/i.test(bodyText.slice(0, 500))) {
      log.error = 'Post-submit page shows an error/failure indicator';
      return { status: 'needs_review', log };
    }

    return { status: 'applied', log };
  } catch (e) {
    log.error = e.message;
    return { status: 'error', log };
  }
}

// ── Credential invalidation + notification ──────────────────────────────────

async function markInvalidCredentials(userId, portal, error) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(`
    UPDATE portal_credentials SET status = 'invalid', last_login_error = ?, last_login_at = ?, updated_at = ?
    WHERE user_id = ? AND portal = ?
  `).run(String(error || '').slice(0, 500), now, now, userId, portal);
  await db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'error', ?, ?)
  `).run(
    crypto.randomUUID(), userId, `Auto-apply: ${portal} login failed`,
    `Your ${portal} credentials failed to log in and have been marked invalid — auto-apply for this portal is paused until you re-enter them in Auto-Apply Settings. Error: ${String(error || '').slice(0, 200)}`
  );
  logger.warn(`[auto-apply] ${portal} credentials marked invalid`, { userId, error: String(error || '').slice(0, 200) });
}

async function pausePortal(userId, portal, reason) {
  await saveQueueConfig({ auto_apply: { enabled: { [portal]: false } } });
  await db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'warn', ?, ?)
  `).run(
    crypto.randomUUID(), userId, `Auto-apply: ${portal} paused`,
    `Auto-apply for ${portal} was automatically paused after repeated submission failures (${reason}). Check Auto-Apply Settings and the affected jobs (now in Needs Review) before re-enabling.`
  );
  logger.warn(`[auto-apply] ${portal} auto-paused`, { userId, reason });
}

// ── Main entry point — one portal, one user, one run ────────────────────────

async function runPortalForUser(userId, portal) {
  const allowed = await checkAutoApplyAllowed(userId, portal);
  if (!allowed.allowed) {
    return { processed: 0, applied: 0, needsReview: 0, reason: allowed.reason };
  }

  const credRow = await db.prepare(
    'SELECT username, password_encrypted FROM portal_credentials WHERE user_id = ? AND portal = ?'
  ).get(userId, portal);
  if (!credRow) return { processed: 0, applied: 0, needsReview: 0, reason: 'no_credentials' };

  const password = decrypt(credRow.password_encrypted);
  const bank = await db.prepare('SELECT question_pattern, answer FROM apply_answer_bank WHERE user_id = ?').all(userId);

  // Serialized with the LinkedIn content publisher's browser too — see
  // lib/browserStealth.js's withBrowserLock. Two simultaneous Chromium
  // instances is exactly the kind of compounding that tips a 512MB
  // container over the edge.
  return withBrowserLock(async () => {
  let browser;
  let applied = 0, needsReview = 0, consecutiveFailures = 0;
  try {
    browser = await launchStealthBrowser();
    const ctx = await newStealthContext(browser);
    const page = await ctx.newPage();

    const login = await loginPortal(page, portal, { username: credRow.username, password });
    if (!login.ok) {
      await markInvalidCredentials(userId, portal, login.error);
      return { processed: 0, applied: 0, needsReview: 0, reason: 'login_failed' };
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(
      `UPDATE portal_credentials SET last_login_at = ?, last_login_error = NULL WHERE user_id = ? AND portal = ?`
    ).run(now, userId, portal);
    logger.info(`[auto-apply] ${portal} login succeeded`, { userId });

    let remaining = allowed.remaining;
    const queued = await db.prepare(`
      SELECT * FROM job_applications WHERE user_id = ? AND scraper_type = ? AND status = 'queued'
      ORDER BY match_percent DESC, queued_at ASC LIMIT ?
    `).all(userId, portal, remaining);

    for (const job of queued) {
      if (remaining <= 0) break;
      // Re-check live in case the global pause / cap changed mid-run.
      const stillAllowed = await checkAutoApplyAllowed(userId, portal);
      if (!stillAllowed.allowed) {
        logger.info(`[auto-apply] ${portal} stopping mid-run`, { userId, reason: stillAllowed.reason });
        break;
      }

      const result = await attemptApply(page, job, bank);
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);

      if (result.status === 'applied') {
        await db.prepare(
          `UPDATE job_applications SET status = 'applied', submission_mode = 'auto', applied_at = ?, auto_apply_log = ? WHERE id = ?`
        ).run(ts, JSON.stringify(result.log), job.id);
        applied++; remaining--; consecutiveFailures = 0;
      } else if (result.status === 'needs_review') {
        await db.prepare(
          `UPDATE job_applications SET status = 'needs_review', auto_apply_log = ? WHERE id = ?`
        ).run(JSON.stringify(result.log), job.id);
        needsReview++; consecutiveFailures = 0; // an unmatched question isn't an automation failure
      } else {
        await db.prepare(`UPDATE job_applications SET auto_apply_log = ? WHERE id = ?`).run(JSON.stringify(result.log), job.id);
        consecutiveFailures++;
        logger.warn(`[auto-apply] ${portal} submission error`, { userId, jobId: job.id, error: result.log?.error });
        if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
          await pausePortal(userId, portal, `${consecutiveFailures} consecutive submission failures`);
          break;
        }
      }

      // Human-like pacing between applications — never fire them back-to-back.
      await sleep(8000 + Math.random() * 12000);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return { processed: applied + needsReview, applied, needsReview };
  });
}

// ── On-demand login test ─────────────────────────────────────────────────────
// Exposed via POST /api/apply-automation/credentials/:portal/test so the user
// can get an immediate answer to "does this actually work now" instead of
// waiting for the next scheduled cycle (every 3h) — same login code path the
// worker runs unattended, just triggered by an explicit user click on their
// own stored credentials rather than a timer. Works regardless of the
// credential's current status (including 'invalid') since the whole point is
// re-testing after a fix; a fresh success clears 'invalid' the same way a
// fresh failure would set it.
async function testLogin(userId, portal) {
  const credRow = await db.prepare(
    'SELECT username, password_encrypted FROM portal_credentials WHERE user_id = ? AND portal = ?'
  ).get(userId, portal);
  if (!credRow) return { ok: false, error: 'no_credentials' };

  const password = decrypt(credRow.password_encrypted);

  return withBrowserLock(async () => {
    let browser, ctx;
    try {
      browser = await launchStealthBrowser();
      ctx = await newStealthContext(browser);
      const page = await ctx.newPage();

      const login = await loginPortal(page, portal, { username: credRow.username, password });
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      if (!login.ok) {
        await markInvalidCredentials(userId, portal, login.error);
        return { ok: false, error: login.error };
      }
      await db.prepare(
        `UPDATE portal_credentials SET status = 'active', last_login_at = ?, last_login_error = NULL WHERE user_id = ? AND portal = ?`
      ).run(now, userId, portal);
      logger.info(`[auto-apply] ${portal} test login succeeded`, { userId });
      return { ok: true };
    } catch (e) {
      await markInvalidCredentials(userId, portal, e.message);
      return { ok: false, error: e.message };
    } finally {
      if (ctx) await ctx.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  });
}

// ── Scheduler entry point ────────────────────────────────────────────────────
// Iterates every user with an active credential row for an enabled portal,
// running them ONE AT A TIME (never concurrent browser sessions — see file
// header) so this is safe to call from a single periodic timer.
async function runAutoApplyCycle() {
  const cfg = await getQueueConfig();
  if (cfg.auto_apply.paused) {
    logger.info('[auto-apply] cycle skipped — globally paused');
    return { skipped: true, reason: 'globally_paused' };
  }

  const enabledPortals = Object.entries(cfg.auto_apply.enabled).filter(([, on]) => on).map(([p]) => p);
  if (!enabledPortals.length) return { skipped: true, reason: 'no_portals_enabled' };

  const rows = await db.prepare(`
    SELECT user_id, portal FROM portal_credentials
    WHERE status = 'active' AND portal = ANY(?)
  `).all(enabledPortals);

  const summary = [];
  for (const { user_id, portal } of rows) {
    try {
      const result = await runPortalForUser(user_id, portal);
      summary.push({ user_id, portal, ...result });
      logger.info(`[auto-apply] ${portal} run complete`, { userId: user_id, ...result });
    } catch (e) {
      logger.error(`[auto-apply] ${portal} run threw`, { userId: user_id, error: e.message });
      summary.push({ user_id, portal, error: e.message });
    }
  }
  return { skipped: false, summary };
}

module.exports = { runPortalForUser, runAutoApplyCycle, matchAnswer, loginPortal, attemptApply, markInvalidCredentials, testLogin };
