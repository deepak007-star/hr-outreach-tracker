/**
 * Auto-synced HR email/phone contacts for the Gmail Tracking tab.
 * Sources: LinkedIn Feed (Playwright + Apify) and Naukri job posts with contact info.
 * Refreshes every 60 s. Filter by source, status, date range, or search.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import EmailTemplatesModal from './EmailTemplatesModal.jsx';
import RichEditor from './RichEditor.jsx';
import AttachmentPicker from './AttachmentPicker.jsx';

const SINCE_OPTS = [
  { value: '7d',  label: 'Last 7 days'  },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const RECIPIENT_VARS = [
  { label: '{{name}}',    hint: 'Contact full name' },
  { label: '{{company}}', hint: 'Company' },
  { label: '{{title}}',   hint: 'Job title' },
  { label: '{{email}}',   hint: 'Email address' },
];

const PROFILE_VARS = [
  { label: '{{your_name}}',     hint: 'Your name' },
  { label: '{{current_title}}', hint: 'Your title' },
  { label: '{{experience}}',    hint: 'Years of experience' },
  { label: '{{notice_period}}', hint: 'Notice period' },
  { label: '{{location}}',      hint: 'Your location' },
  { label: '{{linkedin_url}}',  hint: 'LinkedIn URL' },
  { label: '{{phone}}',         hint: 'Your phone' },
  { label: '{{skills}}',        hint: 'Your skills' },
];

const SOURCE_TABS = [
  { id: 'all',      label: 'All Sources' },
  { id: 'linkedin', label: 'LinkedIn'    },
  { id: 'naukri',   label: 'Naukri'     },
];

const DEFAULT_SUBJECT = 'Hi {{name}}, saw your post about openings at {{company}}';
const DEFAULT_BODY =
`Hi {{name}},

I came across your recent LinkedIn post about job openings at {{company}} and I'm very interested in the opportunity.

I'm a {{current_title}} with {{experience}} of experience, specialising in {{skills}}.

I'd love a quick 15-minute chat to explore if there's a fit.

Thanks,
{{your_name}}
{{phone}} | {{linkedin_url}}`;

function buildProfileBody(profile) {
  if (!profile) return DEFAULT_BODY;
  const title  = profile.current_title    || 'professional';
  const exp    = profile.total_experience || '';
  const skills = Array.isArray(profile.skills) && profile.skills.length
    ? profile.skills.slice(0, 4).join(', ')
    : '';
  const name   = profile.full_name    || '{{your_name}}';
  const phone  = profile.phone        ? `\n${profile.phone}` : '';
  const li     = profile.linkedin_url ? `\n${profile.linkedin_url}` : '';

  return `Hi {{name}},

I came across your recent LinkedIn post about job openings at {{company}} and I'm very interested in the opportunity.

I'm a ${title}${exp ? ` with ${exp} of experience` : ''}${skills ? `, specialising in ${skills}` : ''}.

I'd love a quick 15-minute chat to explore if there's a fit.

Thanks,
${name}${phone}${li}`;
}

// Extract a best-guess first name from an email address
// e.g. vishal.baliyan@gmail.com → "Vishal", deepak12@gmail.com → "Deepak"
function guessNameFromEmail(email) {
  if (!email) return '';
  const local = email.split('@')[0];
  const first = local.split(/[.\-_+]/)[0];
  const clean = first.replace(/[^a-zA-Z]/g, '');
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

// Resolve display name: use provided name, else guess from email
function resolveName(name, email) {
  return (name || '').trim() || guessNameFromEmail(email);
}

// ─── Client-side template renderer (mirrors backend renderFeedTemplate) ────────
function renderPreview(tpl, contact, profile) {
  if (!tpl) return '';
  const p = profile || {};
  const effectiveName = resolveName(contact.name, contact.email);
  const firstName = effectiveName.split(' ')[0];
  const skillsStr = Array.isArray(p.skills) ? p.skills.join(', ') : (p.skills || '');

  function sub(text, patterns, value) {
    let r = text;
    for (const pat of patterns) r = r.replace(pat, value);
    return r;
  }

  let r = tpl;
  r = sub(r, [/\{\{name\}\}/gi, /\{name\}/gi, /\{\{HR_?[Nn]ame\}\}/g, /\{HR_?[Nn]ame\}/g,
    /\{\{[Hh]iring_?[Mm]anager\}\}/g, /\{\{[Rr]ecipient_?[Nn]ame\}\}/g,
    /\{\{[Ff]ull_?[Nn]ame\}\}/g], effectiveName);
  r = sub(r, [/\{\{[Ff]irst_?[Nn]ame\}\}/g], firstName);
  r = sub(r, [/\{\{company\}\}/gi, /\{company\}/gi, /\{\{[Cc]ompany_?[Nn]ame\}\}/g], contact.company || '');
  r = sub(r, [/\{\{title\}\}/gi, /\{title\}/gi, /\{\{role\}\}/gi, /\{\{[Pp]osition\}\}/gi], contact.title || '');
  r = sub(r, [/\{\{email\}\}/gi, /\{email\}/gi], contact.email || '');
  r = sub(r, [/\{\{your_name\}\}/gi, /\{your_name\}/gi], p.full_name || '');
  r = sub(r, [/\{\{current_title\}\}/gi, /\{current_title\}/gi], p.current_title || '');
  r = sub(r, [/\{\{experience\}\}/gi, /\{experience\}/gi], p.total_experience || '');
  r = sub(r, [/\{\{notice_period\}\}/gi, /\{notice_period\}/gi], p.notice_period || '');
  r = sub(r, [/\{\{location\}\}/gi, /\{location\}/gi], p.location || '');
  r = sub(r, [/\{\{linkedin_url\}\}/gi, /\{linkedin_url\}/gi], p.linkedin_url || '');
  r = sub(r, [/\{\{phone\}\}/gi, /\{phone\}/gi], p.phone || '');
  r = sub(r, [/\{\{skills\}\}/gi, /\{skills\}/gi], skillsStr);
  r = r.replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\{[A-Za-z_]\w*\}/g, '');
  return r;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function VarChip({ label, hint, onInsert }) {
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onInsert(label); }} title={hint}
      className="px-2 py-0.5 text-xs font-mono bg-brand-50 text-brand-700 border border-brand-200 rounded-sm hover:bg-brand-100 transition">
      {label}
    </button>
  );
}

function PreviewCard({ p, index }) {
  const [expanded, setExpanded] = useState(false);
  const isHtml = /<[a-zA-Z]/.test(p.body);
  return (
    <div className="border rounded-md overflow-hidden text-sm bg-white border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-gray-400 text-xs font-mono shrink-0">#{index + 1}</span>
          <span className="font-medium truncate text-gray-800">{p.name || p.email}</span>
          <span className="text-xs truncate text-gray-500">&lt;{p.email}&gt;</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Ready</span>
          <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-2">
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</span>
            <p className="mt-0.5 text-gray-800 text-sm">{p.subject}</p>
          </div>
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Body</span>
            {isHtml
              ? <div className="mt-0.5 text-gray-700 text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: p.body }} />
              : <pre className="mt-0.5 text-gray-700 text-xs leading-relaxed whitespace-pre-wrap font-sans">{p.body}</pre>
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Full-featured compose modal for feed contacts ─────────────────────────────

function FeedComposeModal({ contacts, onClose, onSent }) {
  const [step,             setStep]             = useState('compose');
  const [subject,          setSubject]          = useState(DEFAULT_SUBJECT);
  const [body,             setBody]             = useState(DEFAULT_BODY);
  const [subjectError,     setSubjectError]     = useState(false);
  const [bodyError,        setBodyError]        = useState(false);
  const [previews,         setPreviews]         = useState([]);
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
    Promise.all([
      api.get('/email-templates').catch(() => []),
      api.get('/profile').catch(() => null),
    ]).then(([templates, p]) => {
      const tpls = Array.isArray(templates) ? templates : [];
      setQuickTpls(tpls.slice(0, 4));

      const prof = p?.user_id ? p : null;
      setProfile(prof);

      if (tpls.length > 0) {
        // Always start with the user's first saved template — overrides hardcoded defaults
        setSubject(tpls[0].subject || DEFAULT_SUBJECT);
        setBody(tpls[0].body    || DEFAULT_BODY);
      } else if (prof) {
        // No templates yet — build body from profile as a fallback
        setBody(prev => prev === DEFAULT_BODY ? buildProfileBody(prof) : prev);
      }
    });
  }, []);

  function applyTemplate(t) {
    setSubject(t.subject || DEFAULT_SUBJECT);
    setBody(t.body || DEFAULT_BODY);
    if (t.attachment_json) setAttachment(t.attachment_json);
    toast.success(`Template applied: "${t.name}"`);
  }

  const insertVar = (v) => {
    if (focused === 'subject') {
      const el = subjRef.current;
      if (!el) return;
      const s = el.selectionStart ?? subject.length;
      const e = el.selectionEnd   ?? subject.length;
      setSubject(subject.slice(0, s) + v + subject.slice(e));
      setTimeout(() => { el.selectionStart = el.selectionEnd = s + v.length; el.focus(); }, 0);
    } else {
      bodyEditorRef.current?.insertText(v);
    }
  };

  const handlePreview = () => {
    const subjEmpty = !subject.trim();
    const bodyText  = body.trim().replace(/<[^>]+>/g, '').trim();
    const bodyEmpty = !bodyText;
    setSubjectError(subjEmpty);
    setBodyError(bodyEmpty);
    if (subjEmpty) { toast.error('Subject is required'); return; }
    if (bodyEmpty) { toast.error('Body is required');    return; }

    setLoading(true);
    // Build client-side previews — mirrors backend renderFeedTemplate
    const built = contacts.map(c => {
      const name = resolveName(c.contact_name, c.contact_email);
      const ctx  = { name, company: c.company || '', title: c.title || '', email: c.contact_email };
      return {
        email:   c.contact_email,
        name,
        subject: renderPreview(subject, ctx, profile),
        body:    renderPreview(body,    ctx, profile),
      };
    });
    setPreviews(built);
    setStep('preview');
    setLoading(false);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const payload = {
        template_subject: subject,
        template_body:    body,
        contacts: contacts.map(c => ({
          email:   c.contact_email,
          name:    resolveName(c.contact_name, c.contact_email),
          company: c.company || '',
          title:   c.title   || '',
        })),
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
      const result = await api.post('/scraped-jobs/send-feed-emails', payload, { timeout: 120000 });

      if (result.queued) {
        toast.success(
          `Sending ${result.total} emails in the background — you can close this window and carry on. A notification will appear when done.`,
          { duration: 7000 }
        );
        onSent([]);
      } else {
        const sent       = result.sent   || 0;
        const failed     = (result.total || 0) - sent;
        const sentEmails = (result.results || []).filter(r => r.ok).map(r => r.email);
        const failedList = (result.results || []).filter(r => !r.ok);

        if (failed === 0) {
          toast.success(`${sent} email${sent !== 1 ? 's' : ''} sent successfully!`);
        } else if (sent === 0) {
          toast.error(`All ${failed} email${failed !== 1 ? 's' : ''} failed to send.`, { duration: 5000 });
        } else {
          toast.success(`${sent} sent`, { duration: 4000 });
          const reasons = [...new Set(failedList.map(r => r.error).filter(Boolean))];
          toast.error(`${failed} failed${reasons.length ? ` — ${reasons[0]}` : ''}`, { duration: 6000 });
        }
        onSent(sentEmails);
      }
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Send failed — please try again');
      onClose(); // always close so user isn't stuck on preview
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-md shadow-modal w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-bold">
              {step === 'compose'
                ? `Compose — ${contacts.length} recipient${contacts.length !== 1 ? 's' : ''}`
                : 'Preview Before Sending'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {step === 'compose'
                ? 'One separate email per contact — variables auto-replaced per recipient'
                : `${previews.length} email${previews.length !== 1 ? 's' : ''} ready to send`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Compose step */}
        {step === 'compose' && (
          <div className="flex-1 overflow-y-auto">

            {/* Template quick-pick */}
            <div className="mx-5 mt-5 bg-brand-50 border border-brand-200 rounded-md p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-bold text-brand-800">Start with a Template</p>
                  <p className="text-xs text-brand-500">Pick one below or browse all templates</p>
                </div>
                <button onClick={() => setShowTemplates(true)}
                  className="text-xs px-3 py-1.5 bg-brand-600 text-white rounded-sm hover:bg-brand-700 font-semibold transition whitespace-nowrap">
                  Browse All →
                </button>
              </div>
              {quickTpls.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {quickTpls.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="text-xs px-3 py-2 bg-white border border-brand-200 text-brand-700 rounded-sm hover:bg-brand-600 hover:text-white hover:border-brand-600 font-medium transition-all shadow-sm">
                      {t.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-brand-400">No templates yet — click "Browse All" to create one.</p>
              )}
            </div>

            {/* Editor area */}
            <div className="p-5 space-y-4">
              {/* Variable chips */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">Recipient:</span>
                  {RECIPIENT_VARS.map(v => <VarChip key={v.label} label={v.label} hint={v.hint} onInsert={insertVar} />)}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">Your profile:</span>
                  {PROFILE_VARS.map(v => <VarChip key={v.label} label={v.label} hint={v.hint} onInsert={insertVar} />)}
                </div>
              </div>

              {/* To — recipient list */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">To</p>
                <div className="flex flex-wrap gap-1.5 bg-gray-50 rounded-sm border p-2 max-h-20 overflow-y-auto">
                  {contacts.map(c => (
                    <span key={c.contact_email} className="text-xs bg-brand-100 text-brand-800 px-2 py-0.5 rounded-full">
                      {c.contact_name ? `${c.contact_name} <${c.contact_email}>` : c.contact_email}
                    </span>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Subject *{subjectError && <span className="ml-2 text-red-500 font-normal text-[11px]">Subject is required</span>}
                </label>
                <input
                  ref={subjRef}
                  value={subject}
                  onChange={e => { setSubject(e.target.value); setSubjectError(false); }}
                  onFocus={() => setFocused('subject')}
                  className={`w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 outline-none ${subjectError ? 'border-red-400 focus:ring-red-200 bg-red-50' : 'focus:ring-brand-300'}`}
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Body *{bodyError && <span className="ml-2 text-red-500 font-normal text-[11px]">Body is required</span>}
                </label>
                <div onFocus={() => { setFocused('body'); setBodyError(false); }}
                  className={bodyError ? 'ring-2 ring-red-300 rounded-sm' : ''}>
                  <RichEditor
                    ref={bodyEditorRef}
                    value={body}
                    onChange={v => { setBody(v); setBodyError(false); }}
                    minRows={11}
                  />
                </div>
              </div>

              {/* Attach Resume */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Attach Resume (optional)</label>
                {attachment ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-brand-50 border border-brand-200 rounded-sm text-sm">
                    <span className="text-brand-700 flex-1 truncate text-xs">{attachment.label}</span>
                    <button onClick={() => setAttachment(null)}
                      className="text-xs text-red-400 hover:text-red-600 shrink-0 font-medium">Remove</button>
                  </div>
                ) : (
                  <button onClick={() => setShowAttachPicker(true)}
                    className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-sm text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 transition text-left">
                    + Attach resume — from profile, vault, or device
                  </button>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 text-xs text-amber-800">
                Each recipient gets their own individual email — not CC/BCC. Variables like <code className="font-mono">{'{{name}}'}</code> are replaced automatically per contact.
              </div>
            </div>
          </div>
        )}

        {/* Preview step */}
        {step === 'preview' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {attachment && (
              <div className="px-3 py-2 bg-brand-50 border border-brand-200 rounded-sm text-xs text-brand-700">
                Attachment: <strong>{attachment.label}</strong>
              </div>
            )}
            {previews.length === 0 && <p className="text-center py-16 text-gray-400">No previews</p>}
            {previews.map((p, i) => <PreviewCard key={p.email} p={p} index={i} />)}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t shrink-0 flex gap-3">
          {step === 'compose' && (
            <>
              <button onClick={handlePreview} disabled={loading}
                className="flex-1 bg-brand-600 text-white rounded-sm py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition">
                {loading ? 'Building previews…' : `Preview ${contacts.length} Email${contacts.length !== 1 ? 's' : ''} →`}
              </button>
              <button onClick={onClose} className="border rounded-sm px-5 py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => setStep('compose')} className="border rounded-sm px-5 py-2.5 text-sm font-medium hover:bg-gray-50 transition">← Back</button>
              <button onClick={handleSend} disabled={sending || previews.length === 0}
                className="flex-1 bg-green-600 text-white rounded-sm py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
                {sending ? 'Sending…' : `Confirm & Send ${previews.length} Email${previews.length !== 1 ? 's' : ''}`}
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FeedContactsPanel() {
  const [contacts,   setContacts]   = useState([]);
  const [counts,     setCounts]     = useState({ linkedin: 0, naukri: 0 });
  const [loading,    setLoading]    = useState(true);
  const [since,      setSince]      = useState('30d');
  const [search,     setSearch]     = useState('');
  const [sourceTab,  setSourceTab]  = useState('all');
  const [filterTab,  setFilterTab]  = useState('all');
  const [selected,   setSelected]   = useState(new Set());
  const [composeTo,  setComposeTo]  = useState(null);
  const [lastSync,   setLastSync]   = useState(null);
  const intervalRef  = useRef(null);

  const fetchContacts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = { since, limit: 200, source: sourceTab };
      if (search) params.search = search;
      const data = await api.get('/scraped-jobs/feed-contacts', { params });
      setContacts(data.contacts || []);
      if (data.counts) setCounts(data.counts);
      setLastSync(new Date());
    } catch {
      if (!silent) toast.error('Failed to load feed contacts');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [since, search, sourceTab]);

  useEffect(() => {
    fetchContacts();
    intervalRef.current = setInterval(() => fetchContacts(true), 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchContacts]);

  const handleSent = (sentEmails) => {
    const sentSet = new Set(sentEmails);
    setContacts(prev => prev.map(c =>
      sentSet.has(c.contact_email) ? { ...c, already_emailed: 1, just_sent: true } : c
    ));
    setSelected(new Set());
    setComposeTo(null);
  };

  // Closing the modal always clears selection so "X selected" badge doesn't linger
  const handleCloseCompose = () => {
    setComposeTo(null);
    setSelected(new Set());
  };

  const selectN = (n) => {
    const pending = filteredContacts.filter(c => !c.already_emailed);
    setSelected(new Set(pending.slice(0, n).map(c => c.contact_email)));
  };

  const toggleSelect = (email) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  };

  const pendingContacts  = contacts.filter(c => !c.already_emailed);
  const sentContacts     = contacts.filter(c =>  c.already_emailed);
  const filteredContacts = filterTab === 'pending' ? pendingContacts
    : filterTab === 'sent' ? sentContacts
    : contacts;
  const selectedContacts = contacts.filter(c => selected.has(c.contact_email));

  const toggleAll = () => {
    const pending = filteredContacts.filter(c => !c.already_emailed);
    if (pending.every(c => selected.has(c.contact_email))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pending.map(c => c.contact_email)));
    }
  };

  const exportCSV = () => {
    if (!filteredContacts.length) { toast.error('No contacts to export'); return; }
    const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
    const lines  = [['Name', 'Email', 'Company', 'Job Title'].join(',')];
    for (const c of filteredContacts) {
      lines.push([
        escape(c.contact_name  || ''),
        escape(c.contact_email || ''),
        escape(c.company       || ''),
        escape(c.title         || ''),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `feed-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredContacts.length} contact${filteredContacts.length !== 1 ? 's' : ''}`);
  };

  const timeSince = lastSync
    ? (() => {
        const secs = Math.floor((Date.now() - lastSync.getTime()) / 1000);
        if (secs < 10)  return 'just now';
        if (secs < 60)  return `${secs}s ago`;
        const mins = Math.floor(secs / 60);
        if (mins < 60)  return `${mins} min ago`;
        return `${Math.floor(mins / 60)}h ago`;
      })()
    : '';

  if (loading) {
    return (
      <div className="space-y-2 py-4">
        {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-md" />)}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 space-y-2">
        <p className="text-2xl">📭</p>
        <p className="text-sm font-medium">No HR contacts with email/phone found yet</p>
        <p className="text-xs">
          Contacts appear here from <span className="font-semibold">LinkedIn Feed</span> posts and <span className="font-semibold">Naukri</span> job posts where HRs shared their email or phone number.
          {sourceTab !== 'all' && <span> Try switching to <strong>All Sources</strong>.</span>}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Source tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {SOURCE_TABS.map(t => {
          const cnt = t.id === 'all'
            ? contacts.length
            : t.id === 'linkedin' ? counts.linkedin
            : counts.naukri;
          return (
            <button key={t.id}
              onClick={() => { setSourceTab(t.id); setSelected(new Set()); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                sourceTab === t.id
                  ? t.id === 'naukri'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {t.id === 'linkedin' && <span className="text-[10px]">💼</span>}
              {t.id === 'naukri'   && <span className="text-[10px]">🔍</span>}
              {t.label}
              <span className={`text-[10px] px-1 py-0.5 rounded-full ${
                sourceTab === t.id ? 'bg-white/20' : 'bg-gray-100'
              }`}>{cnt}</span>
            </button>
          );
        })}
        {timeSince && <span className="text-xs text-gray-400 ml-2">Synced {timeSince}</span>}
      </div>

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
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select value={since} onChange={e => setSince(e.target.value)}
                  className="border rounded-sm px-2 py-1.5 text-xs focus:ring-2 focus:ring-brand-300 outline-none bg-white">
            {SINCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                 className="border rounded-sm px-3 py-1.5 text-xs w-40 focus:ring-2 focus:ring-brand-300 outline-none" />
          <button onClick={() => fetchContacts()} className="text-xs text-gray-500 border rounded-sm px-2 py-1.5 hover:bg-gray-50">
            ↻ Refresh
          </button>
          <button
            onClick={exportCSV}
            title="Download current search results as CSV (Name, Email, Company, Job Title)"
            className="text-xs bg-emerald-600 text-white border border-emerald-600 rounded-sm px-2.5 py-1.5 hover:bg-emerald-700 font-semibold transition"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Bulk select bar */}
      {pendingContacts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filteredContacts.filter(c => !c.already_emailed).length > 0 &&
                       filteredContacts.filter(c => !c.already_emailed).every(c => selected.has(c.contact_email))}
              onChange={toggleAll}
              className="rounded accent-brand-600"
            />
            Select all
          </label>

          {/* Quick-select N buttons */}
          {[5, 10].map(n => {
            const available = filteredContacts.filter(c => !c.already_emailed).length;
            if (available < n && n === 10) return null;
            return (
              <button
                key={n}
                onClick={() => selectN(n)}
                disabled={available === 0}
                className="px-2.5 py-1 text-xs font-semibold border border-gray-300 rounded-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-40 transition"
              >
                Select {n}
              </button>
            );
          })}

          {selected.size > 0 && (
            <>
              <span className="text-xs text-gray-400">{selected.size} selected</span>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600 transition"
              >
                Clear
              </button>
              <button
                onClick={() => setComposeTo(selectedContacts)}
                className="px-4 py-1.5 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 transition"
              >
                ✉ Email {selected.size} selected
              </button>
            </>
          )}
        </div>
      )}

      {/* Contact rows */}
      <div className="space-y-2">
        {filteredContacts.map(c => (
          <div key={c.id}
               className={`bg-white border rounded-md px-4 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow ${
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
            {c.already_emailed && <div className="w-4 h-4 shrink-0" />}

            {/* Source badge */}
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
              c.source === 'naukri'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-brand-100 text-brand-700'
            }`}>
              {c.source === 'naukri' ? 'Naukri' : 'LinkedIn'}
            </span>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-bold text-brand-700 shrink-0">
              {(c.company?.[0] || c.contact_email?.[0] || '?').toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {c.contact_name && (
                  <span className="text-sm font-medium text-gray-900 truncate">{c.contact_name}</span>
                )}
                <span className="text-sm text-gray-600 truncate">{c.contact_email}</span>
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
                  className="px-3 py-1.5 bg-brand-600 text-white text-xs font-semibold rounded-sm hover:bg-brand-700 transition"
                >
                  ✉ Email
                </button>
              )}
              {c.link && (
                <a href={c.link} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-brand-500 hover:text-brand-700">
                  Post →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {composeTo && (
        <FeedComposeModal
          contacts={composeTo}
          onClose={handleCloseCompose}
          onSent={handleSent}
        />
      )}
    </div>
  );
}
