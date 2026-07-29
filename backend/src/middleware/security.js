const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const slowDown   = require('express-slow-down');

// ── Global API rate limiter ────────────────────────────────────────────────────
// Blocks bots. For authenticated users, key by userId so that shared-IP
// environments (Render NAT, multiple users behind same router) don't
// cause one user's traffic to burn another user's quota.
const globalApiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             1000,            // 1000 requests per 15 min per user/IP
  standardHeaders: true,
  legacyHeaders:   false,
  // Prefer userId over IP — avoids Render/NAT shared-IP collisions.
  // ipKeyGenerator handles IPv6 normalisation (required by express-rate-limit v8).
  keyGenerator:    req => req.user?.userId || ipKeyGenerator(req) || 'anon',
  skip:            req => req.method === 'OPTIONS', // preflight always passes
  message:         { error: 'Too many requests — please slow down.' },
  handler: (req, res, _next, options) => {
    // Always include CORS headers even on rate-limit rejections so the
    // browser doesn't misreport a 429 as a CORS policy violation.
    const origin = req.headers.origin;
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.status(429).json(options.message);
  },
});

// ── Strict limiter for auth endpoints ─────────────────────────────────────────
// 10 attempts per 15 minutes per IP — brute-force protection.
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

// ── Auth slowdown ─────────────────────────────────────────────────────────────
// After 5 failed attempts from same IP, each subsequent request is slowed
// by 500ms, up to 5s max. Makes brute-force attacks impractical.
const authSlowDown = slowDown({
  windowMs:          15 * 60 * 1000,
  delayAfter:        5,
  delayMs:           (used, req) => {
    const delay = (used - req.slowDown.limit) * 500;
    return Math.min(delay, 5000);
  },
});

// ── Scraper / public endpoint limiter ─────────────────────────────────────────
// Job scraping triggers real browser + external calls — cap heavily.
const scrapeLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,  // 1 hour
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Scraping rate limit reached. Wait 1 hour before fetching more job posts.' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

// ── Lead/contact form limiter ──────────────────────────────────────────────────
// Prevents spam submissions to the early-access / leads form.
const leadLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many submissions. Please wait before trying again.' },
  handler: (req, res, _next, options) => {
    res.status(429).json(options.message);
  },
});

// ── Request body sanitizer ─────────────────────────────────────────────────────
// Strips obvious XSS patterns from string fields in req.body.
// Not a substitute for output encoding, but stops stored-XSS from landing in DB.
const DANGEROUS_RE = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const ON_HANDLER_RE = /\bon\w+\s*=/gi;
const JS_PROTO_RE   = /javascript\s*:/gi;

function sanitizeValue(val) {
  if (typeof val !== 'string') return val;
  return val
    .replace(DANGEROUS_RE, '')
    .replace(ON_HANDLER_RE, '')
    .replace(JS_PROTO_RE, '');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeValue);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'object' ? sanitizeObject(v) : sanitizeValue(v);
  }
  return out;
}

function bodySanitizer(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// ── Safe error handler ────────────────────────────────────────────────────────
// Never leaks stack traces or internal error messages to clients.
function safeErrorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  // Log full error server-side
  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}:`, err.message);
  }

  // Return safe message to client
  if (status >= 500) {
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
  res.status(status).json({ error: err.message || 'Request failed.' });
}

module.exports = {
  globalApiLimiter,
  authLimiter,
  authSlowDown,
  scrapeLimiter,
  leadLimiter,
  bodySanitizer,
  safeErrorHandler,
};
