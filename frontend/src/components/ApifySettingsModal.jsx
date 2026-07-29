import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';

const DEFAULT_QUERIES = [
  'Java Developer', 'SDE 1', 'SDE 2', 'SDE 3', 'Python Developer',
  'Backend Developer', 'MERN Stack Developer', 'Frontend Developer',
  'React JS Developer', 'DevOps Developer', 'Java Backend Developer',
  'Full Stack Developer', 'Node.js Developer',
];

export default function ApifySettingsModal({ onClose, onSaved }) {
  const [queriesText, setQueriesText] = useState(DEFAULT_QUERIES.join('\n'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/apify/settings').then(s => {
      if (s.searchQueries?.length) setQueriesText(s.searchQueries.join('\n'));
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    const queries = queriesText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!queries.length) { toast.error('Add at least one job keyword'); return; }

    setSaving(true);
    try {
      await api.put('/apify/settings', { searchQueries: queries });
      toast.success('Job keywords saved!');
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
      <div className="bg-white rounded-md shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-extrabold text-gray-900">🔍 Job Keywords</h3>
            <p className="text-xs text-gray-500 mt-0.5">Role titles used by daily scrapers (Naukri, LinkedIn, Instahyre, Internshala, Jora, etc.)</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-lg font-bold">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Search Queries */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Job Titles / Roles <span className="text-gray-400 font-normal">(one per line)</span>
            </label>
            <textarea
              value={queriesText}
              onChange={e => setQueriesText(e.target.value)}
              rows={10}
              className="w-full border rounded-sm px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-brand-300 outline-none"
              placeholder="e.g. Java Developer&#10;React Developer&#10;DevOps Engineer"
            />
            <p className="text-xs text-gray-400 mt-1">
              These keywords drive the 7 AM IST daily scrape across <strong>Naukri</strong>, <strong>LinkedIn</strong>,
              <strong> Instahyre</strong>, <strong>Internshala</strong>, <strong>Foundit</strong>, <strong>Jora</strong>,
              and the remote job boards. The more specific the roles, the better the HR contact matches.
            </p>
          </div>

          {/* Tip */}
          <div className="bg-brand-50 border border-brand-200 rounded-sm p-3 text-xs text-brand-700 space-y-1">
            <p className="font-semibold">Tips for better contact extraction:</p>
            <ul className="list-disc list-inside space-y-0.5 text-brand-600">
              <li>Use exact job titles you're targeting (e.g. "Node.js Developer" not just "Backend")</li>
              <li>Add 8–15 keywords for broad coverage across all scraped platforms</li>
              <li>Include both "SDE 1" and "Junior Developer" style variants for the same role</li>
              <li>After saving, the next 7 AM IST scrape picks up the new keywords automatically</li>
            </ul>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 bg-brand-600 text-white rounded-sm text-sm font-bold hover:bg-brand-700 disabled:opacity-60 transition"
          >
            {saving ? 'Saving…' : '💾 Save Keywords'}
          </button>
        </div>
      </div>
    </div>
  );
}
