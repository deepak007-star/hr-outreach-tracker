import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { confirm } from '../utils/confirm.js';
import EmailStatusBadge from './EmailStatusBadge.jsx';
import QuickReplyModal from './QuickReplyModal.jsx';

const SINCE_OPTIONS = [
  { value: '7d',  label: 'Last 7 days'  },
  { value: '30d', label: 'Last 30 days' },
  { value: '18m', label: 'Last 18 months (all)' },
];

const STATUS_FILTERS = ['All', 'sent', 'replied', 'undelivered', 'failed'];

const INITIAL_VISIBLE = 5;
const SHOW_MORE_STEP  = 10;
const PAGE_SIZE       = 15;

export default function GmailEmailList({ refreshKey, myName = '' }) {
  const [allEmails,    setAllEmails]    = useState([]);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [loadedPage,   setLoadedPage]   = useState(1);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [total,        setTotal]        = useState(0);
  const [pages,        setPages]        = useState(1);
  const [since,        setSince]        = useState('18m');
  const [statusFilter, setStatusFilter] = useState('All');
  const [search,       setSearch]       = useState('');
  const [replyOnly,    setReplyOnly]    = useState(false);
  const [replying,     setReplying]     = useState(null);
  const [addingIds,    setAddingIds]    = useState(new Set());
  const [addedIds,     setAddedIds]     = useState(new Set());
  const [addingAll,    setAddingAll]    = useState(false);

  // Track filter values so fetchPage closure always reads current ones
  const filterRef = useRef({ since, statusFilter, search, replyOnly });
  useEffect(() => { filterRef.current = { since, statusFilter, search, replyOnly }; },
            [since, statusFilter, search, replyOnly]);

  const fetchPage = useCallback(async (pageNum, reset = false) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const { since: s, statusFilter: sf, search: q, replyOnly: ro } = filterRef.current;
      const params = { since: s, limit: PAGE_SIZE, page: pageNum };
      if (sf !== 'All') params.status       = sf;
      if (q)            params.search       = q;
      if (ro)           params.replies_only = 'true';

      const data      = await api.get('/gmail/emails', { params });
      const newEmails = data.emails || [];
      setAllEmails(prev => reset ? newEmails : [...prev, ...newEmails]);
      setTotal(data.total  || 0);
      setPages(data.pages  || 1);
    } catch {
      if (reset) setAllEmails([]);
    } finally {
      if (reset) setLoading(false);
      else setLoadingMore(false);
    }
  }, []);

  // Reset + reload on filter / refresh changes
  useEffect(() => {
    setAllEmails([]);
    setVisibleCount(INITIAL_VISIBLE);
    setLoadedPage(1);
    fetchPage(1, true);
  }, [since, statusFilter, search, replyOnly, refreshKey, fetchPage]);

  async function handleShowMore() {
    const newVisible = visibleCount + SHOW_MORE_STEP;
    setVisibleCount(newVisible);
    // Pre-fetch next page when we've consumed the buffer
    if (newVisible >= allEmails.length && loadedPage < pages) {
      const next = loadedPage + 1;
      setLoadedPage(next);
      await fetchPage(next, false);
    }
  }

  async function addContact(email) {
    setAddingIds(prev => new Set(prev).add(email.id));
    try {
      const r = await api.post(`/gmail/emails/${email.id}/add-contact`);
      if (r.added) {
        toast.success(`${email.contact_name || email.contact_email} added to Contacts`);
      } else {
        toast(`${email.contact_name || email.contact_email} is already in Contacts`, { icon: 'ℹ️' });
      }
      setAddedIds(prev => new Set(prev).add(email.contact_email));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add contact');
    } finally {
      setAddingIds(prev => { const n = new Set(prev); n.delete(email.id); return n; });
    }
  }

  async function addAllContacts() {
    if (!await confirm('Add every synced contact not already in your Contacts list?')) return;
    setAddingAll(true);
    try {
      const r = await api.post('/gmail/add-all-contacts');
      toast.success(`${r.added} new contact${r.added !== 1 ? 's' : ''} added — ${r.skipped} already existed`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add contacts');
    } finally {
      setAddingAll(false);
    }
  }

  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d.slice(0, 10); }
  }

  const visible      = allEmails.slice(0, visibleCount);
  // More to show if we haven't reached the local buffer end, OR more pages exist on the server
  const canShowMore  = visibleCount < allEmails.length || loadedPage < pages;
  const repliedCount = visible.filter(e => e.email_status === 'replied').length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Search email, name, subject…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded-sm px-3 py-2 text-sm w-60 focus:ring-2 focus:ring-brand-300 outline-none bg-white"
        />

        <select
          value={since}
          onChange={e => setSince(e.target.value)}
          className="border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white"
        >
          {SINCE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white"
        >
          {STATUS_FILTERS.map(s => (
            <option key={s} value={s}>
              {s === 'All' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={replyOnly}
            onChange={e => setReplyOnly(e.target.checked)}
            className="rounded"
          />
          Replies only
        </label>

        <button
          onClick={addAllContacts}
          disabled={addingAll || total === 0}
          className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {addingAll ? '⏳ Adding…' : '+ Add All to Contacts'}
        </button>

        {repliedCount > 0 && (
          <span className="ml-auto bg-purple-100 text-purple-800 text-xs font-semibold px-3 py-1.5 rounded-full border border-purple-200">
            🚩 {repliedCount} replied (visible)
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="text-xs text-gray-500">
        {loading
          ? 'Loading…'
          : `Showing ${Math.min(visibleCount, allEmails.length)} of ${total} email${total !== 1 ? 's' : ''} tracked`}
      </div>

      {/* Email rows */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-md" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📭</p>
          <p className="text-sm font-medium">No emails found</p>
          <p className="text-xs mt-1">Connect Gmail and click "Sync Now" to import your outreach history</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(email => (
            <div
              key={email.id}
              className={`bg-white border rounded-md px-4 py-3 flex items-start gap-3 hover:shadow-sm transition-shadow ${
                email.email_status === 'replied' ? 'border-l-4 border-l-purple-400' : ''
              }`}
            >
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-700 flex-shrink-0 mt-0.5">
                {(email.contact_name?.[0] || email.contact_email?.[0] || '?').toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900 truncate">
                    {email.contact_name || email.contact_email}
                  </span>
                  <span className="text-xs text-gray-400">{email.contact_email}</span>
                  <EmailStatusBadge status={email.email_status} showFlag />
                </div>
                <p className="text-xs text-gray-600 mt-0.5 truncate">{email.subject || '(no subject)'}</p>
                {email.body_snippet && (
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{email.body_snippet}</p>
                )}
                {email.email_status === 'replied' && email.reply_snippet && (
                  <div className="mt-1 bg-purple-50 border-l-2 border-purple-300 pl-2 py-0.5">
                    <p className="text-xs text-purple-700 font-medium">
                      💬 Reply: {email.reply_snippet.slice(0, 120)}{email.reply_snippet.length > 120 ? '…' : ''}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5 flex-shrink-0 ml-2">
                <span className="text-xs text-gray-400">{fmtDate(email.sent_at)}</span>
                {email.replied_at && (
                  <span className="text-xs text-purple-600">Replied {fmtDate(email.replied_at)}</span>
                )}
                {email.email_status === 'replied' && isWithinDays(email.replied_at, 30) && (
                  <button
                    onClick={() => setReplying(email)}
                    className="px-2.5 py-1 bg-purple-600 text-white rounded-sm text-xs font-semibold hover:bg-purple-700 transition-colors"
                  >
                    ↩ Quick Reply
                  </button>
                )}
                {addedIds.has(email.contact_email) ? (
                  <span className="text-xs text-emerald-600 font-medium">✓ In Contacts</span>
                ) : (
                  <button
                    onClick={() => addContact(email)}
                    disabled={addingIds.has(email.id)}
                    className="px-2.5 py-1 border border-emerald-300 text-emerald-700 rounded-sm text-xs font-semibold hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                  >
                    {addingIds.has(email.id) ? '…' : '+ Add to Contacts'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Show More + pagination */}
      {!loading && (canShowMore || loadingMore) && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            onClick={handleShowMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-5 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 transition-all shadow-sm"
          >
            {loadingMore
              ? <><span className="animate-spin">⟳</span> Loading…</>
              : <>Show 10 more <span className="text-gray-400 font-normal">({total - Math.min(visibleCount, allEmails.length)} remaining)</span></>
            }
          </button>

          {/* Compact pagination for direct jump */}
          {pages > 1 && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <span>Loaded page {loadedPage} of {pages}</span>
              <span>·</span>
              <span>{Math.min(visibleCount, allEmails.length)} shown of {total}</span>
            </div>
          )}
        </div>
      )}

      {/* Quick Reply Modal */}
      {replying && (
        <QuickReplyModal
          email={replying}
          myName={myName}
          onClose={() => setReplying(null)}
          onSent={() => {
            setAllEmails([]);
            setVisibleCount(INITIAL_VISIBLE);
            setLoadedPage(1);
            fetchPage(1, true);
          }}
        />
      )}
    </div>
  );
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  try { return (Date.now() - new Date(dateStr).getTime()) < days * 86_400_000; }
  catch { return false; }
}
