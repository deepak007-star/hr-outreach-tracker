import axios from 'axios';

export const API_ROOT = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_ROOT}/api`,
  timeout: 20000,
});

// Attach JWT token to every request when logged in
api.interceptors.request.use(config => {
  const token = localStorage.getItem('hr_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => Promise.reject(err)
);
