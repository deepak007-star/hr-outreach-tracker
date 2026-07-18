import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

function UsageBar({ info, label, icon }) {
  const pct = info.max > 0 ? (info.used / info.max) * 100 : 0;
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : pct >= 60 ? 'bg-yellow-400' : 'bg-green-500';
  const textColor = pct >= 80 ? 'text-red-600 font-semibold' : 'text-gray-500';

  const resetStr = info.resetAt
    ? new Date(info.resetAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">{icon} {label}</span>
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden shrink-0">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={`text-xs whitespace-nowrap ${textColor}`}>
        {info.used}/{info.max}
        {pct >= 80 && resetStr && (
          <span className="ml-1 text-[10px] text-gray-400 font-normal">↺{resetStr}</span>
        )}
      </span>
    </div>
  );
}

export default function RateLimitBar() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get('/rate-limit/status');
      // Deserialize resetAt strings back to Date objects
      for (const type of Object.keys(data)) {
        if (data[type].resetAt) data[type].resetAt = new Date(data[type].resetAt);
      }
      setStatus(data);
    } catch {}
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (!user || !status) return null;

  const emailPct  = (status.email.used / status.email.max) * 100;
  const applyPct  = (status.apply.used / status.apply.max) * 100;
  const isWarning = emailPct >= 80 || applyPct >= 80;

  return (
    <div
      title="Session limits — resets every 3 hours"
      className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border text-xs ${
        isWarning ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-200'
      }`}
    >
      <UsageBar info={status.email} label="Emails" icon="✉️" />
      <div className="w-px h-4 bg-gray-200 shrink-0" />
      <UsageBar info={status.apply} label="Applies" icon="📋" />
      <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 hidden sm:block">/3h</span>
    </div>
  );
}
