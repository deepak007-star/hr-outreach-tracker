// Runs in every Jest worker before any module is loaded.
// Sets env vars that database.js reads at require time.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/hr_outreach_tracker_test';
process.env.JWT_SECRET = 'test-jwt-secret-key-32chars-min-length';
process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '0'.repeat(64);
process.env.FRONTEND_URL = 'http://localhost:5173';
