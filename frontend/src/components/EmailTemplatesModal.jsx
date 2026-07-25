import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api/client.js';
import { confirm } from '../utils/confirm.js';
import { toast } from 'react-hot-toast';
import RichEditor, { toHtml } from './RichEditor.jsx';
import AttachmentPicker from './AttachmentPicker.jsx';

const CATEGORIES = [
  { id: 'all',           label: 'All' },
  { id: 'cold-outreach', label: 'Cold Outreach' },
  { id: 'follow-up',     label: 'Follow-Up' },
  { id: 'referral',      label: 'Referral' },
  { id: 'direct-apply',  label: 'Direct Apply' },
  { id: 'networking',    label: 'Networking' },
];

// Variables the user can insert — profile-aware vars + per-recipient vars
const PROFILE_VARS = [
  { key: '{{your_name}}',          label: 'Your Name' },
  { key: '{{current_title}}',      label: 'Your Title' },
  { key: '{{experience}}',         label: 'Experience' },
  { key: '{{skills}}',             label: 'Skills (list)' },
  { key: '{{location}}',           label: 'Your Location' },
  { key: '{{preferred_location}}', label: 'Preferred Location' },
  { key: '{{notice_period}}',      label: 'Notice Period' },
  { key: '{{linkedin_url}}',       label: 'LinkedIn URL' },
  { key: '{{phone}}',              label: 'Phone' },
];

const RECIPIENT_VARS = [
  { key: '{{name}}',    label: 'Recipient Name' },
  { key: '{{company}}', label: 'Company' },
  { key: '{{role}}',    label: 'Role / Position' },
];

const EMPTY = { name: '', subject: '', body: '' };

function skillsToString(skills) {
  if (Array.isArray(skills)) return skills.join(', ');
  if (typeof skills === 'string') return skills;
  return '';
}

function buildVarMap(profile) {
  if (!profile) return {};
  return {
    '{{your_name}}':          profile.full_name || '',
    '{{current_title}}':      profile.current_title || '',
    '{{experience}}':         profile.total_experience || '',
    '{{skills}}':             skillsToString(profile.skills),
    '{{location}}':           profile.location || '',
    '{{preferred_location}}': profile.preferred_location || profile.preferred_city || '',
    '{{notice_period}}':      profile.notice_period || '',
    '{{linkedin_url}}':       profile.linkedin_url || '',
    '{{phone}}':              profile.phone || '',
  };
}

function substituteVars(text, varMap) {
  if (!text) return '';
  return text.replace(/\{\{\w+\}\}/g, (match) => varMap[match] ?? match);
}

function getTagsArray(t) {
  if (!t?.tags) return [];
  try { return Array.isArray(t.tags) ? t.tags : JSON.parse(t.tags); } catch { return []; }
}

function matchScore(template, profile) {
  if (!profile) return 0;
  let score = 0;
  const title  = (profile.current_title || '').toLowerCase();
  const skills = Array.isArray(profile.skills) ? profile.skills.map(s => s.toLowerCase()) : [];
  const tags   = getTagsArray(template).map(t => t.toLowerCase());
  tags.forEach(tag => {
    if (title.includes(tag) || skills.some(s => s.includes(tag))) score += 2;
    if (tag.split(' ').some(w => title.includes(w))) score += 1;
  });
  return score;
}

function generateFromProfile(profile) {
  if (!profile) return '';
  const skills  = Array.isArray(profile.skills) ? profile.skills : [];
  const name    = profile.full_name || '{{your_name}}';
  const title   = profile.current_title || 'Software Developer';
  const exp     = profile.total_experience || '';
  const loc     = profile.location || '';
  const prefLoc = profile.preferred_location || profile.preferred_city || '';
  const notice  = profile.notice_period || '';
  const li      = profile.linkedin_url || '';
  const phone   = profile.phone || '';

  const skillLines = skills.length > 0
    ? skills.map(s => `  • ${s}`).join('\n')
    : '  • (Add skills in your Profile)';

  const lines = [
    `Hi {{name}},`,
    ``,
    `I'm ${name}, a ${title}${exp ? ` with ${exp} of experience` : ''}, currently exploring new opportunities.`,
    ``,
    `Technical Skills:`,
    skillLines,
    ``,
  ];
  if (loc)     lines.push(`Current Location: ${loc}`);
  if (prefLoc) lines.push(`Preferred Locations: ${prefLoc}`);
  if (notice)  lines.push(`Notice Period: ${notice}`);
  if (li)      lines.push(`LinkedIn: ${li}`);
  if (phone)   lines.push(`Phone: ${phone}`);
  lines.push(``, `I'd love to connect and explore any ${title.toLowerCase()} opportunities at {{company}}.`);
  lines.push(``, `Best regards,`, name);

  return lines.join('\n');
}

