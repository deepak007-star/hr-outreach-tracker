'use strict';
/**
 * Installs Playwright Chromium browser for the job scrapers.
 * Tries --with-deps first (installs OS packages too — needed on bare CI/CD
 * runners). Falls back to just the browser download if apt-get is blocked
 * (e.g. Render's build image where packages are already present).
 * Never exits with a non-zero code so a missing browser never kills the build.
 */
const { execSync } = require('child_process');

function run(cmd) {
  console.log(`[playwright] ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  run('npx playwright install chromium --with-deps');
  console.log('[playwright] Chromium + deps installed successfully.');
} catch {
  console.warn('[playwright] --with-deps failed; retrying without system packages…');
  try {
    run('npx playwright install chromium');
    console.log('[playwright] Chromium installed (system packages assumed present).');
  } catch (e) {
    // Don't fail the build — scrapers simply won't launch until the browser
    // is available, but every other feature keeps working.
    console.warn('[playwright] Browser install failed. Scraper features need manual setup.');
    console.warn(e.message);
  }
}
