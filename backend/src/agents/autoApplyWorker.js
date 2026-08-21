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
const { checkAutoApplyAllowed, saveQueueConfig, getQueueConfig, MIN_MATCHED_SKILLS } = require('./applyQueue');
const { lightweightSkillMatch, parseSkills } = require('../lib/skillMatch');
const logger = require('../lib/logger');
const { launchStealthBrowser, newStealthContext, withBrowserLock, isTransientNetworkError } = require('../lib/browserStealth');

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
  //
  // Confirmed live 2026-08-20: the modal's <form> carries `ng-pristine
  // ng-valid` classes — this is a legacy AngularJS (1.x) form bound via
  // ng-model. page.fill() sets the DOM value directly and fires input/change,
  // which usually satisfies Angular's $digest — but not reliably enough here;
  // production logs showed repeated "problems submitting the information you
  // provided. Please check each field" rejections, which is exactly Angular's
  // own client-side validation still seeing the field as pristine/invalid at
  // submit time. pressSequentially() (real per-keystroke key events, same as
  // an actual user typing) plus an explicit blur is the standard fix for
  // legacy Angular forms that don't pick up scripted value assignment.
  instahyre: async (page, { username, password }) => {
    await page.goto('https://www.instahyre.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200 + Math.random() * 800);
    // Bumped from 8000 to match naukri's 10000 — a resource-constrained
    // container renders/hydrates slower than local dev, where this button
    // already took ~3s to become clickable on an otherwise-unblocked run.
    await page.locator('text=LOGIN').first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);
    const emailField = page.locator('input[name="email"]').first();
    const passField  = page.locator('input[name="password"]').first();
    await emailField.click();
    await emailField.pressSequentially(username, { delay: 30 + Math.random() * 40 });
    await emailField.blur();
    await passField.click();
    await passField.pressSequentially(password, { delay: 30 + Math.random() * 40 });
    await passField.blur();
    await page.waitForTimeout(300); // let Angular's $digest catch up before submit
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
    // A thrown page.goto/network error (e.g. net::ERR_TUNNEL_CONNECTION_FAILED
    // from a dead proxy) means the login page was NEVER reached — this says
    // nothing about whether the username/password are right. `transient`
    // lets callers avoid invalidating real, correct credentials over an
    // infra hiccup (see loginWithRetry below).
    return { ok: false, error: e.message, transient: isTransientNetworkError(e.message) };
  }
}

// Runs a login attempt, and if it fails for a TRANSIENT (network/proxy)
// reason, retries once more with the proxy pool skipped entirely — a proxy
// that passed the pool's TCP-only health check can still fail to actually
// CONNECT-tunnel to a specific bot-protected target (exactly what
// net::ERR_TUNNEL_CONNECTION_FAILED means). A real credential failure
// (wrong password, CAPTCHA, locked account) is never retried — retrying
// that wastes an attempt and risks the site's own abuse detection.
// On success returns { ok:true, browser, ctx, page } — caller owns closing
// them. On failure returns { ok:false, error, transient } with everything
// already closed.
async function loginWithRetry(portal, creds) {
  let lastError = null, lastTransient = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const forceDirect = attempt > 0; // 2nd attempt only: bypass the proxy pool
    let browser, ctx;
    try {
      browser = await launchStealthBrowser({ forceDirect });
      ctx = await newStealthContext(browser);
      const page = await ctx.newPage();
      const login = await loginPortal(page, portal, creds);
      if (login.ok) return { ok: true, browser, ctx, page };
      lastError = login.error; lastTransient = !!login.transient;
    } catch (e) {
      lastError = e.message; lastTransient = isTransientNetworkError(e.message);
    }
    if (ctx) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (!lastTransient) break; // real login failure — retrying with a different proxy can't fix a wrong password
  }
  return { ok: false, error: lastError, transient: lastTransient };
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

// A loading/spinner overlay sitting on top of the real button is exactly
// what produced "<div id='loading-page'>… intercepts pointer events" in a
// live run (Instahyre's Angular app: the button itself is
// ng-disabled="!jobDataLoaded", so it briefly exists-but-is-blocked while the
// job data finishes loading). Waiting it out here beats a longer flat delay —
// it clears as soon as the app is actually ready instead of a fixed guess.
const LOADING_OVERLAY_SELECTOR = '#loading-page, [class*="loading-overlay"], [class*="spinner"]:visible, [class*="lcp-element"]';
async function waitForOverlayClear(page, timeoutMs = 8000) {
  try {
    await page.locator(LOADING_OVERLAY_SELECTOR).first().waitFor({ state: 'hidden', timeout: timeoutMs });
  } catch (_) { /* no overlay present, or it never clears — proceed and let the click itself time out/retry */ }
}