export default function EmailTemplatesModal({ mode = 'manage', onClose, onSelect }) {
  const [templates,   setTemplates]   = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [form,        setForm]        = useState(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [dirty,       setDirty]       = useState(false);
  const [profile,     setProfile]     = useState(null);
  const [search,           setSearch]           = useState('');
  const [category,         setCategory]         = useState('all');
  const [previewMode,      setPreviewMode]       = useState(false);
  const [selectAttachment, setSelectAttachment] = useState(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const bodyEditorRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get('/email-templates'),
      api.get('/profile').catch(() => null),
    ]).then(([tmpl, prof]) => {
      setTemplates(Array.isArray(tmpl) ? tmpl : []);
      setProfile(prof && prof.user_id ? prof : null);
    }).catch(() => toast.error('Could not load templates'));
  }, []);

  const varMap = useMemo(() => buildVarMap(profile), [profile]);

  const filteredTemplates = useMemo(() => {
    let list = templates;
    if (category !== 'all') {
      list = list.filter(t => (t.category || 'general') === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.subject || '').toLowerCase().includes(q) ||
        (t.body || '').toLowerCase().includes(q) ||
        getTagsArray(t).some(tag => tag.includes(q))
      );
    }
    // Sort by profile relevance, then system templates first within same score
    return [...list].sort((a, b) => {
      const sd = matchScore(b, profile) - matchScore(a, profile);
      if (sd !== 0) return sd;
      return (b.is_default || 0) - (a.is_default || 0);
    });
  }, [templates, category, search, profile]);

  function openTemplate(t) {
    setSelected(t);
    setForm({ name: t.name, subject: t.subject, body: t.body });
    // Load the saved attachment preference for this template
    const att = t.attachment_json;
    setSelectAttachment(att && typeof att === 'object' ? att : null);
    setDirty(false);
    setPreviewMode(false);
  }

  function newTemplate() {
    setSelected({ _new: true });
    setForm(EMPTY);
    setDirty(false);
    setPreviewMode(false);
  }

  function handleFormChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setDirty(true);
  }

  function insertVar(v) {
    bodyEditorRef.current?.insertText(v);
    setDirty(true);
  }

  function handleGenerateFromProfile() {
    if (!profile) return toast.error('Profile not loaded — fill in your Profile tab first');
    const body = generateFromProfile(profile);
    const suggestedName = profile.current_title
      ? `Cold Outreach — ${profile.current_title}`
      : 'Generated from Profile';
    setForm(f => ({ ...f, body, name: f.name || suggestedName }));
    setDirty(true);
    toast.success('Template body generated from your profile');
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Template name is required');
    setSaving(true);
    try {
      let attachToSave = selectAttachment?.type && selectAttachment.type !== 'local' ? selectAttachment : null;

      // Auto-upload local file to vault so it's saved with the template
      if (selectAttachment?.type === 'local' && selectAttachment.data) {
        try {
          const raw = selectAttachment.data.includes(',')
            ? selectAttachment.data.split(',')[1]
            : selectAttachment.data;
          const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
          const blob  = new Blob([bytes], { type: selectAttachment.mimeType || 'application/octet-stream' });
          const rawLabel = selectAttachment.label || 'resume';
          const hasExt   = /\.[a-zA-Z]{2,5}$/.test(rawLabel);
          const extGuess = !hasExt
            ? (selectAttachment.mimeType?.includes('pdf')  ? '.pdf'
              : selectAttachment.mimeType?.includes('word') ? '.docx'
              : selectAttachment.mimeType?.includes('text') ? '.txt'
              : '.pdf')
            : '';
          const uploadName = rawLabel + extGuess;
          const fd    = new FormData();
          fd.append('resume', blob, uploadName);
          fd.append('label',  rawLabel);
          const result = await api.post('/resume-versions/upload', fd);
          attachToSave = { type: 'vault', vaultId: result.id, label: result.label || selectAttachment.label };
          setSelectAttachment(attachToSave);
          toast.success('File saved to vault and linked to template');
        } catch {
          toast.error('Could not save file to vault — template saved without attachment');
        }
      }

      if (selected?._new) {
        const created = await api.post('/email-templates', { ...form, category: 'general', attachment_json: attachToSave });
        const withAtt = { ...created, attachment_json: attachToSave };
        setTemplates(ts => [...ts, withAtt]);
        setSelected(withAtt);
      } else {
        await api.put(`/email-templates/${selected.id}`, {
          ...form,
          category: selected.category || 'general',
          tags: getTagsArray(selected),
          attachment_json: attachToSave,
        });
        setTemplates(ts => ts.map(t => t.id === selected.id ? { ...t, ...form, attachment_json: attachToSave } : t));
        setSelected(s => ({ ...s, ...form, attachment_json: attachToSave }));
      }
      setDirty(false);
      toast.success('Template saved');
    } catch { toast.error('Save failed'); }
    finally  { setSaving(false); }
  }

  async function handleDelete(t) {
    if (!await confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.delete(`/email-templates/${t.id}`);
      setTemplates(ts => ts.filter(x => x.id !== t.id));
      if (selected?.id === t.id) { setSelected(null); setForm(EMPTY); }
      toast.success('Deleted');
    } catch { toast.error('Delete failed'); }
  }

  function handleSelect(t) {
    if (mode !== 'select' || !onSelect) return;
    onSelect({
      subject:    substituteVars(t.subject || '', varMap),
      body:       substituteVars(t.body    || '', varMap),
      attachment: selectAttachment || null,
    });
    onClose();
  }

  const previewBody    = substituteVars(form.body    || '', varMap);
  const previewSubject = substituteVars(form.subject || '', varMap);

  return (
    <>
    {showAttachPicker && (
      <AttachmentPicker
        profile={profile}
        onSelect={a => { setSelectAttachment(a); setShowAttachPicker(false); }}
        onClose={() => setShowAttachPicker(false)}
      />
    )}
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-md shadow-modal flex flex-col w-full max-w-5xl h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">
              {mode === 'select' ? 'Choose a Template' : 'Email Templates'}
            </h2>
            {profile?.current_title ? (
              <p className="text-xs text-gray-400 mt-0.5">
                Profile match active — best templates for <strong>{profile.current_title}</strong> shown first
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">
                Fill your <strong>Profile</strong> tab to get personalised template suggestions
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Left — template list */}
          <div className="w-72 border-r flex flex-col bg-gray-50 shrink-0">

            {/* Search + New */}
            <div className="p-3 border-b space-y-2">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full border rounded-sm px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white"
              />
              {mode === 'manage' && (
                <button
                  onClick={newTemplate}
                  className="w-full px-3 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 transition"
                >
                  + New Template
                </button>
              )}
            </div>

            {/* Category pills */}
            <div className="flex overflow-x-auto px-2 py-2 gap-1.5 border-b shrink-0" style={{ scrollbarWidth: 'none' }}>
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition ${
                    category === c.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-white border text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Template list */}
            <div className="flex-1 overflow-y-auto">
              {filteredTemplates.length === 0 && (
                <p className="text-xs text-gray-400 text-center mt-8 px-4">No templates found</p>
              )}
              {filteredTemplates.map(t => {
                const score = matchScore(t, profile);
                return (
                  <div
                    key={t.id}
                    onClick={() => openTemplate(t)}
                    className={`px-4 py-3 border-b cursor-pointer transition-colors ${
                      selected?.id === t.id
                        ? 'bg-brand-50 border-l-2 border-l-brand-500'
                        : 'hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                          {score > 1 && (
                            <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">MATCH</span>
                          )}
                        </div>
                        {t.subject && (
                          <p className="text-[11px] text-gray-400 truncate mt-0.5">{t.subject}</p>
                        )}
                        {t.category && t.category !== 'general' && (
                          <span className="text-[10px] text-brand-500">{t.category}</span>
                        )}
                      </div>
                      {t.is_default === 1 && (
                        <span className="text-[9px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">SYS</span>
                      )}
                    </div>
                    {mode === 'manage' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(t); }}
                        className="text-[10px] text-red-400 hover:text-red-600 mt-1"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right — editor / preview */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm px-8 text-center">
                {mode === 'manage'
                  ? 'Select a template to edit, or create a new one'
                  : 'Select a template from the list to use it'}
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto p-5 space-y-4">

                  {/* Template Name */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Template Name</label>
                    <input
                      value={form.name}
                      onChange={e => handleFormChange('name', e.target.value)}
                      disabled={mode === 'select'}
                      placeholder="e.g. Cold Outreach — Backend Developer"
                      className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Subject Line</label>
                    <input
                      value={previewMode ? previewSubject : form.subject}
                      onChange={e => handleFormChange('subject', e.target.value)}
                      disabled={mode === 'select' || previewMode}
                      placeholder="Hi {{name}}, exploring roles at {{company}}"
                      className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>

                  {/* Variable inserter — only in edit mode */}
                  {mode === 'manage' && !previewMode && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-gray-500">Insert variable</p>
                        <button
                          onClick={handleGenerateFromProfile}
                          disabled={!profile}
                          className="text-xs bg-purple-600 text-white px-3 py-1 rounded-full hover:bg-purple-700 disabled:opacity-50 transition font-medium"
                          title={profile ? 'Auto-generate body from your profile data' : 'Fill your Profile tab first'}
                        >
                          Generate from Profile
                        </button>
                      </div>

                      {/* Profile vars */}
                      <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Your profile</p>
                      <div className="flex gap-1.5 flex-wrap mb-2">
                        {PROFILE_VARS.map(v => (
                          <button
                            key={v.key}
                            onMouseDown={e => { e.preventDefault(); insertVar(v.key); }}
                            className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full hover:bg-purple-100 font-mono"
                            title={v.label}
                          >
                            {v.key}
                          </button>
                        ))}
                      </div>

                      {/* Recipient vars */}
                      <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Recipient (filled when sending)</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {RECIPIENT_VARS.map(v => (
                          <button
                            key={v.key}
                            onMouseDown={e => { e.preventDefault(); insertVar(v.key); }}
                            className="text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded-full hover:bg-brand-100 font-mono"
                            title={v.label}
                          >
                            {v.key}
                          </button>
                        ))}
                      </div>

                      {/* Profile summary line */}
                      {profile && (
                        <div className="mt-2 text-xs text-gray-500 bg-gray-100 rounded-sm px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
                          {profile.current_title && <span><strong>{profile.current_title}</strong></span>}
                          {profile.total_experience && <span>{profile.total_experience}</span>}
                          {profile.notice_period && <span>Notice: {profile.notice_period}</span>}
                          {profile.location && <span>{profile.location}</span>}
                          {!profile.current_title && <span className="text-amber-600">Profile incomplete — add title, skills, notice period for best results</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Body */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-500">Email Body</label>
                      <button
                        onClick={() => setPreviewMode(p => !p)}
                        className={`text-xs px-2.5 py-0.5 rounded-full border font-medium transition ${
                          previewMode
                            ? 'bg-purple-100 text-purple-700 border-purple-200'
                            : 'text-gray-500 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {previewMode ? 'Edit' : 'Preview with profile'}
                      </button>
                    </div>
                    {previewMode ? (
                      <div
                        className="w-full border rounded-lg px-4 py-3 text-sm bg-gray-50 min-h-[260px] text-gray-700 leading-relaxed overflow-auto"
                        dangerouslySetInnerHTML={{ __html: previewBody || '<span style="color:#ccc;font-style:italic">No body</span>' }}
                      />
                    ) : (
                      <RichEditor
                        ref={bodyEditorRef}
                        value={form.body}
                        onChange={v => handleFormChange('body', v)}
                        disabled={mode === 'select'}
                        minRows={13}
                      />
                    )}
                  </div>

                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t bg-gray-50 space-y-2">
                  {/* Attachment row — shown in both modes */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">
                      {mode === 'manage' ? 'Default attachment:' : 'Attach resume:'}
                    </span>
                    {selectAttachment ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded px-2 py-0.5 truncate flex-1">
                          {selectAttachment.label}
                          {selectAttachment.type === 'local' && <span className="text-amber-600"> (will be saved to vault on save)</span>}
                        </span>
                        <button onClick={() => setSelectAttachment(null)} className="text-xs text-red-400 hover:text-red-600 shrink-0">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAttachPicker(true)}
                        className="text-xs px-2.5 py-1 border border-dashed border-gray-300 rounded-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 transition"
                      >
                        + Pick resume
                      </button>
                    )}
                  </div>

                  {mode === 'select' ? (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">
                        Profile vars ({Object.values(varMap).filter(Boolean).length > 0 ? 'auto-filled' : 'not set'})
                      </span>
                      <button
                        onClick={() => handleSelect({ subject: form.subject, body: form.body })}
                        className="px-5 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 transition"
                      >
                        Use this Template →
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">
                        {dirty ? 'Unsaved changes' : selected?._new ? 'New template' : 'All saved'}
                      </span>
                      <button
                        onClick={handleSave}
                        disabled={saving || !dirty}
                        className="px-5 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 disabled:opacity-50 transition"
                      >
                        {saving ? 'Saving…' : 'Save Template'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
