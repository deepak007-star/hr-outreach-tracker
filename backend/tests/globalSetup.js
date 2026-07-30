'use strict';
// Runs once before all test files in a separate process.
// Initialises the test database so tables exist when tests start.
module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/hr_outreach_tracker_test';
  process.env.JWT_SECRET = 'test-jwt-secret-key-32chars-min-length';
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '0'.repeat(64);

  const database = require('../src/db/database');
  await database.initialize();
  console.log('[test] Test DB initialised');
};