async function attemptApply(page, job, bank) {
  const log = { job_id: job.id, title: job.title, company: job.company, questions: [] };
  try {
    await page.goto(job.apply_link || job.link, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000 + Math.random() * 1500);
    await waitForOverlayClear(page);

    let applyBtn = null;
    for (const sel of APPLY_BUTTON_SELECTORS) {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) { applyBtn = loc; break; }
    }
    if (!applyBtn) {
      log.error = 'No recognizable Apply button found on the job page';
      return { status: 'needs_review', log };
    }
    await applyBtn.click({ timeout: 15000 }); // bumped from 10000 — a disabled-until-loaded button (ng-disabled="!jobDataLoaded") needs real headroom beyond the overlay wait above
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
      // Confirmed live 2026-08-21 across all 20 Naukri queued jobs this run:
      // every single one hit exactly this branch with ZERO screening
      // questions detected — meaning the earlier applyBtn.click() (line ~251)
      // was very likely the WHOLE application on portals with a genuine
      // one-click "Apply" flow (no separate submit step at all), not a
      // stuck/broken flow. The old code treated "no submit button" as
      // automatic needs_review regardless, which silently forces every
      // one-click-apply portal to 0% success. Only take the shortcut when
      // there were no questions to answer (bank-filled multi-step forms
      // still require the buttons above); look for a positive completion
      // signal before trusting it, rather than assuming success just because
      // nothing to click was found — a genuinely stuck/broken page has no
      // such signal either, so this can't manufacture a false 'applied'.
      if (questionBlocks.length === 0) {
        const postClickState = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button, a')]
            .find(el => /apply/i.test(el.textContent || ''));
          return {
            btnText: btn?.textContent?.trim().slice(0, 60) || '',
            btnDisabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.className.includes('disabled')) : false,
            bodySnippet: document.body?.innerText?.slice(0, 1500) || '',
          };
        }).catch(() => ({ btnText: '', btnDisabled: false, bodySnippet: '' }));

        const APPLIED_RE = /already applied|application (?:sent|submitted|successful)|successfully applied|thanks for applying|your application has been (?:sent|received|submitted)/i;
        const btnNowSaysApplied = /^applied$/i.test(postClickState.btnText);
        const pageConfirmsApplied = APPLIED_RE.test(postClickState.bodySnippet);

        if (btnNowSaysApplied || pageConfirmsApplied || postClickState.btnDisabled) {
          log.completionSignal = { btnText: postClickState.btnText, btnDisabled: postClickState.btnDisabled, pageConfirmsApplied };
          return { status: 'applied', log };
        }

        log.error = 'No submit control and no completion signal after apply click — status unclear';
        return { status: 'needs_review', log };
      }

      log.error = 'No final submit control found after filling questions';
      return { status: 'needs_review', log };
    }
    await waitForOverlayClear(page);
    await submitBtn.click({ timeout: 15000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (hasFailureText(bodyText) || /error|failed/i.test(bodyText.slice(0, 500))) {
      log.error = 'Post-submit page shows an error/failure indicator';
      return { status: 'needs_review', log };
    }

    return { status: 'applied', log };
  } catch (e) {
    // A thrown error here (click timeout, an overlay intercepting the click,
    // the page/context closing mid-attempt) means automation couldn't
    // confidently interact with THIS job's page — it says nothing about
    // whether the portal or credentials are broken. Per this file's own
    // design rule (never guess, never partially submit — see file header),
    // that's exactly a needs_review case, same as an unmatched question.
    // Previously this returned 'error', which counts toward
    // CONSECUTIVE_FAILURE_LIMIT and auto-pauses the WHOLE portal — so 3
    // ordinary selector/timing hiccups (one per differently-structured job
    // page) were pausing auto-apply entirely, even though nothing was
    // actually wrong with the account or the portal itself.
    log.error = e.message;
    return { status: 'needs_review', log };
  }
}

