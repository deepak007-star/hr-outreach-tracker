'use strict';

// Shared Playwright stealth setup for real, logged-in browser automation
// against the user's own accounts (auto-apply on Naukri/Instahyre, and the
// LinkedIn content publisher). Extracted out of agents/autoApplyWorker.js
// since both need byte-identical launch/context setup.

const { chromium } = require('playwright');

async function launchStealthBrowser() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ headless: true, channel, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    } catch (_) { /* channel not installed — try next */ }
  }
  return chromium.launch({ headless: true, args: ['--no-sandbox'] });
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

module.exports = { launchStealthBrowser, newStealthContext };
