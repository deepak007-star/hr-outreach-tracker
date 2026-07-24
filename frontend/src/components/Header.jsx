import { useAuth } from '../contexts/AuthContext.jsx';
import NotificationPanel from './NotificationPanel.jsx';
import Logo from './Logo.jsx';
import { Radio } from 'lucide-react';

function initials(name) {
  return (name || 'U').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

export default function Header({ onLoginClick }) {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-card">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">

        {/* Brand */}
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">HR Outreach Tracker</p>
            <p className="text-xs text-gray-400 leading-tight hidden sm:block">Excel auto-syncs on every change</p>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Signal live indicator */}
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 border border-brand-100 px-2.5 py-1 rounded-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75 animate-signal-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
            </span>
            Live
          </span>

          <NotificationPanel />

          {user ? (
            <div className="flex items-center gap-2">
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {initials(user.name)}
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-xs font-medium text-gray-900 leading-tight">{user.name}</p>
                <p className="text-[11px] text-gray-400 leading-tight">
                  <span className={user.role === 'admin' ? 'text-amber-500 font-semibold' : 'text-gray-400'}>
                    {user.role}
                  </span>
                  {' · '}
                  <span className={user.plan === 'advanced' ? 'text-brand-600 font-semibold' : 'text-gray-400'}>
                    {user.plan}
                  </span>
                </p>
              </div>
              <button
                onClick={logout}
                className="ml-1 px-3 py-1.5 border border-gray-200 rounded-sm text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={onLoginClick}
              className="px-4 py-1.5 bg-brand-600 text-white rounded-sm text-xs font-semibold hover:bg-brand-700 transition"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
