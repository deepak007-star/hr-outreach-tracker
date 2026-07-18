/**
 * Auto-synced LinkedIn Feed email contacts for the Gmail Tracking tab.
 * Reads directly from scraped_jobs (scraper_type='linkedin-feed', has email).
 * No manual import needed — refreshes every 60 s or on mount.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';

const SINCE_OPTS = [
  { value: '7d',  label: 'Last 7 days'  },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

// ─── Compose modal ────────────────────────────────────────────────────────────

function ComposeModal({ contacts, onClose, onSent }) {
  const [subject, setSubject] = useState('Job Application — Saw Your LinkedIn Post');
  const [body,    setBody]    = useState(
    `Hi,\n\nI came across your recent LinkedIn post about job openings and I'm very interested in the opportunity.\n\nI'd love to connect and share my profile for your consideration.\n\n[Your Profile/Resume Link]\n\nThank you for your time!\n\nBest regards,\n[Your Name]`
  );
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      const result = await api.post('/scraped-jobs/send-feed-emails', {
        subject: subject.trim(),
        body:    body.trim(),
        contacts: contacts.map(c => ({
          email:   c.contact_email,
          name:    c.contact_name || '',
          company: c.company      || '',
          title:   c.title        || '',
        })),
      });
      toast.success(`${result.sent}/${result.total} emails sent!`);
      onSent(contacts.map(c => c.contact_email));
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-semibold text-gray-900">✉ Compose Emails</h2>
            <p className="text-sm text-gray-500">
              {contacts.length} separate email{contacts.length !== 1 ? 's' : ''} — one per contact
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">To</p>
            <div className="flex flex-wrap gap-1.5 bg-gray-50 rounded-lg border p-2 max-h-20 overflow-y-auto">
              {contacts.map(c => (
                <span key={c.contact_email} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  {c.contact_email}
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
                   className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none resize-none font-mono leading-relaxed" />
          </div>
          <p className="text-xs text-gray-400">Each recipient gets their own individual email — not CC/BCC.</p>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim()}
                  className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {sending ? 'Sending…' : `✉ Send ${contacts.length} Email${contacts.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FeedContactsPanel() {
  const [contacts,  setContacts]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [since,     setSince]     = useState('30d');
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState(new Set()); // set of contact_email strings
  const [composeTo, setComposeTo] = useState(null);
  const [lastSync,  setLastSync]  = useState(null);
  const intervalRef = useRef(null);

  const fetchContacts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = { since, limit: 200 };
      if (search) params.search = search;
      const data = await api.get('/scraped-jobs/feed-contacts', { params });
      setContacts(data.contacts || []);
      setLastSync(new Date());
    } catch {
      if (!silent) toast.error('Failed to load feed contacts');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [since, search]);

  useEffect(() => {
    fetchContacts();
    // auto-refresh every 60s
    intervalRef.current = setInterval(() => fetchContacts(true), 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchContacts]);

  const handleSent = (sentEmails) => {
    const sentSet = new Set(sentEmails);
    setContacts(prev => prev.map(c => sentSet.has(c.contact_email) ? { ...c, already_emailed: 1, just_sent: true } : c));
    setSelected(new Set());
  };

  const toggleSelect = (email) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  };

  const toggleAll = () => {
    const pending = contacts.filter(c => !c.already_emailed);
    if (pending.every(c => selected.has(c.contact_email))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pending.map(c => c.contact_email)));
    }
  };

  const [filterTab, setFilterTab] = useState('all');

  const selectedContacts = contacts.filter(c => selected.has(c.contact_email));
  const pendingContacts  = contacts.filter(c => !c.already_emailed);
  const sentContacts     = contacts.filter(c =>  c.already_emailed);
  const filteredContacts = filterTab === 'pending' ? pendingContacts
    : filterTab === 'sent' ? sentContacts
    : contacts;

  const timeSince = lastSync
    ? Math.floor((Date.now() - lastSync.getTime()) / 1000) < 10
      ? 'just now'
      : `${Math.floor((Date.now() - lastSync.getTime()) / 60000)} min ago`
    : '';

  if (loading) {
    return (
      <div className="space-y-2 py-4">
        {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-xl" />)}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 space-y-2">
        <p className="text-2xl">📭</p>
        <p className="text-sm font-medium">No LinkedIn Feed email contacts yet</p>
        <p className="text-xs">
          Use the <span className="font-semibold">LinkedIn Feed</span> tab to scrape HR posts — email contacts found there appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border overflow-hidden text-xs font-medium">
            {[
              { id: 'all',     label: `All (${contacts.length})`        },
              { id: 'pending', label: `Not emailed (${pendingContacts.length})` },
              { id: 'sent',    label: `Emailed (${sentContacts.length})` },
            ].map(t => (
              <button key={t.id}
                onClick={() => setFilterTab(t.id)}
                className={`px-3 py-1.5 text-xs font-medium transition ${
                  filterTab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          {timeSince && <span className="text-xs text-gray-400">Synced {timeSince}</span>}
        </div>

        <div className="flex items-center gap-2">
          <select value={since} onChange={e => setSince(e.target.value)}
                  className="border rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-300 outline-none bg-white">
            {SINCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                 className="border rounded-lg px-3 py-1.5 text-xs w-40 focus:ring-2 focus:ring-blue-300 outline-none" />
          <button onClick={() => fetchContacts()} className="text-xs text-gray-500 border rounded-lg px-2 py-1.5 hover:bg-gray-50">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Bulk select bar */}
      {pendingContacts.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={pendingContacts.every(c => selected.has(c.contact_email))}
              onChange={toggleAll}
              className="rounded accent-blue-600"
            />
            Select all ({pendingContacts.length} not emailed)
          </label>
          {selected.size > 0 && (
            <button
              onClick={() => setComposeTo(selectedContacts)}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              ✉ Email {selected.size} selected
            </button>
          )}
        </div>
      )}

      {/* Contact rows */}
      <div className="space-y-2">
        {filteredContacts.map(c => (
          <div key={c.id}
               className={`bg-white border rounded-xl px-4 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow ${
                 c.just_sent || c.already_emailed ? 'opacity-75' : ''
               }`}>
            {!c.already_emailed && (
              <input
                type="checkbox"
                checked={selected.has(c.contact_email)}
                onChange={() => toggleSelect(c.contact_email)}
                className="rounded accent-blue-600 shrink-0 cursor-pointer"
              />
            )}
            {c.already_emailed && (
              <div className="w-4 h-4 shrink-0" />
            )}

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700 shrink-0">
              {(c.company?.[0] || c.contact_email?.[0] || '?').toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 truncate">{c.contact_email}</span>
                {c.company && <span className="text-xs text-gray-500 truncate">{c.company}</span>}
                {c.title   && <span className="text-xs text-gray-400 truncate">{c.title}</span>}
              </div>
              {c.description && (
                <p className="text-xs text-gray-400 truncate mt-0.5">{c.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-2">
              {c.contact_phone && (
                <span className="text-xs text-gray-500">📱 {c.contact_phone}</span>
              )}
              {c.already_emailed ? (
                <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                  {c.just_sent ? '✓ Just sent' : '✓ Emailed'}
                </span>
              ) : (
                <button
                  onClick={() => setComposeTo([c])}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition"
                >
                  Email
                </button>
              )}
              {c.link && (
                <a href={c.link} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-blue-500 hover:text-blue-700">
                  Post →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {composeTo && (
        <ComposeModal
          contacts={composeTo}
          onClose={() => setComposeTo(null)}
          onSent={handleSent}
        />
      )}
    </div>
  );
}
