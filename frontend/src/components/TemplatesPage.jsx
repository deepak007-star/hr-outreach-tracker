import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { RESUME_TEMPLATES } from '../data/resumeTemplates.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import RichEditor, { toHtml } from './RichEditor.jsx';
import AttachmentPicker from './AttachmentPicker.jsx';

const TEMPLATE_VARS = ['{{name}}', '{{company}}', '{{role}}', '{{your_name}}', '{{title}}'];

// ── Sample data for live preview ──────────────────────────────────────────────
const SAMPLE = {
  '{{name}}':      'Priya Sharma',
  '{{company}}':   'Google India',
  '{{role}}':      'Senior Backend Engineer',
  '{{your_name}}': 'Vishal',
  '{{title}}':     'Engineering Manager',
  '{{email}}':     'priya.sharma@google.com',
};

function fillVars(text) {
  let out = text || '';
  Object.entries(SAMPLE).forEach(([k, v]) => { out = out.split(k).join(v); });
  return out;
}

// ── Inline placeholder highlighter ───────────────────────────────────────────
function HighlightedText({ text, className = '' }) {
  const parts = String(text).split(/(\[.+?\]|\{\{.+?\}\})/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (/^\[.+\]$/.test(p))   return <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5 not-italic font-semibold">{p}</mark>;
        if (/^\{\{.+\}\}$/.test(p)) return <mark key={i} className="bg-indigo-100 text-indigo-700 rounded px-0.5 not-italic">{p}</mark>;
        return p;
      })}
    </span>
  );
}

