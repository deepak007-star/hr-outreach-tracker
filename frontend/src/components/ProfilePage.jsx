import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { extractSkills } from '../data/techSkills.js';
import ProfileAnalyzer from './ProfileAnalyzer.jsx';
import { getSuggestedSkills } from '../data/skillSuggestions.js';
import { useDraft, readDraft, clearDraft, useBeforeUnload } from '../hooks/useDraft.js';
import { invalidateCache } from '../api/client.js';
import PasswordVault from './PasswordVault.jsx';
import ChangePassword from './ChangePassword.jsx';

const PROFILE_CACHE_KEY = 'ss:profile';
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 min

function readProfileCache() {
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return Date.now() - ts < PROFILE_CACHE_TTL ? data : null;
  } catch { return null; }
}
function writeProfileCache(data) {
  try { sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
}
function clearProfileCache() {
  try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
}

// ── Detection helpers ─────────────────────────────────────────────────────────
function detectName(t)  { const lines = t.split('\n').map(l=>l.trim()).filter(Boolean); for (const l of lines.slice(0,6)) if (/^[A-Z][a-z]+([\s-][A-Z][a-z]+){1,3}$/.test(l)) return l; return ''; }
function detectPhone(t) { const m = t.match(/(?:\+\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}/); return m ? m[0].trim() : ''; }
function detectTitle(t) { const m = t.match(/(Senior|Junior|Lead|Principal|Staff|Software|Backend|Frontend|Full[- ]?Stack|Data|DevOps|Cloud|Java|Python|React)[^\n]{4,60}(Engineer|Developer|Architect|Scientist|Analyst|Manager|Consultant|Specialist)/i); return m ? m[0].trim() : ''; }
function detectExp(t)   { const m = t.match(/(\d+\.?\d*)\s*\+?\s*years?\s*(of\s+)?(experience|exp)/i); return m ? `${m[1]} years` : ''; }

function Avatar({ name, size = 'lg' }) {
  const initials = (name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const cls = size === 'lg' ? 'w-20 h-20 text-2xl' : 'w-10 h-10 text-sm';
  return (
    <div className={`${cls} rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold flex-shrink-0 shadow-md`}>
      {initials}
    </div>
  );
}

function SkillChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs px-2.5 py-1 rounded-full">
      {label}
      {onRemove && <button onClick={onRemove} className="text-blue-400 hover:text-red-500 leading-none text-xs font-bold ml-0.5">&times;</button>}
    </span>
  );
}

function InfoField({ label, value, editing, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      {editing ? (
        <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
      ) : (
        <p className="text-sm text-gray-800">{value || <span className="text-gray-300 italic">Not set</span>}</p>
      )}
    </div>
  );
}

const INDIA_CITIES = [
  'Bangalore', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi NCR', 'Chennai',
  'Noida', 'Gurgaon', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Kochi',
  'Chandigarh', 'Indore', 'Bhubaneswar', 'Remote / WFH',
];

const JOB_TITLE_OPTIONS = [
  'Java Backend Engineer', 'Spring Boot Developer', 'Full Stack Developer',
  'Frontend Developer', 'React Developer', 'Node.js Developer',
  'DevOps Engineer', 'SRE / Platform Engineer', 'Data Engineer',
  'ML / AI Engineer', 'Android Developer', 'iOS Developer',
  'Software Architect', 'Engineering Manager', 'QA / SDET',
  'Python Developer', 'Cloud Engineer', 'Microservices Engineer',
];

function profileToOverviewForm(p) {
  return {
    current_title:      p?.current_title      || '',
    current_company:    p?.current_company    || '',
    location:           p?.location           || '',
    phone:              p?.phone              || '',
    total_experience:   p?.total_experience   || '',
    summary:            p?.summary            || '',
    notice_period:      p?.notice_period      || '',
    preferred_location: p?.preferred_location || '',
    job_title_1:        p?.job_title_1        || '',
    job_title_2:        p?.job_title_2        || '',
    job_title_3:        p?.job_title_3        || '',
    preferred_city:     p?.preferred_city     || '',
  };
}

