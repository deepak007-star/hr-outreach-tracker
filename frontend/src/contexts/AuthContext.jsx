import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api, invalidateCache } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const syncRef = useRef(null);

  // ── Dev login bypass ──────────────────────────────────────────────────────
  // When on, the app auto-signs in as an admin (all features) with no login.
  const [devBypass,       setDevBypass]       = useState(() => localStorage.getItem('hr_dev_bypass') === 'on');
  const [bypassAvailable, setBypassAvailable] = useState(false);

  // Is the bypass allowed by the server? Controls whether the toggle is shown.
  useEffect(() => {
    api.get('/auth/dev-status')
      .then(r => setBypassAvailable(!!r?.enabled))
      .catch(() => setBypassAvailable(false));
  }, []);

  // ── Core sync: fetch fresh user from /auth/me ────────────────────────────
  // Also receives a fresh JWT from the server and updates localStorage so
  // the session rolls forward on every active use (never expires mid-session).
  const sync = useCallback(() =>
    api.get('/auth/me')
      .then(u => {
        // Server returns _token when rolling a fresh JWT — persist it
        if (u._token) {
          localStorage.setItem('hr_token', u._token);
          const { _token, ...userData } = u;
          // Keep the same object reference when nothing actually changed — this
          // runs on a 30s poll + every focus/visibility event, and setUser()
          // handing back a brand-new object every time (even with identical
          // field values) was recreating every fetchContacts/fetchEmailStats
          // callback that depends on `user`, cascading into repeated refetches
          // across the app on every tab focus.
          setUser(prev => JSON.stringify(prev) === JSON.stringify(userData) ? prev : userData);
        } else {
          setUser(prev => JSON.stringify(prev) === JSON.stringify(u) ? prev : u);
        }
      })
      .catch(err => {
        const status = err?.response?.status;
        // Only clear session on explicit auth rejection; ignore network errors
        if (status === 401 || status === 403) {
          localStorage.removeItem('hr_token');
          setUser(null);
        }
      }),
  []);

  // Store stable ref so event listeners always call the latest sync
  useEffect(() => { syncRef.current = sync; }, [sync]);

  // Retries a transient failure (free-tier cold-start delay, a brief network
  // blip) before treating the session as invalid. An explicit 401/403 fails
  // fast since retrying that would never succeed. Used ONLY for the initial
  // mount below: without this, sync() failing for any non-auth reason (e.g. a
  // cold host taking longer than the 20s request timeout to wake up) left
  // `user` at null while still calling setLoading(false) — rendering the app
  // as fully logged out (even though the token in localStorage was still
  // valid) until the 30s background poll happened to land. That's exactly
  // the "something went wrong, then auto-logs-in on its own" / "reload the
  // page and it's logged out" pattern users were hitting.
  const syncWithRetry = useCallback(async (maxAttempts = 4) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const u = await api.get('/auth/me');
        if (u._token) {
          localStorage.setItem('hr_token', u._token);
          const { _token, ...userData } = u;
          setUser(userData);
        } else {
          setUser(u);
        }
        return;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem('hr_token');
          setUser(null);
          return;
        }
        if (attempt === maxAttempts - 1) return; // give up quietly — keep the token, next poll/focus will retry
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); // 3s, 6s, 9s backoff
      }
    }
  }, []);

  // ── "Continue with Google" redirect landing ──────────────────────────────
  // /api/oauth/google/callback redirects here with ?google_login_code=... on
  // success — a short-lived (60s) one-time code that is exchanged here for a
  // real 30-day JWT. The JWT never touches the URL / browser history / logs.
  // On failure the server redirects with ?google_login_error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('google_login_code');
    const error  = params.get('google_login_error');

    if (code) {
      // Strip the code from the URL immediately before the async exchange
      window.history.replaceState({}, '', window.location.pathname);
      api.post('/oauth/exchange', { code })
        .then(data => {
          if (data?.token) {
            localStorage.setItem('hr_token', data.token);
            toast.success('Signed in with Google!');
            // sync() will run in the session-restore effect below after token lands
            syncRef.current?.();
          } else {
            toast.error('Google sign-in failed. Please try again.');
          }
        })
        .catch(err => {
          const msg = err?.response?.data?.error || 'Google sign-in failed. Please try again.';
          toast.error(msg);
        });
    } else if (error) {
      window.history.replaceState({}, '', window.location.pathname);
      toast.error('Google sign-in failed: ' + decodeURIComponent(error));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initial session restore ──────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('hr_token');
    if (!token) {
      // No session — if dev bypass is on, silently sign in as admin
      if (localStorage.getItem('hr_dev_bypass') === 'on') {
        api.post('/auth/dev-login')
          .then(data => {
            if (data?.token) { localStorage.setItem('hr_token', data.token); return sync(); }
          })
          .catch(() => { localStorage.removeItem('hr_dev_bypass'); setDevBypass(false); })
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
      return;
    }
    syncWithRetry().finally(() => setLoading(false));

    // Refresh when user comes back to the tab
    const onVisible = () => { if (document.visibilityState === 'visible') syncRef.current?.(); };
    // Use a named function so removeEventListener can match the exact reference
    const onFocus = () => syncRef.current?.();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    // Background poll — only fires when a token exists; stops itself after logout
    const interval = setInterval(() => {
      if (localStorage.getItem('hr_token')) syncRef.current?.();
    }, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cross-tab session sync ───────────────────────────────────────────────
  // If the user logs out in another tab, this tab clears immediately.
  // If the user logs in in another tab, this tab picks it up.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'hr_dev_bypass') { setDevBypass(e.newValue === 'on'); return; }
      if (e.key !== 'hr_token') return;
      if (!e.newValue) {
        setUser(null); // logged out elsewhere
      } else {
        syncRef.current?.(); // logged in elsewhere — sync user data
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ── Global session-expired handler ──────────────────────────────────────
  // The API client fires this event when any request returns 401 (except
  // login/register which legitimately return 401 for wrong credentials).
  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem('hr_token');
      invalidateCache(); // clear all cached API responses
      setUser(null);
    };
    window.addEventListener('hr-session-expired', onExpired);
    return () => window.removeEventListener('hr-session-expired', onExpired);
  }, []);

  // ── login ────────────────────────────────────────────────────────────────
  const login = useCallback((token, userData) => {
    localStorage.setItem('hr_token', token);
    setUser(userData);
    // Immediately re-fetch from DB to get the definitive role/plan
    sync();
  }, [sync]);

  // ── logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      // Clear the httpOnly cookie on the server side
      await api.post('/auth/logout');
    } catch {
      // Even if the server call fails, clear local state
    }
    // Signing out also exits dev-bypass so it doesn't auto-log back in on reload
    localStorage.removeItem('hr_dev_bypass');
    setDevBypass(false);
    localStorage.removeItem('hr_token');
    invalidateCache();
    setUser(null);
  }, []);

  // ── enable dev bypass ─────────────────────────────────────────────────────
  // Turns login off: signs in as admin now, and persists so reloads stay in.
  const enableDevBypass = useCallback(async () => {
    try {
      const data = await api.post('/auth/dev-login');
      if (data?.token) {
        localStorage.setItem('hr_token', data.token);
        localStorage.setItem('hr_dev_bypass', 'on');
        setDevBypass(true);
        await sync();
        toast.success('Login disabled — signed in as admin');
        return true;
      }
      toast.error('Dev login failed');
      return false;
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Dev login is disabled on the server');
      return false;
    }
  }, [sync]);

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout, refreshUser: sync,
      devBypass, bypassAvailable, enableDevBypass,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
