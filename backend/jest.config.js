'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['./tests/setup.js'],
  globalSetup: './tests/globalSetup.js',
  globalTeardown: './tests/globalTeardown.js',
  testTimeout: 30000,
  // Suppress playwright/puppeteer noise during tests
  testPathIgnorePatterns: ['/node_modules/', '/src/scrapers/'],
};
