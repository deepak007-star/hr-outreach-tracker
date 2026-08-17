/**
 * Content AI — Review Queue. Lists batches of AI-generated LinkedIn post
 * candidates (one topic → 2-3 variants) waiting for review, and steps
 * through one batch's variants at a time: edit inline, regenerate with a
 * free-text instruction ("make it more like me"), approve with a schedule,
 * or reject with a reason. Nothing here ever touches LinkedIn — publishing
 * happens later, only for posts explicitly approved here.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { EmptyState, Spinner } from './ui/index.js';
import { RefreshCw, Check, X, Edit3, Sparkles, Keyboard, ListChecks } from 'lucide-react';

const REJECT_REASONS = ['Not my voice', 'Inaccurate', 'Off-topic', 'Too similar to a past post', 'Other'];

function nowLocalInputValue() {
  const d = new Date(Date.now() + 5 * 60_000); // default 5 min out, so "now" always validates as future
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RejectPopover({ onReject, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-300 text-gray-600 text-sm font-medium rounded-sm hover:bg-gray-50 disabled:opacity-50 transition"
      >
        <X size={15} /> Reject
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
          {REJECT_REASONS.map(r => (
            <button
              key={r}
              onClick={() => { setOpen(false); onReject(r); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PostReviewStepper({ initialPosts, topic, onExit }) {
  const [posts, setPosts] = useState(initialPosts);
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState({ approved: 0, rejected: 0 });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [instruction, setInstruction] = useState('');
  const [scheduledFor, setScheduledFor] = useState(nowLocalInputValue());
  const instructionRef = useRef(null);

  const current = posts[index];
  const done = index >= posts.length;

  const advance = () => setIndex(i => i + 1);

  const handleApprove = async () => {
    if (!scheduledFor) { toast.error('Pick a schedule time first'); return; }
    setBusy(true);
    try {
      await api.post(`/content/posts/${current.id}/approve`, { scheduled_for: scheduledFor.replace('T', ' ') + ':00' });
      setTally(t => ({ ...t, approved: t.approved + 1 }));
      toast.success('Approved');
      advance();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (reason) => {
    setBusy(true);
    try {
      await api.post(`/content/posts/${current.id}/reject`, { reason });
      setTally(t => ({ ...t, rejected: t.rejected + 1 }));
      advance();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => { setEditText(current.content); setEditing(true); };

  const saveEdit = async () => {
    if (!editText.trim()) return;
    setBusy(true);
    try {
      await api.patch(`/content/posts/${current.id}`, { content: editText.trim() });
      setPosts(ps => ps.map((p, i) => i === index ? { ...p, content: editText.trim() } : p));
      setEditing(false);
      toast.success('Saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const data = await api.post(`/content/posts/${current.id}/regenerate`, { instruction });
      setPosts(ps => ps.map((p, i) => i === index ? { ...p, content: data.content } : p));
      setInstruction('');
      toast.success('Regenerated');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Regenerate failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editing) {
        if (e.key === 'Escape') { e.preventDefault(); if (editing) setEditing(false); else onExit(); }
        return;
      }
      if (done || busy) return;
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); handleApprove(); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); startEdit(); }
      else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); instructionRef.current?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); onExit(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [done, busy, editing, current, scheduledFor]);

  return (
    <div className="bg-white border-2 border-brand-200 rounded-md p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-brand-700">
          {topic} — {Math.min(index + 1, posts.length)} of {posts.length}
        </span>
        <button onClick={onExit} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
          <X size={13} /> Exit
        </button>
      </div>

      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-brand-600 rounded-full transition-all duration-300" style={{ width: `${(index / posts.length) * 100}%` }} />
      </div>

      {done ? (
        <div className="text-center py-8 space-y-2">
          <p className="text-lg font-bold text-gray-800">Batch reviewed 🎉</p>
          <p className="text-sm text-gray-500">{tally.approved} approved, {tally.rejected} rejected</p>
          <button onClick={onExit} className="mt-2 px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 transition">
            Back to queue
          </button>
        </div>
      ) : (
        <>
          <div className="border rounded-md p-4 bg-gray-50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                Variant {current.variant_label}
              </span>
              {current.regenerate_count > 0 && (
                <span className="text-xs text-gray-400">regenerated {current.regenerate_count}×</span>
              )}
            </div>
            {editing ? (
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={6}
                className="w-full text-sm text-gray-900 border border-gray-300 rounded-sm p-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
                autoFocus
              />
            ) : (
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{current.content}</p>
            )}
          </div>

          {editing ? (
            <div className="flex items-center gap-2">
              <button onClick={saveEdit} disabled={busy} className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 disabled:opacity-50 transition">
                Save edit
              </button>
              <button onClick={() => setEditing(false)} disabled={busy} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-sm hover:bg-gray-50 transition">
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  ref={instructionRef}
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  placeholder='Instruction for regenerate, e.g. "make it more like me" or "shorter, punchier"'
                  className="flex-1 text-sm border border-gray-300 rounded-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <button
                  onClick={regenerate}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 border border-purple-300 text-purple-700 text-sm font-medium rounded-sm hover:bg-purple-50 disabled:opacity-50 transition"
                >
                  <Sparkles size={14} /> Regenerate
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={e => setScheduledFor(e.target.value)}
                  className="text-sm border border-gray-300 rounded-sm px-2 py-2"
                />
                <button
                  onClick={handleApprove}
                  disabled={busy}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  <Check size={15} /> Approve & Schedule
                </button>
                <button onClick={startEdit} disabled={busy} title="Edit"
                  className="px-3 py-2.5 border border-gray-300 text-gray-500 rounded-sm hover:bg-gray-50 transition">
                  <Edit3 size={15} />
                </button>
                <RejectPopover onReject={handleReject} disabled={busy} />
              </div>

              <p className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
                <Keyboard size={12} className="shrink-0" />
                <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono">A</kbd> approve
                <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono">E</kbd> edit
                <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono">G</kbd> focus regenerate
                <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono">Esc</kbd> exit
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function ContentReviewPanel() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeBatch, setActiveBatch] = useState(null); // { topic, posts }

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/content/posts/pending-batches');
      setBatches(data.batches || []);
    } catch (e) {
      toast.error('Failed to load review queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const openBatch = async (batchId, topic) => {
    try {
      const data = await api.get(`/content/posts/batch/${batchId}`);
      setActiveBatch({ topic, posts: data.posts || [] });
    } catch (e) {
      toast.error('Failed to load batch');
    }
  };

  const exitBatch = () => { setActiveBatch(null); loadBatches(); };

  if (activeBatch) {
    return <PostReviewStepper initialPosts={activeBatch.posts} topic={activeBatch.topic} onExit={exitBatch} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{batches.length} topic{batches.length === 1 ? '' : 's'} waiting for review</span>
        <button onClick={loadBatches} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : batches.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="Nothing to review right now"
          description="Run the Content AI pipeline from Admin Panel → Content AI Pipeline to generate new draft topics, or wait for the next scheduled run."
        />
      ) : (
        batches.map(b => (
          <button
            key={b.batch_id}
            onClick={() => openBatch(b.batch_id, b.topic)}
            className="w-full text-left bg-white border rounded-md px-4 py-3 flex items-center justify-between hover:shadow-sm transition-shadow"
          >
            <div>
              <p className="text-sm font-semibold text-gray-900">{b.topic}</p>
              <p className="text-xs text-gray-400">{b.count} candidate{b.count === '1' || b.count === 1 ? '' : 's'}</p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">Review →</span>
          </button>
        ))
      )}
    </div>
  );
}
