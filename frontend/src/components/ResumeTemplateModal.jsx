import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { RESUME_TEMPLATES } from '../data/resumeTemplates.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ResumeTemplateModal({ onClose, onSaved }) {
  const { user } = useAuth();
  const [selected, setSelected]   = useState(null);
  const [editText, setEditText]   = useState('');
  const [saving,   setSaving]     = useState(false);

  function openTemplate(t) {
    setSelected(t);
    setEditText(t.template);
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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">📄 ATS-Optimised Resume Templates</h2>
            <p className="text-xs text-gray-400 mt-0.5">Choose a domain template, customise in the editor, then save to your profile</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* Body — split layout */}
        <div className="flex flex-1 min-h-0">

          {/* Left — template grid */}
          <div className={`${selected ? 'w-52 shrink-0' : 'flex-1'} border-r overflow-y-auto bg-gray-50 p-4`}>
            {!selected && (
              <p className="text-sm font-semibold text-gray-600 mb-4">Choose your domain:</p>
            )}
            <div className={`${selected ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-4 sm:grid-cols-3'}`}>
              {RESUME_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => openTemplate(t)}
                  className={`text-left rounded-xl border p-4 transition-all hover:shadow-md ${
                    selected?.id === t.id
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-white border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <div className="text-2xl mb-2">{t.icon}</div>
                  <p className={`font-semibold text-sm ${selected?.id === t.id ? 'text-white' : 'text-gray-800'}`}>{t.label}</p>
                  {!selected && (
                    <p className={`text-xs mt-1 leading-relaxed ${selected?.id === t.id ? 'text-blue-100' : 'text-gray-500'}`}>{t.description}</p>
                  )}
                </button>
              ))}
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
                  className="w-full h-full resize-none bg-gray-900 text-green-300 font-mono text-[13px] leading-relaxed p-4 outline-none border-none"
                  style={{ tabSize: 4 }}
                />
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">
                  Edit the template above — replace all <span className="font-mono bg-gray-100 px-1 rounded">[placeholders]</span> with your details
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditText(selected.template)}
                    className="px-3 py-2 text-xs border rounded-lg hover:bg-gray-50 text-gray-600 transition"
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleUse}
                    disabled={saving || !user}
                    className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
                  >
                    {saving ? 'Saving…' : user ? '💾 Save to Profile' : 'Login to Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="hidden sm:flex flex-1 items-center justify-center text-gray-400 text-sm">
              ← Select a template to start editing
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
