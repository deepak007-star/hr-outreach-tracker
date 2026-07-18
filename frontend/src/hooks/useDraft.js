import { useEffect, useRef } from 'react';

const DELAY = 600;

export function useDraft(key, value) {
  const timer = useRef(null);
  useEffect(() => {
    if (value === null || value === undefined) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { localStorage.setItem('draft:' + key, JSON.stringify(value)); } catch {}
    }, DELAY);
    return () => clearTimeout(timer.current);
  });
}

export function readDraft(key) {
  try {
    const raw = localStorage.getItem('draft:' + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearDraft(key) {
  try { localStorage.removeItem('draft:' + key); } catch {}
}

export function useBeforeUnload(isDirty) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
