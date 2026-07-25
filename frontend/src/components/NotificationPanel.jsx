import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function NotificationPanel() {
  const { user } = useAuth();
  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState([]);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get('/notifications');
      setNotifications(data);
    } catch {}
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Poll every 30s
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!user) return null;

  const unread = notifications.filter(n => !n.is_read).length;

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`, {});
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all', {});
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    } catch {}
  };

  const clearAll = async () => {
    try {
      await api.delete('/notifications');
      setNotifications([]);
      setOpen(false);
    } catch {}
  };

  function timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60_000);
    if (min < 1)   return 'just now';
    if (min < 60)  return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24)   return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  const TYPE_ICON = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Notifications"
        className="relative p-2 rounded-sm text-slate-300 hover:text-white hover:bg-slate-700 transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white rounded-md shadow-modal border border-gray-200 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <h3 className="font-bold text-gray-800 text-sm">
              Notifications
              {unread > 0 && (
                <span className="ml-2 text-xs bg-red-100 text-red-600 font-semibold px-1.5 py-0.5 rounded-full">{unread} new</span>
              )}
            </h3>
            <div className="flex gap-3">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-brand-600 hover:text-brand-800 hover:underline font-medium">
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={clearAll} className="text-xs text-red-500 hover:text-red-700 hover:underline font-medium">
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {notifications.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-2xl mb-2">🔔</p>
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            )}
            {notifications.map(n => (
              <div
                key={n.id}
                className={`px-4 py-3 flex gap-2.5 items-start transition ${n.is_read ? 'bg-white' : 'bg-brand-50'}`}
              >
                <span className="text-base shrink-0 mt-0.5">{TYPE_ICON[n.type] || TYPE_ICON.info}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold text-gray-800 leading-snug ${!n.is_read ? 'text-gray-900' : ''}`}>
                    {n.title}
                  </p>
                  {n.body && <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>}
                  <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                </div>
                {!n.is_read && (
                  <button
                    onClick={() => markRead(n.id)}
                    className="text-[10px] text-brand-500 hover:text-brand-700 shrink-0 mt-0.5 whitespace-nowrap"
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
