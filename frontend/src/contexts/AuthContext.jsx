import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount: validate saved token
  useEffect(() => {
    const token = localStorage.getItem('hr_token');
    if (!token) { setLoading(false); return; }

    api.get('/auth/me')
      .then(u => setUser(u))
      .catch(() => localStorage.removeItem('hr_token'))
      .finally(() => setLoading(false));
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
