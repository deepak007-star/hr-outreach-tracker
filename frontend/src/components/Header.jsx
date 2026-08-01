import { useAuth } from '../contexts/AuthContext.jsx';
import NotificationPanel from './NotificationPanel.jsx';
import Logo from './Logo.jsx';
import { Radio, Crown } from 'lucide-react';

function initials(name) {
  return (name || 'U').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

export default function Header({ onLoginClick, onPlansClick, planName }) {
  const { user, logout, devBypass, bypassAvailable, enableDevBypass } = useAuth();

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
              {/* Upgrade / Plans button */}
              {planName !== 'Advanced' && (
                <button
                  onClick={onPlansClick}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-sm text-xs font-semibold hover:from-violet-700 hover:to-purple-700 transition shadow-sm"
                >
                  <Crown size={12} />
                  Upgrade
                </button>
              )}
              {planName === 'Advanced' && (
                <button
                  onClick={onPlansClick}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 border border-violet-200 text-violet-600 rounded-sm text-xs font-medium hover:bg-violet-50 transition"
                >
                  <Crown size={12} />
                  Plans
                </button>
              )}
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
              {devBypass && (
                <span
                  title="Dev mode is on — login is bypassed. Sign out to turn it off."
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-bold bg-amber-100 text-amber-700 border border-amber-300"
                >
                  DEV
                </span>
              )}
              <button
                onClick={logout}
                className="ml-1 px-3 py-1.5 border border-gray-200 rounded-sm text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition"
              >
                {devBypass ? 'Exit Dev' : 'Sign Out'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onPlansClick}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 border border-violet-300 text-violet-600 rounded-sm text-xs font-medium hover:bg-violet-50 transition"
              >
                <Crown size={12} />
                Plans
              </button>
              {bypassAvailable && (
                <button
                  onClick={enableDevBypass}
                  title="Skip login and enter as admin with all features"
                  className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-sm text-xs font-semibold hover:bg-amber-50 transition"
                >
                  Dev Login
                </button>
              )}
              <button
                onClick={onLoginClick}
                className="px-4 py-1.5 bg-brand-600 text-white rounded-sm text-xs font-semibold hover:bg-brand-700 transition"
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
