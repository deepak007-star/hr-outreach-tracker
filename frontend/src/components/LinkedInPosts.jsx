import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

// ─── Bulk-email compose modal ─────────────────────────────────────────────────

function BulkEmailModal({ contacts, onClose, onSent }) {
  const defaultSubject = 'Job Application — Interested in Your Opening';
  const defaultBody = `Hi,

I came across your LinkedIn post and I'm interested in the opportunity you mentioned.

I'd love to connect and learn more about the role. Please find my profile below:

[Your Profile/Resume Link]

Looking forward to hearing from you!

Best regards,
[Your Name]`;

  const [subject, setSubject] = useState(defaultSubject);
  const [body,    setBody]    = useState(defaultBody);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      const payload = {
        subject: subject.trim(),
        body:    body.trim(),
        contacts: contacts.map(c => ({
          email:   c.contact_email,
          name:    c.contact_name || '',
          company: c.company      || '',
          title:   c.title        || '',
        })),
      };
      const result = await api.post('/scraped-jobs/send-feed-emails', payload);
      toast.success(`Sent ${result.sent}/${result.total} emails successfully`);
      onSent(contacts.map(c => c.id));
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to send emails');
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
            <h2 className="font-semibold text-gray-900">✉ Compose Bulk Email</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Sending <span className="font-semibold text-blue-700">{contacts.length}</span> separate emails — one per contact
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Recipient pills */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recipients</p>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-gray-50 rounded-lg border">
              {contacts.map(c => (
                <span key={c.id} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  {c.contact_email}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={12}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none resize-none font-mono leading-relaxed"
            />
          </div>
          <p className="text-xs text-gray-400">
            Each recipient gets an individual email. No CC/BCC — completely separate sends.
          </p>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !subject.trim() || !body.trim()}
            className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {sending ? 'Sending…' : `✉ Send ${contacts.length} Email${contacts.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Contact card ─────────────────────────────────────────────────────────────

function ContactCard({ job, selected, onSelect, hasEmail, onSingleEmail, onCopy }) {
  const allContacts = (() => {
    try { return JSON.parse(job.all_contacts || '{}'); }
    catch { return {}; }
  })();
  const emails   = allContacts.emails  || (job.contact_email  ? [job.contact_email]  : []);
  const phones   = allContacts.phones  || (job.contact_phone  ? [job.contact_phone]  : []);
  const gforms   = allContacts.gforms  || (job.google_form_link ? [job.google_form_link] : []);
  const waLinks  = allContacts.waLinks || (job.whatsapp_link  ? [job.whatsapp_link]  : []);

  const posted = job.created_at?.slice(0, 10) || '';

  return (
    <div className={`bg-white border rounded-xl p-4 space-y-3 transition-all hover:shadow-md ${
      selected       ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-300' :
      job.emailed_now ? 'border-green-300 bg-green-50/20' : 'hover:border-blue-200'
    }`}>
      {/* Top row */}
      <div className="flex items-start gap-3">
        {hasEmail && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(job)}
            className="mt-1 rounded accent-blue-600 cursor-pointer"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <p className="font-semibold text-gray-900 truncate">{job.title || 'LinkedIn Hiring Post'}</p>
            {job.emailed_now && (
              <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">✓ Emailed</span>
            )}
            {!job.emailed_now && job.already_emailed && (
              <span className="text-xs bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full font-medium">Sent before</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {job.company   && <span className="text-xs text-gray-600 font-medium">{job.company}</span>}
            {job.location  && <span className="text-xs text-gray-400">📍 {job.location}</span>}
            {posted        && <span className="text-xs text-gray-400">{posted}</span>}
          </div>
        </div>
        {job.link && (
          <a href={job.link} target="_blank" rel="noopener noreferrer"
             className="text-xs text-blue-500 hover:text-blue-700 shrink-0 whitespace-nowrap">
            View Post →
          </a>
        )}
      </div>

      {/* Description snippet */}
      {job.description && (
        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{job.description}</p>
      )}

      {/* Email contacts */}
      {emails.length > 0 && (
        <div className="space-y-1">
          {emails.map(email => (
            <div key={email} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-blue-600 font-medium">✉ {email}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(email); toast.success('Copied!'); }}
                className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
              >
                Copy
              </button>
              <button
                onClick={() => onSingleEmail({ ...job, contact_email: email })}
                className="text-xs bg-blue-600 text-white rounded px-2 py-0.5 hover:bg-blue-700 font-medium"
              >
                Email
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Phone contacts */}
      {phones.length > 0 && (
        <div className="space-y-1">
          {phones.map(phone => (
            <div key={phone} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-700 font-medium">📱 {phone}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(phone); toast.success('Copied!'); }}
                className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
              >
                Copy
              </button>
              <a href={`tel:${phone}`}
                 className="text-xs text-green-600 border border-green-200 rounded px-1.5 py-0.5 hover:bg-green-50">
                Call
              </a>
            </div>
          ))}
        </div>
      )}

      {/* WhatsApp links */}
      {waLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {waLinks.map(wa => (
            <a key={wa} href={wa} target="_blank" rel="noopener noreferrer"
               className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg px-2 py-1 hover:bg-green-100 font-medium">
              💬 WhatsApp
            </a>
          ))}
        </div>
      )}

      {/* Google Forms */}
      {gforms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {gforms.map(gf => (
            <a key={gf} href={gf} target="_blank" rel="noopener noreferrer"
               className="text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-lg px-2 py-1 hover:bg-purple-100 font-medium">
              📋 Apply via Form
            </a>
          ))}
        </div>
      )}

      {/* Phone-only label */}
      {emails.length === 0 && phones.length === 0 && !job.contact_email && (
        <p className="text-xs text-gray-400 italic">No direct contact info extracted</p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SINCE_OPTS = [
  { value: '7d',  label: 'Last 7 days'  },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export default function LinkedInPosts() {
  const { user }                      = useAuth();
  const [jobs,          setJobs]      = useState([]);
  const [loading,       setLoading]   = useState(true);
  const [scraping,      setScraping]  = useState(false);
  const [scraperLogs,   setLogs]      = useState([]);
  const [showLogs,      setShowLogs]  = useState(false);
  const [search,        setSearch]    = useState('');
  const [since,         setSince]     = useState('30d');
  const [filter,        setFilter]    = useState('all'); // 'all' | 'email' | 'phone'
  const [selected,      setSelected]  = useState(new Set()); // set of job IDs
  const [composeTo,     setComposeTo] = useState(null); // null | 'bulk' | single-job
  const [profile,       setProfile]   = useState(null);
  const logsEndRef = useRef(null);

  // Load user profile for keyword defaults
  useEffect(() => {
    if (!user) return;
    api.get('/profile').then(p => setProfile(p)).catch(() => {});
  }, [user]);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scraperLogs]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { scraper: 'linkedin-feed', since, limit: 200 };
      if (search) params.search = search;
      const data = await api.get('/scraped-jobs', { params });

      // Check already-emailed status
      const rows = data.jobs || [];
      if (rows.length) {
        try {
          const feedRes = await api.get('/scraped-jobs/feed-contacts', { params: { since, limit: 500 } });
          const emailedMap = new Map((feedRes.contacts || []).map(c => [c.id, c.already_emailed]));
          rows.forEach(j => { j.already_emailed = emailedMap.get(j.id) || 0; });
        } catch {}
      }
      setJobs(rows);
    } catch { toast.error('Failed to load LinkedIn feed posts'); }
    finally  { setLoading(false); }
  }, [search, since]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ── SSE scraper trigger ──────────────────────────────────────────────────────
  const runScraper = async () => {
    if (scraping) return;
    setScraping(true);
    setLogs([]);
    setShowLogs(true);

    const titles = [profile?.job_title_1, profile?.job_title_2, profile?.job_title_3, profile?.current_title]
      .filter(Boolean).slice(0, 3);
    const keywords = titles.length ? titles : ['Software Developer'];
    const location = profile?.preferred_city || profile?.location || 'India';

    const send = line => setLogs(prev => [...prev, line]);

    try {
      const resp = await fetch(`${API_ROOT}/api/scraper/run`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('hr_token')}`,
        },
        body: JSON.stringify({
          scraper: 'linkedin-feed',
          titles:  keywords,
          location,
          limit:   30,
          since:   '7d',
        }),
      });

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const msg = JSON.parse(line.slice(5).trim());
            if (msg.type === 'log' || msg.type === 'err') {
              send({ type: msg.type, text: msg.data });
            } else if (msg.type === 'done') {
              if (msg.data.code === 0) {
                toast.success(`Scrape complete — ${msg.data.stored || 0} posts stored`);
                fetchJobs();
              } else {
                toast.error('Scraper exited with errors — see logs below');
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error('Scraper failed: ' + err.message);
    } finally {
      setScraping(false);
    }
  };

  // ── Selection helpers ────────────────────────────────────────────────────────
  const emailJobs = jobs.filter(j => j.contact_email);

  const toggleSelect = (job) => {
    if (!job.contact_email) return;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(job.id) ? next.delete(job.id) : next.add(job.id);
      return next;
    });
  };

  const toggleAll = () => {
    const emailIds = emailJobs.map(j => j.id);
    if (emailIds.every(id => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(emailIds));
    }
  };

  const selectedJobs = emailJobs.filter(j => selected.has(j.id));

  const handleSent = (sentIds) => {
    const sentSet = new Set(sentIds);
    setJobs(prev => prev.map(j => sentSet.has(j.id) ? { ...j, emailed_now: true, already_emailed: 1 } : j));
    setSelected(new Set());
  };

  // ── Filtered view ────────────────────────────────────────────────────────────
  const filtered = jobs.filter(j => {
    if (filter === 'email') return !!j.contact_email;
    if (filter === 'phone') return !j.contact_email && !!j.contact_phone;
    return true;
  });

  const emailCount = jobs.filter(j => j.contact_email).length;
  const phoneCount = jobs.filter(j => !j.contact_email && j.contact_phone).length;

  return (
    <div className="space-y-4">

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search title, company, email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-64 focus:ring-2 focus:ring-blue-300 outline-none bg-white"
        />
        <select
          value={since}
          onChange={e => setSince(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none bg-white"
        >
          {SINCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">
            {jobs.length} posts · {emailCount} with email · {phoneCount} phone only
          </span>
          {user && (
            <button
              onClick={runScraper}
              disabled={scraping}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {scraping ? '⏳ Scraping…' : '🔍 Scrape LinkedIn Feed'}
            </button>
          )}
        </div>
      </div>

      {/* ── Info banner (first load) ──────────────────────────────────────── */}
      {!loading && jobs.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-center space-y-3">
          <p className="text-2xl">🔍</p>
          <p className="font-semibold text-gray-800">No LinkedIn Feed posts yet</p>
          <p className="text-sm text-gray-500">
            Click <strong>Scrape LinkedIn Feed</strong> to find HR hiring posts that contain emails, phone numbers, or Google Form links.
            Uses your profile's job titles as keywords.
          </p>
          {!profile?.job_title_1 && (
            <p className="text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-2 inline-block border border-orange-200">
              Tip: Add job titles in your Profile → Preferences for better results
            </p>
          )}
          <button
            onClick={runScraper}
            disabled={scraping}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {scraping ? '⏳ Scraping…' : '🔍 Scrape LinkedIn Feed'}
          </button>
        </div>
      )}

      {/* ── SSE log panel ────────────────────────────────────────────────── */}
      {showLogs && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-4 space-y-1 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-400">Scraper Output</span>
            <button onClick={() => setShowLogs(false)} className="text-gray-500 hover:text-gray-300 text-xs">Hide</button>
          </div>
          {scraperLogs.map((l, i) => (
            <p key={i} className={`text-xs font-mono whitespace-pre-wrap ${l.type === 'err' ? 'text-red-400' : 'text-green-300'}`}>
              {l.text}
            </p>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* ── Filter + bulk select bar ────────────────────────────────────── */}
      {!loading && jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Filter tabs */}
          <div className="flex rounded-lg border overflow-hidden text-xs font-medium">
            {[
              { id: 'all',   label: `All (${jobs.length})` },
              { id: 'email', label: `✉ Email (${emailCount})` },
              { id: 'phone', label: `📱 Phone only (${phoneCount})` },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-2 transition-colors ${
                  filter === f.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {emailJobs.length > 0 && (
            <>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailJobs.length > 0 && emailJobs.every(j => selected.has(j.id))}
                  onChange={toggleAll}
                  className="rounded accent-blue-600"
                />
                Select all email contacts
              </label>

              {selected.size > 0 && (
                <button
                  onClick={() => setComposeTo('bulk')}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
                >
                  ✉ Email {selected.size} selected
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Contact cards ────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-40 bg-gray-100 animate-pulse rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No posts match this filter.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map(job => (
            <ContactCard
              key={job.id}
              job={job}
              hasEmail={!!job.contact_email}
              selected={selected.has(job.id)}
              onSelect={toggleSelect}
              onSingleEmail={j => setComposeTo({ single: true, contacts: [j] })}
            />
          ))}
        </div>
      )}

      {/* ── Compose modals ───────────────────────────────────────────────── */}
      {composeTo === 'bulk' && (
        <BulkEmailModal
          contacts={selectedJobs}
          onClose={() => setComposeTo(null)}
          onSent={handleSent}
        />
      )}
      {composeTo?.single && (
        <BulkEmailModal
          contacts={composeTo.contacts}
          onClose={() => setComposeTo(null)}
          onSent={handleSent}
        />
      )}
    </div>
  );
}
