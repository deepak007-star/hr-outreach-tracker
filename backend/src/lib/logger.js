'use strict';
/**
 * Lightweight structured logger. No external dependencies.
 *
 * Writes to:
 *   1. Console (colored, human-readable) — skipped in NODE_ENV=test
 *   2. backend/logs/app.log  (JSON-lines, all levels)
 *   3. backend/logs/error.log (JSON-lines, errors only)
 *   4. DB activity_logs table (info/warn/error, async fire-and-forget)
 *
 * Wire the DB after database.initialize():
 *   const logger = require('./lib/logger');
 *   logger.setDb(database);
 */

const fs   = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs');
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) {}

const COLORS = {
  error: '\x1b[31m',  // red
  warn:  '\x1b[33m',  // yellow
  info:  '\x1b[36m',  // cyan
  debug: '\x1b[90m',  // gray
  reset: '\x1b[0m',
};

let _db = null;

function setDb(db) { _db = db; }

function log(level, message, meta = {}) {
  const ts    = new Date().toISOString();
  const isTest = process.env.NODE_ENV === 'test';

  // 1. Console
  if (!isTest) {
    const color  = COLORS[level] || '';
    const reset  = COLORS.reset;
    const tag    = `[${level.toUpperCase()}]`.padEnd(7);
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    process.stdout.write(`${color}${tag}${reset} ${ts.slice(11, 23)} ${message}${metaStr}\n`);
  }

  // 2 & 3. Files
  if (!isTest) {
    try {
      const line = JSON.stringify({ ts, level, message, ...meta }) + '\n';
      fs.appendFileSync(path.join(LOGS_DIR, 'app.log'), line);
      if (level === 'error') {
        fs.appendFileSync(path.join(LOGS_DIR, 'error.log'), line);
      }
    } catch (_) {}
  }

  // 4. DB (fire-and-forget — never blocks, never throws)
  if (_db && level !== 'debug') {
    try {
      _db.prepare(
        `INSERT INTO activity_logs (level, message, meta, created_at) VALUES (?, ?, ?, ?)`
      ).run(
        level,
        String(message).slice(0, 500),
        JSON.stringify(meta).slice(0, 2000),
        ts,
      ).catch(() => {});
    } catch (_) {}
  }
}

const logger = {
  setDb,
  error: (msg, meta = {}) => log('error', msg, meta),
  warn:  (msg, meta = {}) => log('warn',  msg, meta),
  info:  (msg, meta = {}) => log('info',  msg, meta),
  debug: (msg, meta = {}) => log('debug', msg, meta),
};

module.exports = logger;
