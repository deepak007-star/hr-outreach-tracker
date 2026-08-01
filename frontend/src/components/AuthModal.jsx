import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

// ── Defined OUTSIDE AuthModal so its identity is stable across re-renders ──
function Field({ label, fkey, type, placeholder, hint, form, errors, set, showPass, setShowPass }) {
  const inputType = type === 'password' ? (showPass ? 'text' : 'password') : (type || 'text');
  const hasError  = !!errors[fkey];

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <input
          type={inputType}
          value={form[fkey]}
          onChange={e => set(fkey, e.target.value)}
          onBlur={e => set(fkey, e.target.value.trim())}
          placeholder={placeholder}
          autoComplete={type === 'password' ? 'current-password' : fkey === 'identifier' ? 'username email' : 'name'}
          className={`w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 outline-none transition
            ${hasError ? 'border-red-400 focus:ring-red-200 bg-red-50' : 'border-gray-300 focus:ring-brand-200'}`}
        />
        {type === 'password' && (
          <button
            type="button"
            onClick={() => setShowPass(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs select-none"
          >
            {showPass ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hasError
        ? <p className="mt-1 text-xs text-red-500 font-medium">{errors[fkey]}</p>
        : hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>
      }
    </div>
  );
}

// ── Main modal ──────────────────────────────────────────────────────────────
export default function AuthModal({ onClose }) {
  const { login, enableDevBypass, bypassAvailable } = useAuth();
  const [bypassing, setBypassing] = useState(false);

  const handleDevBypass = async () => {
    setBypassing(true);
    const ok = await enableDevBypass();
    setBypassing(false);
    if (ok) onClose();
  };
  const [tab,      setTab]      = useState('login');
  const [loading,  setLoading]  = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [errors,   setErrors]   = useState({});
  const [form,     setForm]     = useState({ name: '', identifier: '', password: '', confirm: '' });

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const { url } = await api.get('/oauth/google/login-start');
      window.location.href = url;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not start Google sign-in');
      setGoogleLoading(false);
    }
  };

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: '', general: '' }));
  };

  function validate() {
    const errs = {};
    if (tab === 'register') {
      if (!form.name.trim())              errs.name       = 'Name is required';
      if (!form.identifier.trim())        errs.identifier = 'Email is required';
      else if (!/\S+@\S+\.\S+/.test(form.identifier.trim()))
                                          errs.identifier = 'Enter a valid email address';
      if (!form.password)                 errs.password   = 'Password is required';
      else if (form.password.length < 6)  errs.password   = 'Password must be at least 6 characters';
      if (form.password !== form.confirm) errs.confirm    = 'Passwords do not match';
    } else {
      if (!form.identifier.trim())        errs.identifier = 'Email or username is required';
      else if (/\s{2,}/.test(form.identifier) && !/\S+@\S+\.\S+/.test(form.identifier.trim()))
                                          errs.identifier = 'Remove extra spaces from your username';
      if (!form.password)                 errs.password   = 'Password is required';
    }
    return errs;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    setErrors({});
    try {
      const endpoint = tab === 'login' ? '/auth/login' : '/auth/register';
      const payload  = tab === 'login'
        ? { email: form.identifier.trim(), password: form.password }
        : { name: form.name.trim(), email: form.identifier.trim(), password: form.password };

      const data = await api.post(endpoint, payload);
      login(data.token, data.user);
      toast.success(tab === 'login'
        ? `Welcome back, ${data.user.name}!`
        : `Account created! Welcome, ${data.user.name}!`
      );
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong. Please try again.';
      if (msg.toLowerCase().includes('password'))                                  setErrors({ password: msg });
      else if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('username')) setErrors({ identifier: msg });
      else if (msg.toLowerCase().includes('already'))                              setErrors({ identifier: msg });
      else                                                                         setErrors({ general: msg });
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (t) => {
    setTab(t);
    setForm({ name: '', identifier: '', password: '', confirm: '' });
    setErrors({});
    setShowPass(false);
  };

  const fieldProps = { form, errors, set, showPass, setShowPass };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-md shadow-modal w-full max-w-sm" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-800">
              {tab === 'login' ? 'Sign In' : 'Create Account'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">HR Outreach Tracker</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {['login', 'register'].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => switchTab(t)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tab === t ? 'border-b-2 border-brand-600 text-brand-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {/* Continue with Google */}
        <div className="px-5 pt-5">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded-sm py-2.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 transition"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 34.7 26.9 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.8l6.6 5.6C39.9 37 44 31 44 24c0-1.3-.1-2.7-.4-3.5z"/>
            </svg>
            {googleLoading ? 'Redirecting…' : 'Continue with Google'}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Signs you in and connects your Gmail for sending outreach mail — no app password needed.
          </p>
        </div>

        <div className="flex items-center gap-3 px-5 pt-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4" noValidate>

          {tab === 'register' && (
            <Field {...fieldProps} label="Full Name" fkey="name" placeholder="Vishal Choudhary" />
          )}

          <Field
            {...fieldProps}
            label={tab === 'login' ? 'Email or Username' : 'Email'}
            fkey="identifier"
            type={tab === 'register' ? 'email' : 'text'}
            placeholder={tab === 'login' ? 'you@example.com or your name' : 'you@example.com'}
            hint={tab === 'login' ? 'Use your email address or display name' : undefined}
          />

          <Field
            {...fieldProps}
            label="Password"
            fkey="password"
            type="password"
            placeholder="Min. 6 characters"
            hint={tab === 'register' ? 'At least 6 characters' : undefined}
          />

          {tab === 'register' && (
            <Field {...fieldProps} label="Confirm Password" fkey="confirm" type="password" placeholder="Repeat password" />
          )}

          {errors.general && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-sm px-3 py-2.5">
              <p className="text-xs text-red-600 font-medium">{errors.general}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition"
          >
            {loading ? '…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {bypassAvailable && (
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between gap-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-amber-800">Developer mode</p>
                <p className="text-[11px] text-amber-600 leading-snug">Skip login — enter as admin with all features.</p>
              </div>
              <button
                type="button"
                onClick={handleDevBypass}
                disabled={bypassing}
                className="shrink-0 px-3 py-1.5 bg-amber-500 text-white rounded-sm text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 transition"
              >
                {bypassing ? '…' : 'Enter'}
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pb-5">
          {tab === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => switchTab(tab === 'login' ? 'register' : 'login')}
            className="text-brand-600 hover:underline font-medium"
          >
            {tab === 'login' ? 'Register' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
