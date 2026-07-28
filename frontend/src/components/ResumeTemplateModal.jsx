import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT } from '../api/client.js';
import { confirm } from '../utils/confirm.js';
import { RESUME_TEMPLATES } from '../data/resumeTemplates.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { downloadAsPdf, downloadAsWord, cleanResumeText } from '../utils/resumeUtils.js';

// ── Line classifier (mirrors resumeUtils.js classifyLine) ─────────────────────
function classifyLine(rawLine, idx, allLines) {
  const line = rawLine.replace(/^\[ADDED-LINE\]/, '');
  const t = line.trim();
  if (!t) return 'blank';

  let nonBlankPos = 0;
  for (let i = 0; i < idx; i++) {
    if (allLines[i].replace(/^\[ADDED-LINE\]/, '').trim()) nonBlankPos++;
  }

  if (nonBlankPos === 0) return 'name';
  if (nonBlankPos === 1) return 'subtitle';
  if (nonBlankPos <= 3 && (
    t.includes('|') || t.includes('@') || /\d{7,}/.test(t) ||
    /linkedin|leetcode|github|portfolio/i.test(t)
  )) return 'contact';

  if (t.length > 2 && t === t.toUpperCase() && /^[A-Z]/.test(t) && !t.includes(':') && t.length < 80)
    return 'section';
  if (/^[A-Za-z][A-Za-z\s\/&0-9]+?\s*:\s*.{1,}/.test(t)) return 'subcategory';
  if (/^[A-Za-z][A-Za-z\s\/&0-9]+?\s+-\s+.{1,}/.test(t) && !t.startsWith('•') && !t.startsWith('-'))
    return 'subcategory';
  if (/^[•▪▸►\-–]\s/.test(t)) return 'bullet';
  return 'body';
}

// ── Inline [ADDED] renderer ───────────────────────────────────────────────────
function Inline({ text }) {
  if (!text || !text.includes('[ADDED]')) return <>{text}</>;
  const parts = text.split('[ADDED]');
  return (
    <>
      {parts[0]}
      {parts.slice(1).map((part, j) => (
        <mark key={j} style={{ background: '#dcfce7', color: '#166534', borderRadius: 3, padding: '0 2px', fontWeight: 600 }}>
          ✦{part}
        </mark>
      ))}
    </>
  );
}

