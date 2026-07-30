'use strict';
// Runs once after all test files.
module.exports = async function globalTeardown() {
  // pg Pool keeps connections open — allow Jest to exit cleanly.
  // The pool is module-level in database.js and can't be imported here
  // (different module cache from globalSetup), so we just let --forceExit handle it.
};
