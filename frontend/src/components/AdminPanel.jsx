import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

// ── Constants ──────────────────────────────────────────────────────────────
const PLANS  = ['guest', 'demo', 'basic', 'advanced'];
const ROLES  = ['user', 'admin'];
const STAGES = ['new', 'contacted', 'converted', 'rejected'];

const STAGE_META = {
  new:       { label: 'New',       icon: '🆕', color: 'blue',   bar: 'bg-blue-500',   pill: 'bg-blue-100 text-blue-700',   border: 'border-l-blue-500',   header: 'bg-blue-50' },
  contacted: { label: 'Contacted', icon: '📬', color: 'amber',  bar: 'bg-amber-500',  pill: 'bg-amber-100 text-amber-700', border: 'border-l-amber-500',  header: 'bg-amber-50' },
  converted: { label: 'Converted', icon: '✅', color: 'green',  bar: 'bg-green-500',  pill: 'bg-green-100 text-green-700', border: 'border-l-green-500',  header: 'bg-green-50' },
  rejected:  { label: 'Rejected',  icon: '❌', color: 'red',    bar: 'bg-red-400',    pill: 'bg-red-100 text-red-600',     border: 'border-l-red-400',    header: 'bg-red-50' },
};

const PLAN_BADGE = {
  guest:    'bg-gray-100 text-gray-600',
  demo:     'bg-sky-100 text-sky-700',
  basic:    'bg-blue-100 text-blue-700',
  advanced: 'bg-purple-100 text-purple-700',
};