// ── A4 visual resume renderer ─────────────────────────────────────────────────
function ResumeRenderer({ text }) {
  if (!text?.trim()) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, color: '#9ca3af' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
        <p style={{ fontSize: 13 }}>Your resume will appear here as you type</p>
      </div>
    );
  }

  const lines = text.split('\n');

  return (
    <div style={{ fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11, lineHeight: 1.55, color: '#111', userSelect: 'text' }}>
      {lines.map((raw, i) => {
        const isAdded = raw.startsWith('[ADDED-LINE]');
        const line    = raw.replace(/^\[ADDED-LINE\]/, '');
        const t       = line.trim();
        const type    = classifyLine(raw, i, lines);

        const addedWrap = (child) => isAdded ? (
          <div style={{ background: '#f0fdf4', borderLeft: '3px solid #4ade80', paddingLeft: 6, marginBottom: 1, borderRadius: '0 2px 2px 0' }}>
            {child}
          </div>
        ) : child;

        if (type === 'blank') return <div key={i} style={{ height: 5 }} />;

        if (type === 'name') return (
          <div key={i} style={{ textAlign: 'center', fontSize: 20, fontWeight: 700, marginBottom: 2, color: '#000' }}>
            <Inline text={t} />
          </div>
        );

        if (type === 'subtitle') return (
          <div key={i} style={{ textAlign: 'center', fontSize: 12, color: '#4b5563', marginBottom: 2 }}>
            <Inline text={t} />
          </div>
        );

        if (type === 'contact') return (
          <div key={i} style={{ textAlign: 'center', fontSize: 10, color: '#6b7280', marginBottom: 6 }}>
            <Inline text={t} />
          </div>
        );

        if (type === 'section') return (
          <div key={i} style={{ marginTop: 12, marginBottom: 4, borderBottom: '1.5px solid #111', paddingBottom: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>
              <Inline text={t} />
            </span>
          </div>
        );

        if (type === 'subcategory') {
          const colonIdx = t.indexOf(':');
          const dashIdx  = t.search(/\s+-\s+/);
          const idx2     = colonIdx > 0 && colonIdx < 30 ? colonIdx + 1 : (dashIdx > 0 ? dashIdx + 3 : -1);
          if (idx2 > 0) {
            const label = t.slice(0, colonIdx > 0 && colonIdx < 30 ? colonIdx + 1 : dashIdx + 1);
            const rest  = t.slice(idx2);
            return addedWrap(
              <div key={i} style={{ marginBottom: 1 }}>
                <span style={{ fontWeight: 700, color: '#111', minWidth: 90, display: 'inline-block' }}>{label}</span>
                <span style={{ color: '#374151' }}><Inline text={rest} /></span>
              </div>
            );
          }
          return addedWrap(<div key={i} style={{ color: '#374151', marginBottom: 1 }}><Inline text={t} /></div>);
        }

        if (type === 'bullet') {
          const content = t.replace(/^[•▪▸►\-–]\s*/, '');
          const indent  = (raw.match(/^\s*/)?.[0].length || 0);
          return addedWrap(
            <div key={i} style={{ display: 'flex', gap: 6, paddingLeft: 8 + indent * 3, color: '#374151', marginBottom: 1 }}>
              <span style={{ flexShrink: 0, color: '#6b7280' }}>•</span>
              <span><Inline text={content} /></span>
            </div>
          );
        }

        // body
        const indent = raw.length - raw.trimStart().length;
        return addedWrap(
          <div key={i} style={{ color: '#374151', paddingLeft: Math.min(indent * 4, 32), marginBottom: 0.5 }}>
            <Inline text={t || ' '} />
          </div>
        );
      })}
    </div>
  );
}

// ── Toolbar helpers ───────────────────────────────────────────────────────────
function getLineRange(ta) {
  const { selectionStart: s, value: v } = ta;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  const le = v.indexOf('\n', s);
  return { ls, le: le === -1 ? v.length : le, lineText: v.slice(ls, le === -1 ? v.length : le) };
}

function replaceCurrentLine(ta, setText, transformer) {
  const { ls, le, lineText } = getLineRange(ta);
  const result = transformer(lineText);
  setText(ta.value.slice(0, ls) + result + ta.value.slice(le));
  setTimeout(() => ta.focus(), 0);
}

function insertAtCursor(ta, setText, insertStr) {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const v = ta.value;
  setText(v.slice(0, s) + insertStr + v.slice(e));
  setTimeout(() => {
    ta.selectionStart = ta.selectionEnd = s + insertStr.length;
    ta.focus();
  }, 0);
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ResumeTemplateModal({ onClose, onSaved }) {
  const { user } = useAuth();

  const [selected,      setSelected]      = useState(null);
  const [editText,      setEditText]      = useState('');
  const [saving,        setSaving]        = useState(false);
  const [userTemplates, setUserTemplates] = useState([]);
  const [loadingUser,   setLoadingUser]   = useState(true);
  const [uploading,     setUploading]     = useState(false);
  const [viewMode,      setViewMode]      = useState('split'); // 'split' | 'editor' | 'preview'
  const [editorPct,     setEditorPct]     = useState(50);     // % width of editor in split mode
  const [cursorPos,     setCursorPos]     = useState({ ln: 1, col: 1 });
  const [profileResume, setProfileResume] = useState('');

  const textareaRef  = useRef(null);
  const lineNumRef   = useRef(null);
  const containerRef = useRef(null);
  const uploadRef    = useRef(null);
  const dragging     = useRef(false);
  const dragStartX   = useRef(0);
  const dragStartPct = useRef(50);

  // Load user templates + profile resume
  useEffect(() => {
    api.get('/resume-versions')
      .then(data => {
        const arr = Array.isArray(data) ? data : [];
        setUserTemplates(arr.filter(v => v.is_ats_template));
      })
      .catch(() => {})
      .finally(() => setLoadingUser(false));

    if (user) {
      api.get('/profile')
        .then(p => { if (p?.resume_text) setProfileResume(p.resume_text); })
        .catch(() => {});
    }
  }, [user]);

  // ── Template selection ───────────────────────────────────────────────────
  function openBuiltin(t) {
    setSelected({ ...t, _builtin: true });
    setEditText(t.template);
  }

  function openUserTemplate(v) {
    setSelected({ ...v, _user: true });
    setEditText('Loading…');
    api.get(`/resume-versions/${v.id}/text`)
      .then(data => setEditText(data.resume_text || ''))
      .catch(() => { toast.error('Failed to load template'); setEditText(''); });
  }

  function loadProfileResume() {
    if (!profileResume) return toast.error('No profile resume found. Upload one in Profile → Resume.');
    setSelected({ id: '__profile__', label: 'My Profile Resume', _profile: true });
    setEditText(profileResume);
  }

  // ── Saves / deletes ──────────────────────────────────────────────────────
  async function handleSave() {
    if (!user) return toast.error('Please log in to save');
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await api.put('/profile', { resume_text: editText });
      toast.success('Saved to your profile!');
      onSaved?.(editText);
      onClose();
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  }

  async function handleUpload(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'doc', 'txt'].includes(ext)) {
      toast.error('Only PDF, DOCX, or TXT files are supported');
      return;
    }
    setUploading(true);
    try {
      const token = localStorage.getItem('hr_token');
      const form  = new FormData();
      form.append('resume', file);
      form.append('label', file.name.replace(/\.[^.]+$/, ''));
      form.append('isAtsTemplate', '1');
      const resp = await fetch(`${API_ROOT}/api/resume-versions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
      const saved = await resp.json();
      setUserTemplates(ts => [saved, ...ts]);
      toast.success('Template uploaded!');
    } catch (err) { toast.error(err.message); }
    finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = ''; }
  }

  async function handleDeleteUser(v, e) {
    e.stopPropagation();
    if (!await confirm(`Delete "${v.label}"?`)) return;
    try {
      await api.delete(`/resume-versions/${v.id}`);
      setUserTemplates(ts => ts.filter(t => t.id !== v.id));
      if (selected?.id === v.id) { setSelected(null); setEditText(''); }
      toast.success('Template deleted');
    } catch { toast.error('Delete failed'); }
  }

  // ── Cursor position tracker ──────────────────────────────────────────────
  function updateCursor(e) {
    const { selectionStart, value } = e.target;
    const before = value.slice(0, selectionStart);
    const lines  = before.split('\n');
    setCursorPos({ ln: lines.length, col: lines[lines.length - 1].length + 1 });
  }

  // ── Line-number scroll sync ──────────────────────────────────────────────
  function syncLineNums(e) {
    if (lineNumRef.current) lineNumRef.current.scrollTop = e.target.scrollTop;
  }

  // ── Resizable divider ────────────────────────────────────────────────────
  function onDividerDown(e) {
    e.preventDefault();
    dragging.current = true;
    dragStartX.current   = e.clientX;
    dragStartPct.current = editorPct;

    function onMove(ev) {
      if (!dragging.current) return;
      const w = containerRef.current?.offsetWidth || window.innerWidth;
      const delta = ((ev.clientX - dragStartX.current) / w) * 100;
      setEditorPct(Math.max(25, Math.min(75, dragStartPct.current + delta)));
    }
    function onUp() {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Toolbar actions ──────────────────────────────────────────────────────
  const ta = () => textareaRef.current;

  function toolSection() {
    if (!ta()) return;
    replaceCurrentLine(ta(), setEditText, l => l.trim().toUpperCase());
  }

  function toolSubLabel() {
    if (!ta()) return;
    const { ls, le, lineText } = getLineRange(ta());
    const label = 'Label: ';
    const newLine = lineText.trim() ? `${label}${lineText.trim()}` : label;
    setEditText(ta().value.slice(0, ls) + newLine + ta().value.slice(le));
    setTimeout(() => {
      ta().selectionStart = ls;
      ta().selectionEnd   = ls + 5;
      ta().focus();
    }, 0);
  }

  function toolBullet() {
    if (!ta()) return;
    replaceCurrentLine(ta(), setEditText, l => {
      const trimmed = l.trimStart();
      return /^[•▪▸►\-–]\s/.test(trimmed) ? trimmed.slice(2) : `• ${trimmed}`;
    });
  }

  function toolBlankLine() {
    if (!ta()) return;
    insertAtCursor(ta(), setEditText, '\n');
  }

  function toolClearMarkers() {
    setEditText(prev => cleanResumeText(prev));
    toast.success('Markers cleared');
  }

  function toolDownloadPdf() {
    if (!editText.trim()) return toast.error('Nothing to download');
    try { downloadAsPdf(editText, selected?.label || 'resume'); }
    catch { toast.error('PDF generation failed'); }
  }

  async function toolDownloadWord() {
    if (!editText.trim()) return toast.error('Nothing to download');
    try { await downloadAsWord(editText, selected?.label || 'resume'); }
    catch { toast.error('Word export failed'); }
  }

  // Keyboard shortcuts in textarea
  function handleKeyDown(e) {
    // Tab → 4 spaces (prevent focus shift)
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor(ta(), setEditText, '    ');
    }
    // Ctrl+S → Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Ctrl+Shift+H → Section header
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      toolSection();
    }
  }

  const lineCount  = editText.split('\n').length;
  const charCount  = editText.length;
  const isBuiltin  = !!selected?._builtin;
  const isUser     = !!selected?._user;
  const isProfile  = !!selected?._profile;

  const showEditor  = viewMode === 'split' || viewMode === 'editor';
  const showPreview = viewMode === 'split' || viewMode === 'preview';

  const editorStyle  = viewMode === 'split' ? { width: `${editorPct}%`, flexShrink: 0 }     : { flex: 1 };
  const previewStyle = viewMode === 'split' ? { width: `${100 - editorPct}%`, flexShrink: 0 } : { flex: 1 };

  // ── Sidebar (dark, Overleaf-style) ────────────────────────────────────────
  const Sidebar = (
    <div className="w-52 shrink-0 flex flex-col border-r border-gray-700 bg-gray-900 overflow-hidden">
      {/* Logo-style header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-green-400 font-bold text-sm tracking-tight">Resume Editor</p>
        <p className="text-gray-500 text-[10px] mt-0.5">Overleaf-style · ATS optimised</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Load from profile */}
        {profileResume && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">My Resume</p>
            <button
              onClick={loadProfileResume}
              className={`w-full text-left text-xs px-3 py-2 rounded-sm border transition ${
                isProfile
                  ? 'bg-green-600 border-green-600 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-green-500 hover:text-green-300'
              }`}
            >
              📋 Load Profile Resume
            </button>
          </div>
        )}

        {/* Built-in templates */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Templates</p>
          <div className="space-y-1">
            {RESUME_TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => openBuiltin(t)}
                className={`w-full text-left px-3 py-2 rounded-sm border transition text-[11px] ${
                  isBuiltin && selected?.id === t.id
                    ? 'bg-green-600 border-green-600 text-white font-semibold'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-green-500 hover:text-green-300'
                }`}
              >
                <span className="mr-1.5">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* User uploaded */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">My Files</p>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className="text-[9px] px-2 py-0.5 bg-green-700 text-white rounded-sm hover:bg-green-600 disabled:opacity-50 font-semibold"
            >
              {uploading ? '…' : '+ Upload'}
            </button>
          </div>
          <input ref={uploadRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
            onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} />

          {loadingUser ? (
            <p className="text-[10px] text-gray-500">Loading…</p>
          ) : userTemplates.length === 0 ? (
            <p className="text-[10px] text-gray-600 italic">No files uploaded yet</p>
          ) : (
            <div className="space-y-1">
              {userTemplates.map(v => (
                <div
                  key={v.id}
                  onClick={() => openUserTemplate(v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-sm border cursor-pointer transition text-[11px] ${
                    isUser && selected?.id === v.id
                      ? 'bg-green-600 border-green-600 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-green-500 hover:text-green-300'
                  }`}
                >
                  <span className="flex-1 truncate">📄 {v.label}</span>
                  <button onClick={e => handleDeleteUser(v, e)} className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── No template selected placeholder ─────────────────────────────────────
  const NoSelectionPlaceholder = (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 text-gray-600">
      <div className="text-5xl mb-4">📝</div>
      <p className="text-sm font-medium text-gray-500">Select a template to start editing</p>
      <p className="text-xs text-gray-600 mt-1">or upload your own PDF / DOCX</p>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      <div className="bg-gray-900 rounded-md shadow-2xl flex flex-col w-full h-full max-w-[1400px] max-h-[96vh] overflow-hidden border border-gray-700">

        {/* ── Top bar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-gray-800 shrink-0">
          {/* Traffic-light dots */}
          <div className="flex gap-1.5 shrink-0">
            <button onClick={onClose} className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition" title="Close" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
          </div>

          {/* File name */}
          <span className="text-gray-300 font-mono text-xs ml-1 truncate">
            {selected ? `${selected.label || 'resume'}.txt` : 'no file selected'}
          </span>
          {selected && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
              isBuiltin ? 'bg-yellow-800 text-yellow-300' :
              isUser    ? 'bg-blue-800 text-blue-300' :
                          'bg-green-800 text-green-300'
            }`}>
              {isBuiltin ? 'Template' : isUser ? 'My File' : 'Profile'}
            </span>
          )}

          {/* View mode toggle */}
          <div className="ml-auto flex items-center gap-1 bg-gray-700 rounded-sm p-0.5">
            {[['split', '⬛⬜'], ['editor', '⬛'], ['preview', '⬜']].map(([mode, icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                title={`${mode[0].toUpperCase()}${mode.slice(1)} view`}
                className={`px-3 py-1 text-[10px] font-semibold rounded-sm transition ${
                  viewMode === mode ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode === 'split' ? 'Split' : mode === 'editor' ? 'Editor' : 'Preview'}
              </button>
            ))}
          </div>

          {/* Save + Close */}
          <div className="flex items-center gap-2">
            {selected && (
              <button
                onClick={handleSave}
                disabled={saving || !user || !editText.trim()}
                className="px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-sm hover:bg-green-500 disabled:opacity-50 transition"
              >
                {saving ? 'Saving…' : user ? 'Save to Profile' : 'Login to Save'}
              </button>
            )}
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {Sidebar}

          {!selected ? NoSelectionPlaceholder : (
            <div className="flex flex-1 min-w-0" ref={containerRef}>

              {/* ── Code editor pane ──────────────────────────────────────── */}
              {showEditor && (
                <div className="flex flex-col bg-gray-900 min-w-0 border-r border-gray-700" style={editorStyle}>

                  {/* Toolbar */}
                  <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-700 bg-gray-800 shrink-0 flex-wrap">
                    <ToolBtn onClick={toolSection}  title="Make section header (Ctrl+Shift+H)">H1</ToolBtn>
                    <ToolBtn onClick={toolSubLabel} title="Insert sub-category label">H2</ToolBtn>
                    <ToolBtn onClick={toolBullet}   title="Toggle bullet point">•</ToolBtn>
                    <ToolBtn onClick={toolBlankLine} title="Insert blank line">↵</ToolBtn>
                    <Sep />
                    <ToolBtn onClick={toolClearMarkers} title="Remove all ✦ added-skill markers" warn>✦ Clear</ToolBtn>
                    {isBuiltin && (
                      <ToolBtn onClick={() => setEditText(selected.template)} title="Reset to original template" warn>↺ Reset</ToolBtn>
                    )}
                    <Sep />
                    <ToolBtn onClick={toolDownloadPdf}  title="Download as PDF">↓ PDF</ToolBtn>
                    <ToolBtn onClick={toolDownloadWord} title="Download as Word DOCX">↓ DOCX</ToolBtn>
                    <span className="ml-auto text-[9px] text-gray-600 font-mono">
                      Ctrl+S save · Tab indent · Ctrl+Shift+H section
                    </span>
                  </div>

                  {/* Editor area with line numbers */}
                  <div className="flex flex-1 overflow-hidden font-mono">
                    {/* Line numbers */}
                    <div
                      ref={lineNumRef}
                      className="select-none text-right pr-2 py-3 pl-2 text-gray-600 bg-gray-800 border-r border-gray-700 overflow-hidden shrink-0"
                      style={{ fontSize: 11, lineHeight: '1.65rem', minWidth: 40, userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {editText.split('\n').map((_, i) => (
                        <div key={i} style={{ height: '1.65rem' }}>{i + 1}</div>
                      ))}
                    </div>

                    {/* Textarea */}
                    <textarea
                      ref={textareaRef}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onKeyUp={updateCursor}
                      onClick={updateCursor}
                      onScroll={syncLineNums}
                      spellCheck={false}
                      placeholder={isProfile ? '' : 'Select a template from the sidebar…'}
                      className="flex-1 resize-none bg-gray-900 text-green-300 py-3 px-3 outline-none border-none overflow-auto"
                      style={{ fontSize: 12, lineHeight: '1.65rem', tabSize: 4, caretColor: '#4ade80' }}
                    />
                  </div>

                  {/* Status bar */}
                  <div className="flex items-center justify-between px-3 py-1 border-t border-gray-700 bg-gray-800 shrink-0">
                    <span className="text-[9px] text-gray-500 font-mono">
                      Ln {cursorPos.ln}, Col {cursorPos.col}
                    </span>
                    <span className="text-[9px] text-gray-500 font-mono">
                      {lineCount} lines · {charCount} chars · UTF-8
                    </span>
                  </div>
                </div>
              )}

              {/* ── Resize handle ─────────────────────────────────────────── */}
              {viewMode === 'split' && (
                <div
                  onMouseDown={onDividerDown}
                  className="w-1 bg-gray-700 hover:bg-green-500 cursor-col-resize shrink-0 transition-colors"
                  title="Drag to resize"
                />
              )}

              {/* ── Preview pane ──────────────────────────────────────────── */}
              {showPreview && (
                <div className="flex flex-col min-w-0 bg-gray-200 overflow-hidden" style={previewStyle}>
                  {/* Preview header */}
                  <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-300 bg-gray-100 shrink-0">
                    <span className="text-xs text-gray-500 font-medium">Preview — A4 document</span>
                    <span className="text-[9px] text-gray-400">Live · updates as you type</span>
                  </div>

                  {/* Paper scroll area */}
                  <div className="flex-1 overflow-y-auto p-6 bg-gray-200">
                    <div
                      className="bg-white shadow-lg mx-auto"
                      style={{
                        maxWidth: 680,
                        minHeight: 940,
                        padding: '36px 40px',
                        borderRadius: 2,
                        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
                      }}
                    >
                      <ResumeRenderer text={editText} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Bottom hint ───────────────────────────────────────────────────── */}
        {selected && (
          <div className="px-4 py-1.5 border-t border-gray-700 bg-gray-800 shrink-0 flex items-center gap-4">
            <span className="text-[10px] text-gray-500">
              {isBuiltin
                ? <>Replace <span className="font-mono text-yellow-500 text-[9px]">[placeholders]</span> with your details</>
                : 'Edit freely — changes are not auto-saved'
              }
            </span>
            <span className="text-[10px] text-gray-600">
              Green highlights (✦) = skills auto-added by the analyzer · "✦ Clear" strips them
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable toolbar button ───────────────────────────────────────────────────
function ToolBtn({ children, onClick, title, warn }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1 text-[10px] font-semibold rounded-sm transition ${
        warn
          ? 'text-yellow-400 hover:bg-yellow-900/40 hover:text-yellow-300'
          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="text-gray-700 mx-1 select-none">|</span>;
}
