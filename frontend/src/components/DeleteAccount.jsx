import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

// Self-service account deletion — backend requires typing the account's own
// email exactly (not the password: some accounts, e.g. connected via Google
// OAuth, have a random password_hash the user never sees) as a deliberate,
// accidental-click-proof confirmation before the irreversible cascade delete runs.
export default function DeleteAccount() {
  const { user, logout } = useAuth();
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const matches = confirmEmail.trim().toLowerCase() === (user?.email || '').toLowerCase();

  const handleDelete = async () => {
    if (!matches) return;
    if (!window.confirm('This permanently deletes your account, contacts, resumes, and email history. This cannot be undone. Continue?')) return;
    setDeleting(true);
    setError('');
    try {
      await api.delete('/auth/me', { data: { confirmEmail } });
      toast.success('Account deleted.');
      await logout();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to delete account');
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-md border-t pt-6">
      <h3 className="text-base font-semibold text-red-700 mb-1">Delete Account</h3>
      <p className="text-xs text-gray-500 mb-4">
        Permanently deletes your account, contacts, resumes, and email history. This cannot be undone.
      </p>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Type <span className="font-mono text-red-600">{user?.email}</span> to confirm
      </label>
      <input
        type="text"
        value={confirmEmail}
        onChange={e => setConfirmEmail(e.target.value)}
        placeholder={user?.email}
        className="w-full px-3 py-2 border border-gray-300 rounded-sm text-sm focus:ring-2 focus:ring-red-400 focus:border-red-400 outline-none font-mono"
      />
      {error && <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-sm">{error}</div>}
      <button
        onClick={handleDelete}
        disabled={!matches || deleting}
        className="mt-4 w-full px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {deleting ? 'Deleting…' : 'Permanently Delete My Account'}
      </button>
    </div>
  );
}
