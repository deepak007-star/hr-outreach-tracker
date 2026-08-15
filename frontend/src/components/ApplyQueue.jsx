/**
 * Apply Queue — skill-matched jobs queued for the user to review and apply
 * to THEMSELVES. Nothing here submits a form or logs into a job platform:
 * "Apply →" just opens the real apply page in a new tab (using data already
 * in hand, no extra request); a follow-up "✓ Mark as applied" click is what
 * actually records it server-side. Two low-friction clicks, no blocking
 * modal — a modal per job would defeat the point of clearing 50-60/day.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { EmptyState, Spinner } from './ui/index.js';
import { RefreshCw, ExternalLink, Check, X, PlayCircle } from 'lucide-react';

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

function JobRow({ item, segment, pendingConfirm, onOpenApply, onMarkApplied, onSkip, selected, onToggleSelect }) {
  const isPending = pendingConfirm.has(item.id);
  return (
    <div className="bg-white border rounded-md px-4 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
      {segment === 'queued' && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item)}
          className="rounded accent-brand-600 shrink-0 cursor-pointer"
        />
      )}
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

/**
 * Batch Review — steps through a pre-selected list of jobs one at a time.
 * Auto-opens each job's apply page as soon as it becomes current (removes
 * the "hunt through the list for the next one" friction), but every
 * submission is still an explicit human click — "Mark Applied & Next" is
 * the ONLY thing that advances past a job and calls the backend. Nothing
 * here fills a form, answers a screening question, or submits anything
 * unattended; that's the exact bot-automation risk (LinkedIn/Naukri account
 * bans) the user deliberately opted out of for this feature.
 */
