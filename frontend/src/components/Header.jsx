import { useAuth } from '../contexts/AuthContext.jsx';
import NotificationPanel from './NotificationPanel.jsx';
import Logo from './Logo.jsx';

export default function Header({ onLoginClick }) {
  const { user, logout } = useAuth();

  return (
    <header className="bg-slate-900 text-white shadow-lg">
      <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 className="text-xl font-bold tracking-tight">HR Outreach Tracker</h1>
            <p className="text-slate-400 text-xs mt-0.5">Excel file auto-syncs on every add / edit / delete</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 bg-emerald-900/60 text-emerald-300 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>

          <NotificationPanel />

          {user ? (
            <div className="flex items-center gap-2">
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                {(user.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-white text-xs font-medium leading-tight">{user.name}</p>
                <p className="text-slate-400 text-xs leading-tight">{user.email}</p>
                <p className="text-slate-500 text-xs leading-tight">
                  <span className={`font-semibold ${user.role === 'admin' ? 'text-yellow-400' : 'text-slate-400'}`}>
                    {user.role}
                  </span>
                  {' · '}
                  <span className={user.plan === 'advanced' ? 'text-emerald-400' : 'text-slate-400'}>
                    {user.plan}
                  </span>
                </p>
              </div>
              <button
                onClick={logout}
                className="ml-1 px-3 py-1.5 border border-slate-600 rounded-lg text-xs text-slate-300 hover:bg-slate-700 transition"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={onLoginClick}
              className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
