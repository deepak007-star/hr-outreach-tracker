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
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 outline-none transition
            ${hasError ? 'border-red-400 focus:ring-red-200 bg-red-50' : 'border-gray-300 focus:ring-blue-200'}`}
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
  const { login } = useAuth();
  const [tab,      setTab]      = useState('login');
  const [loading,  setLoading]  = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [errors,   setErrors]   = useState({});
  const [form,     setForm]     = useState({ name: '', identifier: '', password: '', confirm: '' });

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>

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
                tab === t ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
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
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <span className="text-red-400 mt-0.5 shrink-0">⚠️</span>
              <p className="text-xs text-red-600 font-medium">{errors.general}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? '…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 pb-5">
          {tab === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => switchTab(tab === 'login' ? 'register' : 'login')}
            className="text-blue-600 hover:underline font-medium"
          >
            {tab === 'login' ? 'Register' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