// ── Live email preview ────────────────────────────────────────────────────────
function EmailPreview({ subject, body }) {
  const filledSubject = fillVars(subject);
  const filledBody    = fillVars(body);

  if (!body && !subject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3 bg-gray-50">
        <span className="text-5xl">✉️</span>
        <p className="text-sm">Your email preview will appear here</p>
        <p className="text-xs">Start writing in the editor on the left</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-5 space-y-4">
      {/* Email chrome */}
      <div className="bg-white rounded-2xl shadow-md overflow-hidden max-w-2xl mx-auto">
        {/* Window bar */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-200 border-b border-gray-300">
          <span className="w-3 h-3 rounded-full bg-red-400" />
          <span className="w-3 h-3 rounded-full bg-yellow-400" />
          <span className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-3 text-xs text-gray-500 font-medium">New Message</span>
        </div>

        {/* Email header fields */}
        <div className="px-5 py-4 border-b bg-gray-50 space-y-2 text-xs">
          {[
            { label: 'From',    val: 'You <outreach@yourmail.com>' },
            { label: 'To',      val: 'Priya Sharma <priya.sharma@google.com>' },
            { label: 'Subject', val: filledSubject || '(no subject)', bold: true },
          ].map(r => (
            <div key={r.label} className="flex items-baseline gap-3">
              <span className="text-gray-400 w-14 text-right shrink-0">{r.label}</span>
              <span className={`text-gray-800 ${r.bold ? 'font-semibold text-sm' : ''}`}>{r.val}</span>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="px-5 py-5 min-h-[140px]">
          <div
            className="text-sm text-gray-800 leading-relaxed font-sans"
            dangerouslySetInnerHTML={{ __html: toHtml(filledBody) || '' }}
          />
          <div className="mt-5 pt-4 border-t border-gray-100 text-xs text-gray-400 italic">
            To unsubscribe from these emails, reply with UNSUBSCRIBE.
          </div>
        </div>
      </div>

      {/* Variable legend */}
      <div className="max-w-2xl mx-auto">
        <p className="text-xs text-gray-400 font-semibold mb-2">Preview variables (sample data)</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SAMPLE).map(([k, v]) => (
            <span key={k} className="text-[11px] bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-500 shadow-sm">
              <span className="font-mono text-indigo-500">{k}</span> → <span className="text-gray-700">{v}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Resume document renderer ──────────────────────────────────────────────────
function isSectionHeader(line) {
  const clean = line.trim().replace(/[^A-Za-z\s\/\-&]/g, '');
  if (clean.length < 4) return false;
  const uppers = (clean.match(/[A-Z]/g) || []).length;
  const letters = (clean.match(/[A-Za-z]/g) || []).length;
  return letters > 0 && uppers / letters > 0.85;
}

function isContactLine(line) {
  return /\|/.test(line) && line.trim().length > 5 && !isSectionHeader(line);
}

function isJobHeader(line) {
  return /\|/.test(line) && /\d{4}|Present/.test(line);
}

function isBullet(line) {
  return /^[\s]*[•\-\*]/.test(line);
}

function DocLine({ line, isFirst, isSecond }) {
  const trimmed = line.trim();
  if (!trimmed) return <div className="h-2.5" />;

  // [PLACEHOLDER] or {{var}} highlight
  const hasMark = /\[.+?\]|\{\{.+?\}\}/.test(trimmed);

  if (isFirst) {
    return (
      <h1 className="text-xl font-bold text-gray-900 text-center tracking-wide mb-0.5">
        <HighlightedText text={trimmed} />
      </h1>
    );
  }

  if (isSecond && isContactLine(trimmed)) {
    return (
      <p className="text-center text-[11px] text-gray-500 tracking-wide mb-1">
        <HighlightedText text={trimmed} />
      </p>
    );
  }

  if (isSectionHeader(trimmed)) {
    return (
      <div className="mt-3 mb-1 border-b border-gray-300 pb-0.5">
        <h2 className="text-[11px] font-bold text-gray-700 uppercase tracking-[0.12em]">{trimmed}</h2>
      </div>
    );
  }

  if (isJobHeader(trimmed)) {
    const parts = trimmed.split('|').map(s => s.trim());
    return (
      <div className="flex items-baseline justify-between mt-1.5 mb-0.5 flex-wrap gap-1">
        <span className="text-xs font-bold text-gray-800">
          <HighlightedText text={parts[0]} />
        </span>
        <span className="text-[11px] text-gray-500">
          {parts.slice(1).map((p, i) => (
            <span key={i}>{i > 0 && ' | '}<HighlightedText text={p} /></span>
          ))}
        </span>
      </div>
    );
  }

  if (isBullet(trimmed)) {
    const content = trimmed.replace(/^[\s]*[•\-\*]\s*/, '');
    return (
      <div className="flex items-start gap-2 leading-relaxed mt-0.5">
        <span className="text-gray-400 shrink-0 text-[10px] mt-0.5">•</span>
        <span className={`text-[11px] text-gray-700 leading-relaxed ${hasMark ? 'text-gray-500 italic' : ''}`}>
          <HighlightedText text={content} />
        </span>
      </div>
    );
  }

  // General: label: value lines (Technical Skills etc.)
  if (/^\w[\w\s]+\s*:/.test(trimmed)) {
    const colonIdx = trimmed.indexOf(':');
    const label    = trimmed.slice(0, colonIdx);
    const value    = trimmed.slice(colonIdx + 1).trim();
    return (
      <div className="flex text-[11px] leading-relaxed mt-0.5">
        <span className="font-semibold text-gray-700 shrink-0 w-28">{label}</span>
        <span className="text-gray-600">: <HighlightedText text={value} /></span>
      </div>
    );
  }

  return (
    <p className={`text-[11px] leading-relaxed mt-0.5 ${hasMark ? 'text-gray-400 italic' : 'text-gray-700'}`}>
      <HighlightedText text={trimmed} />
    </p>
  );
}

function ResumeDocPreview({ text }) {
  if (!text) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 bg-gray-100">
        <span className="text-5xl">📄</span>
        <p className="text-sm">Select a domain template to see the document preview</p>
      </div>
    );
  }

  const lines = text.split('\n');
  let firstContentLine = -1;
  let secondContentLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      if (firstContentLine === -1) { firstContentLine = i; continue; }
      if (secondContentLine === -1) { secondContentLine = i; break; }
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-200 p-6">
      {/* A4-ish paper */}
      <div className="bg-white mx-auto shadow-xl rounded-lg overflow-hidden" style={{ maxWidth: '640px', minHeight: '900px' }}>
        {/* Paper top accent */}
        <div className="h-1.5 bg-gradient-to-r from-blue-500 to-indigo-600" />
        <div className="px-8 py-7 space-y-0">
          {lines.map((line, i) => (
            <DocLine
              key={i}
              line={line}
              isFirst={i === firstContentLine}
              isSecond={i === secondContentLine}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 max-w-[640px] mx-auto flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><mark className="bg-yellow-200 text-yellow-800 rounded px-1 text-[10px]">[PLACEHOLDER]</mark> Replace with your data</span>
        <span className="flex items-center gap-1.5"><mark className="bg-indigo-100 text-indigo-600 rounded px-1 text-[10px]">{'{{var}}'}</mark> Auto-filled template var</span>
      </div>
    </div>
  );
}

// ── Code editor with line numbers ─────────────────────────────────────────────
function CodeEditor({ value, onChange, language = 'text' }) {
  const taRef   = useRef();
  const numRef  = useRef();
  const lineCount = (value || '').split('\n').length;

  const syncScroll = useCallback(() => {
    if (numRef.current && taRef.current) numRef.current.scrollTop = taRef.current.scrollTop;
  }, []);

  function insertTab(e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = taRef.current;
    const s  = el.selectionStart;
    const newVal = value.slice(0, s) + '  ' + value.slice(el.selectionEnd);
    onChange(newVal);
    setTimeout(() => { el.selectionStart = el.selectionEnd = s + 2; }, 0);
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-gray-950 font-mono text-[13px] leading-6">
      {/* Line numbers */}
      <div
        ref={numRef}
        className="select-none overflow-hidden shrink-0 text-right text-gray-600 bg-gray-900 border-r border-gray-800 pt-4 pb-4"
        style={{ width: '3.2rem', overflowY: 'hidden' }}
        aria-hidden
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="px-2">{i + 1}</div>
        ))}
      </div>
      {/* Editor textarea */}
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={insertTab}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="flex-1 bg-transparent text-green-300 py-4 pl-4 pr-4 outline-none resize-none leading-6 h-full overflow-auto"
        style={{ caretColor: '#86efac' }}
      />
    </div>
  );
}

// ── Panel toggle buttons ──────────────────────────────────────────────────────
function PanelToggle({ view, setView }) {
  return (
    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
      {[
        { id: 'editor',  icon: '✏️', title: 'Editor only' },
        { id: 'split',   icon: '⬛', title: 'Split view'  },
        { id: 'preview', icon: '👁', title: 'Preview only' },
      ].map(({ id, icon, title }) => (
        <button
          key={id}
          onClick={() => setView(id)}
          title={title}
          className={`px-2.5 py-1 rounded text-sm transition-all ${
            view === id ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

// ── Email Templates section ───────────────────────────────────────────────────
function EmailTemplatesSection() {
  const [templates,       setTemplates]       = useState([]);
  const [selected,        setSelected]        = useState(null);
  const [form,            setForm]            = useState({ name: '', subject: '', body: '' });
  const [saving,          setSaving]          = useState(false);
  const [dirty,           setDirty]           = useState(false);
  const [view,            setView]            = useState('split');
  const [selectAttachment, setSelectAttachment] = useState(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [profile,         setProfile]         = useState(null);
  const bodyEditorRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get('/email-templates'),
      api.get('/profile').catch(() => null),
    ]).then(([data, prof]) => {
      setTemplates(Array.isArray(data) ? data : []);
      setProfile(prof && prof.user_id ? prof : null);
      if (data.length) {
        const first = data[0];
        setSelected(first);
        setForm({ name: first.name, subject: first.subject, body: first.body });
        const att = first.attachment_json;
        setSelectAttachment(att && typeof att === 'object' ? att : null);
      }
    }).catch(() => toast.error('Could not load email templates'));
  }, []);

  function open(t) {
    setSelected(t);
    setForm({ name: t.name, subject: t.subject, body: t.body });
    const att = t.attachment_json;
    setSelectAttachment(att && typeof att === 'object' ? att : null);
    setDirty(false);
  }
  function newTpl() {
    setSelected({ _new: true });
    setForm({ name: '', subject: '', body: '' });
    setSelectAttachment(null);
    setDirty(false);
  }
  function change(field, val) { setForm(f => ({ ...f, [field]: val })); setDirty(true); }

  function insertVar(v) {
    bodyEditorRef.current?.insertText(v);
    setDirty(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error('Name is required');
    setSaving(true);
    try {
      const attachToSave = selectAttachment?.type && selectAttachment.type !== 'local' ? selectAttachment : null;
      if (selectAttachment?.type === 'local') {
        toast('Local file attachment not saved with template — re-attach before sending', { icon: 'ℹ️' });
      }
      if (selected?._new) {
        const created = await api.post('/email-templates', { ...form, attachment_json: attachToSave });
        const withAtt = { ...created, attachment_json: attachToSave };
        setTemplates(ts => [...ts, withAtt]);
        setSelected(withAtt);
      } else {
        await api.put(`/email-templates/${selected.id}`, { ...form, attachment_json: attachToSave });
        setTemplates(ts => ts.map(t => t.id === selected.id ? { ...t, ...form, attachment_json: attachToSave } : t));
        setSelected(s => ({ ...s, ...form, attachment_json: attachToSave }));
      }
      setDirty(false);
      toast.success('Template saved');
    } catch { toast.error('Save failed'); }
    finally  { setSaving(false); }
  }

  async function del(t, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.delete(`/email-templates/${t.id}`);
      const next = templates.filter(x => x.id !== t.id);
      setTemplates(next);
      if (selected?.id === t.id) {
        if (next.length) {
          setSelected(next[0]);
          setForm({ name: next[0].name, subject: next[0].subject, body: next[0].body });
          const att = next[0].attachment_json;
          setSelectAttachment(att && typeof att === 'object' ? att : null);
        } else {
          setSelected(null);
          setForm({ name: '', subject: '', body: '' });
          setSelectAttachment(null);
        }
      }
      toast.success('Deleted');
    } catch { toast.error('Delete failed'); }
  }

  return (
    <>
      {showAttachPicker && (
        <AttachmentPicker
          profile={profile}
          onSelect={a => { setSelectAttachment(a); setShowAttachPicker(false); setDirty(true); }}
          onClose={() => setShowAttachPicker(false)}
        />
      )}
    <div className="flex h-[720px] rounded-2xl border border-gray-200 shadow-sm overflow-hidden bg-white">

      {/* ── Sidebar ── */}
      <div className="w-56 border-r bg-gray-50 flex flex-col shrink-0">
        <div className="p-3 border-b">
          <button onClick={newTpl}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition">
            + New Template
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {templates.length === 0 && (
            <p className="text-xs text-gray-400 text-center mt-10 px-4 leading-relaxed">No templates yet.<br />Create your first one above.</p>
          )}
          {templates.map(t => (
            <div key={t.id} onClick={() => open(t)}
              className={`group px-3.5 py-3 cursor-pointer transition-colors ${
                selected?.id === t.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-100'
              }`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 truncate">{t.name}</p>
                  {t.subject && <p className="text-[11px] text-gray-400 truncate mt-0.5">{t.subject}</p>}
                </div>
                {t.is_default === 1 && <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-bold shrink-0 mt-0.5">DEFAULT</span>}
              </div>
              <button onClick={e => del(t, e)}
                className="text-[10px] text-red-400 hover:text-red-600 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main panel ── */}
      {!selected ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <span className="text-5xl">✉️</span>
          <p className="text-sm">Select a template or click "+ New Template"</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-gray-50 shrink-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <input value={form.name} onChange={e => change('name', e.target.value)}
                placeholder="Template name…"
                className="text-sm font-semibold border-0 outline-none bg-transparent text-gray-800 placeholder-gray-300 min-w-0 flex-1 max-w-xs" />
              {dirty && <span className="text-[10px] text-amber-500 font-medium shrink-0">● unsaved</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PanelToggle view={view} setView={setView} />
              <button onClick={save} disabled={saving || !dirty}
                className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* Content area */}
          <div className="flex flex-1 min-h-0">

            {/* Editor panel */}
            {(view === 'editor' || view === 'split') && (
              <div className={`flex flex-col border-r min-h-0 ${view === 'split' ? 'w-1/2' : 'flex-1'}`}>
                {/* Subject */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-white shrink-0">
                  <span className="text-xs text-gray-400 font-semibold w-14 shrink-0">Subject</span>
                  <input value={form.subject} onChange={e => change('subject', e.target.value)}
                    placeholder="Hi {{name}}, exploring roles at {{company}}"
                    className="flex-1 text-sm outline-none text-gray-800 placeholder-gray-300" />
                </div>

                {/* Var chips */}
                <div className="flex items-center gap-1.5 px-4 py-1.5 border-b bg-gray-50 flex-wrap shrink-0">
                  <span className="text-[10px] text-gray-400 font-medium">Insert:</span>
                  {TEMPLATE_VARS.map(v => (
                    <button key={v} onMouseDown={e => { e.preventDefault(); insertVar(v); }}
                      className="text-[10px] font-mono bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded hover:bg-indigo-100 transition">
                      {v}
                    </button>
                  ))}
                </div>

                {/* Rich body editor */}
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  <RichEditor
                    ref={bodyEditorRef}
                    value={form.body}
                    onChange={v => change('body', v)}
                    minRows={11}
                  />
                </div>

                {/* Attachment row */}
                <div className="px-4 py-2.5 border-t bg-gray-50 flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-500 shrink-0">Default attachment:</span>
                  {selectAttachment ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 truncate flex-1">
                        {selectAttachment.label}
                        {selectAttachment.type === 'local' && ' (not saved)'}
                      </span>
                      <button onClick={() => { setSelectAttachment(null); setDirty(true); }} className="text-xs text-red-400 hover:text-red-600 shrink-0">✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAttachPicker(true)}
                      className="text-xs px-2.5 py-1 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-600 transition"
                    >
                      + Pick resume (vault / drive / local / profile)
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Preview panel */}
            {(view === 'preview' || view === 'split') && (
              <div className={`flex flex-col ${view === 'split' ? 'w-1/2' : 'flex-1'}`}>
                <div className="px-4 py-2 border-b bg-gray-50 flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-gray-500">Live Preview</span>
                  <span className="text-[10px] text-gray-300">— sample data substituted</span>
                </div>
                <EmailPreview subject={form.subject} body={form.body} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
}

// ── ATS Resume Templates section ──────────────────────────────────────────────
function ResumeTemplatesSection() {
  const { user } = useAuth();
  const [selected,  setSelected]  = useState(null);
  const [editText,  setEditText]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [view,      setView]      = useState('split');
  const [copyDone,  setCopyDone]  = useState(false);

  function open(t) { setSelected(t); setEditText(t.template); }

  async function handleSave() {
    if (!user) return toast.error('Please sign in to save a resume');
    setSaving(true);
    try {
      await api.put('/profile', { resume_text: editText });
      toast.success('Resume saved to your profile — check the Profile tab!');
    } catch { toast.error('Failed to save'); }
    finally  { setSaving(false); }
  }

  function copyText() {
    navigator.clipboard.writeText(editText).then(() => { setCopyDone(true); setTimeout(() => setCopyDone(false), 2000); });
  }

  function download() {
    const blob = new Blob([editText], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${selected?.id || 'resume'}_template.txt` });
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-[680px] rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

      {/* ── Domain sidebar ── */}
      <div className="w-52 border-r bg-gray-50 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Domain</p>
          <p className="text-[11px] text-gray-400 mt-0.5">ATS-optimised starters</p>
        </div>
        <div className="flex-1 p-3 space-y-2">
          {RESUME_TEMPLATES.map(t => (
            <button key={t.id} onClick={() => open(t)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                selected?.id === t.id
                  ? 'bg-blue-600 border-blue-600 shadow-md'
                  : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl shrink-0">{t.icon}</span>
                <p className={`text-sm font-semibold leading-tight ${selected?.id === t.id ? 'text-white' : 'text-gray-800'}`}>{t.label}</p>
              </div>
              <p className={`text-[11px] leading-relaxed line-clamp-2 ${selected?.id === t.id ? 'text-blue-100' : 'text-gray-400'}`}>{t.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      {!selected ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 bg-gray-900">
          <span className="text-5xl">📄</span>
          <p className="text-sm text-gray-400">Select a domain template from the sidebar</p>
          <p className="text-xs text-gray-600">The editor and live preview will open here</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block"/>
                <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block"/>
                <span className="w-3 h-3 rounded-full bg-green-500 inline-block"/>
              </div>
              <span className="text-gray-400 text-xs font-mono">{selected.id}_ats_resume.txt</span>
              <span className="text-gray-600 text-xs">— {selected.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <PanelToggle view={view} setView={setView} />
              <button onClick={copyText}
                className="text-xs text-gray-400 hover:text-gray-200 border border-gray-700 px-2.5 py-1 rounded transition">
                {copyDone ? '✓ Copied' : '📋 Copy'}
              </button>
              <button onClick={download}
                className="text-xs text-gray-400 hover:text-gray-200 border border-gray-700 px-2.5 py-1 rounded transition">
                ↓ .txt
              </button>
              <button onClick={() => setEditText(selected.template)}
                className="text-xs text-gray-400 hover:text-gray-200 border border-gray-700 px-2.5 py-1 rounded transition">
                ↺ Reset
              </button>
              <button onClick={handleSave} disabled={saving || !user}
                className="text-xs px-3 py-1 bg-green-600 text-white rounded font-semibold hover:bg-green-700 disabled:opacity-50 transition">
                {saving ? 'Saving…' : user ? '💾 Save to Profile' : '🔒 Login'}
              </button>
            </div>
          </div>

          {/* Editor + Preview panels */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* Code editor */}
            {(view === 'editor' || view === 'split') && (
              <div className={`flex flex-col min-h-0 ${view === 'split' ? 'w-1/2 border-r border-gray-800' : 'flex-1'}`}>
                <CodeEditor value={editText} onChange={setEditText} />
              </div>
            )}

            {/* Document preview */}
            {(view === 'preview' || view === 'split') && (
              <div className={`flex flex-col min-h-0 overflow-hidden ${view === 'split' ? 'w-1/2' : 'flex-1'}`}>
                <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-gray-500">Document Preview</span>
                  <span className="text-[10px] text-gray-300">— live render</span>
                </div>
                <ResumeDocPreview text={editText} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main TemplatesPage ────────────────────────────────────────────────────────
export default function TemplatesPage({ defaultTab = 'email' }) {
  const [subTab, setSubTab] = useState(defaultTab);

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-1.5 flex gap-1.5">
        {[
          { id: 'email',  icon: '✉️',  label: 'Email Templates',      desc: 'Create, edit & preview personalised email templates' },
          { id: 'resume', icon: '📄', label: 'ATS Resume Templates',  desc: 'ATS-optimised resume starters with live document preview' },
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
              subTab === t.id ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span className="text-xl shrink-0">{t.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t.label}</p>
              <p className={`text-xs mt-0.5 truncate ${subTab === t.id ? 'text-blue-200' : 'text-gray-400'}`}>{t.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {subTab === 'email'  && <EmailTemplatesSection />}
      {subTab === 'resume' && <ResumeTemplatesSection />}
    </div>
  );
}
