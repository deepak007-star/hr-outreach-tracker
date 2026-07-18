import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';

const DEFAULT_QUERIES = [
  'hiring software developer Noida',
  'hiring full stack developer Delhi',
  'software engineer job Noida hiring',
  'fullstack developer jobs Delhi NCR',
  'looking for MERN developer Noida',
  'urgent hiring software developer Delhi',
];

const POSTED_LIMITS = ['1h', '6h', '12h', '24h', '3d', '7d'];
const SORT_OPTIONS  = ['relevance', 'date'];

export default function ApifySettingsModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    apiKey:        '',
    actorId:       '',
    searchQueries: DEFAULT_QUERIES,
    maxPosts:      30,
    postedLimit:   '24h',
    sortBy:        'relevance',
  });
  const [queriesText, setQueriesText] = useState(DEFAULT_QUERIES.join('\n'));
  const [saving,   setSaving]   = useState(false);
  const [hasKey,   setHasKey]   = useState(false);

  useEffect(() => {
    api.get('/apify/settings').then(s => {
      setHasKey(s.hasApiKey);
      setForm(f => ({
        ...f,
        apiKey:      s.hasApiKey ? s.apiKey : '',
        actorId:     s.actorId   || '',
        maxPosts:    s.maxPosts  || 30,
        postedLimit: s.postedLimit || '24h',
        sortBy:      s.sortBy    || 'relevance',
        searchQueries: s.searchQueries?.length ? s.searchQueries : DEFAULT_QUERIES,
      }));
      if (s.searchQueries?.length) setQueriesText(s.searchQueries.join('\n'));
    }).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    const queries = queriesText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!queries.length) { toast.error('Add at least one search query'); return; }
    if (!form.actorId.trim()) { toast.error('Actor ID is required'); return; }

    setSaving(true);
    try {
      await api.put('/apify/settings', { ...form, searchQueries: queries });
      toast.success('Apify settings saved!');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-extrabold text-gray-900">⚙️ Apify Settings</h3>
            <p className="text-xs text-gray-500 mt-0.5">Configure LinkedIn post scraping via Apify</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-lg font-bold">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Apify API Token {hasKey && <span className="text-green-600 font-normal">(saved)</span>}
            </label>
            <input
              type="password"
              value={form.apiKey}
              onChange={e => set('apiKey', e.target.value)}
              placeholder={hasKey ? 'Leave blank to keep existing key' : 'apify_api_XXXXXXXX'}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Find your token at <span className="text-blue-500 font-mono">console.apify.com → Settings → Integrations</span>
            </p>
          </div>

          {/* Actor ID */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Actor ID</label>
            <input
              value={form.actorId}
              onChange={e => set('actorId', e.target.value)}
              placeholder="e.g. apify/linkedin-post-search-scraper"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Copy Actor ID from <span className="text-blue-500 font-mono">console.apify.com/actors</span> → your actor → API tab
            </p>
          </div>

          {/* Search Queries */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Search Queries <span className="text-gray-400 font-normal">(one per line)</span></label>
            <textarea
              value={queriesText}
              onChange={e => setQueriesText(e.target.value)}
              rows={6}
              className="w-full border rounded-lg px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-blue-300 outline-none"
            />
          </div>

          {/* Max Posts + Posted Limit + Sort */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Max Posts</label>
              <input
                type="number" min="5" max="200"
                value={form.maxPosts}
                onChange={e => set('maxPosts', parseInt(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Posted Within</label>
              <select value={form.postedLimit} onChange={e => set('postedLimit', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none bg-white">
                {POSTED_LIMITS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Sort By</label>
              <select value={form.sortBy} onChange={e => set('sortBy', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none bg-white">
                {SORT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Help note */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">How to set up:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
              <li>Sign up at <span className="font-mono">apify.com</span></li>
              <li>Go to <span className="font-mono">console.apify.com/actors</span> → find your LinkedIn scraper actor</li>
              <li>Copy the Actor ID from the API tab</li>
              <li>Copy your API Token from Settings → Integrations</li>
            </ol>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {saving ? 'Saving…' : '💾 Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
