import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import ApifySettingsModal from './ApifySettingsModal.jsx';
import PostWorkflowModal  from './PostWorkflowModal.jsx';

const STATUS_COLORS = {
  new:       'bg-gray-100 text-gray-600',
  viewed:    'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  applied:   'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
};

function ConfidenceBadge({ score }) {
  if (!score) return null;
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? 'text-green-700 bg-green-50 border-green-200'
            : pct >= 60 ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
            :             'text-gray-500 bg-gray-50 border-gray-200';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>{pct}%</span>;
}

export default function LinkedInPosts() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [posts,         setPosts]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [scraping,      setScraping]      = useState(false);
  const [search,        setSearch]        = useState('');
  const [hiringOnly,    setHiringOnly]    = useState(true);
  const [showSettings,  setShowSettings]  = useState(false);
  const [activePost,    setActivePost]    = useState(null);
  const [hasApiConfig,  setHasApiConfig]  = useState(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search)           params.search       = search;
      if (hiringOnly)       params.hiring_only  = 'true';
      const data = await api.get('/apify/posts', { params });
      setPosts(data);
    } catch { toast.error('Failed to load posts'); }
    finally  { setLoading(false); }
  }, [search, hiringOnly]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  useEffect(() => {
    api.get('/apify/settings').then(s => setHasApiConfig(s.hasApiKey && !!s.actorId)).catch(() => {});
  }, []);

  const handleScrape = async () => {
    if (!hasApiConfig) { setShowSettings(true); return; }
    setScraping(true);
    const tid = toast.loading('Fetching LinkedIn posts via Apify… (may take 1-3 min)');
    try {
      const result = await api.post('/apify/scrape', {}, { timeout: 200_000 });
      toast.success(`Imported ${result.imported} posts!`, { id: tid });
      fetchPosts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Scrape failed', { id: tid });
    } finally {
      setScraping(false);
    }
  };

  const handleClearPosts = async () => {
    if (!window.confirm('Clear all cached LinkedIn posts?')) return;
    await api.delete('/apify/posts');
    setPosts([]);
    toast.success('Posts cleared');
  };

  const handleStatusChange = async (postId, status) => {
    try {
      await api.patch(`/apify/posts/${postId}/status`, { status });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status } : p));
      if (activePost?.id === postId) setActivePost(prev => ({ ...prev, status }));
    } catch (err) { toast.error(err.response?.data?.error || 'Status update failed'); }
  };

  return (
    <div className="space-y-4">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search title, company, skills…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-2 w-72 text-sm focus:ring-2 focus:ring-blue-300 outline-none bg-white"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={hiringOnly} onChange={e => setHiringOnly(e.target.checked)} className="rounded" />
          Hiring posts only
        </label>
        {(search) && (
          <button onClick={() => setSearch('')} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear</button>
        )}

        <div className="ml-auto flex gap-2 flex-wrap items-center">
          <span className="text-xs text-gray-400">{posts.length} post{posts.length !== 1 ? 's' : ''}</span>
          {posts.length > 0 && (
            <button onClick={handleClearPosts} className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 transition">
              🗑 Clear
            </button>
          )}
          <button onClick={() => setShowSettings(true)}
            className="text-sm border rounded-lg px-3 py-2 bg-white hover:bg-gray-50 font-medium transition">
            ⚙️ Apify Settings
          </button>
          {isAdmin ? (
            <button
              onClick={handleScrape}
              disabled={scraping}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {scraping ? '⏳ Scraping…' : '🔍 Fetch from LinkedIn'}
            </button>
          ) : (
            <span
              title="Posts are auto-synced every 24 hours by admin"
              className="px-4 py-2 bg-gray-100 text-gray-400 text-sm font-semibold rounded-lg border border-gray-200 cursor-default select-none"
            >
              🔄 Auto-synced daily
            </span>
          )}
        </div>
      </div>

      {/* ── Empty / loading state ─────────────────────────────────────────── */}
      {loading && (
        <div className="bg-white rounded-xl border shadow-sm flex items-center justify-center h-48">
          <p className="text-gray-400 text-sm animate-pulse">Loading posts…</p>
        </div>
      )}

      {!loading && posts.length === 0 && (
        <div className="bg-white rounded-xl border shadow-sm flex flex-col items-center justify-center h-64 gap-4 text-center px-6">
          <div className="text-4xl">💼</div>
          <div>
            <p className="font-semibold text-gray-700">No LinkedIn posts yet</p>
            <p className="text-sm text-gray-400 mt-1">Configure your Apify API key and actor, then click "Fetch from LinkedIn"</p>
          </div>
          <button onClick={() => setShowSettings(true)}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            ⚙️ Configure Apify →
          </button>
        </div>
      )}

      {/* ── Posts table ───────────────────────────────────────────────────── */}
      {!loading && posts.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Post / Role</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Author</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tech Stack</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {posts.map(post => (
                  <tr key={post.id} className="hover:bg-blue-50/30 transition-colors">
                    {/* Title */}
                    <td className="px-3 py-3 max-w-xs">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">
                              {post.title || '—'}
                            </p>
                            <ConfidenceBadge score={post.confidence_score} />
                          </div>
                          {post.job_type && <p className="text-xs text-gray-400 truncate">{post.job_type}</p>}
                        </div>
                      </div>
                    </td>

                    {/* Author */}
                    <td className="px-3 py-3">
                      <p className="text-xs font-medium text-gray-800 whitespace-nowrap">{post.author_name || '—'}</p>
                      {post.author_headline && (
                        <p className="text-[11px] text-gray-400 max-w-[140px] truncate">{post.author_headline}</p>
                      )}
                    </td>

                    {/* Company */}
                    <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">{post.company_name || '—'}</td>

                    {/* Location */}
                    <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">{post.location || '—'}</td>

                    {/* Tech Stack */}
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {(post.tech_stack || []).slice(0, 3).map(t => (
                          <span key={t} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-medium">{t}</span>
                        ))}
                        {(post.tech_stack || []).length > 3 && (
                          <span className="text-[10px] text-gray-400">+{post.tech_stack.length - 3}</span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[post.status] || STATUS_COLORS.new}`}>
                        {post.status || 'new'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3">
                      <button
                        onClick={() => setActivePost(post)}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
                      >
                        Work →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-400">
            {posts.length} post{posts.length !== 1 ? 's' : ''} · Sorted by confidence score
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showSettings && (
        <ApifySettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            api.get('/apify/settings').then(s => setHasApiConfig(s.hasApiKey && !!s.actorId)).catch(() => {});
          }}
        />
      )}

      {activePost && (
        <PostWorkflowModal
          post={activePost}
          onClose={() => setActivePost(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
