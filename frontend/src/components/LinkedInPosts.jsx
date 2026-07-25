import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import PostWorkflowModal from './PostWorkflowModal.jsx';
import { computeJobMatch } from '../utils/jobMatch.js';

// ─── Confidence badge ─────────────────────────────────────────────────────────
function ConfidenceBadge({ score }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? 'text-green-700 bg-green-50 border-green-200'
            : pct >= 60 ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
            :             'text-gray-500 bg-gray-50 border-gray-200';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>{pct}%</span>;
}

// ─── Status badge colours ─────────────────────────────────────────────────────
const STATUS_COLORS = {
  new:       'bg-gray-100 text-gray-600',
  viewed:    'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  applied:   'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
};

// ─── Bulk email compose modal ─────────────────────────────────────────────────
function BulkEmailModal({ contacts, onClose, onSent }) {
  const [subject, setSubject] = useState('Job Application — Interested in Your Opening');
  const [body,    setBody]    = useState(
    `Hi,\n\nI came across your LinkedIn post about job openings and I'm very interested in the opportunity.\n\nI'd love to connect and discuss further.\n\n[Your Profile / Resume Link]\n\nBest regards,\n[Your Name]`
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
          name:    c.author_name   || '',
          company: c.company       || '',
          title:   c.title         || '',
        })),
      });
      toast.success(`${result.sent}/${result.total} emails sent!`);
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
      <div className="bg-white rounded-md shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-semibold text-gray-900">✉ Compose Emails</h2>
            <p className="text-sm text-gray-500">{contacts.length} separate email{contacts.length !== 1 ? 's' : ''} — one per contact</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">To</p>
            <div className="flex flex-wrap gap-1.5 bg-gray-50 rounded-sm border p-2 max-h-20 overflow-y-auto">
              {contacts.map(c => (
                <span key={c.id} className="text-xs bg-brand-100 text-brand-800 px-2 py-0.5 rounded-full">{c.contact_email}</span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
                   className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
                      className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none resize-none font-mono leading-relaxed" />
          </div>
          <p className="text-xs text-gray-400">Each recipient gets their own individual email — not CC/BCC.</p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-md">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border rounded-sm hover:bg-gray-100">Cancel</button>
          <button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim()}
                  className="px-5 py-2 text-sm font-semibold bg-brand-600 text-white rounded-sm hover:bg-brand-700 disabled:opacity-50">
            {sending ? 'Sending…' : `✉ Send ${contacts.length} Email${contacts.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skill-match badge ────────────────────────────────────────────────────────
function MatchBadge({ matchPercent }) {
  if (matchPercent == null) return null;
  const cls = matchPercent >= 70 ? 'text-green-700 bg-green-50 border-green-200'
            : matchPercent >= 50 ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
            :                      'text-gray-500 bg-gray-50 border-gray-200';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>{matchPercent}% match</span>;
}

// ─── Individual post card ─────────────────────────────────────────────────────
function PostCard({ post, selected, onSelect, onWorkflow, onSingleEmail, onStatusChange, profileSkills }) {
  const hasContact = post.contact_email || post.contact_phone || post.google_form_link || post.whatsapp_link;
  const { matchPercent } = computeJobMatch(post, profileSkills);
  const allContacts = (() => {
    try { return JSON.parse(post.all_contacts || '{}'); } catch { return {}; }
  })();
  const emails  = allContacts.emails  || (post.contact_email  ? [post.contact_email]  : []);
  const phones  = allContacts.phones  || (post.contact_phone  ? [post.contact_phone]  : []);
  const gforms  = allContacts.gforms  || (post.google_form_link ? [post.google_form_link] : []);
  const waLinks = allContacts.waLinks || (post.whatsapp_link  ? [post.whatsapp_link]  : []);

  const isApify = post.source === 'apify' || post.source === 'both';
  const isScraper = post.source === 'scraper' || post.source === 'both';

  return (
    <div className={`bg-white border rounded-md p-4 space-y-3 transition-all hover:shadow-md ${
      selected ? 'border-brand-400 bg-brand-50/30 ring-1 ring-brand-300' :
      post.emailed_now ? 'border-green-300' : 'hover:border-brand-200'
    }`}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2">
        {post.contact_email && (
          <input type="checkbox" checked={selected} onChange={() => onSelect(post)}
                 className="mt-1 rounded accent-brand-600 cursor-pointer shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5">
            <p className="font-semibold text-gray-900 truncate max-w-xs">{post.title || 'LinkedIn Post'}</p>
            {isApify && <ConfidenceBadge score={post.confidence_score} />}
            <MatchBadge matchPercent={matchPercent} />
            {post.is_hiring === 1 && (
              <span className="text-[10px] bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full font-semibold">
                #Hiring
              </span>
            )}
            {post.emailed_now && (
              <span className="text-[10px] bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full font-semibold">✓ Emailed</span>
            )}
            {isApify && post.status && post.status !== 'new' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold capitalize ${STATUS_COLORS[post.status] || STATUS_COLORS.new}`}>
                {post.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {post.company   && <span className="text-xs text-gray-600 font-medium">{post.company}</span>}
            {post.location  && <span className="text-xs text-gray-400">📍 {post.location}</span>}
            {post.job_type  && <span className="text-xs text-gray-400 capitalize">{post.job_type}</span>}
            <span className="text-xs text-gray-300">{post.created_at?.slice(0, 10)}</span>
          </div>
        </div>
        {post.link && (
          <a href={post.link} target="_blank" rel="noopener noreferrer"
             className="text-xs text-brand-500 hover:text-brand-700 shrink-0 whitespace-nowrap">
            View →
          </a>
        )}
      </div>

      {/* ── Author (apify) ────────────────────────────────────────────────── */}
      {isApify && post.author_name && (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 shrink-0">
            {post.author_name[0]?.toUpperCase() || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-800 truncate">{post.author_name}</p>
            {post.author_headline && (
              <p className="text-[11px] text-gray-400 truncate">{post.author_headline}</p>
            )}
          </div>
          {post.author_linkedin && (
            <a href={post.author_linkedin} target="_blank" rel="noopener noreferrer"
               className="text-xs text-blue-500 ml-auto shrink-0">in</a>
          )}
        </div>
      )}

      {/* ── Description ──────────────────────────────────────────────────── */}
      {post.description && (
        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{post.description}</p>
      )}

      {/* ── Tech stack (apify) ────────────────────────────────────────────── */}
      {isApify && post.tech_stack?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {post.tech_stack.slice(0, 5).map(t => (
            <span key={t} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-medium">{t}</span>
          ))}
          {post.tech_stack.length > 5 && (
            <span className="text-[10px] text-gray-400">+{post.tech_stack.length - 5}</span>
          )}
        </div>
      )}

      {/* ── Contact info (scraper) ────────────────────────────────────────── */}
      {isScraper && hasContact && (
        <div className="space-y-1.5 border-t pt-2">
          {emails.map(email => (
            <div key={email} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-brand-600 font-medium">✉ {email}</span>
              <button onClick={() => { navigator.clipboard.writeText(email); toast.success('Copied!'); }}
                      className="text-[11px] text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50">
                Copy
              </button>
              <button onClick={() => onSingleEmail({ ...post, contact_email: email })}
                      className="text-[11px] bg-brand-600 text-white rounded px-2 py-0.5 hover:bg-brand-700 font-medium">
                Email
              </button>
            </div>
          ))}
          {phones.map(phone => (
            <div key={phone} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-700 font-medium">📱 {phone}</span>
              <button onClick={() => { navigator.clipboard.writeText(phone); toast.success('Copied!'); }}
                      className="text-[11px] text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50">
                Copy
              </button>
              <a href={`tel:${phone}`}
                 className="text-[11px] text-green-700 border border-green-200 rounded px-1.5 py-0.5 hover:bg-green-50">
                Call
              </a>
            </div>
          ))}
          {waLinks.map(wa => (
            <a key={wa} href={wa} target="_blank" rel="noopener noreferrer"
               className="inline-flex text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg px-2 py-1 hover:bg-green-100 font-medium">
              💬 WhatsApp
            </a>
          ))}
          {gforms.map(gf => (
            <a key={gf} href={gf} target="_blank" rel="noopener noreferrer"
               className="inline-flex text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-lg px-2 py-1 hover:bg-purple-100 font-medium">
              📋 Apply via Form
            </a>
          ))}
        </div>
      )}

      {/* ── Actions row ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap border-t pt-2">
        {isApify && (
          <button onClick={() => onWorkflow(post)}
                  className="px-3 py-1.5 bg-brand-600 text-white text-xs font-semibold rounded-sm hover:bg-brand-700 transition">
            Work →
          </button>
        )}
        {isApify && post.status && (
          <select
            value={post.status}
            onChange={e => onStatusChange(post.id, e.target.value)}
            className="text-xs border rounded-sm px-2 py-1.5 focus:ring-1 focus:ring-brand-300 outline-none bg-white cursor-pointer"
          >
            {Object.keys(STATUS_COLORS).map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        )}
        {post.likes > 0 && (
          <span className="text-xs text-gray-400 ml-auto">👍 {post.likes}{post.comments != null ? `  💬 ${post.comments}` : ''}</span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SINCE_OPTS = [
  { value: 'today', label: 'Today (last 24h)' },
  { value: 'all', label: 'All time'     },
  { value: '7d',  label: 'Last 7 days'  },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const MATCH_OPTS = [
  { value: 0,  label: 'Any match'  },
  { value: 50, label: '≥ 50% match' },
  { value: 70, label: '≥ 70% match' },
];

export default function LinkedInPosts() {
  const { user }                       = useAuth();
  const [posts,         setPosts]      = useState([]);
  const [loading,       setLoading]    = useState(true);
  const [scraping,      setScraping]   = useState(false);
  const [scraperLogs,   setLogs]       = useState([]);
  const [showLogs,      setShowLogs]   = useState(false);
  const [search,        setSearch]     = useState('');
  const [since,         setSince]      = useState('today');
  const [hiringOnly,    setHiringOnly] = useState(false);
  const [filter,        setFilter]     = useState('all'); // 'all' | 'email' | 'phone'
  const [minMatch,      setMinMatch]  = useState(0);
  const [includeApify,  setIncludeApify] = useState(true);
  const [selected,      setSelected]   = useState(new Set());
  const [composeTo,     setComposeTo]  = useState(null);
  const [activePost,    setActivePost] = useState(null);
  const [profile,       setProfile]    = useState(null);
  const [showAllRoles,  setShowAllRoles]  = useState(false);
  const [matchedTerms,  setMatchedTerms]  = useState([]);
  const [customKeywords, setCustomKeywords] = useState('');
  const [sinceFallback, setSinceFallback] = useState(false);
  const logsEndRef = useRef(null);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (user) api.get('/profile').then(p => setProfile(p)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (showLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scraperLogs]);

  // ── Fetch from scraper-primary endpoint ─────────────────────────────────────
  // Defaults to matching the caller's own target roles (job_title_1/2/3 on
  // their profile) server-side — every user gets a feed relevant to them
  // instead of the identical global list. "Show all roles" opts out.
  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { since, limit: 500, source: includeApify ? 'all' : 'scraper' };
      if (search)       params.search       = search;
      if (hiringOnly)   params.hiring_only  = 'true';
      if (showAllRoles) params.matchProfile = 'false';
      const data = await api.get('/linkedin-feed', { params });
      setPosts(data.posts || []);
      setMatchedTerms(data.matched_profile_terms || []);
      setSinceFallback(!!data.since_fallback);
    } catch { toast.error('Failed to load posts'); }
    finally  { setLoading(false); }
  }, [search, since, hiringOnly, includeApify, showAllRoles]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // Auto-refresh when the user returns to this tab after being away
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchPosts(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchPosts]);

  // ── Scraper trigger ──────────────────────────────────────────────────────────
  // Admins can override with custom keywords; everyone else always gets
  // titles/limit derived server-side from their own profile (the backend
  // ignores whatever's sent here for non-admins), so this just needs to send
  // an admin's intent when present.
  const runScraper = async () => {
    if (scraping) return;
    setScraping(true);
    setLogs([]);
    setShowLogs(true);

    const customTitles = isAdmin
      ? customKeywords.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    const profileTitles = [profile?.job_title_1, profile?.job_title_2, profile?.job_title_3, profile?.current_title]
      .filter(Boolean).slice(0, 3);
    const titles   = customTitles.length ? customTitles : (profileTitles.length ? profileTitles : ['Software Developer']);
    const location = profile?.preferred_city || profile?.location || 'India';

    const addLog = (type, text) => setLogs(prev => [...prev, { type, text }]);

    try {
      const resp = await fetch(`${API_ROOT}/api/scraper/run`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('hr_token')}`,
        },
        body: JSON.stringify({ scraper: 'linkedin-feed', titles, location, limit: 30 }),
      });

      if (!resp.ok) {
        let msg = `Scraper error (${resp.status})`;
        try { const d = await resp.json(); msg = d.error || msg; } catch {}
        addLog('error', msg);
        toast.error(msg);
        setScraping(false);
        return;
      }

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
              addLog(msg.type, msg.data);
            } else if (msg.type === 'done') {
              if (msg.data.code === 0) {
                toast.success(`Scrape complete — ${msg.data.stored || 0} posts stored`);
                fetchPosts();
              } else {
                toast.error('Scraper exited with errors — check logs');
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

  // ── Status change (Apify posts) ──────────────────────────────────────────────
  const handleStatusChange = async (postId, status) => {
    try {
      await api.patch(`/linkedin-feed/${postId}/status`, { status });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, status } : p));
      if (activePost?.id === postId) setActivePost(prev => ({ ...prev, status }));
    } catch (e) { toast.error(e.response?.data?.error || 'Status update failed'); }
  };

  // ── Selection ────────────────────────────────────────────────────────────────
  const emailPosts  = posts.filter(p => p.contact_email);
  const toggleSelect = p => {
    if (!p.contact_email) return;
    setSelected(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; });
  };
  const toggleAll = () => {
    if (emailPosts.every(p => selected.has(p.id))) setSelected(new Set());
    else setSelected(new Set(emailPosts.map(p => p.id)));
  };
  const selectedPosts = emailPosts.filter(p => selected.has(p.id));

  const handleSent = (sentIds) => {
    const s = new Set(sentIds);
    setPosts(prev => prev.map(p => s.has(p.id) ? { ...p, emailed_now: true } : p));
    setSelected(new Set());
  };

  // ── Filter ───────────────────────────────────────────────────────────────────
  const profileSkills = (() => {
    const raw = profile?.skills;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  })();
  const filtered = posts.filter(p => {
    if (filter === 'email') return !!p.contact_email;
    if (filter === 'phone') return !!p.contact_phone;
    return true;
  }).filter(p => {
    if (!minMatch) return true;
    const { matchPercent } = computeJobMatch(p, profileSkills);
    return matchPercent != null && matchPercent >= minMatch;
  });

  const withEmail = posts.filter(p => p.contact_email).length;
  const phoneOnly = posts.filter(p => !p.contact_email && p.contact_phone).length;
  const apifyOnly = posts.filter(p => p.source === 'apify' || p.source === 'both').length;

  return (
    <div className="space-y-4">

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        <input type="text" placeholder="Search title, company, email…"
               value={search} onChange={e => setSearch(e.target.value)}
               className="border rounded-sm px-3 py-2 text-sm w-64 focus:ring-2 focus:ring-brand-300 outline-none bg-white" />
        <select value={since} onChange={e => setSince(e.target.value)}
                className="border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white">
          {SINCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={minMatch} onChange={e => setMinMatch(Number(e.target.value))}
                className="border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white">
          {MATCH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={hiringOnly} onChange={e => setHiringOnly(e.target.checked)} className="rounded" />
          Hiring only
        </label>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">
            {posts.length} posts · {withEmail} email · {phoneOnly} phone
            {includeApify && apifyOnly > 0 ? ` · ${apifyOnly} Apify` : ''}
          </span>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none border rounded-sm px-2.5 py-1.5 hover:bg-gray-50 transition-colors">
            <input type="checkbox" checked={includeApify} onChange={e => setIncludeApify(e.target.checked)} className="rounded accent-brand-600" />
            Include Apify posts
          </label>
          {isAdmin && (
            <input type="text" placeholder="Custom keywords (comma-separated)…"
                   value={customKeywords} onChange={e => setCustomKeywords(e.target.value)}
                   title="Overrides your profile's target roles for this scrape only"
                   className="border rounded-sm px-2.5 py-1.5 text-xs w-52 focus:ring-2 focus:ring-brand-300 outline-none bg-white" />
          )}
          <button onClick={runScraper} disabled={scraping}
                  className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 disabled:opacity-50 transition">
            {scraping ? '⏳ Scraping…' : isAdmin ? '🔍 Scrape Now (admin)' : '🔍 Find My Matches'}
          </button>
        </div>
      </div>

      {/* ── Personalization / fallback banners ──────────────────────────── */}
      {sinceFallback && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span>⚠ No new posts scraped today — showing posts from the last 7 days instead.</span>
          <button onClick={fetchPosts} className="ml-auto underline hover:no-underline font-medium shrink-0">Refresh</button>
        </div>
      )}
      {!search && (
        matchedTerms.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-sm px-3 py-2">
            <span>Showing posts matching your target roles: <strong>{matchedTerms.join(', ')}</strong></span>
            <button onClick={() => setShowAllRoles(v => !v)} className="ml-auto underline hover:no-underline font-medium shrink-0">
              {showAllRoles ? 'Back to my matches' : 'Show all roles instead'}
            </button>
          </div>
        ) : !showAllRoles && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <span>Set your target roles in <strong>Profile → Overview</strong> (Target Role 1/2/3) to see a personalized feed — showing all posts for now.</span>
          </div>
        )
      )}

      {/* ── Log panel ────────────────────────────────────────────────────── */}
      {showLogs && (
        <div className="bg-gray-900 rounded-md border border-gray-700 p-4 space-y-1 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-400">Scraper Output</span>
            <button onClick={() => setShowLogs(false)} className="text-gray-500 hover:text-gray-300 text-xs">Hide</button>
          </div>
          {scraperLogs.map((l, i) => (
            <p key={i} className={`text-xs font-mono whitespace-pre-wrap ${l.type === 'err' ? 'text-red-400' : 'text-green-300'}`}>{l.text}</p>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && posts.length === 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-md p-6 text-center space-y-3">
          <p className="text-3xl">💼</p>
          <p className="font-semibold text-gray-800">No posts in this range yet</p>
          <p className="text-sm text-gray-500">
            The feed refreshes automatically every morning at 7:00 AM IST with new HR hiring posts —
            email addresses, phone numbers, and Google Forms. Apify-sourced listings are added
            whenever an admin runs a manual Apify scrape.
            Try a wider date range above, click below to search now, or check back after the next morning refresh.
          </p>
          <button onClick={runScraper} disabled={scraping}
                  className="px-5 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 disabled:opacity-50">
            {scraping ? '⏳ Scraping…' : isAdmin ? '🔍 Scrape Now (admin)' : '🔍 Find My Matches'}
          </button>
          {!isAdmin && (
            <p className="text-xs text-gray-400">Uses your target roles from Profile — limited to once every few hours.</p>
          )}
        </div>
      )}

      {/* ── Filter + bulk select bar ──────────────────────────────────────── */}
      {!loading && posts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-sm border overflow-hidden text-xs font-medium">
            {[
              { id: 'all',   label: `All (${posts.length})`  },
              { id: 'email', label: `✉ Email (${withEmail})` },
              { id: 'phone', label: `📱 Phone (${phoneOnly})` },
            ].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                      className={`px-3 py-2 transition-colors ${filter === f.id ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {f.label}
              </button>
            ))}
          </div>

          {emailPosts.length > 0 && (
            <>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" className="rounded accent-brand-600"
                       checked={emailPosts.every(p => selected.has(p.id))}
                       onChange={toggleAll} />
                Select all with email
              </label>
              {selected.size > 0 && (
                <button onClick={() => setComposeTo('bulk')}
                        className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700">
                  ✉ Email {selected.size} selected
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Cards grid ────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-44 bg-gray-100 animate-pulse rounded-md" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No posts match this filter.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map(post => (
            <PostCard
              key={post.id}
              post={post}
              selected={selected.has(post.id)}
              onSelect={toggleSelect}
              onWorkflow={setActivePost}
              onSingleEmail={p => setComposeTo({ single: true, contacts: [p] })}
              onStatusChange={handleStatusChange}
              profileSkills={profileSkills}
            />
          ))}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {composeTo === 'bulk' && (
        <BulkEmailModal contacts={selectedPosts} onClose={() => setComposeTo(null)} onSent={handleSent} />
      )}
      {composeTo?.single && (
        <BulkEmailModal contacts={composeTo.contacts} onClose={() => setComposeTo(null)} onSent={handleSent} />
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
