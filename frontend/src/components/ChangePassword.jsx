import { useState } from 'react';
import { api } from '../api/client.js';

const EyeIcon = ({ open }) => open
  ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>;

function PasswordInput({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-sm text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none font-mono"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded">
          <EyeIcon open={show} />
        </button>
      </div>
    </div>
  );
}

function strengthOf(pw) {
  if (!pw) return { score: 0, label: '', color: '' };
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 1) return { score: s, label: 'Very weak', color: 'bg-red-500' };
  if (s === 2) return { score: s, label: 'Weak', color: 'bg-orange-500' };
  if (s === 3) return { score: s, label: 'Fair', color: 'bg-yellow-500' };
  if (s === 4) return { score: s, label: 'Strong', color: 'bg-brand-500' };
  return { score: s, label: 'Very strong', color: 'bg-green-500' };
}

export default function ChangePassword() {
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const strength = strengthOf(form.newPassword);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccess(''); setError('');
    if (!form.newPassword)     return setError('New password is required');
    if (form.newPassword.length < 6) return setError('New password must be at least 6 characters');
    if (form.newPassword !== form.confirmPassword) return setError('Passwords do not match');

    setSaving(true);
    try {
      const data = await api.put('/auth/change-password', {
        newPassword: form.newPassword,
      });
      // Backend issues a fresh token with updated token_version — update storage
      // so this session stays valid and other sessions are revoked
      if (data?.token) localStorage.setItem('hr_token', data.token);
      setSuccess('Password changed successfully.');
      setForm({ newPassword: '', confirmPassword: '' });
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md">
      <h3 className="text-base font-semibold text-gray-900 mb-4">Change Login Password</h3>
      <p className="text-xs text-gray-500 mb-4">No need to enter your current password — you're already signed in, so this resets it directly.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <PasswordInput label="New password" value={form.newPassword}
            onChange={v => set('newPassword', v)} placeholder="At least 6 characters" />
          {form.newPassword && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex gap-0.5 flex-1">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= strength.score ? strength.color : 'bg-gray-200'}`} />
                ))}
              </div>
              <span className="text-xs text-gray-500 w-20">{strength.label}</span>
            </div>
          )}
        </div>

        <PasswordInput label="Confirm new password" value={form.confirmPassword}
          onChange={v => set('confirmPassword', v)} placeholder="Repeat new password" />

        {form.newPassword && form.confirmPassword && form.newPassword !== form.confirmPassword && (
          <p className="text-xs text-red-500">Passwords do not match</p>
        )}
        {form.newPassword && form.confirmPassword && form.newPassword === form.confirmPassword && (
          <p className="text-xs text-green-600">Passwords match</p>
        )}

        {error   && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-sm">{error}</div>}
        {success && <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-sm">{success}</div>}

        <button type="submit" disabled={saving}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-sm hover:bg-brand-700 disabled:opacity-60 transition-colors">
          {saving ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}
