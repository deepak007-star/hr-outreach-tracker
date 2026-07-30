// Runs in every Jest worker before any module is loaded.
// Sets env vars that database.js reads at require time.

// Load .env so DATABASE_URL is available as a fallback when no local test DB is configured.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

process.env.NODE_ENV = 'test';
// Precedence: TEST_DATABASE_URL (CI) → .env DATABASE_URL (Supabase dev) → local fallback
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/hr_outreach_tracker_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-32chars-min-length';
process.env.OAUTH_TOKEN_ENCRYPTION_KEY = process.env.OAUTH_TOKEN_ENCRYPTION_KEY || '0'.repeat(64);
process.env.FRONTEND_URL = 'http://localhost:5173';
