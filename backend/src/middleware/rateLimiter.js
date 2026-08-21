// Sliding-window in-memory rate limiter (resets on server restart — intentional)

const LIMITS = {
  email: { max: 20, windowMs: 3 * 60 * 60 * 1000, label: 'Email sends' },
  apply: { max: 30, windowMs: 3 * 60 * 60 * 1000, label: 'Job applications' },
  // Non-admin "find my matches" trigger on the LinkedIn feed — each run spawns
  // a real browser and hits external search engines, so this is capped hard
  // to stop concurrent users from hammering (and getting CAPTCHA-blocked by)
  // the same shared IP.
  linkedinFeedScrape: { max: 1, windowMs: 6 * 60 * 60 * 1000, label: 'LinkedIn feed scrape' },
};

const store = new Map(); // `${uid}:${type}` → number[]

function _clean(key, windowMs) {
  const now = Date.now();
  const ts  = (store.get(key) || []).filter(t => now - t < windowMs);
  // Evict the key entirely once its window is empty — this Map otherwise
  // grows for the lifetime of the process, one entry per distinct
  // userId:type pair ever seen, even after every timestamp has aged out.
  // On a long-running 512MB container with many users over weeks/months
  // that's a real, if slow, leak (see the earlier dedicated
  // "reduce memory footprint for 512MB container" work).
  if (ts.length) store.set(key, ts);
  else store.delete(key);
  return ts;
}

function check(userId, type) {
  const { max, windowMs } = LIMITS[type];
  const ts        = _clean(`${userId}:${type}`, windowMs);
  const used      = ts.length;
  const remaining = Math.max(0, max - used);
  const resetAt   = ts[0] ? new Date(ts[0] + windowMs) : null;
  return { used, max, remaining, resetAt, allowed: remaining > 0 };
}

function record(userId, type) {
  const { windowMs } = LIMITS[type];
  const key = `${userId}:${type}`;
  const ts  = _clean(key, windowMs);
  ts.push(Date.now());
  store.set(key, ts);
}

function getStatus(userId) {
  return Object.fromEntries(
    Object.keys(LIMITS).map(type => [type, check(userId, type)])
  );
}

function middleware(type) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') { next(); return; }
    const uid    = req.user?.userId || req.ip || 'anon';
    const result = check(uid, type);
    if (!result.allowed) {
      const resetStr = result.resetAt
        ? ` Resets at ${result.resetAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`
        : '';
      return res.status(429).json({
        error: `${LIMITS[type].label} limit reached: ${result.max} per 3 hours.${resetStr}`,
        rateLimitInfo: { ...result, type },
      });
    }
    record(uid, type);
    next();
  };
}

module.exports = { check, record, getStatus, middleware };
