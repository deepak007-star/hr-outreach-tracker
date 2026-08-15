import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT, notifyIfUnauthorized } from '../api/client.js';
import { confirm } from '../utils/confirm.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import RolesPermissions from './RolesPermissions.jsx';
import PasswordVault from './PasswordVault.jsx';
import ApifySettingsModal from './ApifySettingsModal.jsx';
import { Pencil, Trash2, Eye, EyeOff, Shield, Users, Lock, Search, Database, Settings, LayoutGrid, List, Handshake, Inbox, Copy, Bot, Zap, Play, CheckCircle, ScrollText, RefreshCw, XCircle, AlertTriangle, Info } from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────
const PLANS  = ['guest', 'demo', 'basic', 'advanced'];
const ROLES  = ['user', 'admin'];
const STAGES = ['new', 'contacted', 'converted', 'rejected'];

const STAGE_META = {
  new:       { label: 'New',       color: 'blue',   bar: 'bg-blue-500',   pill: 'bg-blue-100 text-blue-700',   border: 'border-l-blue-500',   header: 'bg-blue-50' },
  contacted: { label: 'Contacted', color: 'amber',  bar: 'bg-amber-500',  pill: 'bg-amber-100 text-amber-700', border: 'border-l-amber-500',  header: 'bg-amber-50' },
  converted: { label: 'Converted', color: 'green',  bar: 'bg-green-500',  pill: 'bg-green-100 text-green-700', border: 'border-l-green-500',  header: 'bg-green-50' },
  rejected:  { label: 'Rejected',  color: 'red',    bar: 'bg-red-400',    pill: 'bg-red-100 text-red-600',     border: 'border-l-red-400',    header: 'bg-red-50' },
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
    ? 'text-xs text-brand-600 hover:text-brand-700 border border-brand-200 rounded-sm px-2 py-1 hover:bg-brand-50 transition font-medium'
    : 'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-sm border bg-brand-50 hover:bg-brand-100 text-brand-700 border-brand-200 transition-all';

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} className={btnCls}>
        {size !== 'xs' && <Copy size={12} />}
        <span>{label}</span>
        <span className="ml-0.5 opacity-60">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 bg-white border border-gray-200 rounded-md shadow-modal w-52 py-1.5 overflow-hidden">
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
    lead.github_url   && { icon: '🐙', label: 'GitHub',   href: /^https?:\/\//.test(lead.github_url) ? lead.github_url : `https://github.com/${lead.github_url}`,  title: lead.github_url, cls: 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200' },
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
      <div className={`bg-white rounded-md border-l-4 ${meta.border} border border-gray-200 shadow-card p-4 space-y-3`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-brand-700">Editing — {lead.email}</p>
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
                className="w-full border border-gray-200 rounded-sm px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-300" />
            </div>
          ))}
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wide">Other Info</label>
            <textarea rows={2} value={editForm.other_info || ''}
              onChange={e => setEditForm(f => ({ ...f, other_info: e.target.value }))}
              className="w-full border border-gray-200 rounded-sm px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-300 resize-none" />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wide">Admin Notes</label>
            <textarea rows={2} value={editForm.notes || ''}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-sm px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-300 resize-none" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={saveEdit} disabled={saving}
            className="px-4 py-1.5 bg-brand-600 text-white text-xs font-bold rounded-sm hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)}
            className="px-4 py-1.5 border border-gray-200 text-xs text-gray-600 rounded-sm hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-md border-l-4 ${meta.border} border border-gray-200 shadow-card hover:shadow-md transition-shadow`}>
      {/* Card header */}
      <div className={`px-4 pt-3.5 pb-2 ${meta.header} rounded-tr-md`}>
        <div className="flex items-start gap-3">
          <Avatar name={lead.name} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-gray-900 leading-tight">{lead.name}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
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
              className="text-gray-400 hover:text-brand-500 p-1 rounded-sm transition"><Pencil size={14} /></button>
            <button onClick={() => onDelete(lead.id, lead.name)} title="Delete"
              className="text-gray-400 hover:text-red-500 p-1 rounded-sm transition"><Trash2 size={14} /></button>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="px-4 pb-3.5 pt-2 space-y-2.5">
        {/* Meta badges */}
        <div className="flex flex-wrap gap-1.5">
          {lead.mobile       && <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">📞 {lead.mobile}</span>}
          {lead.experience   && <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">💼 {lead.experience}</span>}
          {lead.job_type     && <span className="text-[11px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-semibold">{lead.job_type}</span>}
          {lead.plan_interest && <span className="text-[11px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-semibold">{lead.plan_interest}</span>}
        </div>

        {/* Outreach buttons */}
        <OutreachButtons lead={lead} />

        {/* Other info */}
        {lead.other_info && (
          <p className="text-xs text-gray-500 italic bg-gray-50 rounded-sm px-2.5 py-1.5">
            "{lead.other_info}"
          </p>
        )}

        {/* Admin notes */}
        {showNotes ? (
          <div className="space-y-1.5">
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add admin notes…"
              className="w-full border border-amber-300 rounded-sm px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-amber-300 resize-none bg-amber-50" />
            <div className="flex gap-1.5">
              <button onClick={saveNotes} disabled={saving}
                className="text-[11px] px-2.5 py-1 bg-amber-500 text-white rounded-sm font-bold hover:bg-amber-600 disabled:opacity-50">
                {saving ? '…' : 'Save'}
              </button>
              <button onClick={() => { setShowNotes(false); setNotes(lead.notes||''); }}
                className="text-[11px] px-2.5 py-1 border border-gray-200 text-gray-500 rounded-sm hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        ) : lead.notes ? (
          <button onClick={() => setShowNotes(true)}
            className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-2.5 py-1.5 w-full text-left hover:bg-amber-100 transition">
            {lead.notes}
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
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-gray-300 pt-0.5">
          <span>Submitted: {fmtDate(lead.created_at)}</span>
          <button onClick={() => copyText(lead.email, 'Email copied!')}
            className="hover:text-gray-500 transition flex items-center gap-1"><Copy size={10} /> Copy email</button>
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
    api.get('/leads')
      .then(data => setLeads(Array.isArray(data) ? data : (data?.leads || [])))
      .catch(() => toast.error('Failed to load leads'))
      .finally(() => setLoading(false));
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
    if (!await confirm(`Delete lead "${name}"?`)) return;
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
          <div key={s.label} className={`rounded-md p-4 bg-gradient-to-br ${s.gradient} text-white shadow-card`}>
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
          className="flex-1 min-w-[200px] border border-gray-200 rounded-sm px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-300" />
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="border border-gray-200 rounded-sm px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-brand-300">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <div className="flex bg-gray-100 p-0.5 rounded-md">
          {[{ id: 'pipeline', Icon: LayoutGrid }, { id: 'list', Icon: List }].map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`px-3 py-1.5 rounded-sm text-sm transition-all flex items-center ${view === v.id ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
              <v.Icon size={15} />
            </button>
          ))}
        </div>
        <button onClick={() => exportCSV(sorted)}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-sm text-sm bg-white hover:bg-gray-50 font-medium transition">
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
                <div className={`flex items-center justify-between px-3 py-2.5 rounded-md ${meta.header} border border-current/10`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700">{meta.label}</span>
                  </div>
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full ${meta.pill}`}>{cards.length}</span>
                </div>
                {/* Cards */}
                {cards.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-md py-8 flex items-center justify-center text-xs text-gray-300">
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

// ── Reset Password Modal ───────────────────────────────────────────────────
function ResetPasswordModal({ user: target, onClose }) {
  const [password, setPassword]   = useState('');
  const [confirm,  setConfirm]    = useState('');
  const [show,     setShow]       = useState(false);
  const [saving,   setSaving]     = useState(false);
  const [done,     setDone]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password || password.length < 6) return toast.error('Password must be at least 6 characters');
    if (password !== confirm)             return toast.error('Passwords do not match');
    setSaving(true);
    try {
      await api.put(`/admin/users/${target.id}/password`, { password });
      setDone(true);
      toast.success(`Password reset for ${target.name}`);
      setTimeout(onClose, 1500);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to reset password');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-md shadow-modal w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900">Reset Password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        {done ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">✅</div>
            <p className="text-sm text-green-700 font-medium">Password reset successfully</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-sm text-xs text-amber-800">
              Setting a new password for <strong>{target.name}</strong> ({target.email})
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-sm text-sm font-mono focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                />
                <button type="button" onClick={() => setShow(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confirm Password</label>
              <input
                type={show ? 'text' : 'password'}
                className="w-full px-3 py-2 border border-gray-300 rounded-sm text-sm font-mono focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="Repeat password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </div>
            {password && confirm && password !== confirm && (
              <p className="text-xs text-red-500">Passwords do not match</p>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 px-4 py-2 text-sm bg-brand-600 text-white rounded-sm hover:bg-brand-700 disabled:opacity-60 font-semibold">
                {saving ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Users Section ──────────────────────────────────────────────────────────
function UsersSection() {
  const { user: me }  = useAuth();
  const [users,     setUsers]     = useState([]);
  const [allRoles,  setAllRoles]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [resetTarget, setResetTarget] = useState(null); // user to reset password for

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/admin/users'),
      api.get('/rbac/roles').catch(() => []),
    ]).then(([u, r]) => {
      setUsers(Array.isArray(u) ? u : []);
      setAllRoles(Array.isArray(r) && r.length > 0 ? r.map(role => role.name) : ['admin', 'user', 'viewer']);
    }).catch(() => toast.error('Failed to load users')).finally(() => setLoading(false));
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
    if (!await confirm(`Delete user "${name}"? This cannot be undone.`)) return;
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
      {resetTarget && (
        <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {PLANS.map(p => (
          <div key={p} className={`bg-white rounded-md border border-gray-200 p-4`}>
            <p className="text-2xl font-black text-gray-800">{planCounts[p]}</p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full mt-1.5 inline-block capitalize ${PLAN_BADGE[p]}`}>{p}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="flex-1 border border-gray-200 rounded-sm px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-300" />
        <p className="text-xs text-gray-400 shrink-0">{filtered.length} of {users.length} users</p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-md border border-gray-200 shadow-card overflow-hidden">
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
                  <tr key={u.id} className={`hover:bg-gray-50/60 transition-colors ${isMe ? 'bg-brand-50/30' : ''}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} gradient={isMe ? 'from-brand-500 to-brand-700' : 'from-brand-400 to-brand-600'} size="md" />
                        <div>
                          <p className="font-semibold text-gray-800">
                            {u.name}
                            {isMe && <span className="ml-1.5 text-[10px] bg-brand-100 text-brand-600 px-1.5 py-0.5 rounded-full font-bold">YOU</span>}
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
                          className="text-xs border border-gray-200 rounded-sm px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-brand-300 cursor-pointer">
                          {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <select value={u.plan || 'demo'} onChange={e => changePlan(u.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-sm px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-brand-300 cursor-pointer">
                          {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        {u.subscription_status && (u.plan === 'basic' || u.plan === 'advanced') && (
                          <span
                            title={u.current_period_end ? `Renews/expires ${fmtDate(u.current_period_end)}` : ''}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${
                              u.subscription_status === 'active'    ? 'bg-green-100 text-green-700' :
                              u.subscription_status === 'cancelled' ? 'bg-amber-100 text-amber-700'  :
                              u.subscription_status === 'past_due'  ? 'bg-red-100 text-red-700'      :
                              'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {u.subscription_status === 'cancelled' ? 'lapsing' : u.subscription_status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EmailChooser email={u.email} subject="Hi from HR Outreach Tracker" body={`Hi ${u.name},\n\n`} label="Email" size="xs" />
                        {!isMe && (
                          <button onClick={() => setResetTarget(u)}
                            className="text-xs text-amber-600 hover:text-amber-800 border border-amber-200 rounded-sm px-2 py-1 hover:bg-amber-50 transition font-medium">
                            Reset PW
                          </button>
                        )}
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

// ── Data Management Section ────────────────────────────────────────────────
function DataManagementSection() {
  const [purge,    setPurge]    = useState({ enabled: true, retention_days: 30, last_purge: null });
  const [ghCfg,    setGhCfg]    = useState({ enabled: false, token: '', owner: '', repo: '', retention_days: 30 });
  const [ghStatus, setGhStatus] = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [running,  setRunning]  = useState(false);
  const [purging,  setPurging]  = useState(false);
  const [jobStats, setJobStats] = useState(null);
  const [throttleMs, setThrottleMs] = useState(1000);
  const [savingThrottle, setSavingThrottle] = useState(false);

  useEffect(() => {
    api.get('/github-backup/status').then(s => {
      setGhStatus(s);
      setGhCfg(c => ({ ...c, enabled: s.enabled, retention_days: s.retention_days }));
    }).catch(() => {});
    api.get('/github-backup/config').then(c => {
      setGhCfg(prev => ({ ...prev, ...c }));
    }).catch(() => {});
    api.get('/scraped-jobs/stats').then(setJobStats).catch(() => {});
    api.get('/settings').then(s => setThrottleMs(parseInt(s.send_throttle_ms) || 1000)).catch(() => {});
  }, []);

  async function saveThrottle() {
    setSavingThrottle(true);
    try {
      await api.put('/settings', { send_throttle_ms: throttleMs });
      toast.success('Send throttle saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setSavingThrottle(false); }
  }

  async function savePurgeConfig() {
    setSaving(true);
    try {
      await api.post('/scraped-jobs/purge', { retention_days: purge.retention_days });
      toast.success(`Purged jobs older than ${purge.retention_days} days`);
      api.get('/scraped-jobs/stats').then(setJobStats).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.error || 'Purge failed');
    } finally { setSaving(false); }
  }

  async function saveGhConfig() {
    setSaving(true);
    try {
      await api.put('/github-backup/config', ghCfg);
      toast.success('GitHub backup config saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  async function runBackup() {
    setRunning(true);
    try {
      const r = await api.post('/github-backup/run');
      toast.success(`Backup complete! ${r.uploaded} file(s) pushed, ${r.purgedJobs} jobs purged`);
      api.get('/github-backup/status').then(setGhStatus).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.error || 'Backup failed');
    } finally { setRunning(false); }
  }

  return (
    <div className="space-y-6">
      {/* Job Stats */}
      {jobStats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Jobs in DB', value: jobStats.total,  color: 'blue'   },
            { label: 'Last 30 days',     value: jobStats.last30, color: 'green'  },
            { label: 'Last 7 days',      value: jobStats.last7,  color: 'purple' },
          ].map(s => (
            <div key={s.label} className={`bg-${s.color}-50 border border-${s.color}-100 rounded-md p-4 text-center`}>
              <p className={`text-2xl font-black text-${s.color}-700`}>{s.value.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Email send throttle */}
      <div className="bg-white border rounded-md p-5 space-y-3">
        <h3 className="font-bold text-gray-800">Email Send Throttle</h3>
        <p className="text-sm text-gray-500">Base delay between emails in a batch send, across all users. A random 0–50% jitter is added on top so the gap isn't a fixed, fingerprintable interval.</p>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Base delay (ms)</label>
            <input
              type="number"
              min="200" max="10000" step="100"
              value={throttleMs}
              onChange={e => setThrottleMs(parseInt(e.target.value) || 1000)}
              className="w-32 border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
          </div>
          <button onClick={saveThrottle} disabled={savingThrottle}
            className="px-4 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition">
            {savingThrottle ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Purge Config */}
      <div className="bg-white border rounded-md p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">Data Retention &amp; Purge</h3>
        <p className="text-sm text-gray-500">Scraped jobs older than the retention window are purged from the database. Data is pushed to GitHub backup before deletion if configured.</p>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Retention (days)</label>
            <input
              type="number"
              min="1" max="365"
              value={purge.retention_days}
              onChange={e => setPurge(p => ({ ...p, retention_days: parseInt(e.target.value) || 30 }))}
              className="w-28 border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={purge.enabled}
              onChange={e => setPurge(p => ({ ...p, enabled: e.target.checked }))}
              className="rounded"
            />
            Auto-purge enabled (runs daily)
          </label>
          <button
            onClick={savePurgeConfig}
            disabled={saving}
            className="px-5 py-2 bg-red-600 text-white rounded-sm text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors pb-2"
          >
            {saving ? 'Purging…' : `Purge Now (>${purge.retention_days}d)`}
          </button>
        </div>
        {ghStatus?.jobs_to_purge > 0 && (
          <p className="text-xs text-orange-600 font-medium">
            ⚠️ {ghStatus.jobs_to_purge} jobs are eligible for purge (older than {purge.retention_days} days)
          </p>
        )}
      </div>

      {/* GitHub Backup Config */}
      <div className="bg-white border rounded-md p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.4.6.1.82-.26.82-.58v-2.17c-3.34.72-4.04-1.6-4.04-1.6-.54-1.38-1.33-1.75-1.33-1.75-1.08-.74.08-.72.08-.72 1.2.08 1.83 1.23 1.83 1.23 1.06 1.82 2.78 1.3 3.46.99.1-.77.42-1.3.76-1.6-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.82.57C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub Backup
        </h3>
        <p className="text-sm text-gray-500">Push daily snapshots and archived job data to a GitHub repository. Daily snapshots are saved to <code className="bg-gray-100 px-1 rounded">snapshots/</code>, archived data to <code className="bg-gray-100 px-1 rounded">backup/</code>.</p>

        {ghStatus?.last_backup && (
          <p className="text-xs text-green-600 font-medium">✅ Last backup: {new Date(ghStatus.last_backup).toLocaleString()}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">GitHub Token (PAT)</label>
            <input
              type="password"
              placeholder={ghCfg.token ? '***configured***' : 'ghp_xxxx…'}
              value={ghCfg.token === '***configured***' ? '' : (ghCfg.token || '')}
              onChange={e => setGhCfg(c => ({ ...c, token: e.target.value }))}
              className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
            <p className="text-xs text-gray-400 mt-0.5">Needs repo write access</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">GitHub Owner</label>
            <input
              type="text"
              placeholder="your-username"
              value={ghCfg.owner || ''}
              onChange={e => setGhCfg(c => ({ ...c, owner: e.target.value }))}
              className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Repository Name</label>
            <input
              type="text"
              placeholder="hr-outreach-data-backup"
              value={ghCfg.repo || ''}
              onChange={e => setGhCfg(c => ({ ...c, repo: e.target.value }))}
              className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Data retention for backup (days)</label>
            <input
              type="number" min="7" max="365"
              value={ghCfg.retention_days || 30}
              onChange={e => setGhCfg(c => ({ ...c, retention_days: parseInt(e.target.value) || 30 }))}
              className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={!!ghCfg.enabled}
            onChange={e => setGhCfg(c => ({ ...c, enabled: e.target.checked }))}
            className="rounded"
          />
          Enable daily automatic backup to GitHub
        </label>

        <div className="flex gap-3 pt-2">
          <button
            onClick={saveGhConfig}
            disabled={saving}
            className="px-5 py-2 bg-gray-900 text-white rounded-sm text-sm font-semibold hover:bg-gray-800 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Config'}
          </button>
          <button
            onClick={runBackup}
            disabled={running || !ghStatus?.configured}
            className="px-5 py-2 bg-green-600 text-white rounded-sm text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors"
            title={!ghStatus?.configured ? 'Configure GitHub settings first' : ''}
          >
            {running ? 'Backing up…' : 'Run Backup Now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Referrals Section (configurable per-pair limit + reset) ────────────────
function ReferralsSection() {
  const [limit,     setLimit]     = useState(2);
  const [savedLimit, setSavedLimit] = useState(2);
  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/admin/referral-settings'),
      api.get('/admin/referrals'),
    ]).then(([s, r]) => {
      setLimit(s?.limit || 2);
      setSavedLimit(s?.limit || 2);
      setRows(Array.isArray(r) ? r : []);
    }).catch(() => toast.error('Failed to load referral data')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveLimit() {
    setSaving(true);
    try {
      const r = await api.put('/admin/referral-settings', { limit });
      setSavedLimit(r.limit);
      toast.success(`Referral limit set to ${r.limit} per person`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save limit');
    } finally { setSaving(false); }
  }

  async function resetPair(fromUserId, toUserId, fromName, toName) {
    if (!await confirm(`Reset referral request count from "${fromName}" to "${toName}"? They'll be able to request again.`)) return;
    try {
      await api.delete(`/admin/referrals/${fromUserId}/${toUserId}`);
      setRows(rs => rs.filter(r => !(r.from_user_id === fromUserId && r.to_user_id === toUserId)));
      toast.success('Reset — they can send referral requests to this person again');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    }
  }

  if (loading) return <div className="flex items-center justify-center h-32"><p className="text-sm text-gray-400 animate-pulse">Loading referral data…</p></div>;

  return (
    <div className="space-y-6">
      {/* Global limit */}
      <div className="bg-white border rounded-md p-5 space-y-3">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">Referral Request Limit</h3>
        <p className="text-sm text-gray-500">
          How many times a user can request a referral from the <em>same</em> community member before being blocked.
          Currently <strong>{savedLimit}</strong> per pair.
        </p>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Max requests per person</label>
            <input
              type="number" min="1" max="100"
              value={limit}
              onChange={e => setLimit(parseInt(e.target.value) || 1)}
              className="w-28 border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
          </div>
          <button
            onClick={saveLimit}
            disabled={saving || limit === savedLimit}
            className="px-5 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Per-pair usage + reset */}
      <div className="bg-white border rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h3 className="font-bold text-gray-800">Requests Sent</h3>
          <p className="text-xs text-gray-500 mt-0.5">Reset a pair to let that user request a referral from that person again, even past the limit.</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No referral requests sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-5 py-3">From</th>
                  <th className="text-left px-4 py-3">To</th>
                  <th className="text-left px-4 py-3">Count</th>
                  <th className="text-left px-4 py-3">Last Sent</th>
                  <th className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={`${r.from_user_id}-${r.to_user_id}`} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{r.from_name}</p>
                      <p className="text-xs text-gray-400">{r.from_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{r.to_name}</p>
                      <p className="text-xs text-gray-400">{r.to_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${parseInt(r.request_count) >= savedLimit ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.request_count} / {savedLimit}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.last_sent_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => resetPair(r.from_user_id, r.to_user_id, r.from_name, r.to_name)}
                        className="text-xs text-amber-600 hover:text-amber-800 border border-amber-200 rounded-sm px-2 py-1 hover:bg-amber-50 transition font-medium"
                      >
                        Reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Job Scraper Section (multi-platform daily scraper, admin-only manual trigger) ──
function ScraperSection() {
  const [showConfig,   setShowConfig]   = useState(false);
  const [feedRunning,  setFeedRunning]  = useState(false);
  const [feedLogs,     setFeedLogs]     = useState([]);
  const [showFeedLogs, setShowFeedLogs] = useState(false);
  const [queries,      setQueries]      = useState([]);
  const logsEndRef = useRef(null);

  useEffect(() => {
    api.get('/apify/settings').then(s => setQueries(s.searchQueries || [])).catch(() => {});
  }, [showConfig]);

  useEffect(() => {
    if (showFeedLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feedLogs]);

  async function runFeedScraperNow() {
    setFeedRunning(true);
    setFeedLogs([]);
    setShowFeedLogs(true);
    try {
      const resp = await fetch(`${API_ROOT}/api/scraper/run`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('hr_token')}`,
        },
        body: JSON.stringify({ scraper: 'linkedin-feed', titles: queries, limit: 25 }),
      });

      if (!resp.ok) {
        notifyIfUnauthorized(resp.status);
        let msg = `Scraper error (${resp.status})`;
        try { const d = await resp.json(); msg = d.error || msg; } catch {}
        setFeedLogs(prev => [...prev, { type: 'err', text: msg }]);
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
              setFeedLogs(prev => [...prev, { type: msg.type, text: msg.data }]);
            } else if (msg.type === 'done') {
              if (msg.data.code === 0) toast.success(`LinkedIn feed scrape complete — ${msg.data.stored || 0} jobs stored`);
              else toast.error('Scraper exited with errors — check logs');
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error('Scraper failed: ' + err.message);
    } finally {
      setFeedRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-md p-5 space-y-4">
        <div>
          <h3 className="font-bold text-gray-800 flex items-center gap-2">Job Scraper</h3>
          <p className="text-sm text-gray-500 mt-1">
            Every morning at <strong>7:00 AM IST</strong>, the tracker automatically scrapes jobs across all configured role queries from:
            <strong> Naukri.com</strong>, <strong>LinkedIn Jobs &amp; Feed</strong>, <strong>Internshala</strong>, <strong>Instahyre</strong>, <strong>Foundit</strong>,
            <strong> Arbeitnow</strong>, <strong>RemoteOK</strong>, <strong>We Work Remotely</strong>, <strong>Remotive</strong>,
            and <strong>Jora</strong> (AU/SG/HK/ID/MY/NZ).
            After scraping, the <strong>Job Intel Pipeline</strong> automatically extracts HR emails and syncs them to your HR List and Job Intel Contacts within minutes.
            Manually trigger the LinkedIn Feed scraper below for an immediate refresh.
          </p>
        </div>

        {queries.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {queries.map(q => (
              <span key={q} className="text-xs bg-gray-100 text-gray-600 border rounded-full px-2.5 py-1">{q}</span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            onClick={() => setShowConfig(true)}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-sm text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            <Settings size={14} /> Edit Job Keywords
          </button>
          <button
            onClick={runFeedScraperNow}
            disabled={feedRunning}
            className="px-4 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {feedRunning ? 'Running…' : 'Scrape Now (LinkedIn Feed)'}
          </button>
        </div>

        {showFeedLogs && (
          <div className="bg-gray-900 rounded-sm border border-gray-700 p-4 space-y-1 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400">LinkedIn Feed Scraper Output</span>
              <button onClick={() => setShowFeedLogs(false)} className="text-gray-500 hover:text-gray-300 text-xs">Hide</button>
            </div>
            {feedLogs.map((l, i) => (
              <p key={i} className={`text-xs font-mono whitespace-pre-wrap ${l.type === 'err' ? 'text-red-400' : 'text-green-300'}`}>{l.text}</p>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {showConfig && (
        <ApifySettingsModal onClose={() => setShowConfig(false)} onSaved={() => setShowConfig(false)} />
      )}
    </div>
  );
}

// ── Job Intel Pipeline Config Section ─────────────────────────────────────
function JobIntelConfigSection() {
  const [cfg,          setCfg]          = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [running,      setRunning]      = useState(false);
  const [fullRun,      setFullRun]      = useState(false);
  const [runs,         setRuns]         = useState([]);
  const [runMsg,       setRunMsg]       = useState('');
  const [proxyList,    setProxyList]    = useState('');
  const [savingProxy,  setSavingProxy]  = useState(false);
  const [antiBotStatus, setAntiBotStatus] = useState(null);
  const [health,       setHealth]       = useState(null); // { report: {findings, snapshot}, sources: {} }
  const [autoProxy,    setAutoProxy]    = useState(null); // { config, lastRefresh, count, stats }
  const [proxyBusy,    setProxyBusy]    = useState(false);

  const loadAutoProxy = () => api.get('/job-intel/proxy-auto').then(setAutoProxy).catch(() => {});

  const loadHealth = () => api.get('/job-intel/health').then(setHealth).catch(() => {});

  useEffect(() => {
    api.get('/job-intel/config').then(r => setCfg(r)).catch(() => {});
    api.get('/job-intel/runs').then(r => setRuns(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/settings').then(s => {
      setProxyList(s.proxy_list || '');
      try { setAntiBotStatus(JSON.parse(s.antibot_status || 'null')); } catch {}
    }).catch(() => {});
    loadAutoProxy();
    loadHealth();
  }, []);

  async function toggleSource(source, disabled) {
    try {
      await api.patch(`/job-intel/health/sources/${encodeURIComponent(source)}`, { disabled });
      toast.success(disabled ? `${source} disabled` : `${source} re-enabled`);
      loadHealth();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  }

  async function toggleAutoProxy(enabled) {
    setProxyBusy(true);
    try { const r = await api.put('/job-intel/proxy-auto', { enabled }); setAutoProxy(a => ({ ...a, config: r.config })); toast.success(`Auto-proxy ${enabled ? 'enabled' : 'disabled'}`); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setProxyBusy(false); }
  }

  async function saveWebshareKey(key) {
    try { const r = await api.put('/job-intel/proxy-auto', { webshareApiKey: key }); setAutoProxy(a => ({ ...a, config: r.config })); toast.success('Saved'); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  async function refreshAutoProxy() {
    setProxyBusy(true);
    toast.loading('Fetching + validating proxies…', { id: 'apx' });
    try {
      const r = await api.post('/job-intel/proxy-auto/refresh');
      setAutoProxy(a => ({ ...a, lastRefresh: r.lastRefresh, count: r.count, stats: r.stats }));
      toast.success(`${r.count} live proxies validated (of ${r.stats?.tested || 0} tested)`, { id: 'apx' });
    } catch (e) { toast.error(e.response?.data?.error || 'Refresh failed', { id: 'apx' }); }
    finally { setProxyBusy(false); }
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      await api.put('/job-intel/config', cfg);
      toast.success('Pipeline config saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  async function saveProxy() {
    setSavingProxy(true);
    try {
      await api.put('/settings', { proxy_list: proxyList });
      toast.success('Proxy list saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    } finally { setSavingProxy(false); }
  }

  async function triggerRun() {
    setRunning(true);
    setRunMsg('');
    try {
      await api.post('/job-intel/run');
      setRunMsg('Pipeline started — check run history below in ~1-2 min.');
      setTimeout(() => api.get('/job-intel/runs').then(r => setRuns(Array.isArray(r) ? r : [])).catch(() => {}), 5000);
    } catch (e) {
      setRunMsg(e.response?.data?.error || 'Failed to start');
    } finally { setRunning(false); }
  }

  async function triggerFullRun() {
    setFullRun(true);
    setRunMsg('');
    try {
      await api.post('/job-intel/run-full');
      setRunMsg('LinkedIn Feed scraping started — pipeline runs after. New contacts appear in ~5 min. Check run history below.');
      setTimeout(() => api.get('/job-intel/runs').then(r => setRuns(Array.isArray(r) ? r : [])).catch(() => {}), 10000);
    } catch (e) {
      setRunMsg(e.response?.data?.error || 'Failed to start full run');
    } finally { setFullRun(false); }
  }

  function setField(key, val) {
    setCfg(c => ({ ...c, [key]: val }));
  }
  function setListField(key, val) {
    setCfg(c => ({ ...c, [key]: val.split('\n').map(s => s.trim()).filter(Boolean) }));
  }
  async function loadRecommendedCompanies() {
    try {
      const r = await api.get('/job-intel/default-companies');
      setCfg(c => ({ ...c, greenhouse_companies: r.greenhouse || [], lever_companies: r.lever || [] }));
      toast.success(`Loaded ${(r.greenhouse?.length || 0) + (r.lever?.length || 0)} live-verified companies — click Save Config to apply`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to load recommended companies');
    }
  }
  async function loadRecommendedKeywords() {
    try {
      const r = await api.get('/job-intel/default-keywords');
      setCfg(c => ({ ...c, keywords: r.keywords || [] }));
      toast.success(`Loaded ${r.keywords?.length || 0} recommended keywords — click Save Config to apply`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to load recommended list');
    }
  }

  if (!cfg) return <div className="p-6 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="bg-white border border-gray-200 rounded-md p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Zap size={16} className="text-brand-600" /> Job Intelligence Pipeline</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Every run: (1) scrapes LinkedIn Feed live with your configured keywords (100 posts/keyword) to get fresh HR emails, then (2) processes Arbeitnow, Remotive, RemoteOK, We Work Remotely and other APIs. Takes 5-20 min per run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            cfg.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {cfg.enabled ? <><CheckCircle size={11} /> Enabled</> : 'Disabled'}
          </span>
        </div>
      </div>

      {/* Enable + frequency */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!cfg.enabled} onChange={e => setField('enabled', e.target.checked)}
            className="w-4 h-4 accent-brand-600" />
          <span className="text-sm font-medium text-gray-700">Enable pipeline</span>
        </label>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Run every (hours)</label>
          <input type="number" min={1} max={24} value={cfg.run_every_hours || 6}
            onChange={e => setField('run_every_hours', parseInt(e.target.value) || 6)}
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
      </div>

      {/* Keywords */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-600">Job keywords / titles (one per line)</label>
          <button type="button" onClick={loadRecommendedKeywords}
            className="text-[11px] font-medium text-brand-600 hover:text-brand-700 hover:underline">
            Load recommended list (340+ roles)
          </button>
        </div>
        <textarea rows={4} value={(cfg.keywords || []).join('\n')}
          onChange={e => setListField('keywords', e.target.value)}
          placeholder="Backend Developer&#10;Node.js Developer&#10;Java Developer&#10;React Developer"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono" />
        <p className="text-[11px] text-gray-400 mt-1">
          {(cfg.keywords || []).length} keyword{(cfg.keywords || []).length === 1 ? '' : 's'} configured — used for LinkedIn Feed / Adzuna / Jooble searches (rotated a window per run) + the relevance filter + LLM classification target
        </p>
      </div>

      {/* Locations */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Target locations (one per line)</label>
        <textarea rows={2} value={(cfg.locations || []).join('\n')}
          onChange={e => setListField('locations', e.target.value)}
          placeholder="India&#10;Remote"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono" />
      </div>

      {/* Greenhouse companies */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-600">Greenhouse company slugs (one per line)</label>
          <button type="button" onClick={loadRecommendedCompanies}
            className="text-[11px] font-medium text-brand-600 hover:text-brand-700 hover:underline">
            Load recommended companies (live-verified)
          </button>
        </div>
        <textarea rows={3} value={(cfg.greenhouse_companies || []).join('\n')}
          onChange={e => setListField('greenhouse_companies', e.target.value)}
          placeholder="google&#10;meta&#10;stripe&#10;airbnb"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono" />
        <p className="text-[11px] text-gray-400 mt-1">From: boards-api.greenhouse.io/v1/boards/<strong>{'<slug>'}</strong>/jobs</p>
      </div>

      {/* Lever companies */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Lever company slugs (one per line)</label>
        <textarea rows={3} value={(cfg.lever_companies || []).join('\n')}
          onChange={e => setListField('lever_companies', e.target.value)}
          placeholder="netflix&#10;shopify&#10;discord"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono" />
        <p className="text-[11px] text-gray-400 mt-1">From: api.lever.co/v0/postings/<strong>{'<slug>'}</strong> — "Load recommended companies" above fills both Greenhouse and Lever</p>
      </div>

      {/* Adzuna */}
      <div className="border border-gray-100 rounded-md p-3 space-y-2">
        <p className="text-xs font-medium text-gray-600">Adzuna API <span className="text-gray-400 font-normal">(optional — get free key at developer.adzuna.com)</span></p>
        <div className="grid grid-cols-2 gap-2">
          <input value={cfg.adzuna_app_id || ''} onChange={e => setField('adzuna_app_id', e.target.value)}
            placeholder="App ID"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500" />
          <input value={cfg.adzuna_key || ''} onChange={e => setField('adzuna_key', e.target.value)}
            placeholder="App Key"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
      </div>

      {/* Jooble */}
      <div className="border border-gray-100 rounded-md p-3">
        <p className="text-xs font-medium text-gray-600 mb-2">Jooble API <span className="text-gray-400 font-normal">(optional — free key at jooble.org/api/contacts)</span></p>
        <input value={cfg.jooble_key || ''} onChange={e => setField('jooble_key', e.target.value)}
          placeholder="Jooble API key"
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500" />
      </div>

      {/* Classification */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={cfg.classify !== false} onChange={e => setField('classify', e.target.checked)}
          className="w-4 h-4 accent-brand-600" />
        <div>
          <span className="text-sm font-medium text-gray-700">Enable LLM classification</span>
          <p className="text-[11px] text-gray-400">Uses Groq (same key as VartaBot) to score relevance. Requires VartaBot key to be set.</p>
        </div>
      </label>

      {/* Proxy rotation */}
      <div className="border border-gray-100 rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-700">Proxy / IP Rotation</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              One proxy URL per line. Activated automatically when Google + DDG block your IP.
              Formats: <code className="bg-gray-100 px-1 rounded">http://user:pass@host:port</code> or <code className="bg-gray-100 px-1 rounded">socks5://host:port</code>
            </p>
          </div>
          {antiBotStatus && (
            <span className={`ml-3 shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold ${
              antiBotStatus.status === 'ok'              ? 'bg-green-100 text-green-700' :
              antiBotStatus.status === 'low_yield'       ? 'bg-amber-100 text-amber-700' :
              antiBotStatus.status === 'proxy_pool_dead' ? 'bg-red-100 text-red-600'    :
                                                          'bg-gray-100 text-gray-500'
            }`}>
              {antiBotStatus.status === 'ok'              && <><CheckCircle size={11} /> Scraper OK</>}
              {antiBotStatus.status === 'low_yield'       && <>&#9888; Low yield — possible IP block</>}
              {antiBotStatus.status === 'proxy_pool_dead' && <>&#9888; All proxies dead</>}
            </span>
          )}
        </div>
        <textarea
          rows={4}
          value={proxyList}
          onChange={e => setProxyList(e.target.value)}
          placeholder={'http://user:pass@proxy1.example.com:8080\nsocks5://proxy2.example.com:1080\nhttp://proxy3.example.com:3128'}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
        />
        {antiBotStatus?.status === 'low_yield' && antiBotStatus.message && (
          <p className="text-[11px] text-amber-600">{antiBotStatus.message}</p>
        )}
        <button onClick={saveProxy} disabled={savingProxy}
          className="px-3 py-1.5 text-xs font-semibold bg-gray-700 text-white rounded-md hover:bg-gray-800 disabled:opacity-50">
          {savingProxy ? 'Saving…' : 'Save Proxy List'}
        </button>
      </div>

      {/* Pipeline self-healing: findings from the last run + per-source status */}
      <div className="border border-gray-100 rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-700">Pipeline Health</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Auto-checked after every run — a source failing 6 runs in a row is auto-disabled (reversible below); repeated proxy/yield problems auto-trigger a proxy refresh.
            </p>
          </div>
          <button onClick={loadHealth} className="text-[11px] text-brand-600 hover:underline shrink-0">Refresh</button>
        </div>

        {health?.syncError && (
          <div className="text-[11px] px-2 py-1.5 rounded bg-red-50 text-red-700 border border-red-200">
            <span className="font-bold uppercase">Contact sync failing</span> — {health.syncError.message} (since {health.syncError.ts?.slice(0, 16)}). New Job Intel contacts are NOT being added until this is fixed.
          </div>
        )}

        {health?.report?.findings?.length ? (
          <ul className="space-y-1">
            {health.report.findings.map((f, i) => (
              <li key={i} className={`text-[11px] px-2 py-1 rounded flex items-start gap-1.5 ${
                f.severity === 'critical' ? 'bg-red-50 text-red-700' :
                f.severity === 'warn'     ? 'bg-amber-50 text-amber-700' :
                                             'bg-gray-50 text-gray-600'
              }`}>
                <span className="font-bold uppercase shrink-0">{f.severity}</span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-gray-400">No issues found in the last run.</p>
        )}

        {health?.sources && Object.keys(health.sources).filter(s => !s.startsWith('_')).length > 0 && (
          <div className="pt-1 border-t border-gray-100">
            <p className="text-[11px] font-medium text-gray-500 mb-1">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(health.sources).filter(([s]) => !s.startsWith('_')).map(([source, s]) => (
                <button
                  key={source}
                  onClick={() => toggleSource(source, !s.disabled)}
                  title={s.disabled ? `Disabled — ${s.lastError || 'repeated failures'}. Click to re-enable.` : (s.consecutiveFailures ? `${s.consecutiveFailures} consecutive failure(s)` : 'Healthy')}
                  className={`px-2 py-1 rounded-full text-[10px] font-medium ${
                    s.disabled ? 'bg-red-100 text-red-700' :
                    s.consecutiveFailures >= 3 ? 'bg-amber-100 text-amber-700' :
                                                  'bg-green-100 text-green-700'
                  }`}
                >
                  {source} {s.disabled ? '(disabled — click to re-enable)' : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Auto-proxy — fetch + validate free proxies automatically */}
      <div className="border border-brand-100 bg-brand-50/40 rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-700">Auto Proxy Pool <span className="text-[10px] font-normal text-brand-600">(free, self-updating)</span></p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Fetches thousands of proxies from free sources (ProxyScrape, Geonode, GitHub lists),
              validates the live ones, and rotates them automatically. Merged with your manual list above and
              used by <strong>both the Job Intel pipeline and the Job Scraper</strong> (HTTP sources rotate per-request
              with a direct fallback; browser sources use one live proxy per run).
            </p>
          </div>
          <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer">
            <input type="checkbox" className="sr-only peer" disabled={proxyBusy}
              checked={!!autoProxy?.config?.enabled}
              onChange={e => toggleAutoProxy(e.target.checked)} />
            <span className="w-9 h-5 bg-gray-300 peer-checked:bg-brand-600 rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-4" />
            <span className="text-[11px] font-medium text-gray-600">{autoProxy?.config?.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
          <span><strong className="text-gray-800">{autoProxy?.count ?? 0}</strong> live in pool</span>
          {autoProxy?.stats && <span>· {autoProxy.stats.validated}/{autoProxy.stats.tested} validated of {autoProxy.stats.totalFetched} fetched</span>}
          {autoProxy?.lastRefresh && <span>· updated {String(autoProxy.lastRefresh).slice(0, 16)}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={refreshAutoProxy} disabled={proxyBusy}
            className="px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50">
            {proxyBusy ? 'Working…' : 'Refresh pool now'}
          </button>
          <input
            type="password"
            defaultValue={autoProxy?.config?.webshareApiKey || ''}
            placeholder="Optional: Webshare API key (free tier — more reliable)"
            onBlur={e => { if (e.target.value !== (autoProxy?.config?.webshareApiKey || '')) saveWebshareKey(e.target.value); }}
            className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
          />
        </div>
        <p className="text-[10px] text-gray-400">
          Free proxies are inherently unstable — validation + frequent refresh keeps yield up, but a Webshare key or an official search API is far more reliable.
        </p>
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Config'}
        </button>
        <button onClick={triggerRun} disabled={running || fullRun}
          title="Scrapes LinkedIn Feed with your keywords (100/keyword), then extracts HR contacts from all new posts. Takes 5-20 min."
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50">
          <Play size={13} /> {running ? 'Scraping + Extracting…' : 'Run Pipeline (Scrape + Extract)'}
        </button>
        <button onClick={triggerFullRun} disabled={running || fullRun}
          title="Same as Run Pipeline — scrapes LinkedIn Feed fresh then extracts HR contacts"
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-purple-300 text-purple-700 rounded-md hover:bg-purple-50 disabled:opacity-50">
          <Zap size={13} /> {fullRun ? 'Running…' : 'Full Refresh'}
        </button>
      </div>
      {runMsg && <p className="text-xs text-purple-700 font-medium mt-1">{runMsg}</p>}

      {/* Run history */}
      {runs.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-2">Recent Runs</h4>
          <div className="space-y-1">
            {runs.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center gap-3 text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded">
                <span className={`font-medium ${r.status === 'success' ? 'text-green-600' : r.status === 'running' ? 'text-blue-600' : 'text-red-500'}`}>{r.status}</span>
                <span>{r.started_at?.slice(0, 16)}</span>
                <span className="text-gray-400">→ <span className="text-green-700 font-medium">{r.total_new || 0} truly new</span> / {r.total_fetched || 0} scanned</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── VartaBot AI Config Section ────────────────────────────────────────────
function VartaBotSection() {
  const [config,   setConfig]   = useState(null);
  const [apiKey,   setApiKey]   = useState('');
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showKey,  setShowKey]  = useState(false);

  useEffect(() => {
    api.get('/chatbot/ai-config').then(setConfig).catch(() => {});
  }, []);

  async function saveKey() {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await api.put('/chatbot/ai-config', { apiKey });
      setConfig(c => ({ ...c, ...res }));
      setApiKey('');
      toast.success(res.configured ? `Groq key saved (${res.maskedKey})` : 'Groq key removed');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save key');
    } finally { setSaving(false); }
  }

  async function testGroq() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/chatbot/ai-config/test');
      setTestResult({ ok: true, msg: `${res.reply} (model: ${res.model})` });
    } catch (e) {
      setTestResult({ ok: false, msg: e?.response?.data?.error || 'Test failed' });
    } finally { setTesting(false); }
  }

  return (
    <div className="bg-white border rounded-md p-5 space-y-5">
      <div>
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Bot size={16} /> VartaBot AI Configuration</h3>
        <p className="text-sm text-gray-500 mt-1">
          Set the Groq API key that powers VartaBot. The environment variable <code className="bg-gray-100 px-1 rounded text-xs">GROQ_API_KEY</code> takes priority; this DB setting is the fallback used when the env var is absent.
        </p>
      </div>

      {/* Status */}
      <div className={`flex items-center gap-3 p-3 rounded-md border ${config?.configured ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${config?.configured ? 'bg-green-500' : 'bg-red-500'}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${config?.configured ? 'text-green-800' : 'text-red-800'}`}>
            {config?.configured ? 'VartaBot is configured' : 'VartaBot is not configured'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {config
              ? config.configured
                ? `Source: ${config.source === 'env' ? 'environment variable' : 'database'} · Key: ${config.maskedKey} · Model: ${config.model}`
                : 'No Groq API key found in env or database'
              : 'Loading…'}
          </p>
        </div>
        {config?.configured && (
          <button
            onClick={testGroq}
            disabled={testing}
            className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60 transition"
          >
            {testing ? 'Testing…' : 'Test Now'}
          </button>
        )}
      </div>

      {testResult && (
        <div className={`text-xs p-2.5 rounded border ${testResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
        </div>
      )}

      {/* Key input */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-gray-600 block">
          {config?.source === 'env' ? 'Override with DB key (optional — env var is already active)' : 'Set Groq API Key'}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="gsk_…"
              className="w-full border rounded-sm px-3 py-2 text-sm pr-10 focus:ring-2 focus:ring-brand-300 outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={saveKey}
            disabled={saving || !apiKey.trim()}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 disabled:opacity-60 transition"
          >
            {saving ? 'Saving…' : 'Save Key'}
          </button>
          {config?.source === 'database' && (
            <button
              onClick={() => { setApiKey(''); api.put('/chatbot/ai-config', { apiKey: '' }).then(() => setConfig(c => ({ ...c, configured: false, source: 'none', maskedKey: null }))); }}
              className="px-3 py-2 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-sm transition"
            >
              Remove
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-400">
          Get a free API key at <span className="font-medium text-gray-600">console.groq.com</span> → API Keys → Create new key
        </p>
      </div>
    </div>
  );
}

// ── System Logs Section ────────────────────────────────────────────────────
const LEVEL_META = {
  error: { label: 'Error', color: 'text-red-600',    bg: 'bg-red-50 border-red-200',   Icon: XCircle },
  warn:  { label: 'Warn',  color: 'text-amber-600',  bg: 'bg-amber-50 border-amber-200', Icon: AlertTriangle },
  info:  { label: 'Info',  color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200',  Icon: Info },
  debug: { label: 'Debug', color: 'text-gray-500',   bg: 'bg-gray-50 border-gray-200',  Icon: Info },
};

function LogsSection() {
  const [logs, setLogs]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [level, setLevel]       = useState('');
  const [since, setSince]       = useState('24h');
  const [search, setSearch]     = useState('');
  const [offset, setOffset]     = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState({});
  const LIMIT = 100;

  const fetchLogs = useCallback(async (resetOffset = false) => {
    setLoading(true);
    try {
      const off = resetOffset ? 0 : offset;
      if (resetOffset) setOffset(0);
      const params = new URLSearchParams({ limit: LIMIT, offset: off, since });
      if (level) params.set('level', level);
      if (search.trim()) params.set('search', search.trim());
      const res = await api.get(`/admin/logs?${params}`);
      setLogs(res.data.logs || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      toast.error('Failed to load logs: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [level, since, search, offset]);

  useEffect(() => { fetchLogs(true); }, [level, since]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => fetchLogs(true), 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchLogs]);

  async function clearOldLogs(days) {
    if (!await confirm(`Delete logs older than ${days} day(s)?`)) return;
    try {
      const res = await api.delete(`/admin/logs?days=${days}`);
      toast.success(`Deleted ${res.data.deleted} log entries`);
      fetchLogs(true);
    } catch (e) {
      toast.error('Failed to clear logs');
    }
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function parseMeta(metaStr) {
    try { return JSON.parse(metaStr); } catch { return null; }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white border rounded-md p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search message or meta…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchLogs(true)}
              className="flex-1 text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <select
            value={level}
            onChange={e => setLevel(e.target.value)}
            className="text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">All levels</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
            <option value="info">Info</option>
          </select>
          <select
            value={since}
            onChange={e => setSince(e.target.value)}
            className="text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="1h">Last 1h</option>
            <option value="6h">Last 6h</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
          </select>
          <button
            onClick={() => fetchLogs(true)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto 10s
          </label>
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => clearOldLogs(1)}
              className="text-[10px] text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1"
            >
              Clear &gt;1d
            </button>
            <button
              onClick={() => clearOldLogs(7)}
              className="text-[10px] text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1"
            >
              Clear &gt;7d
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          {total} total entries matching filters · showing {logs.length}
        </p>
      </div>

      {/* Log list */}
      <div className="space-y-1.5">
        {loading && logs.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">Loading…</div>
        )}
        {!loading && logs.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">No log entries found.</div>
        )}
        {logs.map(log => {
          const meta   = parseMeta(log.meta);
          const lm     = LEVEL_META[log.level] || LEVEL_META.info;
          const LIcon  = lm.Icon;
          const isOpen = expanded[log.id];
          const hasMeta = meta && Object.keys(meta).length > 0 && !(Object.keys(meta).length === 1 && meta.service === 'http');
          return (
            <div key={log.id} className={`border rounded text-xs ${lm.bg}`}>
              <div
                className="flex items-start gap-2 px-3 py-2 cursor-pointer select-none"
                onClick={() => hasMeta && toggleExpand(log.id)}
              >
                <LIcon size={13} className={`mt-0.5 flex-shrink-0 ${lm.color}`} />
                <span className={`font-semibold uppercase w-10 flex-shrink-0 ${lm.color}`}>{log.level}</span>
                <span className="text-gray-500 flex-shrink-0 w-36">
                  {log.created_at?.slice(0, 19).replace('T', ' ')}
                </span>
                <span className="text-gray-800 flex-1 font-mono leading-snug break-all">{log.message}</span>
                {meta?.service === 'http' && (
                  <span className="flex-shrink-0 text-gray-500">
                    {meta.method} {meta.status} {meta.ms}ms
                  </span>
                )}
                {hasMeta && (
                  <span className="flex-shrink-0 text-gray-400 text-[10px]">{isOpen ? '▲' : '▼'}</span>
                )}
              </div>
              {isOpen && hasMeta && (
                <pre className="px-3 pb-2 text-[11px] text-gray-600 whitespace-pre-wrap break-all font-mono border-t border-gray-200 pt-2">
                  {JSON.stringify(meta, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            disabled={offset === 0}
            onClick={() => { setOffset(Math.max(0, offset - LIMIT)); fetchLogs(); }}
            className="text-xs border rounded px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500">
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button
            disabled={offset + LIMIT >= total}
            onClick={() => { setOffset(offset + LIMIT); fetchLogs(); }}
            className="text-xs border rounded px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      )}
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
        <Lock size={36} className="text-gray-300" />
        <p className="text-gray-500 text-sm font-medium">Admin access required.</p>
      </div>
    );
  }

  const TABS = [
    { id: 'leads',     Icon: Inbox,      label: 'Interest Leads'       },
    { id: 'job-intel', Icon: Zap,        label: 'Job Intel Pipeline'   },
    { id: 'users',     Icon: Users,      label: 'User Management'      },
    { id: 'roles',     Icon: Shield,     label: 'Roles & Permissions'  },
    { id: 'passwords', Icon: Lock,       label: 'Password Vault'       },
    { id: 'scraper',   Icon: Search,     label: 'Job Scraper'          },
    { id: 'vartabot',  Icon: Bot,        label: 'VartaBot AI'          },
    { id: 'referrals', Icon: Handshake,  label: 'Referrals'            },
    { id: 'data',      Icon: Database,   label: 'Data & Backup'        },
    { id: 'logs',      Icon: ScrollText, label: 'System Logs'          },
  ];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="relative bg-gradient-to-br from-slate-800 via-slate-900 to-purple-950 rounded-md overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full -translate-y-1/2 translate-x-1/4" />
        </div>
        <div className="relative px-6 py-6 flex items-center gap-4">
          <div className="w-14 h-14 rounded-md bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg"><Shield size={28} className="text-white" /></div>
          <div>
            <h1 className="text-xl font-black text-white">Admin Control Centre</h1>
            <p className="text-slate-400 text-sm mt-0.5">Manage users · Reach out to leads · Control plans & permissions</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1.5 bg-gray-100 p-1 rounded-md w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-bold transition-all ${
              tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <t.Icon size={14} /><span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'leads' && <LeadsSection />}
      {tab === 'users' && <UsersSection />}
      {tab === 'roles' && (
        <div className="bg-white border rounded-md p-5">
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-800">Roles & Permissions</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Select a role on the left to view and edit its permissions. Changes take effect on the user's next request.
            </p>
          </div>
          <RolesPermissions />
        </div>
      )}
      {tab === 'passwords' && (
        <div className="bg-white border rounded-md p-5">
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-800">Password Vault — All Users</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              View all stored credentials across all users. Click "Reveal" to decrypt any password on demand.
              Passwords are encrypted with AES-256-GCM at rest.
            </p>
          </div>
          <PasswordVault isAdmin={true} />
        </div>
      )}
      {tab === 'job-intel' && <JobIntelConfigSection />}
      {tab === 'scraper'   && <ScraperSection />}
      {tab === 'vartabot'  && <VartaBotSection />}
      {tab === 'referrals' && <ReferralsSection />}
      {tab === 'data'      && <DataManagementSection />}
      {tab === 'logs'      && <LogsSection />}
    </div>
  );
}
