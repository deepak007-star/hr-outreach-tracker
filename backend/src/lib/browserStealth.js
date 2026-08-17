'use strict';

// Shared Playwright stealth setup for real, logged-in browser automation
// against the user's own accounts (auto-apply on Naukri/Instahyre, and the
// LinkedIn content publisher). Extracted out of agents/autoApplyWorker.js
// since both need byte-identical launch/context setup.

const { chromium } = require('playwright');
const db = require('../db/database');
const proxyRotator = require('./proxyRotator');
const { parseProxyForLaunch } = require('./common');

// Memory-lean flags — real, quantifiable reduction in headless Chromium's
// baseline RSS (no GPU compositor process, no background sync/translate
// services spun up for no reason on a host with no display and a 512MB
// total container budget). Same set used by scrapers/linkedin-feed.js.
const LEAN_ARGS = [
  '--no-sandbox', '--disable-blink-features=AutomationControlled',
  '--disable-gpu', '--disable-software-rasterizer',
  '--disable-background-networking', '--disable-sync', '--disable-translate',
  '--metrics-recording-only', '--mute-audio', '--disable-extensions',
];

// Reuses the exact same `proxy_list` setting Job Intel's proxy panel already
// manages (lib/proxyRotator.js) — a real logged-in session hitting a site's
// login endpoint directly from a datacenter IP (Render's) is exactly the kind
// of request Naukri's Akamai bot-detection is tuned to flag; the passive
// scraper already fights this and gets a proxy pool, so login should too.
// No proxies configured = launches direct, unchanged from before.
async function getProxyOption() {
  try {
    const row = await db.prepare(`SELECT value FROM settings WHERE key = 'proxy_list'`).get().catch(() => null);
    if (row?.value?.trim()) {
      proxyRotator.loadFromString(row.value);
      await proxyRotator.healthCheckAll(8000);
    }
  } catch (_) { /* fall through to direct */ }
  const url = proxyRotator.nextHttp() || proxyRotator.next();
  return url ? parseProxyForLaunch(url) : undefined;
}

async function launchStealthBrowser() {
  const proxy = await getProxyOption();
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ headless: true, channel, args: LEAN_ARGS, ...(proxy ? { proxy } : {}) });
    } catch (_) { /* channel not installed — try next */ }
  }
  return chromium.launch({ headless: true, args: LEAN_ARGS, ...(proxy ? { proxy } : {}) });
}

// App-wide lock so auto-apply and the LinkedIn content publisher never both
// have a Chromium instance open at once — each already only runs one
// portal/post at a time internally, but nothing previously stopped the two
// FEATURES from overlapping if their schedules happened to align, and two
// simultaneous Chromium instances is exactly the kind of compounding that
// tips a 512MB container over the edge. Callers: `await withBrowserLock(fn)`
// where fn launches, uses, and closes its own browser.
let _lockQueue = Promise.resolve();
function withBrowserLock(fn) {
  const run = _lockQueue.then(fn, fn); // run fn regardless of whether the previous holder threw
  _lockQueue = run.catch(() => {});    // never let one failure wedge the queue for everyone after it
  return run;
}

async function newStealthContext(browser) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-IN',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });
  return ctx;
}

module.exports = { launchStealthBrowser, newStealthContext, withBrowserLock };
