/**
 * Apply Queue — skill-matched jobs queued for the user to review and apply
 * to THEMSELVES. Nothing here submits a form or logs into a job platform:
 * "Apply →" just opens the real apply page in a new tab (using data already
 * in hand, no extra request); a follow-up "✓ Mark as applied" click is what
 * actually records it server-side. Two low-friction clicks, no blocking
 * modal — a modal per job would defeat the point of clearing 50-60/day.
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { EmptyState, Spinner } from './ui/index.js';
import { RefreshCw, ExternalLink, Check, X } from 'lucide-react';

const SEGMENTS = [
  { id: 'queued',  label: 'Queued',  active: 'bg-brand-600 text-white border-brand-600', dot: 'bg-brand-500' },
  { id: 'applied', label: 'Applied', active: 'bg-emerald-600 text-white border-emerald-600', dot: 'bg-emerald-500' },
  { id: 'skipped', label: 'Skipped', active: 'bg-gray-600 text-white border-gray-600', dot: 'bg-gray-400' },
  { id: 'all',     label: 'All',     active: 'bg-slate-800 text-white border-slate-800', dot: 'bg-slate-500' },
];

const SKIP_REASONS = ['Not relevant', 'Already applied elsewhere', 'Salary too low', 'Other'];

function timeAgo(iso) {
  if (!iso) return '';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function JobRow({ item, segment, pendingConfirm, onOpenApply, onMarkApplied, onSkip }) {
  const isPending = pendingConfirm.has(item.id);
  return (
    <div className="bg-white border rounded-md px-4 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">{item.title || 'Untitled role'}</span>
          <span className="text-xs text-gray-500 truncate">{item.company || 'Unknown company'}</span>
          {item.location && <span className="text-xs text-gray-400 truncate">📍 {item.location}</span>}
          {item.salary && <span className="text-xs text-green-700 truncate">💰 {item.salary}</span>}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            title={item.matched_skills?.length ? `Matched: ${item.matched_skills.join(', ')}` : undefined}
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
              item.match_percent >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : item.match_percent >= 50 ? 'bg-brand-50 text-brand-700 border-brand-200'
                : 'bg-gray-100 text-gray-600 border-gray-200'
            }`}
          >
            🎯 {item.match_percent}% match
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            item.apply_method === 'easy_apply' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-gray-50 text-gray-600 border border-gray-200'
          }`}>
            {item.apply_method === 'easy_apply' ? '⚡ Easy Apply' : '🔗 Direct apply'}
          </span>
          {segment === 'applied' && item.applied_at && (
            <span className="text-xs text-gray-400">Applied {timeAgo(item.applied_at)}</span>
          )}
          {segment === 'skipped' && (
            <span className="text-xs text-gray-400">Skipped{item.skip_reason ? `: ${item.skip_reason}` : ''}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {item.link && (
          <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-gray-600" title="View posting">
            <ExternalLink size={14} />
          </a>
        )}
        {segment === 'queued' && !isPending && (
          <>
            <button
              onClick={() => onOpenApply(item)}
              className="px-3 py-1.5 bg-brand-600 text-white text-xs font-semibold rounded-sm hover:bg-brand-700 transition"
            >
              Apply →
            </button>
            <SkipButton onSkip={reason => onSkip(item.id, reason)} />
          </>
        )}
        {segment === 'queued' && isPending && (
          <>
            <button
              onClick={() => onMarkApplied(item.id)}
              title="Confirm you submitted the application"
              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-sm hover:bg-emerald-700 transition"
            >
              <Check size={13} /> Mark applied
            </button>
            <button
              onClick={() => onOpenApply(item)}
              title="Reopen the apply page"
              className="px-2.5 py-1.5 border border-gray-300 text-gray-500 text-xs rounded-sm hover:bg-gray-50 transition"
            >
              <ExternalLink size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SkipButton({ onSkip }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="px-2.5 py-1.5 border border-gray-300 text-gray-500 text-xs font-medium rounded-sm hover:bg-gray-50 transition"
      >
        Skip
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
          {SKIP_REASONS.map(r => (
            <button
              key={r}
              onClick={() => { setOpen(false); onSkip(r); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ApplyQueue() {
  const [items,      setItems]      = useState([]);
  const [summary,    setSummary]    = useState({ queued: 0, applied: 0, skipped: 0, total: 0, applied_today: 0, daily_target: 60 });
  const [segment,    setSegment]    = useState('queued');
  const [page,       setPage]       = useState(1);
  const [pages,      setPages]      = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(new Set());

  const fetchSummary = useCallback(() => {
    api.get('/apply-queue/summary').then(setSummary).catch(() => {});
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/apply-queue', { params: { segment, page, limit: 20 } });
      setItems(data.items || []);
      setPages(data.pages || 1);
    } catch {
      toast.error('Could not load the apply queue');
    } finally {
      setLoading(false);
    }
  }, [segment, page]);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { setPage(1); }, [segment]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await api.post('/apply-queue/refresh', {});
      toast.success(result.added > 0 ? `${result.added} new job${result.added !== 1 ? 's' : ''} added to your queue` : 'Queue is already full — no new matches to add');
      fetchItems();
      fetchSummary();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not refresh the queue');
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenApply = (item) => {
    const url = item.apply_link || item.link;
    if (!url) { toast.error('No apply link on this posting'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
    setPendingConfirm(prev => new Set(prev).add(item.id));
  };

  const handleMarkApplied = async (id) => {
    try {
      await api.post(`/apply-queue/${id}/apply`, {});
      setPendingConfirm(prev => { const next = new Set(prev); next.delete(id); return next; });
      setItems(prev => prev.filter(i => i.id !== id));
      fetchSummary();
      toast.success('Marked as applied');
    } catch {
      toast.error('Could not mark as applied');
    }
  };

  const handleSkip = async (id, reason) => {
    try {
      await api.post(`/apply-queue/${id}/skip`, { reason });
      setItems(prev => prev.filter(i => i.id !== id));
      fetchSummary();
    } catch {
      toast.error('Could not skip this job');
    }
  };

  const pct = summary.daily_target > 0 ? Math.min(100, (summary.applied_today / summary.daily_target) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress + refresh */}
      <div className="bg-white border rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
            Applied today: {summary.applied_today}/{summary.daily_target}
          </span>
          <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-semibold rounded-sm hover:bg-gray-50 disabled:opacity-50 transition"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh queue'}
        </button>
      </div>

      {/* Segment tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {SEGMENTS.map(seg => (
          <button
            key={seg.id}
            onClick={() => setSegment(seg.id)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
              segment === seg.id ? seg.active : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${segment === seg.id ? 'bg-white/80' : seg.dot}`} />
            {seg.label}
            <span className={`ml-0.5 tabular-nums ${segment === seg.id ? 'text-white/80' : 'text-gray-400'}`}>
              {seg.id === 'all' ? summary.total : summary[seg.id]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-10"><Spinner size="md" /></div>
      ) : items.length === 0 ? (
        <EmptyState
          title={segment === 'queued' ? 'No jobs queued yet' : `No ${segment} jobs`}
          description={segment === 'queued' ? 'Click "Refresh queue" to pull in skill-matched jobs from what\'s already been scraped.' : ''}
        />
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <JobRow
              key={item.id}
              item={item}
              segment={segment}
              pendingConfirm={pendingConfirm}
              onOpenApply={handleOpenApply}
              onMarkApplied={handleMarkApplied}
              onSkip={handleSkip}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-xs border rounded-sm hover:bg-gray-50 disabled:opacity-40">← Prev</button>
          <span className="px-2 py-1.5 text-xs text-gray-500">{page}/{pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
            className="px-3 py-1.5 text-xs border rounded-sm hover:bg-gray-50 disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}