const ROLE_BADGE = {
  admin: 'bg-red-100 text-red-700 font-bold',
  user:  'bg-gray-100 text-gray-600',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

function Avatar({ name, gradient = 'from-purple-400 to-indigo-500', size = 'md' }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const sz = size === 'lg' ? 'w-12 h-12 text-base' : 'w-9 h-9 text-sm';
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold shrink-0`}>
      {initials}
    </div>
  );
}

function copyText(text, label = 'Copied!') {
  navigator.clipboard.writeText(text).then(() => toast.success(label));
}

function exportCSV(leads) {
  const headers = ['Name','Email','Mobile','LinkedIn','Twitter','GitHub','Preferred Contact','Plan','Experience','Role','Status','Notes','Submitted'];
  const rows = leads.map(l => [
    l.name, l.email, l.mobile||'', l.linkedin_url||'', l.twitter_handle||'', l.github_url||'',
    l.preferred_contact||'', l.plan_interest||'', l.experience||'', l.job_type||'',
    l.status, l.notes||'', fmtDate(l.created_at),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href: url, download: `leads_${new Date().toISOString().slice(0,10)}.csv` }).click();
  URL.revokeObjectURL(url);
}

// ── Email client chooser dropdown ──────────────────────────────────────────
function EmailChooser({ email, subject = '', body = '', label = 'Email', size = 'sm' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const su = encodeURIComponent(subject);
  const bo = encodeURIComponent(body);

  const clients = [
    {
      icon: '📧', name: 'Gmail',
      url: `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}&su=${su}&body=${bo}`,
      cls: 'hover:bg-red-50 text-gray-700',
    },
    {
      icon: '📨', name: 'Outlook Web',
      url: `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(email)}&subject=${su}&body=${bo}`,
      cls: 'hover:bg-blue-50 text-gray-700',
    },
    {
      icon: '🟡', name: 'Yahoo Mail',
      url: `https://compose.mail.yahoo.com/?to=${encodeURIComponent(email)}&subject=${su}&body=${bo}`,
      cls: 'hover:bg-purple-50 text-gray-700',
    },
    {
      icon: '💻', name: 'Default app',
      url: `mailto:${email}?subject=${su}&body=${bo}`,
      cls: 'hover:bg-gray-100 text-gray-700',
      self: true,
    },
  ];

  const btnCls = size === 'xs'
    ? 'text-xs text-blue-500 hover:text-blue-700 border border-blue-200 rounded-lg px-2 py-1 hover:bg-blue-50 transition font-medium'
    : 'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 transition-all';

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} className={btnCls}>
        {size !== 'xs' && <span>✉️</span>}
        <span>{label}</span>
        <span className="ml-0.5 opacity-60">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 bg-white border border-gray-200 rounded-2xl shadow-xl w-52 py-1.5 overflow-hidden">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 py-1.5">Send via…</p>
          {clients.map(c => (
            <a key={c.name} href={c.url}
              target={c.self ? '_self' : '_blank'} rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${c.cls}`}>
              <span className="text-base w-5 text-center">{c.icon}</span>
              <span className="font-medium">{c.name}</span>
            </a>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button
              onClick={() => { navigator.clipboard.writeText(email); toast.success('Email copied!'); setOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 text-sm w-full text-left hover:bg-gray-50 text-gray-600 transition-colors">
              <span className="text-base w-5 text-center">📋</span>
              <span className="font-medium">Copy address</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Outreach buttons ───────────────────────────────────────────────────────
function OutreachButtons({ lead }) {
  const waText      = encodeURIComponent(`Hi ${lead.name},\n\nWe noticed you registered interest in HR Outreach Tracker. We'd love to connect and learn more about your job search goals!\n\nTeam HR Outreach Tracker`);
  const mailSubject = 'Re: Your interest in HR Outreach Tracker';
  const mailBody    = `Hi ${lead.name},\n\nThank you for registering your interest in HR Outreach Tracker!\n\nBest,\nTeam`;

  const otherButtons = [
    lead.mobile       && { icon: '💬', label: 'WhatsApp', href: `https://wa.me/${lead.mobile.replace(/\D/g,'')}?text=${waText}`,  title: `WhatsApp ${lead.mobile}`,       cls: 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200' },
    lead.mobile       && { icon: '📞', label: 'Call',     href: `tel:${lead.mobile}`,                                             title: lead.mobile,                     cls: 'bg-teal-50 hover:bg-teal-100 text-teal-700 border-teal-200' },
    lead.linkedin_url && { icon: '💼', label: 'LinkedIn', href: lead.linkedin_url,                                                title: 'Open LinkedIn profile',         cls: 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200' },
    lead.twitter_handle && { icon: '🐦', label: 'Twitter', href: `https://twitter.com/${lead.twitter_handle}`,                   title: `@${lead.twitter_handle}`,       cls: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200' },
    lead.github_url   && { icon: '🐙', label: 'GitHub',   href: `https://github.com/${lead.github_url}`,                        title: `github.com/${lead.github_url}`, cls: 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200' },
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap gap-1.5">
      {lead.email && (
        <EmailChooser email={lead.email} subject={mailSubject} body={mailBody} label="Email" />
      )}
      {otherButtons.map(b => (
        <a key={b.label} href={b.href}
          target={b.href.startsWith('tel:') ? '_self' : '_blank'}
          rel="noopener noreferrer" title={b.title}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${b.cls}`}>
          <span>{b.icon}</span><span>{b.label}</span>
        </a>
      ))}
    </div>
  );
}

// ── Lead Card ──────────────────────────────────────────────────────────────
function LeadCard({ lead, onStatusChange, onSave, onDelete }) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes,     setNotes]     = useState(lead.notes || '');
  const [editing,   setEditing]   = useState(false);
  const [editForm,  setEditForm]  = useState({});
  const [saving,    setSaving]    = useState(false);
  const meta = STAGE_META[lead.status] || STAGE_META.new;

  async function saveNotes() {
    setSaving(true);
    try { await onSave(lead.id, { notes }); toast.success('Notes saved'); setShowNotes(false); }
    catch { toast.error('Failed'); }
    finally { setSaving(false); }
  }

  function startEdit() { setEditForm({ ...lead }); setEditing(true); }
  async function saveEdit() {
    setSaving(true);
    try { await onSave(lead.id, editForm); setEditing(false); toast.success('Updated'); }
    catch { toast.error('Failed'); }
    finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div className={`bg-white rounded-2xl border-l-4 ${meta.border} border border-gray-200 shadow-sm p-4 space-y-3`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-purple-700">✏️ Editing — {lead.email}</p>
          <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { k: 'name',             label: 'Name' },
            { k: 'mobile',           label: 'Mobile' },
            { k: 'linkedin_url',     label: 'LinkedIn URL',    type: 'url' },
            { k: 'twitter_handle',   label: 'Twitter Handle' },
            { k: 'github_url',       label: 'GitHub Username' },
            { k: 'experience',       label: 'Experience' },
            { k: 'plan_interest',    label: 'Plan Interest' },
            { k: 'job_type',         label: 'Job Type' },
          ].map(({ k, label, type = 'text' }) => (
            <div key={k}>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wide">{label}</label>
              <input type={type} value={editForm[k] || ''}
                onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-purple-300" />
            </div>
          ))}
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wide">Other Info</label>
            <textarea rows={2} value={editForm.other_info || ''}
              onChange={e => setEditForm(f => ({ ...f, other_info: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-purple-300 resize-none" />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wide">Admin Notes</label>
            <textarea rows={2} value={editForm.notes || ''}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-purple-300 resize-none" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={saveEdit} disabled={saving}
            className="px-4 py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700 disabled:opacity-50">
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          <button onClick={() => setEditing(false)}
            className="px-4 py-1.5 border border-gray-200 text-xs text-gray-600 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl border-l-4 ${meta.border} border border-gray-200 shadow-sm hover:shadow-md transition-shadow`}>
      {/* Card header */}
      <div className={`px-4 pt-3.5 pb-2 ${meta.header} rounded-tr-2xl`}>
        <div className="flex items-start gap-3">
          <Avatar name={lead.name} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-gray-900 leading-tight">{lead.name}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.pill}`}>{meta.icon} {meta.label}</span>
              {lead.preferred_contact && (
                <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
                  Prefers: {lead.preferred_contact}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{lead.email}</p>
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={startEdit} title="Edit lead"
              className="text-gray-400 hover:text-blue-500 text-base px-1.5 py-0.5 rounded transition">✏️</button>
            <button onClick={() => onDelete(lead.id, lead.name)} title="Delete"
              className="text-gray-400 hover:text-red-500 text-base px-1.5 py-0.5 rounded transition">🗑</button>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="px-4 pb-3.5 pt-2 space-y-2.5">
        {/* Meta badges */}
        <div className="flex flex-wrap gap-1.5">
          {lead.mobile       && <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">📞 {lead.mobile}</span>}
          {lead.experience   && <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">💼 {lead.experience}</span>}
          {lead.job_type     && <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold">{lead.job_type}</span>}
          {lead.plan_interest && <span className="text-[11px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-semibold">{lead.plan_interest}</span>}
        </div>

        {/* Outreach buttons */}
        <OutreachButtons lead={lead} />

        {/* Other info */}
        {lead.other_info && (
          <p className="text-xs text-gray-500 italic bg-gray-50 rounded-lg px-2.5 py-1.5">
            "{lead.other_info}"
          </p>
        )}

        {/* Admin notes */}
        {showNotes ? (
          <div className="space-y-1.5">
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add admin notes…"
              className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-300 resize-none bg-amber-50" />
            <div className="flex gap-1.5">
              <button onClick={saveNotes} disabled={saving}
                className="text-[11px] px-2.5 py-1 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 disabled:opacity-50">
                {saving ? '…' : 'Save'}
              </button>
              <button onClick={() => { setShowNotes(false); setNotes(lead.notes||''); }}
                className="text-[11px] px-2.5 py-1 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        ) : lead.notes ? (
          <button onClick={() => setShowNotes(true)}
            className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 w-full text-left hover:bg-amber-100 transition">
            📝 {lead.notes}
          </button>
        ) : (
          <button onClick={() => setShowNotes(true)}
            className="text-[11px] text-gray-400 hover:text-amber-600 transition font-medium">
            + Add note
          </button>
        )}

        {/* Status pipeline controls */}
        <div className="pt-1 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-widest mb-1.5">Move to:</p>
          <div className="flex gap-1 flex-wrap">
            {STAGES.filter(s => s !== lead.status).map(s => {
              const m = STAGE_META[s];
              return (
                <button key={s} onClick={() => onStatusChange(lead.id, s)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all hover:opacity-80 ${m.pill} border-current`}>
                  {m.icon} {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-gray-300 pt-0.5">
          <span>Submitted: {fmtDate(lead.created_at)}</span>
          <button onClick={() => copyText(lead.email, 'Email copied!')}
            className="hover:text-gray-500 transition">📋 Copy email</button>
        </div>
      </div>
    </div>
  );
}

// ── Leads Section ──────────────────────────────────────────────────────────
function LeadsSection() {
  const [leads,   setLeads]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [sort,    setSort]    = useState('newest');
  const [view,    setView]    = useState('pipeline'); // 'pipeline' | 'list'

  const load = useCallback(() => {
    setLoading(true);
    api.get('/leads').then(setLeads).catch(() => toast.error('Failed to load leads')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(id, status) {
    try {
      await api.put(`/leads/${id}`, { status });
      setLeads(ls => ls.map(l => l.id === id ? { ...l, status } : l));
    } catch { toast.error('Failed'); }
  }

  async function saveLead(id, updates) {
    await api.put(`/leads/${id}`, updates);
    setLeads(ls => ls.map(l => l.id === id ? { ...l, ...updates } : l));
  }

  async function deleteLead(id, name) {
    if (!window.confirm(`Delete lead "${name}"?`)) return;
    try {
      await api.delete(`/leads/${id}`);
      setLeads(ls => ls.filter(l => l.id !== id));
      toast.success('Deleted');
    } catch { toast.error('Failed'); }
  }

  const sorted = useMemo(() => {
    const q = search.toLowerCase();
    let res = leads.filter(l =>
      !q || l.name?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q)
        || l.job_type?.toLowerCase().includes(q) || l.mobile?.includes(q)
    );
    if (sort === 'newest') res = [...res].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sort === 'oldest') res = [...res].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return res;
  }, [leads, search, sort]);

  const byStage = useMemo(() => {
    const m = {};
    STAGES.forEach(s => { m[s] = sorted.filter(l => l.status === s); });
    return m;
  }, [sorted]);

  if (loading) return <div className="flex items-center justify-center h-32"><p className="text-sm text-gray-400 animate-pulse">Loading leads…</p></div>;

  const total     = leads.length;
  const converted = leads.filter(l => l.status === 'converted').length;
  const rate      = total ? Math.round((converted / total) * 100) : 0;

  return (
    <div className="space-y-4">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',     value: total,                 sub: 'registered',        icon: '🚀', gradient: 'from-purple-500 to-indigo-600' },
          { label: 'Converted',       value: converted,             sub: `${rate}% conversion`, icon: '✅', gradient: 'from-green-500 to-emerald-600' },
          { label: 'Contacted',       value: leads.filter(l => l.status === 'contacted').length, sub: 'in progress', icon: '📬', gradient: 'from-amber-500 to-orange-500' },
          { label: 'Pending Review',  value: leads.filter(l => l.status === 'new').length,       sub: 'new leads',   icon: '🆕', gradient: 'from-blue-500 to-blue-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 bg-gradient-to-br ${s.gradient} text-white shadow-sm`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-black leading-none">{s.value}</p>
                <p className="text-xs font-semibold text-white/80 mt-1.5">{s.label}</p>
                <p className="text-[11px] text-white/50 mt-0.5">{s.sub}</p>
              </div>
              <span className="text-2xl opacity-75">{s.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, role…"
          className="flex-1 min-w-[200px] border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-300" />
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-purple-300">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <div className="flex bg-gray-100 p-0.5 rounded-xl">
          {[{ id: 'pipeline', icon: '⬛' }, { id: 'list', icon: '☰' }].map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-all ${view === v.id ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
              {v.icon}
            </button>
          ))}
        </div>
        <button onClick={() => exportCSV(sorted)}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white hover:bg-gray-50 font-medium transition">
          ↓ Export CSV
        </button>
      </div>

      {sorted.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-12">
          {search ? `No leads matching "${search}"` : 'No leads yet — interest registrations will appear here.'}
        </p>
      )}

      {/* Pipeline / Kanban view */}
      {view === 'pipeline' && sorted.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {STAGES.map(stage => {
            const meta  = STAGE_META[stage];
            const cards = byStage[stage] || [];
            return (
              <div key={stage} className="flex flex-col gap-3">
                {/* Column header */}
                <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl ${meta.header} border border-current/10`}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{meta.icon}</span>
                    <span className="text-sm font-bold text-gray-700">{meta.label}</span>
                  </div>
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full ${meta.pill}`}>{cards.length}</span>
                </div>
                {/* Cards */}
                {cards.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-2xl py-8 flex items-center justify-center text-xs text-gray-300">
                    No leads here
                  </div>
                ) : (
                  cards.map(lead => (
                    <LeadCard key={lead.id} lead={lead}
                      onStatusChange={changeStatus} onSave={saveLead} onDelete={deleteLead} />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {view === 'list' && sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map(lead => (
            <LeadCard key={lead.id} lead={lead}
              onStatusChange={changeStatus} onSave={saveLead} onDelete={deleteLead} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Users Section ──────────────────────────────────────────────────────────
function UsersSection() {
  const { user: me }  = useAuth();
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/users').then(setUsers).catch(() => toast.error('Failed to load users')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function changeRole(userId, role) {
    try { await api.put(`/admin/users/${userId}/role`, { role }); setUsers(us => us.map(u => u.id === userId ? { ...u, role } : u)); toast.success('Role updated'); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function changePlan(userId, plan) {
    try { await api.put(`/admin/users/${userId}/plan`, { plan }); setUsers(us => us.map(u => u.id === userId ? { ...u, plan } : u)); toast.success('Plan updated'); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function deleteUser(userId, name) {
    if (!window.confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try { await api.delete(`/admin/users/${userId}`); setUsers(us => us.filter(u => u.id !== userId)); toast.success('User deleted'); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? users.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)) : users;
  }, [users, search]);

  const planCounts = useMemo(() => {
    const m = {};
    PLANS.forEach(p => { m[p] = users.filter(u => (u.plan || 'demo') === p).length; });
    return m;
  }, [users]);

  if (loading) return <div className="flex items-center justify-center h-32"><p className="text-sm text-gray-400 animate-pulse">Loading users…</p></div>;

  return (
    <div className="space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {PLANS.map(p => (
          <div key={p} className={`bg-white rounded-2xl border border-gray-200 p-4`}>
            <p className="text-2xl font-black text-gray-800">{planCounts[p]}</p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full mt-1.5 inline-block capitalize ${PLAN_BADGE[p]}`}>{p}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
        <p className="text-xs text-gray-400 shrink-0">{filtered.length} of {users.length} users</p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">User</th>
                <th className="text-left px-4 py-3">Joined</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(u => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id} className={`hover:bg-gray-50/60 transition-colors ${isMe ? 'bg-indigo-50/30' : ''}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} gradient={isMe ? 'from-indigo-500 to-blue-500' : 'from-blue-400 to-indigo-500'} size="md" />
                        <div>
                          <p className="font-semibold text-gray-800">
                            {u.name}
                            {isMe && <span className="ml-1.5 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-bold">YOU</span>}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-gray-400">{u.email}</p>
                            <button onClick={() => copyText(u.email, 'Email copied!')}
                              className="text-gray-300 hover:text-gray-500 text-[10px] transition">📋</button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3.5">
                      {isMe ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role]}`}>{u.role}</span>
                      ) : (
                        <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer">
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <select value={u.plan || 'demo'} onChange={e => changePlan(u.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer">
                        {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <EmailChooser email={u.email} subject="Hi from HR Outreach Tracker" body={`Hi ${u.name},\n\n`} label="✉ Email" size="xs" />
                        {!isMe && (
                          <button onClick={() => deleteUser(u.id, u.name)}
                            className="text-xs text-red-400 hover:text-red-600 transition font-medium">
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
          Role change takes effect on the user's next login · Plan change is immediate
        </div>
      </div>
    </div>
  );
}

// ── Main AdminPanel ────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { user } = useAuth();
  const [tab, setTab] = useState('leads');

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <span className="text-4xl">🔒</span>
        <p className="text-gray-500 text-sm font-medium">Admin access required.</p>
      </div>
    );
  }

  const TABS = [
    { id: 'leads', icon: '🚀', label: 'Interest Leads' },
    { id: 'users', icon: '👥', label: 'User Management' },
  ];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="relative bg-gradient-to-br from-slate-800 via-slate-900 to-purple-950 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full -translate-y-1/2 translate-x-1/4" />
        </div>
        <div className="relative px-6 py-6 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-2xl shadow-lg">🛡️</div>
          <div>
            <h1 className="text-xl font-black text-white">Admin Control Centre</h1>
            <p className="text-slate-400 text-sm mt-0.5">Manage users · Reach out to leads · Control plans & permissions</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1.5 bg-gray-100 p-1 rounded-2xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
              tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <span>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'leads' && <LeadsSection />}
      {tab === 'users' && <UsersSection />}
    </div>
  );
}