// ── Draft restore banner ──────────────────────────────────────────────────────
function DraftBanner({ onRestore, onDiscard }) {
  return (
    <div className="flex items-center gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm mb-2">
      <span className="text-lg">📝</span>
      <span className="flex-1 text-amber-800 font-medium">You have an unsaved draft from your last session.</span>
      <button onClick={onRestore} className="px-3 py-1 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600">Restore</button>
      <button onClick={onDiscard} className="px-3 py-1 border border-amber-300 text-amber-700 text-xs font-semibold rounded-lg hover:bg-amber-100">Discard</button>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab({ profile, onSave, onDirtyChange }) {
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState(() => profileToOverviewForm(profile));
  const [saving,  setSaving]  = useState(false);
  const [draftBanner, setDraftBanner] = useState(false);
  const baseRef = useRef(profileToOverviewForm(profile));

  // On profile load, check for an existing draft
  useEffect(() => {
    const base = profileToOverviewForm(profile);
    baseRef.current = base;
    const draft = readDraft('profile:overview');
    if (draft && JSON.stringify(draft) !== JSON.stringify(base)) {
      setDraftBanner(true);
      // Keep current form (draft was already set or use base until user restores)
    } else {
      setForm(base);
    }
  }, [profile]);

  // Auto-save draft while editing
  useDraft('profile:overview', editing ? form : undefined);

  // Notify parent of dirty state
  const isDirty = editing && JSON.stringify(form) !== JSON.stringify(baseRef.current);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function restoreDraft() {
    const draft = readDraft('profile:overview');
    if (draft) { setForm(draft); setEditing(true); }
    setDraftBanner(false);
  }
  function discardDraft() {
    clearDraft('profile:overview');
    setForm(baseRef.current);
    setDraftBanner(false);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(form);
      baseRef.current = { ...form };
      clearDraft('profile:overview');
      setEditing(false);
      onDirtyChange?.(false);
      toast.success('Saved');
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  }

  function cancel() {
    setForm(baseRef.current);
    clearDraft('profile:overview');
    setEditing(false);
    onDirtyChange?.(false);
  }

  return (
    <div className="space-y-6">
      {draftBanner && <DraftBanner onRestore={restoreDraft} onDiscard={discardDraft} />}

      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <button onClick={cancel}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
            ✏️ Edit Overview
          </button>
        )}
      </div>

      <div>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Basic Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoField label="Job Title"           value={form.current_title}      editing={editing} onChange={v => set('current_title', v)}      placeholder="e.g. Senior Backend Engineer" />
          <InfoField label="Company"             value={form.current_company}    editing={editing} onChange={v => set('current_company', v)}    placeholder="e.g. Google" />
          <InfoField label="Location"            value={form.location}           editing={editing} onChange={v => set('location', v)}            placeholder="e.g. Bangalore, India" />
          <InfoField label="Phone"               value={form.phone}              editing={editing} onChange={v => set('phone', v)}               placeholder="+91 98765 43210" type="tel" />
          <InfoField label="Total Experience"    value={form.total_experience}   editing={editing} onChange={v => set('total_experience', v)}   placeholder="e.g. 4.5 years" />
          <InfoField label="Notice Period"       value={form.notice_period}      editing={editing} onChange={v => set('notice_period', v)}      placeholder="e.g. 30 days / Immediate" />
          <InfoField label="Preferred Location"  value={form.preferred_location} editing={editing} onChange={v => set('preferred_location', v)} placeholder="e.g. Noida, Gurugram, Remote" />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Job Search Preferences</h3>
        <p className="text-xs text-gray-400 mb-3">These titles filter LinkedIn posts and job suggestions automatically.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'job_title_1', label: 'Target Role 1 (Primary)' },
            { key: 'job_title_2', label: 'Target Role 2' },
            { key: 'job_title_3', label: 'Target Role 3' },
          ].map(({ key, label }) => (
            <div key={key}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              {editing ? (
                <div className="relative">
                  <input list={`${key}-opts`} value={form[key] || ''} onChange={e => set(key, e.target.value)}
                    placeholder="e.g. Java Backend Engineer"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
                  <datalist id={`${key}-opts`}>
                    {JOB_TITLE_OPTIONS.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
              ) : (
                <p className="text-sm text-gray-800">{form[key] || <span className="text-gray-300 italic">Not set</span>}</p>
              )}
            </div>
          ))}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Preferred City</p>
            {editing ? (
              <select value={form.preferred_city || ''} onChange={e => set('preferred_city', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                <option value="">Select city…</option>
                {INDIA_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <p className="text-sm text-gray-800">{form.preferred_city || <span className="text-gray-300 italic">Not set</span>}</p>
            )}
          </div>
        </div>
        {(!editing && (form.job_title_1 || form.preferred_city)) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[form.job_title_1, form.job_title_2, form.job_title_3].filter(Boolean).map((t, i) => (
              <span key={i} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1 rounded-full font-semibold">🎯 {t}</span>
            ))}
            {form.preferred_city && (
              <span className="text-xs bg-green-50 border border-green-200 text-green-700 px-3 py-1 rounded-full font-semibold">📍 {form.preferred_city}</span>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Professional Summary</h3>
        {editing ? (
          <textarea value={form.summary} onChange={e => set('summary', e.target.value)} rows={6}
            placeholder="Write a 3-5 sentence summary highlighting your experience, key skills, and what you're looking for…"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-blue-300 leading-relaxed" />
        ) : (
          <div className="bg-gray-50 rounded-xl px-4 py-4 min-h-[80px]">
            {form.summary
              ? <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{form.summary}</p>
              : <p className="text-sm text-gray-300 italic">No summary yet. Click "Edit Overview" to add one — it has the highest ATS impact.</p>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Resume file preview modal ─────────────────────────────────────────────────
function ResumeFilePreviewModal({ filename, onClose }) {
  const [blobUrl,  setBlobUrl]  = useState(null);
  const [fallback, setFallback] = useState('');
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let objUrl = null;
    (async () => {
      try {
        const token = localStorage.getItem('hr_token');
        const resp  = await fetch(`${API_ROOT}/api/profile/resume/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const blob = await resp.blob();
          objUrl = URL.createObjectURL(blob);
          setBlobUrl(objUrl);
        } else {
          setFallback('Resume file not available for preview.');
        }
      } catch {
        setFallback('Failed to load resume preview.');
      }
      setLoading(false);
    })();
    return () => { if (objUrl) URL.revokeObjectURL(objUrl); };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="font-bold text-gray-900">{filename || 'Resume Preview'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Your uploaded resume</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden rounded-b-2xl">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading preview…</div>
          ) : blobUrl ? (
            <iframe src={blobUrl} className="w-full h-full border-0" title="Resume" sandbox="allow-same-origin allow-popups" />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">{fallback}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Resume & Skills tab ───────────────────────────────────────────────────────
function ResumeSkillsTab({ profile, onSave }) {
  const [newSkill,    setNewSkill]    = useState('');
  const [uploading,   setUploading]   = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileRef = useRef(null);

  const skills = useMemo(() => { try { return JSON.parse(profile?.skills || '[]'); } catch { return []; } }, [profile?.skills]);

  const suggestions = useMemo(() =>
    getSuggestedSkills(profile?.current_title || '', skills).slice(0, 24),
    [profile?.current_title, skills],
  );

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('resume', file);
    try {
      const data = await api.post('/profile/resume', fd);
      const updates = { resume_filename: data.filename, resume_text: data.text, resume_uploaded_at: new Date().toISOString() };
      const detectedName  = detectName(data.text);
      const detectedTitle = detectTitle(data.text);
      const detectedPhone = detectPhone(data.text);
      const detectedExp   = detectExp(data.text);
      const detected = extractSkills(data.text);
      if (detectedName  && !profile?.full_name)        updates.full_name        = detectedName;
      if (detectedTitle && !profile?.current_title)    updates.current_title    = detectedTitle;
      if (detectedPhone && !profile?.phone)            updates.phone            = detectedPhone;
      if (detectedExp   && !profile?.total_experience) updates.total_experience = detectedExp;
      const merged = [...new Set([...skills, ...detected])];
      updates.skills = JSON.stringify(merged);
      await onSave(updates);
      const filled = [detectedName && 'name', detectedTitle && 'title', detectedExp && 'experience', detected.length && `${detected.length} skills`].filter(Boolean);
      toast.success('Resume uploaded!');
      if (filled.length) toast(`Auto-filled: ${filled.join(', ')}`, { icon: '✨' });
    } catch (err) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); }
  }

  async function addSkill(s) {
    const v = s.trim();
    if (!v || skills.map(x => x.toLowerCase()).includes(v.toLowerCase())) return;
    await onSave({ skills: JSON.stringify([...skills, v]) });
    setNewSkill('');
  }

  async function removeSkill(s) {
    await onSave({ skills: JSON.stringify(skills.filter(x => x !== s)) });
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Your Resume</h3>
        <input type="file" accept=".pdf,.docx,.doc,.txt" ref={fileRef} className="hidden"
          onChange={e => handleUpload(e.target.files?.[0])} />

        {profile?.resume_filename ? (
          <div className="flex items-center gap-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="text-3xl">📎</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-800 truncate">{profile.resume_filename}</p>
              {profile.resume_uploaded_at && (
                <p className="text-xs text-blue-500 mt-0.5">
                  Uploaded {new Date(profile.resume_uploaded_at).toLocaleDateString('en-IN')} · Skills & info auto-extracted ✓
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {profile.has_resume_file && (
                <button onClick={() => setShowPreview(true)}
                  className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition">
                  👁 Preview
                </button>
              )}
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="px-4 py-2 border border-blue-300 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-100 disabled:opacity-50">
                {uploading ? '⏳ Parsing…' : '↺ Update'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl py-10 flex flex-col items-center gap-2 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition disabled:opacity-50">
            <span className="text-4xl">{uploading ? '⏳' : '⬆️'}</span>
            <p className="text-sm font-semibold">{uploading ? 'Parsing resume…' : 'Upload Resume'}</p>
            <p className="text-xs">PDF, DOCX, or TXT — skills, title & experience are auto-extracted</p>
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Skills <span className="text-gray-300 font-normal">({skills.length})</span></h3>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[36px] mb-3">
          {skills.length === 0
            ? <p className="text-xs text-gray-300 italic self-center">No skills yet — upload your resume or add manually</p>
            : skills.map(s => <SkillChip key={s} label={s} onRemove={() => removeSkill(s)} />)
          }
        </div>
        <div className="flex gap-2">
          <input value={newSkill} onChange={e => setNewSkill(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill(newSkill))}
            placeholder="Type a skill and press Enter"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
          <button onClick={() => addSkill(newSkill)}
            className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700">+ Add</button>
        </div>
        {suggestions.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2 font-medium">
              💡 Suggested for <span className="text-indigo-600 font-semibold">{suggestions[0]?.domain}</span> — click to add
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map(({ skill }) => (
                <button key={skill} onClick={() => addSkill(skill)}
                  className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full hover:bg-indigo-100 transition">
                  + {skill}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {showPreview && (
        <ResumeFilePreviewModal filename={profile?.resume_filename} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}

// ── Links tab ─────────────────────────────────────────────────────────────────
function LinksTab({ profile, user, onSave, onDirtyChange }) {
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState({});
  const [saving,  setSaving]  = useState(false);
  const [draftBanner, setDraftBanner] = useState(false);
  const baseRef = useRef({});

  useEffect(() => {
    const base = {
      linkedin_url:  profile?.linkedin_url  || '',
      github_url:    profile?.github_url    || '',
      portfolio_url: profile?.portfolio_url || '',
    };
    baseRef.current = base;
    const draft = readDraft('profile:links');
    if (draft && JSON.stringify(draft) !== JSON.stringify(base)) {
      setDraftBanner(true);
    } else {
      setForm(base);
    }
  }, [profile]);

  useDraft('profile:links', editing ? form : undefined);

  const isDirty = editing && JSON.stringify(form) !== JSON.stringify(baseRef.current);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function restoreDraft() {
    const draft = readDraft('profile:links');
    if (draft) { setForm(draft); setEditing(true); }
    setDraftBanner(false);
  }
  function discardDraft() {
    clearDraft('profile:links');
    setForm(baseRef.current);
    setDraftBanner(false);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(form);
      baseRef.current = { ...form };
      clearDraft('profile:links');
      setEditing(false);
      onDirtyChange?.(false);
      toast.success('Links saved');
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  }

  function cancel() {
    setForm(baseRef.current);
    clearDraft('profile:links');
    setEditing(false);
    onDirtyChange?.(false);
  }

  const LINKS = [
    { key: 'linkedin_url',  label: 'LinkedIn',  icon: '🔗', placeholder: 'https://linkedin.com/in/your-handle', color: 'text-blue-600' },
    { key: 'github_url',    label: 'GitHub',    icon: '🐙', placeholder: 'https://github.com/your-handle',      color: 'text-gray-700' },
    { key: 'portfolio_url', label: 'Portfolio', icon: '🌐', placeholder: 'https://yoursite.com',                color: 'text-green-600' },
  ];

  return (
    <div className="space-y-6">
      {draftBanner && <DraftBanner onRestore={restoreDraft} onDiscard={discardDraft} />}

      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <button onClick={cancel}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Links'}
            </button>
          </>
        ) : (
          <button onClick={() => setEditing(true)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            ✏️ Edit Links
          </button>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Online Presence</h3>
        {LINKS.map(({ key, label, icon, placeholder, color }) => (
          <div key={key} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <span className="text-2xl shrink-0">{icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
              {editing ? (
                <input type="url" value={form[key] || ''} onChange={e => set(key, e.target.value)} placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300" />
              ) : form[key] ? (
                <a href={form[key]} target="_blank" rel="noopener" className={`text-sm truncate block hover:underline ${color}`}>{form[key]}</a>
              ) : (
                <p className="text-sm text-gray-300 italic">{placeholder}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Account</h3>
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
          <p className="text-sm font-semibold text-gray-800">{user?.name}</p>
          <p className="text-xs text-gray-400">{user?.email}</p>
          <p className="text-xs text-gray-300 mt-1">Role: <span className="capitalize text-gray-500">{user?.role || 'user'}</span></p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',   label: '👤 Overview' },
  { id: 'resume',     label: '📄 Resume & Skills' },
  { id: 'links',      label: '🔗 Links' },
  { id: 'score',      label: '📊 Profile Score' },
  { id: 'passwords',  label: '🔐 Passwords' },
];

export default function ProfilePage({ onDirtyChange }) {
  const { user }    = useAuth();
  const [profile,   setProfile]   = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [editHero,  setEditHero]  = useState(false);
  const [heroForm,  setHeroForm]  = useState({});
  const [savingHero, setSavingHero] = useState(false);
  const [heroDraftBanner, setHeroDraftBanner] = useState(false);
  const heroBaseRef = useRef({});

  // Hero dirty tracking
  const heroIsDirty = editHero && JSON.stringify(heroForm) !== JSON.stringify(heroBaseRef.current);
  // Tab-level dirty tracking (set by sub-tabs via callback)
  const [tabDirty, setTabDirty] = useState(false);

  const isDirty = heroIsDirty || tabDirty;
  useBeforeUnload(isDirty);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty]);

  // Draft for hero
  useDraft('profile:hero', editHero ? heroForm : undefined);

  useEffect(() => {
    // Render from cache immediately (no loading flash on tab switch)
    const cached = readProfileCache();
    if (cached) {
      setProfile(cached);
      const base = { full_name: cached.full_name || '' };
      heroBaseRef.current = base;
      const draft = readDraft('profile:hero');
      if (!draft || JSON.stringify(draft) === JSON.stringify(base)) setHeroForm(base);
    }
    // Always fetch fresh in background to pick up server-side changes
    api.get('/profile').then(p => {
      setProfile(p);
      writeProfileCache(p);
      const base = { full_name: p.full_name || '' };
      heroBaseRef.current = base;
      const draft = readDraft('profile:hero');
      if (draft && JSON.stringify(draft) !== JSON.stringify(base)) {
        setHeroDraftBanner(true);
      } else {
        setHeroForm(base);
      }
    }).catch(() => {});
  }, []);

  async function updateProfile(updates) {
    const merged = { ...profile, ...updates };
    await api.put('/profile', merged);
    setProfile(merged);
    writeProfileCache(merged);      // keep cache warm with the latest save
    invalidateCache('/profile');    // bust any stale API-level cache entries
  }

  async function saveHero() {
    setSavingHero(true);
    try {
      await updateProfile(heroForm);
      heroBaseRef.current = { ...heroForm };
      clearDraft('profile:hero');
      setEditHero(false);
      onDirtyChange?.(tabDirty);
      toast.success('Saved');
    } catch { toast.error('Save failed'); }
    finally { setSavingHero(false); }
  }

  function cancelHero() {
    setHeroForm(heroBaseRef.current);
    clearDraft('profile:hero');
    setEditHero(false);
  }

  const skills = useMemo(() => { try { return JSON.parse(profile?.skills || '[]'); } catch { return []; } }, [profile?.skills]);

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-gray-400 text-sm animate-pulse">Loading profile…</p>
      </div>
    );
  }

  const displayName = profile.full_name || user?.name || '';

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* ── Hero card ─────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl shadow-sm p-6 text-white">
        {heroDraftBanner && (
          <div className="flex items-center gap-3 bg-amber-500/20 border border-amber-400/40 rounded-xl px-3 py-2 text-sm mb-4">
            <span>📝</span>
            <span className="flex-1 text-amber-200 text-xs font-medium">Unsaved draft for name.</span>
            <button onClick={() => { const d = readDraft('profile:hero'); if (d) { setHeroForm(d); setEditHero(true); } setHeroDraftBanner(false); }}
              className="px-2 py-0.5 bg-amber-500 text-white text-xs font-semibold rounded hover:bg-amber-600">Restore</button>
            <button onClick={() => { clearDraft('profile:hero'); setHeroForm(heroBaseRef.current); setHeroDraftBanner(false); }}
              className="px-2 py-0.5 border border-amber-400/50 text-amber-200 text-xs font-semibold rounded hover:bg-amber-500/20">Discard</button>
          </div>
        )}
        <div className="flex items-start gap-5">
          <Avatar name={displayName} size="lg" />
          <div className="flex-1 min-w-0">
            {editHero ? (
              <input
                value={heroForm.full_name || ''}
                onChange={e => setHeroForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your full name"
                autoFocus
                className="bg-white/10 border border-white/30 rounded-lg px-3 py-1.5 text-base font-bold text-white placeholder-white/30 outline-none focus:border-white/60 w-full max-w-xs"
              />
            ) : (
              <h2 className="text-xl font-bold text-white">{displayName || <span className="text-white/40 italic font-normal">Name not set</span>}</h2>
            )}
            <p className="text-slate-300 text-sm mt-1">
              {profile.current_title || ''}
              {profile.current_company ? ` @ ${profile.current_company}` : ''}
            </p>
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-400">
              {profile.location         && <span>📍 {profile.location}</span>}
              {profile.total_experience && <span>💼 {profile.total_experience}</span>}
              {profile.phone            && <span>📞 {profile.phone}</span>}
              <span>✉ {user?.email}</span>
            </div>
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {skills.slice(0, 6).map(s => (
                  <span key={s} className="text-[10px] bg-white/10 text-white/70 px-2 py-0.5 rounded-full">{s}</span>
                ))}
                {skills.length > 6 && <span className="text-[10px] text-white/40">+{skills.length - 6} more</span>}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {editHero ? (
              <>
                <button onClick={cancelHero}
                  className="px-3 py-1.5 border border-white/20 rounded-lg text-xs text-white hover:bg-white/10">Cancel</button>
                <button onClick={saveHero} disabled={savingHero}
                  className="px-4 py-1.5 bg-blue-500 rounded-lg text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50">
                  {savingHero ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button onClick={() => setEditHero(true)}
                className="px-4 py-1.5 bg-white/10 border border-white/20 rounded-lg text-xs text-white hover:bg-white/20">
                ✏ Edit Name
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabbed sections ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 bg-gray-50">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-3 px-2 text-xs sm:text-sm font-medium text-center transition-all whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-white border-b-2 border-blue-600 text-blue-700 -mb-px'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'overview' && <OverviewTab profile={profile} onSave={updateProfile} onDirtyChange={setTabDirty} />}
          {activeTab === 'resume'   && <ResumeSkillsTab profile={profile} onSave={updateProfile} />}
          {activeTab === 'links'    && <LinksTab profile={profile} user={user} onSave={updateProfile} onDirtyChange={setTabDirty} />}
          {activeTab === 'score'    && (
            <ProfileAnalyzer
              profile={profile}
              onSave={async (updates) => {
                await updateProfile(updates);
                setActiveTab('score');
              }}
            />
          )}
          {activeTab === 'passwords' && (
            <div className="space-y-8">
              <ChangePassword />
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">Password Vault</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Store credentials for job boards, LinkedIn, email accounts and more. All passwords are encrypted at rest.
                </p>
                <PasswordVault isAdmin={false} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
