import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('hr_token');
    if (!token) { setLoading(false); return; }

    const sync = () =>
      api.get('/auth/me')
        .then(u => setUser(u))
        .catch(() => { localStorage.removeItem('hr_token'); setUser(null); });

    sync().finally(() => setLoading(false));

    // Re-sync when user focuses the tab (catches manual DB updates instantly)
    window.addEventListener('focus', sync);
    // Background poll — keeps data fresh even without tab focus
    const interval = setInterval(sync, 60_000);

    return () => {
      window.removeEventListener('focus', sync);
      clearInterval(interval);
    };
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('hr_token', token);
    setUser(userData);
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