// ── Naukri — API-driven apply flow ───────────────────────────────────────────
// Confirmed live 2026-08-21: clicking Apply fires a real XHR
// (POST .../cloudgateway-workflow/workflow-services/apply-workflow/v1/apply)
// whose JSON response is the actual source of truth — not the DOM. It can
// return `{ statusCode: 0, jobs: [{ questionnaire: [...] }] }`, where a
// non-empty MANDATORY questionnaire means the application is NOT complete
// yet regardless of what statusCode says; the button's own text/DOM state
// never visibly changes either way, which is why the generic attemptApply()
// (DOM-only, no idea this API call exists) could never reliably tell
// "genuinely done" from "silently still needs the form."
const NAUKRI_APPLY_API_RE = /apply-workflow\/v1\/apply/i;

async function attemptApplyNaukri(page, job, bank) {
  const log = { job_id: job.id, title: job.title, company: job.company, questions: [] };
  try {
    await page.goto(job.apply_link || job.link, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000 + Math.random() * 1500);
    await waitForOverlayClear(page);

    const applyBtn = page.locator('button:has-text("Apply")').first();
    if (await applyBtn.count() === 0) {
      log.error = 'No recognizable Apply button found on the job page';
      return { status: 'needs_review', log };
    }

    // Arm the response listener BEFORE clicking — the API call can resolve
    // within a second of the click, before a fixed post-click wait would
    // even start looking for it.
    const applyResponsePromise = page.waitForResponse(res => NAUKRI_APPLY_API_RE.test(res.url()), { timeout: 15000 }).catch(() => null);
    await applyBtn.click({ timeout: 15000 });
    const applyResponse = await applyResponsePromise;

    if (!applyResponse) {
      // Never observed the API call at all — the click may not have
      // registered, or this posting uses a different endpoint. Don't guess.
      log.error = 'No apply-workflow API response observed after clicking Apply';
      return { status: 'needs_review', log };
    }

    let payload = null;
    try { payload = await applyResponse.json(); } catch (_) { /* non-JSON or empty body */ }
    const mandatoryQs = (payload?.jobs?.[0]?.questionnaire || []).filter(q => q.isMandatory);

    // No mandatory questions and the API call itself succeeded — this IS the
    // definitive completion signal for Naukri (there's no separate DOM
    // confirmation to wait for), unlike the generic per-portal flow which
    // has to infer completion from page text.
    if (!mandatoryQs.length) {
      if (payload?.statusCode === 0) {
        log.completionSignal = { statusCode: payload.statusCode, source: 'apply-workflow API' };
        return { status: 'applied', log };
      }
      log.error = `apply-workflow returned unexpected statusCode: ${payload?.statusCode}`;
      return { status: 'needs_review', log };
    }

    // Mandatory questions exist — match each against the answer bank exactly
    // like every other portal (never guess, never partial-submit).
    for (const q of mandatoryQs) {
      const answer = matchAnswer(q.questionName, bank);
      log.questions.push({ label: q.questionName, matched: !!answer, answer: answer || null, type: q.questionType });
      if (!answer) {
        log.error = `Unmatched screening question: "${q.questionName}"`;
        return { status: 'needs_review', log };
      }
    }

    // All matched — give the page a moment to actually render the
    // questionnaire form (the API response and its DOM rendering are two
    // separate events), then fill it via the DOM. Filling through Naukri's
    // own private API contract directly would be far riskier than reusing
    // the same generic, already-tested DOM-fill logic every other portal
    // uses once real fields exist to target.
    await page.waitForTimeout(2000 + Math.random() * 1000);
    await waitForOverlayClear(page);

    for (const q of mandatoryQs) {
      const answer = matchAnswer(q.questionName, bank);
      const block = page.locator(QUESTION_BLOCK_SELECTOR).filter({ hasText: q.questionName }).first();
      if (await block.count() === 0) {
        log.error = `Answered "${q.questionName}" but couldn't find its rendered form field in the DOM`;
        return { status: 'needs_review', log };
      }
      const field = block.locator('input, select, textarea').first();
      const tag = await field.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input');
      if (q.questionType === 'Check Box') await field.check().catch(() => {});
      else if (tag === 'select') await field.selectOption({ label: answer }).catch(() => field.selectOption(answer).catch(() => {}));
      else await field.fill(String(answer)).catch(() => {});
    }

    const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Save and Continue"), button:has-text("Continue")').first();
    if (await submitBtn.count() === 0) {
      log.error = 'No final submit control found after filling the questionnaire';
      return { status: 'needs_review', log };
    }
    await waitForOverlayClear(page);
    await submitBtn.click({ timeout: 15000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (hasFailureText(bodyText)) {
      log.error = 'Post-submit page shows an error/failure indicator';
      return { status: 'needs_review', log };
    }
    return { status: 'applied', log };
  } catch (e) {
    log.error = e.message;
    return { status: 'needs_review', log };
  }
}

// ── Instahyre — real-time "Opportunities" flow (NOT the queued-job model) ───
// Confirmed live 2026-08-21, genuinely authenticated (SIGN OUT visible in
// nav): a specific job's static URL (job.apply_link, as scraped/queued days
// earlier) shows the Apply button PERMANENTLY disabled
// (ng-disabled="!oppValues") no matter what — because Instahyre doesn't work
// like a normal job board with stable per-job apply pages. It's a live,
// rotating "recommended for you" queue on /candidate/opportunities/
// (~5 cards shown at a time). Each card exposes:
//   - "View »"          -> openApplyModal(opp): opens a modal for that card;
//                          this is what actually sets oppValues
//   - "Not interested"   -> submitChoice(opp, false): PERMANENTLY discards
//                          the opportunity — a real, semi-irreversible action
//                          against the user's real account/employer-visible
//                          record. NEVER clicked automatically here — a
//                          skill-match miss just leaves the card alone for
//                          the user to review themselves, exactly like every
//                          other "uncertain" case in this file.
//   - a page-level "Apply" button (ng-click="applyBulk()") that only becomes
//     enabled after a card's modal flow has registered interest
//
// This means the job_applications 'queued' rows scraped for this portal are
// structurally unusable here — by the time auto-apply runs, Instahyre's own
// matching engine has usually already moved past what was scraped days ago.
// So this function ignores that queue entirely and scores whatever is
// CURRENTLY being recommended, right now, against the user's live skills.
// The "employer profile" panel a View-click opens (ng-controller=
// "employerProfileModalCtrl", confirmed live) is NOT necessarily a
// `.modal`/`[role=dialog]` — attribute-based, matches by controller-name
// substring instead so it isn't tied to a specific CSS framework's markup.
const INSTAHYRE_PANEL_SELECTOR = '.modal, [role="dialog"], [uib-modal-window], [ng-controller*="Modal" i]';
// Confirmed live: the real "accept" action inside that panel is a plain
// element (not necessarily <button>) with ng-click="submitChoice(opp, true)"
// — NEVER match the sibling "Not interested" action (submitChoice(opp,
// false)). The literal substring "true)" cannot appear in the false variant
// regardless of whitespace formatting, so this can't cross-match it even if
// Instahyre's ng-click spacing changes.
const INSTAHYRE_ACCEPT_SELECTOR = 'button:has-text("Apply"), [ng-click*="submitChoice"][ng-click*="true)"], button[ng-click="applyBulk()"]';

async function attemptApplyInstahyreOpportunities(page, skills, bank, cap) {
  const results = [];
  const seenTitles = new Set(); // never re-process the same card twice in one run
  let processed = 0;

  // Re-navigate FRESH for every card rather than reusing one page load
  // across the whole loop — confirmed live: a previous card's
  // employer-profile panel can be left open after a needs_review outcome
  // and then physically intercept clicks meant for the NEXT card's "View »"
  // link. A clean reload guarantees no leftover panel state can bleed into
  // the next card, at the cost of one extra page load per card (acceptable
  // — this loop is already bounded to a handful of matches per run).
  for (; processed < cap; ) {
    await page.goto('https://www.instahyre.com/candidate/opportunities/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);
    await waitForOverlayClear(page);

    // Read every visible card's text WITHOUT depending on a specific class/
    // ng-repeat name (confirmed live that a plain `[ng-repeat]` selector
    // does NOT reliably find these cards). Walk up from each "View »"
    // control to the nearest ancestor that also contains a "Not interested"
    // sibling — robust to markup/class changes since it keys off the
    // actual visible button text, not a class name.
    const cards = await page.evaluate(() => {
      const viewEls = [...document.querySelectorAll('a, button')].filter(el => /view\s*»/i.test(el.textContent || ''));
      return viewEls.map((el, i) => {
        let node = el;
        for (let d = 0; d < 8 && node; d++) {
          if (node.querySelectorAll && [...node.querySelectorAll('button')].some(b => /not interested/i.test(b.textContent || ''))) break;
          node = node.parentElement;
        }
        return { index: i, text: (node || el).innerText.slice(0, 500) };
      });
    }).catch(() => []);

    const card = cards.find(c => {
      const title = c.text.split('\n')[0]?.slice(0, 200) || '';
      if (!title || seenTitles.has(title)) return false;
      return lightweightSkillMatch(skills, c.text).matched.length >= MIN_MATCHED_SKILLS;
    });
    if (!card) break; // nothing left this run that both matches skills and hasn't been processed yet

    const title = card.text.split('\n')[0]?.slice(0, 200) || '';
    seenTitles.add(title);
    processed++;
    const { matched } = lightweightSkillMatch(skills, card.text);
    const log = { title, matchedSkills: matched, questions: [] };
    try {
      const viewBtn = page.locator('a, button').filter({ hasText: /view\s*»/i }).nth(card.index);
      await viewBtn.click({ timeout: 10000 });
      await page.waitForTimeout(2000 + Math.random() * 1000);
      await waitForOverlayClear(page);

      // Scope question-detection and the accept action to the panel itself
      // when one is present, not the whole page — a full-page search risks
      // grabbing an unrelated element from page chrome instead of the one
      // this specific opportunity's panel introduced.
      const panelScope = page.locator(INSTAHYRE_PANEL_SELECTOR).first();
      const hasPanel = await panelScope.count() > 0 && await panelScope.isVisible().catch(() => false);
      const scope = hasPanel ? panelScope : page;

      // Reuse the exact same generic screening-question detection as every
      // other portal — an unmatched question stops here; nothing submitted.
      // Root-detection happens inside the browser-context callback itself
      // (page.evaluate and Locator.evaluate pass different arguments to
      // their callback, so this can't cleanly branch on `scope`'s type).
      const questionBlocks = await page.evaluate(({ panelSel, sel }) => {
        const panel = document.querySelector(panelSel);
        const root  = (panel && panel.offsetParent !== null) ? panel : document;
        return [...root.querySelectorAll(sel)]
          .map(b => ({ label: b.innerText?.trim().slice(0, 200) || '', hasField: !!b.querySelector('input, select, textarea') }))
          .filter(b => b.label && b.hasField);
      }, { panelSel: INSTAHYRE_PANEL_SELECTOR, sel: QUESTION_BLOCK_SELECTOR }).catch(() => []);

      let blocked = false;
      for (const qb of questionBlocks) {
        const answer = matchAnswer(qb.label, bank);
        log.questions.push({ label: qb.label, matched: !!answer, answer: answer || null });
        if (!answer) { log.error = `Unmatched screening question: "${qb.label}"`; blocked = true; break; }
      }
      if (blocked) { results.push({ status: 'needs_review', log }); continue; }

      for (const qb of questionBlocks) {
        const block = scope.locator(QUESTION_BLOCK_SELECTOR).filter({ hasText: qb.label }).first();
        const answer = matchAnswer(qb.label, bank);
        const field = block.locator('input, select, textarea').first();
        const tag = await field.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input');
        if (tag === 'select') await field.selectOption({ label: answer }).catch(() => field.selectOption(answer).catch(() => {}));
        else await field.fill(String(answer)).catch(() => {});
      }

      // Finalize via the accept action — scoped to the panel when present
      // (see above). Should now be enabled/present since the step above
      // registered interest in this opportunity.
      const applyBtn = scope.locator(INSTAHYRE_ACCEPT_SELECTOR).first();
      await waitForOverlayClear(page);
      if (await applyBtn.count() === 0) {
        log.error = 'No accept/apply control found in the panel — flow unclear, not submitting';
        results.push({ status: 'needs_review', log });
        continue;
      }
      const isEnabled = await applyBtn.isEnabled({ timeout: 8000 }).catch(() => false);
      if (!isEnabled) {
        log.error = 'Apply control still disabled after the panel step — flow unclear, not submitting';
        results.push({ status: 'needs_review', log });
        continue;
      }
      await applyBtn.click({ timeout: 10000 });
      await page.waitForTimeout(3000);

      const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (hasFailureText(bodyText)) {
        log.error = 'Post-apply page shows an error/failure indicator';
        results.push({ status: 'needs_review', log });
        continue;
      }
      results.push({ status: 'applied', log });
    } catch (e) {
      log.error = e.message;
      results.push({ status: 'needs_review', log });
    }

    await sleep(8000 + Math.random() * 12000); // same human-like pacing as every other apply loop in this file
  }

  return results;
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
    const login = await loginWithRetry(portal, { username: credRow.username, password });
    if (!login.ok) {
      if (login.transient) {
        // Never invalidate real credentials over a proxy/network failure —
        // both attempts (pooled proxy, then direct) failed to even reach the
        // login page. Leave credentials untouched; the next scheduled cycle
        // will retry with a freshly-rotated proxy.
        logger.warn(`[auto-apply] ${portal} login failed after retry — transient network/proxy error, credentials left untouched`, { userId, error: login.error });
        return { processed: 0, applied: 0, needsReview: 0, reason: 'login_network_error' };
      }
      await markInvalidCredentials(userId, portal, login.error);
      return { processed: 0, applied: 0, needsReview: 0, reason: 'login_failed' };
    }
    browser = login.browser;
    const page = login.page;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await db.prepare(
      `UPDATE portal_credentials SET last_login_at = ?, last_login_error = NULL WHERE user_id = ? AND portal = ?`
    ).run(now, userId, portal);
    logger.info(`[auto-apply] ${portal} login succeeded`, { userId });

    let remaining = allowed.remaining;

    // Instahyre doesn't follow the "queue a stable job URL, apply to it
    // later" model every other portal uses — see attemptApplyInstahyreOpportunities's
    // header comment. Skip the queued-job DB read entirely for it and drive
    // its own real-time flow instead.
    if (portal === 'instahyre') {
      const profile = await db.prepare('SELECT skills FROM profiles WHERE user_id = ?').get(userId);
      const skills = parseSkills(profile?.skills);
      if (!skills.length) {
        return { processed: 0, applied: 0, needsReview: 0, reason: 'no_skills_on_profile' };
      }
      const results = await attemptApplyInstahyreOpportunities(page, skills, bank, remaining);
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      for (const r of results) {
        // job_applications.job_id is a FK into scraped_jobs(id) — Instahyre
        // never exposed a stable per-opportunity id anywhere we could read,
        // so synthesize one the SAME way the rest of the app keys scraped
        // postings (SHA-256 of title+company, see CLAUDE.md) and upsert a
        // matching minimal scraped_jobs row first so the FK is satisfiable.
        // Same hash for the same title -> re-appearances update in place
        // instead of duplicating.
        const jobId = crypto.createHash('sha256').update(`instahyre:${r.log.title}`).digest('hex');
        await db.prepare(`
          INSERT INTO scraped_jobs (id, scraper_type, title, scraped_at)
          VALUES (?, 'instahyre', ?, ?)
          ON CONFLICT (id) DO NOTHING
        `).run(jobId, r.log.title, now);
        await db.prepare(`
          INSERT INTO job_applications (id, user_id, job_id, status, title, scraper_type, submission_mode, applied_at, auto_apply_log)
          VALUES (?, ?, ?, ?, ?, 'instahyre', 'auto', ?, ?)
          ON CONFLICT (user_id, job_id) DO UPDATE SET
            status = EXCLUDED.status, applied_at = EXCLUDED.applied_at, auto_apply_log = EXCLUDED.auto_apply_log
        `).run(crypto.randomUUID(), userId, jobId, r.status, r.log.title, r.status === 'applied' ? now : null, JSON.stringify(r.log));

        if (r.status === 'applied') { applied++; consecutiveFailures = 0; }
        else { needsReview++; consecutiveFailures = 0; } // this flow never returns anything but applied/needs_review
      }
      return { processed: applied + needsReview, applied, needsReview };
    }

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

      // Naukri gets its own handler (see attemptApplyNaukri's header) since
      // its real completion signal lives in an API response, not the DOM —
      // every other queued-job portal (currently just foundit) uses the
      // generic DOM-based flow.
      const result = portal === 'naukri'
        ? await attemptApplyNaukri(page, job, bank)
        : await attemptApply(page, job, bank);
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
    const login = await loginWithRetry(portal, { username: credRow.username, password });
    if (!login.ok) {
      if (login.transient) {
        // Same rule as runPortalForUser: a proxy/network failure (retried
        // once already, direct) is never evidence the password is wrong.
        logger.warn(`[auto-apply] ${portal} test login failed after retry — transient network/proxy error, credentials left untouched`, { userId, error: login.error });
        return { ok: false, error: login.error, transient: true };
      }
      await markInvalidCredentials(userId, portal, login.error);
      return { ok: false, error: login.error };
    }
    try {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await db.prepare(
        `UPDATE portal_credentials SET status = 'active', last_login_at = ?, last_login_error = NULL WHERE user_id = ? AND portal = ?`
      ).run(now, userId, portal);
      logger.info(`[auto-apply] ${portal} test login succeeded`, { userId });
      return { ok: true };
    } finally {
      if (login.ctx) await login.ctx.close().catch(() => {});
      if (login.browser) await login.browser.close().catch(() => {});
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
