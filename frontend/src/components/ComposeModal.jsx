import { useState, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import EmailTemplatesModal from './EmailTemplatesModal.jsx';
import RichEditor from './RichEditor.jsx';
import AttachmentPicker from './AttachmentPicker.jsx';

const VARS = [
  { label: '{{name}}',    hint: 'Contact full name' },
  { label: '{{company}}', hint: 'Company' },
  { label: '{{title}}',   hint: 'Job title' },
  { label: '{{email}}',   hint: 'Email address' },
];

const DEFAULT_BODY =
`Hi {{name}},

I came across {{company}} and was really impressed by the work you're doing. I'm a backend developer with 4.5 years of experience in Java/Spring Boot, Kafka, and Redis — currently exploring new opportunities.

I'd love a quick 15-minute chat to explore if there's a fit. Would you be open to connecting?

Thanks for your time,
Vishal`;

const DEFAULT_SUBJECT = 'Hi {{name}}, quick question about opportunities at {{company}}';

// ── Variable chip ─────────────────────────────────────────────────────────────
function VarChip({ label, hint, onInsert }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onInsert(label); }} title={hint}
      className="px-2 py-0.5 text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 transition">
      {label}
    </button>
  );
}

// ── Preview card ──────────────────────────────────────────────────────────────
function PreviewCard({ p, index }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`border rounded-xl overflow-hidden text-sm transition-all ${p.blocked ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200 shadow-sm'}`}>
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-gray-400 text-xs font-mono shrink-0">#{index + 1}</span>
          <span className={`font-medium truncate ${p.blocked ? 'text-gray-400' : 'text-gray-800'}`}>{p.name}</span>
          <span className={`text-xs truncate ${p.blocked ? 'text-gray-400' : 'text-gray-500'}`}>&lt;{p.email}&gt;</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {p.blocked
            ? <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                p.blockType === 'hard_bounce' || p.blockType === 'flagged'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                {p.blockType === 'hard_bounce' ? '⛔' : p.blockType === 'flagged' ? '🚫' : '⚠'} {p.blockReason}
              </span>
            : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Send</span>
          }
          <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-2">
          <div><span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</span><p className="mt-0.5 text-gray-800">{p.subject}</p></div>
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Body</span>
            <div
              className="mt-0.5 text-gray-700 text-xs leading-relaxed"
              dangerouslySetInnerHTML={{ __html: p.body }}
            />
          </div>
          <div className="pt-1 border-t text-xs text-gray-400 italic">{p.footer}</div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ComposeModal({ contacts, onClose, onSent }) {
  const [step,             setStep]             = useState('compose');
  const [subject,          setSubject]          = useState(DEFAULT_SUBJECT);
  const [body,             setBody]             = useState(DEFAULT_BODY);
  const [previews,         setPreviews]         = useState([]);
  const [stats,            setStats]            = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [sending,          setSending]          = useState(false);
  const [focused,          setFocused]          = useState('body');
  const [showTemplates,    setShowTemplates]    = useState(false);
  const [quickTpls,        setQuickTpls]        = useState([]);
  const [attachment,       setAttachment]       = useState(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [profile,          setProfile]          = useState(null);

  const subjRef      = useRef(null);
  const bodyEditorRef = useRef(null);

  useEffect(() => {
    api.get('/email-templates').then(data => setQuickTpls(data.slice(0, 4))).catch(() => {});
    api.get('/profile').then(p => setProfile(p?.user_id ? p : null)).catch(() => {});
  }, []);

  function applyTemplate(t) {
    setSubject(t.subject || DEFAULT_SUBJECT);
    setBody(t.body || DEFAULT_BODY);
    toast.success(`Template applied: "${t.name}"`);
  }

  const insertVar = (v) => {
    if (focused === 'subject') {
      const el = subjRef.current;
      if (!el) return;
      const s = el.selectionStart ?? subject.length;
      const e = el.selectionEnd   ?? subject.length;
      const next = subject.slice(0, s) + v + subject.slice(e);
      setSubject(next);
      setTimeout(() => { el.selectionStart = el.selectionEnd = s + v.length; el.focus(); }, 0);
    } else {
      bodyEditorRef.current?.insertText(v);
    }
  };

  const handlePreview = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    const bodyText = body.trim().replace(/<[^>]+>/g, '').trim();
    if (!bodyText) { toast.error('Body is required'); return; }
    setLoading(true);
    try {
      const res = await api.post('/email/preview', { contactIds: contacts.map(c => c.id), subject, body });
      setPreviews(res.previews);
      setStats({ sentToday: res.sentToday, dailyCap: res.dailyCap, eligible: res.eligible });
      setStep('preview');
    } catch (err) { toast.error(err.response?.data?.error || 'Preview generation failed'); }
    finally       { setLoading(false); }
  };

  const handleSend = async () => {
    const eligible = previews.filter(p => !p.blocked);
    if (!eligible.length) { toast.error('No eligible contacts'); return; }
    if (!window.confirm(`Send ${eligible.length} email${eligible.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setSending(true);
    try {
      const payload = {
        sends: eligible.map(p => ({ contactId: p.contactId, subject: p.subject, body: p.body })),
      };
      if (attachment) {
        payload.attachment = {
          type:     attachment.type,
          vaultId:  attachment.vaultId  || null,
          filename: attachment.label    || null,
          data:     attachment.data     || null,
          mimeType: attachment.mimeType || null,
        };
      }
      const { sent, failed, results } = await api.post('/email/send', payload);
      if (sent > 0)    toast.success(`${sent} email${sent !== 1 ? 's' : ''} sent!`);
      if (failed > 0)  toast.error(`${failed} failed`);
      const bounced       = results.filter(r => r.bounced);
      const undeliverable = results.filter(r => r.deliverable === false && !r.bounced);
      if (bounced.length)       toast(`${bounced.length} bounced → marked Do Not Contact`, { icon: '⚠️' });
      if (undeliverable.length) toast.error(`${undeliverable.length} blocked — email undeliverable`);
      onSent();
    } catch (err) { toast.error(err.response?.data?.error || 'Send failed'); }
    finally       { setSending(false); }
  };

  const eligible = previews.filter(p => !p.blocked).length;

  return (
    <>
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-bold">
              {step === 'compose'
                ? `Compose — ${contacts.length} recipient${contacts.length !== 1 ? 's' : ''}`
                : 'Preview Before Sending'}
            </h2>
            {step === 'preview' && stats && (
              <p className="text-xs text-gray-500 mt-0.5">
                {stats.sentToday} of {stats.dailyCap} sent today ·{' '}
                <span className={eligible > 0 ? 'text-green-600 font-medium' : 'text-red-500'}>
                  {eligible} eligible
                </span>
                {previews.length - eligible > 0 && ` · ${previews.length - eligible} blocked`}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* ── Compose step ─────────────────────────────────────────── */}
        {step === 'compose' && (
          <div className="flex-1 overflow-y-auto">

            {/* ── Template quick-pick ───────────────────────────────── */}
            <div className="mx-5 mt-5 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📋</span>
                  <div>
                    <p className="text-sm font-bold text-indigo-800">Start with a Template</p>
                    <p className="text-xs text-indigo-500">Pick one below or browse all templates</p>
                  </div>
                </div>
                <button onClick={() => setShowTemplates(true)}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold transition whitespace-nowrap">
                  Browse All →
                </button>
              </div>
              {quickTpls.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {quickTpls.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="text-xs px-3 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-xl hover:bg-indigo-600 hover:text-white hover:border-indigo-600 font-medium transition-all shadow-sm">
                      {t.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-indigo-400">No templates yet — click "Browse All" to create one.</p>
              )}
            </div>

            {/* ── Editor area ───────────────────────────────────────── */}
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400 font-medium">Insert variable:</span>
                {VARS.map(v => <VarChip key={v.label} label={v.label} hint={v.hint} onInsert={insertVar} />)}
                <span className="text-xs text-gray-300">(click to insert at cursor)</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Subject *</label>
                <input ref={subjRef} value={subject} onChange={e => setSubject(e.target.value)}
                  onFocus={() => setFocused('subject')}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Body *</label>
                <div onFocus={() => setFocused('body')}>
                  <RichEditor
                    ref={bodyEditorRef}
                    value={body}
                    onChange={setBody}
                    minRows={11}
                  />
                </div>
              </div>

              {/* ── Attach Resume ─────────────────────────────────── */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Attach Resume (optional)</label>
                {attachment ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-sm">
                    <span className="text-blue-700 flex-1 truncate text-xs">{attachment.label}</span>
                    <button onClick={() => setAttachment(null)}
                      className="text-xs text-red-400 hover:text-red-600 shrink-0 font-medium">Remove</button>
                  </div>
                ) : (
                  <button onClick={() => setShowAttachPicker(true)}
                    className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition text-left">
                    + Attach resume — from profile, vault, or device
                  </button>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                An unsubscribe line is automatically appended to every email (configurable in SMTP Settings).
              </div>
            </div>
          </div>
        )}

        {/* ── Preview step ─────────────────────────────────────────── */}
        {step === 'preview' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {attachment && (
              <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
                Attachment: <strong>{attachment.label}</strong>
              </div>
            )}
            {previews.length === 0 && <p className="text-center py-16 text-gray-400">No previews to show</p>}
            {previews.map((p, i) => <PreviewCard key={p.contactId} p={p} index={i} />)}
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t shrink-0 flex gap-3">
          {step === 'compose' && (
            <>
              <button onClick={handlePreview} disabled={loading}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                {loading ? 'Generating previews…' : `Preview ${contacts.length} Email${contacts.length !== 1 ? 's' : ''} →`}
              </button>
              <button onClick={onClose} className="border rounded-xl px-5 py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => setStep('compose')} className="border rounded-xl px-5 py-2.5 text-sm font-medium hover:bg-gray-50 transition">← Back</button>
              <button onClick={handleSend} disabled={sending || eligible === 0}
                className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
                {sending ? 'Sending…' : eligible === 0 ? 'No eligible recipients' : `Confirm & Send ${eligible} Email${eligible !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>

    {showTemplates && (
      <EmailTemplatesModal
        mode="select"
        onClose={() => setShowTemplates(false)}
        onSelect={({ subject: s, body: b, attachment: a }) => {
          setSubject(s);
          setBody(b);
          if (a) setAttachment(a);
          setShowTemplates(false);
        }}
      />
    )}

    {showAttachPicker && (
      <AttachmentPicker
        profile={profile}
        onSelect={a => { setAttachment(a); setShowAttachPicker(false); }}
        onClose={() => setShowAttachPicker(false)}
      />
    )}
    </>
  );
}
