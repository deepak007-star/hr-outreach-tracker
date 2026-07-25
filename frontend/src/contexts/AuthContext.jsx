import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api, invalidateCache } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const syncRef = useRef(null);

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
          setUser(userData);
        } else {
          setUser(u);
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
    if (!token) { setLoading(false); return; }
    sync().finally(() => setLoading(false));

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
    localStorage.removeItem('hr_token');
    invalidateCache();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser: sync }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
