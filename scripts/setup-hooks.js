#!/usr/bin/env node
// Run once after cloning to wire the pre-push hook:
//   node scripts/setup-hooks.js
'use strict';
const { execSync } = require('child_process');
try {
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
  console.log('✓ Git hooks configured — pre-push test runner enabled.');
  console.log('  Set SKIP_BACKEND_TESTS=1 before git push to skip DB-dependent backend tests.');
} catch (e) {
  console.error('Failed to configure git hooks:', e.message);
  process.exit(1);
}
