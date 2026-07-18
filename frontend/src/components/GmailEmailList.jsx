import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import EmailStatusBadge from './EmailStatusBadge.jsx';
import QuickReplyModal from './QuickReplyModal.jsx';

const SINCE_OPTIONS = [
  { value: '7d',  label: 'Last 7 days'  },
  { value: '30d', label: 'Last 30 days' },
  { value: '18m', label: 'Last 18 months (all)' },
];

const STATUS_FILTERS = ['All', 'sent', 'replied', 'undelivered', 'failed'];
const STATUS_COLORS  = {
  sent:        'bg-blue-50   text-blue-800',
  replied:     'bg-purple-50 text-purple-800',
  undelivered: 'bg-orange-50 text-orange-800',
  failed:      'bg-red-50    text-red-800',
};

export default function GmailEmailList({ refreshKey, myName = '' }) {
  const [emails,      setEmails]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [since,       setSince]       = useState('18m');
  const [statusFilter,setStatusFilter]= useState('All');
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [total,       setTotal]       = useState(0);
  const [pages,       setPages]       = useState(1);
  const [replying,    setReplying]    = useState(null); // email object for QuickReplyModal
  const [replyOnly,   setReplyOnly]   = useState(false);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = { since, limit: 30, page };
      if (statusFilter !== 'All') params.status   = statusFilter;
      if (search)                  params.search   = search;
      if (replyOnly)               params.replies_only = 'true';

      const data = await api.get('/gmail/emails', { params });
      setEmails(data.emails || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [since, statusFilter, search, page, replyOnly]);

  useEffect(() => { fetchEmails(); }, [fetchEmails, refreshKey]);
  useEffect(() => { setPage(1); }, [since, statusFilter, search, replyOnly]);

  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d.slice(0, 10); }
  }

  const repliedInMonth = emails.filter(e => e.email_status === 'replied').length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Search email, name, subject…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-60 focus:ring-2 focus:ring-blue-300 outline-none bg-white"
        />

        <select
          value={since}
          onChange={e => setSince(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none bg-white"
        >
          {SINCE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none bg-white"
        >
          {STATUS_FILTERS.map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
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

        {repliedInMonth > 0 && (
          <span className="ml-auto bg-purple-100 text-purple-800 text-xs font-semibold px-3 py-1.5 rounded-full border border-purple-200">
            🚩 {repliedInMonth} replied (this page)
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="text-xs text-gray-500">
        {loading ? 'Loading…' : `${total} email${total !== 1 ? 's' : ''} tracked`}
      </div>

      {/* Email rows */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : emails.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📭</p>
          <p className="text-sm font-medium">No emails found</p>
          <p className="text-xs mt-1">Connect Gmail and click "Sync Now" to import your outreach history</p>
        </div>
      ) : (
        <div className="space-y-2">
          {emails.map(email => (
            <div
              key={email.id}
              className={`bg-white border rounded-xl px-4 py-3 flex items-start gap-3 hover:shadow-sm transition-shadow ${
                email.email_status === 'replied' ? 'border-l-4 border-l-purple-400' : ''
              }`}
            >
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700 flex-shrink-0 mt-0.5">
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
                    <p className="text-xs text-purple-700 font-medium">💬 Reply: {email.reply_snippet.slice(0, 120)}{email.reply_snippet.length > 120 ? '…' : ''}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-1.5 flex-shrink-0 ml-2">
                <span className="text-xs text-gray-400">{fmtDate(email.sent_at)}</span>
                {email.replied_at && (
                  <span className="text-xs text-purple-600">Replied {fmtDate(email.replied_at)}</span>
                )}
                {/* Quick reply button — only for emails replied in last 30 days */}
                {email.email_status === 'replied' && isWithinDays(email.replied_at, 30) && (
                  <button
                    onClick={() => setReplying(email)}
                    className="px-2.5 py-1 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 transition-colors"
                  >
                    ↩ Quick Reply
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-600">{page} / {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* Quick Reply Modal */}
      {replying && (
        <QuickReplyModal
          email={replying}
          myName={myName}
          onClose={() => setReplying(null)}
          onSent={fetchEmails}
        />
      )}
    </div>
  );
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  try {
    return (Date.now() - new Date(dateStr).getTime()) < days * 86_400_000;
  } catch { return false; }
}
