'use strict';
/**
 * Shared test helpers.
 *
 * buildApp() creates a minimal Express app that mounts the routes
 * being tested — call it inside beforeAll() AFTER database.initialize().
 * generateToken() mints a signed JWT without touching the DB.
 */
const express    = require('express');
const jwt        = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const JWT_SECRET = process.env.JWT_SECRET;

function generateToken(payload = {}) {
  return jwt.sign(
    { userId: 'test-user-id', email: 'test@test.com', role: 'user', plan: 'demo', ...payload },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function generateAdminToken(payload = {}) {
  return generateToken({ role: 'admin', ...payload });
}

function buildApp(routeSetup) {
  const { bodySanitizer, safeErrorHandler } = require('../src/middleware/security');
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(bodySanitizer);
  routeSetup(app);
  app.use(safeErrorHandler);
  return app;
}

module.exports = { buildApp, generateToken, generateAdminToken };
