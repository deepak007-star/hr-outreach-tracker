const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'hr-tracker-local-secret-2026';

// In-memory permission cache: roleName → Set<permName>
const _permCache = new Map();
let _cacheDb = null;

function setPermCacheDb(db) { _cacheDb = db; }
function invalidatePermCache(roleName) {
  if (roleName) _permCache.delete(roleName);
  else _permCache.clear();
}

async function getRolePermissions(roleName) {
  if (_permCache.has(roleName)) return _permCache.get(roleName);
  if (!_cacheDb) return new Set();
  const rows = await _cacheDb.prepare(`
    SELECT p.name FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN roles r ON r.id = rp.role_id
    WHERE r.name = ?
  `).all(roleName);
  const set = new Set(rows.map(r => r.name));
  _permCache.set(roleName, set);
  return set;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const decoded = jwt.verify(token, SECRET);
    // Always read fresh role/plan from DB so manual DB updates are reflected immediately
    if (_cacheDb) {
      const row = await _cacheDb.prepare('SELECT role, plan FROM users WHERE id = ?').get(decoded.userId);
      if (row) { decoded.role = row.role; decoded.plan = row.plan; }
    }
    req.user = decoded;
    next();
  } catch (e) {
    const authErr = e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError';
    res.status(401).json({ error: authErr ? 'Invalid or expired token. Please log in again.' : 'Authentication failed.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (req.user.role === 'admin') return next(); // admin bypasses all checks
    try {
      const perms = await getRolePermissions(req.user.role);
      if (perms.has(permission)) return next();
      res.status(403).json({ error: `Permission denied: requires ${permission}` });
    } catch (e) {
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { requireAuth, requireAdmin, requirePermission, setPermCacheDb, invalidatePermCache, SECRET };
