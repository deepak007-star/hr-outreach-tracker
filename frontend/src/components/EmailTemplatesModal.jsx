import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { toast } from 'react-hot-toast';

const VARS = ['{{name}}', '{{company}}', '{{role}}', '{{your_name}}'];

const EMPTY = { name: '', subject: '', body: '' };

export default function EmailTemplatesModal({ mode = 'manage', onClose, onSelect }) {
  const [templates, setTemplates] = useState([]);
  const [selected,  setSelected]  = useState(null); // template being edited/viewed
  const [form,      setForm]      = useState(EMPTY);
  const [saving,    setSaving]    = useState(false);
  const [dirty,     setDirty]     = useState(false);

  useEffect(() => {
    api.get('/email-templates').then(setTemplates).catch(() => toast.error('Could not load templates'));
  }, []);

  function openTemplate(t) {
    setSelected(t);
    setForm({ name: t.name, subject: t.subject, body: t.body });
    setDirty(false);
  }

  function newTemplate() {
    setSelected({ _new: true });
    setForm(EMPTY);
    setDirty(false);
  }

  function handleFormChange(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setDirty(true);
  }

  function insertVar(v) {
    setForm(f => ({ ...f, body: f.body + v }));
    setDirty(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Template name is required');
    setSaving(true);
    try {
      if (selected?._new) {
        const created = await api.post('/email-templates', form);
        setTemplates(ts => [...ts, created]);
        setSelected(created);
      } else {
        await api.put(`/email-templates/${selected.id}`, form);
        setTemplates(ts => ts.map(t => t.id === selected.id ? { ...t, ...form } : t));
        setSelected(s => ({ ...s, ...form }));
      }
      setDirty(false);
      toast.success('Template saved');
    } catch { toast.error('Save failed'); }
    finally  { setSaving(false); }
  }

  async function handleDelete(t) {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.delete(`/email-templates/${t.id}`);
      setTemplates(ts => ts.filter(x => x.id !== t.id));
      if (selected?.id === t.id) { setSelected(null); setForm(EMPTY); }
      toast.success('Deleted');
    } catch { toast.error('Delete failed'); }
  }

  function handleSelect(t) {
    if (mode === 'select' && onSelect) {
      onSelect({ subject: t.subject, body: t.body });
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl h-[85vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">
              {mode === 'select' ? '📋 Choose a Template' : '📋 Email Templates'}
            </h2>
            {mode === 'select' && (
              <p className="text-xs text-gray-400 mt-0.5">Click a template to use it in your compose window</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Left — template list */}
          <div className="w-64 border-r flex flex-col bg-gray-50 shrink-0">
            <div className="p-3 border-b">
              {mode === 'manage' && (
                <button
                  onClick={newTemplate}
                  className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
                >
                  + New Template
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {templates.length === 0 && (
                <p className="text-xs text-gray-400 text-center mt-8">No templates yet</p>
              )}
              {templates.map(t => (
                <div
                  key={t.id}
                  onClick={() => mode === 'select' ? handleSelect(t) : openTemplate(t)}
                  className={`px-4 py-3 border-b cursor-pointer transition-colors ${
                    selected?.id === t.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                      {t.subject && (
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{t.subject}</p>
                      )}
                    </div>
                    {t.is_default === 1 && (
                      <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold shrink-0">DEFAULT</span>
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
              ))}
            </div>
          </div>

          {/* Right — editor / preview */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                {mode === 'manage' ? 'Select a template to edit, or create a new one' : 'Select a template from the list'}
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto p-5 space-y-4">

                  {/* Name */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Template Name</label>
                    <input
                      value={form.name}
                      onChange={e => handleFormChange('name', e.target.value)}
                      disabled={mode === 'select'}
                      placeholder="e.g. Cold Outreach — Backend Developer"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Subject Line</label>
                    <input
                      value={form.subject}
                      onChange={e => handleFormChange('subject', e.target.value)}
                      disabled={mode === 'select'}
                      placeholder="Hi {{name}}, exploring roles at {{company}}"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>

                  {/* Variables */}
                  {mode === 'manage' && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2">Insert variable</p>
                      <div className="flex gap-2 flex-wrap">
                        {VARS.map(v => (
                          <button
                            key={v}
                            onClick={() => insertVar(v)}
                            className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full hover:bg-indigo-100 font-mono"
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Body */}
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Email Body</label>
                    <textarea
                      value={form.body}
                      onChange={e => handleFormChange('body', e.target.value)}
                      disabled={mode === 'select'}
                      rows={14}
                      placeholder="Write your email body here…"
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-300 outline-none resize-none disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>

                </div>

                {/* Footer buttons */}
                <div className="px-5 py-3 border-t bg-gray-50 flex justify-between items-center">
                  {mode === 'select' ? (
                    <button
                      onClick={() => handleSelect({ subject: form.subject, body: form.body })}
                      className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
                    >
                      Use this Template →
                    </button>
                  ) : (
                    <>
                      <span className="text-xs text-gray-400">
                        {dirty ? 'Unsaved changes' : selected?._new ? 'New template' : 'All saved'}
                      </span>
                      <button
                        onClick={handleSave}
                        disabled={saving || !dirty}
                        className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                      >
                        {saving ? 'Saving…' : 'Save Template'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
