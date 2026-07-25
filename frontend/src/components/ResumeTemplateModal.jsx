import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT } from '../api/client.js';
import { confirm } from '../utils/confirm.js';
import { RESUME_TEMPLATES } from '../data/resumeTemplates.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ResumeTemplateModal({ onClose, onSaved }) {
  const { user } = useAuth();
  const [selected,     setSelected]     = useState(null);
  const [editText,     setEditText]     = useState('');
  const [saving,       setSaving]       = useState(false);
  const [userTemplates, setUserTemplates] = useState([]);
  const [loadingUser,  setLoadingUser]  = useState(true);
  const [uploading,    setUploading]    = useState(false);
  const uploadRef = useRef(null);

  useEffect(() => {
    api.get('/resume-versions')
      .then(data => {
        const arr = Array.isArray(data) ? data : [];
        setUserTemplates(arr.filter(v => v.is_ats_template));
      })
      .catch(() => {})
      .finally(() => setLoadingUser(false));
  }, []);

  function openBuiltin(t) {
    setSelected({ ...t, _builtin: true });
    setEditText(t.template);
  }

  function openUserTemplate(v) {
    setSelected({ ...v, _user: true, label: v.label });
    setEditText('');
    api.get(`/resume-versions/${v.id}/text`)
      .then(data => setEditText(data.resume_text || ''))
      .catch(() => toast.error('Failed to load template text'));
  }

  async function handleUse() {
    if (!user) { toast.error('Please log in to save resume to profile'); return; }
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await api.put('/profile', { resume_text: editText });
      toast.success('Resume template saved to your profile!');
      onSaved?.(editText);
      onClose();
    } catch { toast.error('Failed to save'); }
    finally  { setSaving(false); }
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
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      const saved = await resp.json();
      setUserTemplates(ts => [saved, ...ts]);
      toast.success('Template uploaded!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }

  async function handleDeleteUser(v) {
    if (!await confirm(`Delete "${v.label}"?`)) return;
    try {
      await api.delete(`/resume-versions/${v.id}`);
      setUserTemplates(ts => ts.filter(t => t.id !== v.id));
      if (selected?.id === v.id) { setSelected(null); setEditText(''); }
      toast.success('Template deleted');
    } catch { toast.error('Delete failed'); }
  }

  const isUser    = !!selected?._user;
  const isBuiltin = !!selected?._builtin;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-md shadow-modal flex flex-col w-full max-w-5xl h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">ATS-Optimised Resume Templates</h2>
            <p className="text-xs text-gray-400 mt-0.5">Choose a template, customise in the editor, then save to your profile</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* Body — split layout */}
        <div className="flex flex-1 min-h-0">

          {/* Left — template list */}
          <div className={`${selected ? 'w-56 shrink-0' : 'flex-1'} border-r overflow-y-auto bg-gray-50 p-4 space-y-5`}>

            {/* Built-in templates */}
            <div>
              {!selected && <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Built-in Templates</p>}
              <div className={`${selected ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}`}>
                {RESUME_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => openBuiltin(t)}
                    className={`text-left rounded-sm border p-3 transition-all hover:shadow-md ${
                      selected?._builtin && selected?.id === t.id
                        ? 'bg-brand-600 text-white border-brand-600 shadow-md'
                        : 'bg-white border-gray-200 hover:border-brand-300'
                    }`}
                  >
                    <div className="text-xl mb-1">{t.icon}</div>
                    <p className={`font-semibold text-xs ${selected?._builtin && selected?.id === t.id ? 'text-white' : 'text-gray-800'}`}>{t.label}</p>
                    {!selected && (
                      <p className="text-[10px] mt-1 text-gray-500 leading-snug line-clamp-2">{t.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* User-uploaded templates */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">My Templates</p>
                <div>
                  <input
                    ref={uploadRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.txt"
                    className="hidden"
                    onChange={e => e.target.files[0] && handleUpload(e.target.files[0])}
                  />
                  <button
                    onClick={() => uploadRef.current?.click()}
                    disabled={uploading}
                    className="text-[10px] px-2 py-1 bg-brand-600 text-white rounded-sm hover:bg-brand-700 disabled:opacity-50 transition font-semibold"
                  >
                    {uploading ? 'Uploading…' : '+ Upload'}
                  </button>
                </div>
              </div>

              {loadingUser ? (
                <p className="text-xs text-gray-400">Loading…</p>
              ) : userTemplates.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No templates uploaded yet. Click "+ Upload" to add a PDF or DOCX.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {userTemplates.map(v => (
                    <div
                      key={v.id}
                      className={`flex items-center gap-2 rounded-sm border px-3 py-2 transition cursor-pointer ${
                        selected?._user && selected?.id === v.id
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white border-gray-200 hover:border-green-400 hover:bg-green-50'
                      }`}
                    >
                      <span className="flex-1 text-xs font-medium truncate" onClick={() => openUserTemplate(v)}>
                        {v.label}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteUser(v); }}
                        className={`text-[10px] shrink-0 ${
                          selected?._user && selected?.id === v.id
                            ? 'text-green-200 hover:text-white'
                            : 'text-red-400 hover:text-red-600'
                        }`}
                        title="Delete template"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right — code editor */}
          {selected ? (
            <div className="flex-1 flex flex-col min-w-0">
              {/* Editor header */}
              <div className="px-4 py-2 border-b bg-gray-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-yellow-400 font-mono text-xs">resume_template.txt</span>
                  <span className="text-gray-500 text-xs">— {selected.label}</span>
                  {isUser && <span className="text-[9px] bg-green-800 text-green-300 px-1.5 py-0.5 rounded font-bold">MY TEMPLATE</span>}
                </div>
                <div className="flex gap-1">
                  <span className="w-3 h-3 rounded-full bg-red-500 inline-block"/>
                  <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block"/>
                  <span className="w-3 h-3 rounded-full bg-green-500 inline-block"/>
                </div>
              </div>

              {/* Textarea editor */}
              <div className="flex-1 bg-gray-900 overflow-hidden">
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  spellCheck={false}
                  placeholder={isUser ? 'Loading…' : ''}
                  className="w-full h-full resize-none bg-gray-900 text-green-300 font-mono text-[13px] leading-relaxed p-4 outline-none border-none"
                  style={{ tabSize: 4 }}
                />
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">
                  {isBuiltin
                    ? <>Edit above — replace <span className="font-mono bg-gray-100 px-1 rounded">[placeholders]</span> with your details</>
                    : 'Your uploaded resume — edit freely, then save to profile'}
                </div>
                <div className="flex gap-2">
                  {isBuiltin && (
                    <button
                      onClick={() => setEditText(selected.template)}
                      className="px-3 py-2 text-xs border rounded-sm hover:bg-gray-50 text-gray-600 transition"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    onClick={handleUse}
                    disabled={saving || !user || !editText.trim()}
                    className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-sm hover:bg-green-700 disabled:opacity-50 transition"
                  >
                    {saving ? 'Saving…' : user ? 'Save to Profile' : 'Login to Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="hidden sm:flex flex-1 items-center justify-center text-gray-400 text-sm">
              Select a template to start editing
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
