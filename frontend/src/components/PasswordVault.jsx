import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';

const CATEGORIES = ['general', 'job-board', 'social', 'email', 'banking', 'work', 'other'];

const EyeIcon = ({ open }) => open
  ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>;

const categoryColors = {
  'job-board': 'bg-blue-100 text-blue-700',
  'social':    'bg-purple-100 text-purple-700',
  'email':     'bg-green-100 text-green-700',
  'banking':   'bg-yellow-100 text-yellow-700',
  'work':      'bg-orange-100 text-orange-700',
  'general':   'bg-gray-100 text-gray-700',
  'other':     'bg-gray-100 text-gray-700',
};

// Strength indicator for passwords
function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Very weak', color: 'bg-red-500' };
  if (score === 2) return { score, label: 'Weak', color: 'bg-orange-500' };
  if (score === 3) return { score, label: 'Fair', color: 'bg-yellow-500' };
  if (score === 4) return { score, label: 'Strong', color: 'bg-blue-500' };
  return { score, label: 'Very strong', color: 'bg-green-500' };
}

function generatePassword() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => charset[b % charset.length])
    .join('');
}

// ── Entry Form (add / edit) ──────────────────────────────────────────────────
function VaultForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    title:    initial?.title    || '',
    username: initial?.username || '',
    password: '',
    url:      initial?.url      || '',
    category: initial?.category || 'general',
    notes:    initial?.notes    || '',
  });
  const [showPw, setShowPw] = useState(false);
  const isEdit = !!initial;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const strength = passwordStrength(form.password);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
          <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            placeholder="e.g. LinkedIn, Naukri, Gmail" value={form.title}
            onChange={e => set('title', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Username / Email</label>
          <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="username or email" value={form.username}
            onChange={e => set('username', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Password {isEdit && <span className="text-gray-400">(leave blank to keep current)</span>}
            {!isEdit && <span className="text-red-500"> *</span>}
          </label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              placeholder={isEdit ? '(unchanged)' : 'password'}
              value={form.password}
              onChange={e => set('password', e.target.value)}
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
              <button type="button" onClick={() => setShowPw(s => !s)}
                className="p-1.5 text-gray-500 hover:text-gray-700 rounded">
                <EyeIcon open={showPw} />
              </button>
              <button type="button"
                onClick={() => { const p = generatePassword(); set('password', p); setShowPw(true); }}
                title="Generate strong password"
                className="p-1 text-xs text-blue-600 hover:text-blue-800 font-medium rounded">Gen</button>
            </div>
          </div>
          {form.password && (
            <div className="mt-1 flex items-center gap-2">
              <div className="flex gap-0.5 flex-1">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength.score ? strength.color : 'bg-gray-200'}`} />
                ))}
              </div>
              <span className="text-xs text-gray-500">{strength.label}</span>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Website URL</label>
          <input className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="https://..." value={form.url}
            onChange={e => set('url', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
          <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            value={form.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('-', ' ')}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            rows={2} placeholder="Optional notes..." value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="button" onClick={() => onSave(form)} disabled={saving}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
          {saving ? 'Saving…' : isEdit ? 'Update Entry' : 'Save Entry'}
        </button>
      </div>
    </div>
  );
}

// ── Single vault card ────────────────────────────────────────────────────────
function VaultCard({ entry, onEdit, onDelete, revealEndpoint }) {
  const [revealed, setRevealed]   = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [showPw, setShowPw]       = useState(false);
  const [copied, setCopied]       = useState(false);

  // Auto-hide password after 30s
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => { setRevealed(null); setShowPw(false); }, 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  const handleReveal = async () => {
    if (revealed) { setRevealed(null); setShowPw(false); return; }
    setRevealing(true);
    try {
      const data = await api.get(revealEndpoint);
      setRevealed(data.password);
      setShowPw(true);
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to reveal password');
    } finally {
      setRevealing(false);
    }
  };

  const copy = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const catColor = categoryColors[entry.category] || categoryColors.general;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{entry.title}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catColor}`}>
              {entry.category.replace('-', ' ')}
            </span>
          </div>
          {entry.username && (
            <p className="text-xs text-gray-500 truncate">{entry.username}</p>
          )}
          {entry.url && (
            <p className="text-xs text-gray-400 truncate">{entry.url}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit} title="Edit"
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button onClick={onDelete} title="Delete"
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>

      {/* Password row */}
      <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
        <span className="text-xs text-gray-400 w-16 shrink-0">Password</span>
        <span className="flex-1 font-mono text-sm text-gray-700 truncate">
          {revealed
            ? (showPw ? revealed : '•'.repeat(Math.min(revealed.length, 20)))
            : '•••••••••••••'}
        </span>
        <div className="flex gap-1 shrink-0">
          {revealed && (
            <>
              <button onClick={() => setShowPw(s => !s)} title={showPw ? 'Hide' : 'Show'}
                className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <EyeIcon open={showPw} />
              </button>
              <button onClick={copy} title="Copy"
                className="p-1 text-gray-400 hover:text-gray-600 rounded text-xs">
                {copied ? '✓' : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>}
              </button>
            </>
          )}
          <button onClick={handleReveal} disabled={revealing}
            className={`p-1 rounded text-xs font-medium transition-colors ${revealed ? 'text-orange-500 hover:text-orange-700' : 'text-blue-600 hover:text-blue-800'}`}>
            {revealing ? '…' : revealed ? 'Hide' : 'Reveal'}
          </button>
        </div>
      </div>
      {revealed && (
        <p className="text-xs text-gray-400 mt-1 text-right">Auto-hides in 30s</p>
      )}
      {entry.notes && (
        <p className="text-xs text-gray-500 mt-2 italic border-t border-gray-100 pt-2">{entry.notes}</p>
      )}
    </div>
  );
}

// ── Main PasswordVault component ─────────────────────────────────────────────
// isAdmin=false → manages /api/vault (own entries)
// isAdmin=true  → read-only admin view at /api/admin/vault (all users' entries)
export default function PasswordVault({ isAdmin = false }) {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null); // entry being edited
  const [saving, setSaving]     = useState(false);
  const [search, setSearch]     = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const baseUrl = isAdmin ? '/admin/vault' : '/vault';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.get(baseUrl);
      setEntries(data);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load vault');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    if (!form.title.trim()) return alert('Title is required');
    if (!editing && !form.password.trim()) return alert('Password is required');
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/vault/${editing.id}`, form);
      } else {
        await api.post('/vault', form);
      }
      await load();
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry) => {
    if (!confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/vault/${entry.id}`);
      setEntries(es => es.filter(e => e.id !== entry.id));
    } catch (e) {
      alert(e?.response?.data?.error || 'Failed to delete');
    }
  };

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    const matchQ = !q || e.title.toLowerCase().includes(q) || e.username?.toLowerCase().includes(q) || e.url?.toLowerCase().includes(q);
    const matchC = catFilter === 'all' || e.category === catFilter;
    return matchQ && matchC;
  });

  // Group admin view by user
  const adminGroups = isAdmin
    ? filtered.reduce((acc, e) => {
        const key = e.user_id;
        if (!acc[key]) acc[key] = { user_name: e.user_name, user_email: e.user_email, entries: [] };
        acc[key].entries.push(e);
        return acc;
      }, {})
    : null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-48">
          <input
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Search by title, username or URL…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('-', ' ')}</option>)}
        </select>
        {!isAdmin && (
          <button onClick={() => { setEditing(null); setShowForm(true); }}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
            Add Entry
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && !isAdmin && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <h4 className="text-sm font-semibold text-blue-800 mb-3">
            {editing ? 'Edit Entry' : 'New Credential'}
          </h4>
          <VaultForm
            initial={editing}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditing(null); }}
            saving={saving}
          />
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="text-center py-8 text-gray-400">Loading vault…</div>
      )}
      {error && (
        <div className="text-center py-4 text-red-500 text-sm">{error}</div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          {entries.length === 0
            ? <div>
                <div className="text-4xl mb-3">🔐</div>
                <p className="text-sm">No credentials saved yet.</p>
                {!isAdmin && <p className="text-xs mt-1">Click "Add Entry" to store your first credential.</p>}
              </div>
            : <p className="text-sm">No entries match your search.</p>
          }
        </div>
      )}

      {/* User grid (own vault) */}
      {!loading && !error && !isAdmin && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(entry => (
            <VaultCard
              key={entry.id}
              entry={entry}
              revealEndpoint={`/vault/${entry.id}/reveal`}
              onEdit={() => { setEditing(entry); setShowForm(true); window.scrollTo(0,0); }}
              onDelete={() => handleDelete(entry)}
            />
          ))}
        </div>
      )}

      {/* Admin grouped view */}
      {!loading && !error && isAdmin && adminGroups && (
        <div className="space-y-6">
          {Object.values(adminGroups).map(group => (
            <div key={group.user_email}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 text-xs font-bold shrink-0">
                  {(group.user_name || group.user_email)?.[0]?.toUpperCase()}
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-800">{group.user_name}</span>
                  <span className="text-xs text-gray-400 ml-2">{group.user_email}</span>
                </div>
                <span className="text-xs text-gray-400 ml-auto">{group.entries.length} entries</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-9">
                {group.entries.map(entry => (
                  <VaultCard
                    key={entry.id}
                    entry={entry}
                    revealEndpoint={`/admin/vault/${entry.id}/reveal`}
                    onEdit={() => {}}
                    onDelete={() => {}}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
