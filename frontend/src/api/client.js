import axios from 'axios';

export const API_ROOT = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL:         `${API_ROOT}/api`,
  timeout:         20000,
  withCredentials: true, // send httpOnly session cookie on every request
});

// Attach JWT Bearer token (primary auth for cross-origin requests)
api.interceptors.request.use(config => {
  const token = localStorage.getItem('hr_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err?.response?.status === 401) {
      // Skip emitting for endpoints that legitimately 401 without the user's
      // actual session having expired: login/register on bad credentials, and
      // /oauth/exchange when the one-time Google-login code is invalid/already
      // used/expired (e.g. the user reloads or hits Back on the OAuth landing
      // URL) — that 401 has nothing to do with hr_token, but was previously
      // wiping a perfectly valid session and showing "Your session has expired."
      const url = err.config?.url || '';
      const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/oauth/exchange');
      if (!isAuthEndpoint) {
        window.dispatchEvent(new CustomEvent('hr-session-expired'));
      }
    }
    return Promise.reject(err);
  }
);

// ── Simple in-memory GET cache ────────────────────────────────────────────
// Avoids redundant refetches when switching tabs (profile, contacts summary, etc.)
const _cache = new Map(); // url -> { data, ts }

export function cachedGet(url, ttlMs = 5 * 60 * 1000) {
  const entry = _cache.get(url);
  if (entry && Date.now() - entry.ts < ttlMs) {
    return Promise.resolve(entry.data);
  }
  return api.get(url).then(data => {
    _cache.set(url, { data, ts: Date.now() });
    return data;
  });
}

// A few streaming SSE consumers (scraper log tailing) use raw fetch() instead
// of the `api` axios instance, since axios doesn't handle a manually-read
// response body stream well in the browser — those never go through the
// interceptor above, so a 401 there silently failed with no session cleanup.
// Call this from their own `!resp.ok` handling instead of duplicating the check.
export function notifyIfUnauthorized(status) {
  if (status === 401) window.dispatchEvent(new CustomEvent('hr-session-expired'));
}

export function invalidateCache(urlOrPrefix) {
  if (!urlOrPrefix) { _cache.clear(); return; }
  for (const key of _cache.keys()) {
    if (key === urlOrPrefix || key.startsWith(urlOrPrefix)) _cache.delete(key);
  }
}
