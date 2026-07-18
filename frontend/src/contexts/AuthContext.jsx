import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  // keep a stable ref so event listeners always call the latest sync
  const syncRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('hr_token');
    if (!token) { setLoading(false); return; }

    const sync = () =>
      api.get('/auth/me')
        .then(u => setUser(u))
        .catch(err => {
          // Only log out on auth errors — ignore network/server hiccups
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            localStorage.removeItem('hr_token');
            setUser(null);
          }
        });

    syncRef.current = sync;

    sync().finally(() => setLoading(false));

    // visibilitychange fires when switching browser tabs (focus only fires for window)
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    // Background poll — catches changes even if the tab stays open and focused
    const interval = setInterval(sync, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
      clearInterval(interval);
    };
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('hr_token', token);
    setUser(userData);
    // Immediately re-fetch from DB so role/plan are always fresh after login
    api.get('/auth/me').then(u => setUser(u)).catch(() => {});
  };

  const logout = () => {
    localStorage.removeItem('hr_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
