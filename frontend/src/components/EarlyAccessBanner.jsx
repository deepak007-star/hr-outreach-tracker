import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';

const JOB_TYPES = [
  'Java Developer', 'Full Stack Developer', 'Frontend Developer',
  'Backend Developer', 'DevOps / SRE', 'Data Engineer',
  'ML / AI Engineer', 'Android Developer', 'iOS Developer', 'Other',
];

const PLAN_OPTIONS = ['Guest (Free)', 'Demo (Free)', 'Basic (₹299/mo)', 'Advanced (₹599/mo)'];

const CONTACT_PREFS = [
  { value: 'email',    label: '✉️ Email',    desc: 'Send an email' },
  { value: 'whatsapp', label: '💬 WhatsApp', desc: 'WhatsApp message' },
  { value: 'linkedin', label: '💼 LinkedIn', desc: 'LinkedIn message' },
  { value: 'call',     label: '📞 Call',     desc: 'Phone call' },
];

const EMPTY = {
  name: '', email: '', mobile: '', plan_interest: '', experience: '', job_type: '', other_info: '',
  linkedin_url: '', twitter_handle: '', github_url: '', preferred_contact: 'email',
};

export default function EarlyAccessBanner() {
  const [dismissed,  setDismissed]  = useState(() => localStorage.getItem('hr_early_dismissed') === '1');
  const [open,       setOpen]       = useState(false);
  const [form,       setForm]       = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [step,       setStep]       = useState(1); // 2-step form

  if (dismissed) return null;

  const dismiss = () => { localStorage.setItem('hr_early_dismissed', '1'); setDismissed(true); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function openModal() { setOpen(true); setStep(1); setDone(false); }
  function closeModal() { setOpen(false); }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Enter a valid email address'); return;
    }
    if (form.linkedin_url.trim()) {
      try { new URL(form.linkedin_url.trim()); }
      catch { toast.error('LinkedIn URL must be a valid URL (https://...)'); return; }
    }
    setSubmitting(true);
    try {
      const res = await api.post('/leads', form);
      setDone(true);
      toast.success(res.updated ? 'Submission updated!' : "You're on the early access list! 🎉");
    } catch (err) {
      toast.error(err.response?.data?.error || 'Submission failed — try again');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 transition';
  const labelCls = 'block text-xs font-semibold text-gray-600 mb-1.5';

  return (
    <>
      {/* Banner */}
      <div className="bg-gradient-to-r from-purple-700 via-indigo-700 to-blue-700 text-white">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-lg">🚀</span>
            <p className="text-sm font-medium truncate">
              <strong>HR Outreach Tracker</strong> is in early access — register your interest for priority access &amp; updates!
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={openModal}
              className="bg-white text-purple-700 text-xs font-bold px-4 py-1.5 rounded-full hover:bg-purple-50 transition whitespace-nowrap">
              Register Interest →
            </button>
            <button onClick={dismiss} className="text-white/60 hover:text-white text-lg leading-none" aria-label="Dismiss">×</button>
          </div>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="sticky top-0 bg-white border-b px-6 pt-5 pb-4 z-10 rounded-t-2xl">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-extrabold text-gray-900 text-lg">Register Early Interest 🚀</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Priority access · Early-bird pricing · Feature input</p>
                </div>
                <button onClick={closeModal}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold transition shrink-0 mt-0.5">
                  ×
                </button>
              </div>

              {/* Progress bar */}
              {!done && (
                <div className="flex gap-2 mt-4">
                  {[1, 2].map(s => (
                    <div key={s} className={`flex-1 h-1.5 rounded-full transition-all ${step >= s ? 'bg-purple-600' : 'bg-gray-200'}`} />
                  ))}
                </div>
              )}
            </div>

            {done ? (
              /* Success state */
              <div className="px-6 py-8 text-center space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-3xl mx-auto">🎉</div>
                <div>
                  <p className="text-green-700 font-bold text-base">You're on the list!</p>
                  <p className="text-gray-500 text-sm mt-1">We'll reach out via your preferred channel.</p>
                </div>

                {/* Contact summary */}
                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-left space-y-2.5 text-sm">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Your Submission</p>
                  <div className="flex items-center gap-2"><span className="w-5 text-center">👤</span><span className="font-semibold text-gray-800">{form.name}</span></div>
                  <div className="flex items-center gap-2"><span className="w-5 text-center">✉️</span><span className="text-gray-600">{form.email}</span></div>
                  {form.mobile        && <div className="flex items-center gap-2"><span className="w-5 text-center">📞</span><span className="text-gray-600">{form.mobile}</span></div>}
                  {form.linkedin_url  && <div className="flex items-center gap-2"><span className="w-5 text-center">💼</span><a href={form.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{form.linkedin_url}</a></div>}
                  {form.twitter_handle && <div className="flex items-center gap-2"><span className="w-5 text-center">🐦</span><span className="text-gray-600">@{form.twitter_handle}</span></div>}
                  {form.github_url    && <div className="flex items-center gap-2"><span className="w-5 text-center">🐙</span><a href={`https://github.com/${form.github_url}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">github.com/{form.github_url}</a></div>}
                  {form.preferred_contact && (
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-center">📌</span>
                      <span className="text-gray-600">Preferred: <strong>{CONTACT_PREFS.find(c => c.value === form.preferred_contact)?.label}</strong></span>
                    </div>
                  )}
                </div>

                <button onClick={() => { setDone(false); setStep(1); }}
                  className="text-sm text-purple-600 underline hover:text-purple-800">
                  ✏️ Edit / update my submission
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>

                {/* ── Step 1: Basic info ── */}
                {step === 1 && (
                  <div className="px-6 py-5 space-y-4">
                    <p className="text-xs font-bold text-purple-600 uppercase tracking-widest">Step 1 of 2 — Basic Info</p>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Full Name *</label>
                        <input value={form.name} onChange={e => set('name', e.target.value)}
                          placeholder="Rahul Sharma" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Email *</label>
                        <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                          placeholder="rahul@gmail.com" className={inputCls} />
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>Mobile Number</label>
                      <input type="tel" value={form.mobile} onChange={e => set('mobile', e.target.value)}
                        placeholder="+91 98765 43210" className={inputCls} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Plan Interested In</label>
                        <select value={form.plan_interest} onChange={e => set('plan_interest', e.target.value)}
                          className={inputCls + ' bg-white'}>
                          <option value="">Select plan…</option>
                          {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Years of Experience</label>
                        <input value={form.experience} onChange={e => set('experience', e.target.value)}
                          placeholder="e.g. 4.5 years" className={inputCls} />
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>Job Role You're Targeting</label>
                      <select value={form.job_type} onChange={e => set('job_type', e.target.value)}
                        className={inputCls + ' bg-white'}>
                        <option value="">Select role…</option>
                        {JOB_TYPES.map(j => <option key={j} value={j}>{j}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className={labelCls}>Anything else you'd like to share?</label>
                      <textarea value={form.other_info} onChange={e => set('other_info', e.target.value)} rows={2}
                        placeholder="Current situation, specific needs, suggestions…"
                        className={inputCls + ' resize-none'} />
                    </div>

                    <button type="button"
                      onClick={() => {
                        if (!form.name.trim()) { toast.error('Name is required'); return; }
                        if (!form.email.trim()) { toast.error('Email is required'); return; }
                        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { toast.error('Enter a valid email address'); return; }
                        if (form.mobile.trim() && !/^[\d\s\+\-\(\)]{7,20}$/.test(form.mobile.trim())) { toast.error('Mobile number looks invalid'); return; }
                        setStep(2);
                      }}
                      className="w-full py-3 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 transition">
                      Next: Add Contact Links →
                    </button>
                  </div>
                )}

                {/* ── Step 2: Contact channels ── */}
                {step === 2 && (
                  <div className="px-6 py-5 space-y-4">
                    <p className="text-xs font-bold text-purple-600 uppercase tracking-widest">Step 2 of 2 — Contact Channels</p>
                    <p className="text-xs text-gray-400">So we can reach you via your preferred platform.</p>

                    <div>
                      <label className={labelCls}>LinkedIn Profile URL</label>
                      <input type="url" value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)}
                        placeholder="https://linkedin.com/in/your-handle" className={inputCls} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Twitter / X Handle</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                          <input value={form.twitter_handle} onChange={e => set('twitter_handle', e.target.value.replace('@', ''))}
                            placeholder="yourhandle" className={inputCls + ' pl-7'} />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>GitHub Username</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🐙</span>
                          <input value={form.github_url} onChange={e => set('github_url', e.target.value)}
                            placeholder="your-username" className={inputCls + ' pl-7'} />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>Preferred way to be contacted</label>
                      <div className="grid grid-cols-2 gap-2">
                        {CONTACT_PREFS.map(p => (
                          <button key={p.value} type="button" onClick={() => set('preferred_contact', p.value)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                              form.preferred_contact === p.value
                                ? 'bg-purple-600 border-purple-600 text-white shadow-md'
                                : 'bg-white border-gray-200 text-gray-600 hover:border-purple-300'
                            }`}>
                            <span className="text-base">{p.label.split(' ')[0]}</span>
                            <span>{p.label.split(' ').slice(1).join(' ')}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => setStep(1)}
                        className="px-5 py-2.5 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50 transition">
                        ← Back
                      </button>
                      <button type="submit" disabled={submitting}
                        className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-60 transition">
                        {submitting ? 'Submitting…' : '🚀 Register My Interest'}
                      </button>
                    </div>
                    <p className="text-center text-xs text-gray-400">No spam. We only reach out about HR Outreach Tracker.</p>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