function BatchReview({ queue, onMarkApplied, onSkip, onExit }) {
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState({ applied: 0, skipped: 0 });
  const [busy, setBusy]   = useState(false);
  const openedForRef = useRef(null);

  const current = queue[index];
  const done = index >= queue.length;

  // Auto-open the apply page the moment a new job becomes "current" — once
  // per job (openedForRef guards against re-opening on an unrelated re-render).
  useEffect(() => {
    if (!current || openedForRef.current === current.id) return;
    openedForRef.current = current.id;
    const url = current.apply_link || current.link;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, [current]);

  const advance = () => setIndex(i => i + 1);

  const handleApplied = async () => {
    setBusy(true);
    try {
      await onMarkApplied(current.id, { silent: true });
      setTally(t => ({ ...t, applied: t.applied + 1 }));
      advance();
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async (reason) => {
    setBusy(true);
    try {
      await onSkip(current.id, reason);
      setTally(t => ({ ...t, skipped: t.skipped + 1 }));
      advance();
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = () => {
    const url = current.apply_link || current.link;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="bg-white border-2 border-brand-200 rounded-md p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-brand-700">Batch Review — {Math.min(index + 1, queue.length)} of {queue.length}</span>
        <button onClick={onExit} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
          <X size={13} /> Exit batch
        </button>
      </div>

      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-brand-600 rounded-full transition-all duration-300" style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>

      {done ? (
        <div className="text-center py-8 space-y-2">
          <p className="text-lg font-bold text-gray-800">Batch complete 🎉</p>
          <p className="text-sm text-gray-500">{tally.applied} applied, {tally.skipped} skipped</p>
          <button onClick={onExit} className="mt-2 px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 transition">
            Back to queue
          </button>
        </div>
      ) : (
        <>
          <div className="border rounded-md p-4 bg-gray-50">
            <p className="text-base font-semibold text-gray-900">{current.title || 'Untitled role'}</p>
            <p className="text-sm text-gray-500">{current.company || 'Unknown company'} {current.location ? `· ${current.location}` : ''}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                🎯 {current.match_percent}% match
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                current.apply_method === 'easy_apply' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-gray-50 text-gray-600 border border-gray-200'
              }`}>
                {current.apply_method === 'easy_apply' ? '⚡ Easy Apply' : '🔗 Direct apply'}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-400">
            The apply page opened in a new tab automatically. Submit it there, then click below to move on.
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={handleApplied}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              <Check size={15} /> Mark Applied & Next
            </button>
            <button onClick={handleReopen} title="Reopen the apply page"
              className="px-3 py-2.5 border border-gray-300 text-gray-500 rounded-sm hover:bg-gray-50 transition">
              <ExternalLink size={15} />
            </button>
            <div className="relative">
              <SkipButton onSkip={handleSkip} />
            </div>
          </div>
        </>
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
  // Batch Review: selectedMap holds full item data (not just ids) since a
  // "select 50" quick-pick fetches beyond whatever page is currently on
  // screen — the stepper needs the actual job details, not just an id list.
  const [selectedMap, setSelectedMap] = useState(new Map());
  const [selecting,   setSelecting]   = useState(false);
  const [batchQueue,  setBatchQueue]  = useState(null); // array = batch mode active

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

  const REFRESH_EMPTY_MESSAGES = {
    queue_full: 'Queue is already full — clear a few (Applied/Skip) to make room for more.',
    no_candidates_scraped: 'No jobs scraped in the last 30 days yet — check back after the next scrape runs.',
    no_matches_found: "No jobs matched at least 3 of your profile skills — try adding more skills to your profile, or check back after the next scrape.",
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await api.post('/apply-queue/refresh', {});
      if (result.added > 0) {
        toast.success(`${result.added} new job${result.added !== 1 ? 's' : ''} added to your queue`);
      } else {
        toast(REFRESH_EMPTY_MESSAGES[result.reason] || 'No new jobs to add right now');
      }
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

  const handleMarkApplied = async (id, { silent = false } = {}) => {
    try {
      await api.post(`/apply-queue/${id}/apply`, {});
      setPendingConfirm(prev => { const next = new Set(prev); next.delete(id); return next; });
      setItems(prev => prev.filter(i => i.id !== id));
      setSelectedMap(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next; });
      fetchSummary();
      if (!silent) toast.success('Marked as applied');
    } catch {
      toast.error('Could not mark as applied');
    }
  };

  const handleSkip = async (id, reason) => {
    try {
      await api.post(`/apply-queue/${id}/skip`, { reason });
      setItems(prev => prev.filter(i => i.id !== id));
      setSelectedMap(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next; });
      fetchSummary();
    } catch {
      toast.error('Could not skip this job');
    }
  };

  const toggleSelect = (item) => {
    setSelectedMap(prev => {
      const next = new Map(prev);
      next.has(item.id) ? next.delete(item.id) : next.set(item.id, item);
      return next;
    });
  };

  // Quick-select fetches a fresh page at the requested size directly — the
  // on-screen list is paginated at 20, so "select 50" needs its own request
  // rather than only being able to select whatever's currently rendered.
  const quickSelect = async (n) => {
    setSelecting(true);
    try {
      const data = await api.get('/apply-queue', { params: { segment: 'queued', page: 1, limit: n } });
      setSelectedMap(prev => {
        const next = new Map(prev);
        for (const it of (data.items || [])) next.set(it.id, it);
        return next;
      });
    } catch {
      toast.error('Could not load jobs to select');
    } finally {
      setSelecting(false);
    }
  };

  const startBatch = () => {
    if (!selectedMap.size) return;
    setBatchQueue([...selectedMap.values()]);
  };

  const exitBatch = () => {
    setBatchQueue(null);
    setSelectedMap(new Map());
    fetchItems();
    fetchSummary();
  };

  const pct = summary.daily_target > 0 ? Math.min(100, (summary.applied_today / summary.daily_target) * 100) : 0;

  if (batchQueue) {
    return (
      <div className="space-y-4">
        <BatchReview
          queue={batchQueue}
          onMarkApplied={handleMarkApplied}
          onSkip={handleSkip}
          onExit={exitBatch}
        />
      </div>
    );
  }

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

      {/* Batch selection bar — queued only. Quick-select fetches beyond the
          current page so "select 50" always means 50, not "however many
          happen to be on this page." */}
      {segment === 'queued' && summary.queued > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-white border rounded-md px-3 py-2">
          <span className="text-xs text-gray-400 font-medium">Batch review:</span>
          {[5, 10, 25, 50].map(n => (
            <button
              key={n}
              onClick={() => quickSelect(n)}
              disabled={selecting}
              className="text-xs px-2.5 py-1 border border-gray-300 rounded-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
            >
              Select {n}
            </button>
          ))}
          {selectedMap.size > 0 && (
            <>
              <span className="text-xs text-gray-400">{selectedMap.size} selected</span>
              <button onClick={() => setSelectedMap(new Map())} className="text-xs text-gray-400 hover:text-gray-600 underline">
                Clear
              </button>
              <button
                onClick={startBatch}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-xs font-semibold rounded-sm hover:bg-brand-700 transition"
              >
                <PlayCircle size={14} /> Start Batch Review ({selectedMap.size})
              </button>
            </>
          )}
        </div>
      )}

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
              selected={selectedMap.has(item.id)}
              onToggleSelect={toggleSelect}
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
