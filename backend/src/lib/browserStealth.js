'use strict';

// Shared Playwright stealth setup for real, logged-in browser automation
// against the user's own accounts (auto-apply on Naukri/Instahyre, and the
// LinkedIn content publisher). Extracted out of agents/autoApplyWorker.js
// since both need byte-identical launch/context setup.

const { chromium } = require('playwright');
const db = require('../db/database');
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

// Reuses services/proxyFetcher.js's buildScraperProxyEnv — the SAME merged
// manual (`proxy_list`) + auto-fetched-and-validated (`proxy_auto_cache`,
// refreshed from free sources + optional Webshare key) pool the Job Intel
// pipeline already scrapes through. A real logged-in session hitting a
// site's login endpoint directly from a datacenter IP (Render's) is exactly
// the kind of request Naukri's Akamai bot-detection is tuned to flag; the
// passive scraper already fights this with this same pool, so login should
// too. No proxies alive = launches direct, unchanged from before.
async function getProxyOption() {
  try {
    const { buildScraperProxyEnv } = require('../services/proxyFetcher');
    const { env } = await buildScraperProxyEnv(db);
    if (env?.PROXY_URL) return parseProxyForLaunch(env.PROXY_URL);
  } catch (_) { /* fall through to direct */ }
  return undefined;
}

// forceDirect skips the proxy pool entirely — used by loginWithRetry's 2nd
// attempt when the picked proxy launched fine but failed to actually tunnel
// to the target site (net::ERR_TUNNEL_CONNECTION_FAILED etc). A single
// TCP-only health check (proxyRotator.healthCheckAll, see proxyFetcher.js)
// doesn't guarantee a proxy can successfully CONNECT to an arbitrary HTTPS
// host — a common gap with free/auto-fetched proxies against Akamai-style
// bot detection specifically.
async function launchStealthBrowser({ forceDirect = false } = {}) {
  const proxy = forceDirect ? undefined : await getProxyOption();
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ headless: true, channel, args: LEAN_ARGS, ...(proxy ? { proxy } : {}) });
    } catch (_) { /* channel not installed — try next */ }
  }
  return chromium.launch({ headless: true, args: LEAN_ARGS, ...(proxy ? { proxy } : {}) });
}

// Errors from a proxy/network hop that never reached the target site at
// all — as opposed to a real response from the login page saying the
// password is wrong. Callers must NEVER treat these as a credential
// failure (see autoApplyWorker.js's loginWithRetry / markInvalidCredentials).
const TRANSIENT_NETWORK_RE = /net::ERR_(TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|NAME_NOT_RESOLVED|SOCKS_CONNECTION_FAILED|EMPTY_RESPONSE|ADDRESS_UNREACHABLE)|Timeout \d+ms exceeded|browserType\.launch:/i;
function isTransientNetworkError(message) {
  return TRANSIENT_NETWORK_RE.test(message || '');
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

module.exports = { launchStealthBrowser, newStealthContext, withBrowserLock, isTransientNetworkError };
