import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import toast from 'react-hot-toast';
import { X, Search, Users, Inbox, MapPin, Mail, Handshake } from 'lucide-react';

const AVATAR_COLORS = [
  'bg-brand-500', 'bg-purple-500', 'bg-green-500',
  'bg-orange-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
];
const TAG_COLORS = [
  'bg-brand-50 text-brand-700 border border-brand-100',
  'bg-purple-50 text-purple-700 border border-purple-100',
  'bg-green-50 text-green-700 border border-green-100',
  'bg-orange-50 text-orange-700 border border-orange-100',
];

function Avatar({ name, size = 'md' }) {
  const initials = (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const color    = AVATAR_COLORS[(name || '').charCodeAt(0) % AVATAR_COLORS.length];
  const cls      = size === 'lg' ? 'w-14 h-14 text-lg' : 'w-10 h-10 text-sm';
  return (
    <div className={`${cls} ${color} rounded-full flex items-center justify-center text-white font-bold shrink-0 select-none`}>
      {initials}
    </div>
  );
}

function ComposeModal({ target, myUser, myProfile, limit, remaining, onClose, onSent }) {
  const senderName    = myProfile?.full_name || myUser?.name || '';
  const senderTitle   = myProfile?.current_title   || '';
  const senderCompany = myProfile?.current_company || '';
  const lookingFor    = myProfile?.job_title_1     || senderTitle;
  const skills = (() => {
    try {
      const arr = Array.isArray(myProfile?.skills)
        ? myProfile.skills
        : JSON.parse(myProfile?.skills || '[]');
      return arr.slice(0, 5).join(', ');
    } catch { return ''; }
  })();

  const defaultSubject = `Referral Request — ${senderName}${senderTitle ? ` (${senderTitle})` : ''}`;

  const defaultMessage = [
    `Hi ${target.name},`,
    '',
    `I hope you're doing well! I'm ${senderName}${senderTitle ? `, currently a ${senderTitle}` : ''}${senderCompany ? ` at ${senderCompany}` : ''}, and I found your profile on our HR Outreach community.`,
    '',
    `I'm actively exploring new opportunities${lookingFor ? ` in ${lookingFor}` : ''} and would be incredibly grateful if you could refer me or keep me in mind for any relevant openings at your organization or network.`,
    ...(skills ? ['', `Key skills: ${skills}`] : []),
    '',
    `Feel free to reach me at ${myUser?.email || 'my email'}.`,
    '',
    'Thank you so much for your time and consideration!',
    '',
    'Best regards,',
    senderName,
  ].join('\n');

  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    if (!message.trim()) { toast.error('Message cannot be empty'); return; }
    setSending(true);
    try {
      await api.post(`/referrals/ask/${target.id}`, { subject: subject.trim(), message: message.trim() });
      toast.success(`Referral request sent to ${target.name}!`);
      onSent(target.id);
      onClose();
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to send referral request';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-md shadow-modal w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <Avatar name={target.name} />
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900">Ask for Referral</h2>
            <p className="text-sm text-gray-500 truncate">
              To: <span className="font-medium text-gray-700">{target.name}</span>
              {' '}·{' '}
              <span className="text-brand-600">{target.email}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
              placeholder="Email subject"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={13}
              className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none resize-none font-mono leading-relaxed"
              placeholder="Your referral request message…"
            />
          </div>
          <p className="text-xs text-gray-400">
            This email will be sent from your connected mail account. You can send up to {limit} request{limit !== 1 ? 's' : ''} to this person
            {typeof remaining === 'number' ? ` (${remaining} remaining after this one is sent)` : ''}.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-md">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border rounded-sm hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !subject.trim() || !message.trim()}
            className="px-5 py-2 text-sm font-semibold bg-brand-600 text-white rounded-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {sending ? 'Sending…' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserCard({ user, onAsk, sent, limit }) {
  const skills = (() => {
    try {
      const raw = typeof user.skills === 'string' ? JSON.parse(user.skills || '[]') : (user.skills || []);
      const arr = Array.isArray(raw) ? raw : [];
      return arr.slice(0, 4);
    } catch { return []; }
  })();

  const lookingFor = [user.job_title_1, user.job_title_2, user.job_title_3].filter(Boolean).join(' / ');
  const count = user.request_count || 0;

  return (
    <div className={`bg-white border rounded-md p-4 flex flex-col gap-3 shadow-card hover:shadow-md transition-all ${sent ? 'border-green-200 bg-green-50/30' : 'hover:border-brand-200'}`}>

      {/* Top: avatar + name */}
      <div className="flex items-start gap-3">
        <Avatar name={user.name} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{user.name}</p>
          {user.current_title   && <p className="text-sm text-gray-600 truncate">{user.current_title}</p>}
          {user.current_company && <p className="text-xs text-gray-400 truncate">{user.current_company}</p>}
        </div>
        {count > 0 && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${sent ? 'text-green-600 bg-green-100' : 'text-amber-600 bg-amber-100'}`}>
            {sent ? 'Requested' : `Sent ${count}/${limit}`}
          </span>
        )}
      </div>

      {/* Location + email */}
      <div className="space-y-0.5">
        {user.location && <p className="text-xs text-gray-400 flex items-center gap-1.5"><MapPin size={11} className="shrink-0" /> {user.location}</p>}
        <p className="text-xs text-brand-600 truncate flex items-center gap-1"><Mail size={11} className="shrink-0" /> {user.email}</p>
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skills.map((s, i) => (
            <span key={s} className={`text-xs px-2 py-0.5 rounded-full font-medium ${TAG_COLORS[i % TAG_COLORS.length]}`}>{s}</span>
          ))}
        </div>
      )}

      {/* Looking for */}
      {lookingFor && (
        <p className="text-xs text-gray-500">
          Looking for: <span className="font-medium text-gray-700">{lookingFor}</span>
        </p>
      )}

      {/* Action button */}
      <button
        onClick={onAsk}
        disabled={sent}
        className={`w-full py-2 rounded-sm text-sm font-semibold transition-colors mt-auto flex items-center justify-center gap-1.5 ${
          sent
            ? 'bg-green-50 text-green-700 border border-green-200 cursor-default'
            : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
        }`}
      >
        {sent ? '✓ Request Sent' : <><Handshake size={14} /> Ask for Referral</>}
      </button>

      {/* LinkedIn link */}
      {user.linkedin_url && (
        <a
          href={user.linkedin_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-center text-brand-500 hover:underline"
        >
          View LinkedIn →
        </a>
      )}
    </div>
  );
}

export default function AskReferral() {
  const { user }                   = useAuth();
  const [users, setUsers]          = useState([]);
  const [limit, setLimit]          = useState(2);
  const [myProfile, setMyProfile]  = useState(null);
  const [loading, setLoading]      = useState(true);
  const [search, setSearch]        = useState('');
  const [composeTo, setComposeTo]  = useState(null);
  const [activeTab, setActiveTab]  = useState('browse'); // 'browse' | 'received'
  const [received, setReceived]    = useState([]);
  const [rcvLoading, setRcvLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, profileRes] = await Promise.all([
        api.get('/referrals/users'),
        api.get('/profile').catch(() => ({})),
      ]);
      setUsers(Array.isArray(usersRes?.users) ? usersRes.users : []);
      setLimit(usersRes?.limit || 2);
      setMyProfile(profileRes || {});
    } catch {
      toast.error('Failed to load community members');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReceived = useCallback(async () => {
    setRcvLoading(true);
    try {
      const res = await api.get('/referrals/received');
      setReceived(Array.isArray(res) ? res : []);
    } catch {
      toast.error('Failed to load received requests');
    } finally {
      setRcvLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    if (activeTab === 'received') loadReceived();
  }, [activeTab, loadReceived]);

  const handleSent = (targetId) => {
    setUsers(prev => prev.map(u => {
      if (u.id !== targetId) return u;
      const nextCount = (u.request_count || 0) + 1;
      return { ...u, request_count: nextCount, request_sent: nextCount >= limit ? 1 : 0 };
    }));
  };

  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    let skills = [];
    try {
      const parsed = JSON.parse(u.skills || '[]');
      skills = Array.isArray(parsed) ? parsed : [];
    } catch {}
    return (
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.current_title?.toLowerCase().includes(q) ||
      u.current_company?.toLowerCase().includes(q) ||
      u.location?.toLowerCase().includes(q) ||
      skills.some(s => typeof s === 'string' && s.toLowerCase().includes(q))
    );
  });

  const notSent  = filtered.filter(u => !u.request_sent);
  const sentList = filtered.filter(u =>  u.request_sent);

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Ask for Referral</h2>
          <p className="text-sm text-gray-500 mt-1">
            Browse registered community members and send a one-time referral request email directly from the portal.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-brand-50 border border-brand-100 px-3 py-2 rounded-sm">
          <span className="text-brand-600 font-semibold text-xs">{limit}x</span>
          <span>max per person to prevent spam</span>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b">
        {[
          { id: 'browse',   label: `👥 Community Members${users.length ? ` (${users.length})` : ''}` },
          { id: 'received', label: `📬 Received Requests${received.length ? ` (${received.length})` : ''}` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Browse tab ── */}
      {activeTab === 'browse' && (
        <>
          {/* Search */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, title, company, skills…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border rounded-sm text-sm focus:ring-2 focus:ring-brand-300 outline-none"
              />
            </div>
            {search && (
              <button onClick={() => setSearch('')} className="text-sm text-gray-400 hover:text-gray-600">Clear</button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading community members…</div>
          ) : users.length === 0 ? (
            <div className="text-center h-40 flex flex-col items-center justify-center gap-2 text-gray-400">
              <Users size={32} strokeWidth={1} className="text-gray-300" />
              <p className="text-sm">No other members have registered yet.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">No members match your search.</div>
          ) : (
            <div className="space-y-8">
              {notSent.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Available to Contact ({notSent.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {notSent.map(u => (
                      <UserCard
                        key={u.id}
                        user={u}
                        sent={false}
                        limit={limit}
                        onAsk={() => setComposeTo(u)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {sentList.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Already Requested ({sentList.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sentList.map(u => (
                      <UserCard
                        key={u.id}
                        user={u}
                        sent={true}
                        limit={limit}
                        onAsk={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Received tab ── */}
      {activeTab === 'received' && (
        <div>
          {rcvLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
          ) : received.length === 0 ? (
            <div className="text-center h-40 flex flex-col items-center justify-center gap-2 text-gray-400">
              <Inbox size={32} strokeWidth={1} className="text-gray-300" />
              <p className="text-sm">No referral requests received yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {received.map(r => (
                <div key={r.id} className="bg-white border rounded-md p-4 flex flex-col sm:flex-row gap-4 shadow-card">
                  <Avatar name={r.from_name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900">{r.from_name}</span>
                      {r.from_title && <span className="text-xs text-gray-500">{r.from_title}</span>}
                      {r.from_company && <span className="text-xs text-gray-400">@ {r.from_company}</span>}
                      <span className="text-xs text-gray-400 ml-auto">{r.created_at?.slice(0, 10)}</span>
                    </div>
                    <p className="text-xs text-brand-600 mb-2">From: {r.from_email}</p>
                    {r.subject && <p className="text-sm font-medium text-gray-700 mb-1">{r.subject}</p>}
                    <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-4">{r.message}</p>
                  </div>
                  <a
                    href={`mailto:${r.from_email}?subject=${encodeURIComponent('Re: ' + (r.subject || 'Referral Request'))}`}
                    className="shrink-0 self-start px-3 py-1.5 text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200 rounded-sm hover:bg-brand-100 transition-colors"
                  >
                    Reply →
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compose modal */}
      {composeTo && (
        <ComposeModal
          target={composeTo}
          myUser={user}
          myProfile={myProfile}
          limit={limit}
          remaining={Math.max(0, limit - (composeTo.request_count || 0) - 1)}
          onClose={() => setComposeTo(null)}
          onSent={handleSent}
        />
      )}
    </div>
  );
}
