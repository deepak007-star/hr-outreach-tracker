/**
 * Content AI — History. Segmented table of everything past the review
 * queue: approved-and-awaiting-publish, published, rejected, and failed
 * (with a manual Retry, since the publisher never auto-retries a failure).
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { EmptyState, Spinner } from './ui/index.js';
import { RefreshCw, ExternalLink, RotateCcw, Send, FileText } from 'lucide-react';

const SEGMENTS = [
  { id: 'approved',  label: 'Awaiting publish', active: 'bg-brand-600 text-white border-brand-600' },
  { id: 'published', label: 'Published',        active: 'bg-emerald-600 text-white border-emerald-600' },
  { id: 'rejected',  label: 'Rejected',         active: 'bg-gray-600 text-white border-gray-600' },
  { id: 'failed',    label: 'Failed',           active: 'bg-red-600 text-white border-red-600' },
  { id: 'all',       label: 'All',              active: 'bg-slate-800 text-white border-slate-800' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export default function ContentHistoryPanel() {
  const [segment, setSegment] = useState('approved');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/content/posts/history', { params: { status: segment, limit: 50 } });
      setItems(data.items || []);
    } catch (e) {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [segment]);

  useEffect(() => { load(); }, [load]);

  const publishNow = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/content/posts/${id}/publish-now`);
      toast.success('Publish started — check back shortly');
      setTimeout(load, 3000);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to start publish');
    } finally {
      setBusyId(null);
    }
  };

  const retry = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/content/posts/${id}/retry-publish`);
      toast.success('Queued for retry');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Retry failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {SEGMENTS.map(s => (
            <button
              key={s.id}
              onClick={() => setSegment(s.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition ${
                segment === s.id ? s.active : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<FileText size={28} />} title="Nothing here yet" description="Approved, published, rejected and failed posts will show up here." />
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="bg-white border rounded-md px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                    {item.variant_label}
                  </span>
                  <span className="text-xs text-gray-400 truncate">{item.topic}</span>
                  {item.status === 'published' && item.published_at && (
                    <span className="text-xs text-gray-400">Published {timeAgo(item.published_at)}</span>
                  )}
                  {item.status === 'approved' && item.scheduled_for && (
                    <span className="text-xs text-gray-400">Scheduled {item.scheduled_for}</span>
                  )}
                  {item.status === 'rejected' && item.rejection_reason && (
                    <span className="text-xs text-gray-400">Reason: {item.rejection_reason}</span>
                  )}
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-3">{item.content}</p>
                {item.status === 'failed' && item.publish_error && (
                  <p className="text-xs text-red-600 mt-1">{item.publish_error}</p>
                )}
                {item.status === 'published' && item.published_post_url && (
                  <a href={item.published_post_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-1">
                    <ExternalLink size={12} /> View on LinkedIn
                  </a>
                )}
              </div>
              <div className="shrink-0">
                {item.status === 'approved' && (
                  <button
                    onClick={() => publishNow(item.id)}
                    disabled={busyId === item.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    <Send size={13} /> Publish now
                  </button>
                )}
                {item.status === 'failed' && (
                  <button
                    onClick={() => retry(item.id)}
                    disabled={busyId === item.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-medium rounded-sm hover:bg-gray-50 disabled:opacity-50 transition"
                  >
                    <RotateCcw size={13} /> Retry
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
