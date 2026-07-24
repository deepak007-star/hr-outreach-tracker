import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/index.js';

const STATUSES    = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected','Do Not Contact'];
const SOURCES     = ['manual','csv_import','enrichment_api','job_board_scrape'];
const CONFIDENCES = ['unknown','guessed','verified'];

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500 font-medium">{error}</p>}
    </div>
  );
}

const inp = (err) =>
  `w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 outline-none transition ${
    err ? 'border-red-400 focus:ring-red-200 bg-red-50' : 'border-gray-200 focus:ring-brand-300 focus:border-brand-400'
  }`;

export default function ContactForm({ contact, onSave, onClose }) {
  const [form, setForm] = useState({
    name:             contact?.name             || '',
    title:            contact?.title            || '',
    company:          contact?.company          || '',
    email:            contact?.email            || '',
    email_source:     contact?.email_source     || 'manual',
    email_confidence: contact?.email_confidence || 'unknown',
    source_url:       contact?.source_url       || '',
    status:           contact?.status           || 'New',
    notes:            contact?.notes            || '',
    tags:             (Array.isArray(contact?.tags) ? contact.tags : []).join(', '),
  });
  const [errors, setErrors] = useState({});

  const set = k => e => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    setErrors(err => ({ ...err, [k]: '' }));
  };

  function validate() {
    const errs = {};
    if (!form.name.trim())  errs.name = 'Name is required';
    else if (form.name.trim().length < 2) errs.name = 'Name must be at least 2 characters';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = 'Enter a valid email address';
    if (form.source_url.trim()) {
      try { new URL(form.source_url.trim()); }
      catch { errs.source_url = 'Enter a valid URL (starting with https://)'; }
    }
    return errs;
  }

  const handleSubmit = e => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave({
      ...form,
      name:    form.name.trim(),
      email:   form.email.trim(),
      company: form.company.trim(),
      title:   form.title.trim(),
      tags:    form.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-md shadow-modal w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between px-6 py-4 border-b border-gray-100 z-10">
          <h2 className="text-base font-semibold text-gray-900">{contact ? 'Edit Contact' : 'Add New Contact'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name" required error={errors.name}>
              <input value={form.name} onChange={set('name')} placeholder="Priya Sharma" className={inp(errors.name)} />
            </Field>
            <Field label="Job Title">
              <input value={form.title} onChange={set('title')} placeholder="HR Manager" className={inp()} />
            </Field>
            <Field label="Company">
              <input value={form.company} onChange={set('company')} placeholder="Acme Corp" className={inp()} />
            </Field>
            <Field label="Email" required error={errors.email}>
              <input type="email" value={form.email} onChange={set('email')} placeholder="priya@acme.com" className={inp(errors.email)} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={set('status')} className={inp()}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select value={form.email_source} onChange={set('email_source')} className={inp()}>
                {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Email Confidence">
              <select value={form.email_confidence} onChange={set('email_confidence')} className={inp()}>
                {CONFIDENCES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Tags (comma-separated)">
              <input value={form.tags} onChange={set('tags')} placeholder="fintech, priority" className={inp()} />
            </Field>
          </div>

          <Field label="Source URL (job posting or career page)" error={errors.source_url}>
            <input type="url" value={form.source_url} onChange={set('source_url')} placeholder="https://..." className={inp(errors.source_url)} />
          </Field>

          <Field label="Notes">
            <textarea value={form.notes} onChange={set('notes')} rows={3}
              placeholder="Any notes about this contact…"
              className={`${inp()} resize-none`} />
          </Field>

          <div className="flex gap-3 pt-1">
            <Button type="submit" variant="primary" size="md" className="flex-1 justify-center">
              {contact ? 'Save Changes' : 'Add Contact'}
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={onClose} className="flex-1 justify-center">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
