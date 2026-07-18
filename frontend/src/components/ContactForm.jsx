import { useState } from 'react';

const STATUSES    = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected','Do Not Contact'];
const SOURCES     = ['manual','csv_import','enrichment_api','job_board_scrape'];
const CONFIDENCES = ['unknown','guessed','verified'];

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inp = 'w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none transition';

export default function ContactForm({ contact, onSave, onClose }) {
  const [form, setForm] = useState({
    name:              contact?.name             || '',
    title:             contact?.title            || '',
    company:           contact?.company          || '',
    email:             contact?.email            || '',
    email_source:      contact?.email_source     || 'manual',
    email_confidence:  contact?.email_confidence || 'unknown',
    source_url:        contact?.source_url       || '',
    status:            contact?.status           || 'New',
    notes:             contact?.notes            || '',
    tags:              (contact?.tags || []).join(', '),
  });

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = e => {
    e.preventDefault();
    onSave({
      ...form,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b z-10">
          <h2 className="text-base font-bold">{contact ? 'Edit Contact' : 'Add New Contact'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name" required>
              <input required value={form.name} onChange={set('name')} placeholder="Priya Sharma" className={inp} />
            </Field>
            <Field label="Job Title">
              <input value={form.title} onChange={set('title')} placeholder="HR Manager" className={inp} />
            </Field>
            <Field label="Company">
              <input value={form.company} onChange={set('company')} placeholder="Acme Corp" className={inp} />
            </Field>
            <Field label="Email" required>
              <input required type="email" value={form.email} onChange={set('email')} placeholder="priya@acme.com" className={inp} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={set('status')} className={inp}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select value={form.email_source} onChange={set('email_source')} className={inp}>
                {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Email Confidence">
              <select value={form.email_confidence} onChange={set('email_confidence')} className={inp}>
                {CONFIDENCES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Tags (comma-separated)">
              <input value={form.tags} onChange={set('tags')} placeholder="fintech, priority" className={inp} />
            </Field>
          </div>

          <Field label="Source URL (job posting or career page)">
            <input type="url" value={form.source_url} onChange={set('source_url')} placeholder="https://..." className={inp} />
          </Field>

          <Field label="Notes">
            <textarea value={form.notes} onChange={set('notes')} rows={3}
              placeholder="Any notes about this contact…"
              className={`${inp} resize-none`} />
          </Field>

          <div className="flex gap-3 pt-1">
            <button type="submit"
              className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 transition">
              {contact ? 'Save Changes' : 'Add Contact'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 border rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
