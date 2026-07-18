import { useMemo, useState } from 'react';
import { extractSkills } from '../data/techSkills.js';

// ── Score engine ──────────────────────────────────────────────────────────────
const CHECKS = [
  { key: 'resume_text',      label: 'Resume',                weight: 16, hint: 'Upload or paste your resume — powers ATS analysis' },
  { key: '_skills',          label: 'Skills (5+)',           weight: 15, hint: 'Add at least 5 skills — recruiters search by skills' },
  { key: 'summary',          label: 'Professional summary',  weight: 12, hint: 'Write a 3-5 sentence professional summary (biggest ATS impact)' },
  { key: 'linkedin_url',     label: 'LinkedIn URL',          weight: 10, hint: 'Add your LinkedIn profile URL (critical for HR outreach)' },
  { key: 'full_name',        label: 'Full name',             weight: 8,  hint: 'Add your full name' },
  { key: 'current_title',    label: 'Current title',         weight: 8,  hint: 'Add your current job title' },
  { key: 'github_url',       label: 'GitHub URL',            weight: 7,  hint: 'Add your GitHub URL (shows active coding)' },
  { key: 'current_company',  label: 'Current company',       weight: 6,  hint: 'Add your current company' },
  { key: 'total_experience', label: 'Total experience',      weight: 5,  hint: 'Set your total years of experience' },
  { key: 'location',         label: 'Location',              weight: 5,  hint: 'Add your city/location (helps ATS geo-filters)' },
  { key: 'phone',            label: 'Phone number',          weight: 4,  hint: 'Add a phone number for recruiters to reach you' },
  { key: 'portfolio_url',    label: 'Portfolio / blog',      weight: 4,  hint: 'Add a portfolio or personal blog URL' },
];

function scoreProfile(profile) {
  const results = CHECKS.map(c => {
    let present = false;
    if (c.key === '_skills') {
      try { present = JSON.parse(profile?.skills || '[]').length >= 5; } catch { present = false; }
    } else if (c.key === 'resume_text') {
      present = !!(profile?.resume_text?.trim());
    } else {
      present = !!(profile?.[c.key]?.toString().trim());
    }
    return { ...c, present };
  });

  const maxScore = results.reduce((s, r) => s + r.weight, 0);
  const earned   = results.filter(r => r.present).reduce((s, r) => s + r.weight, 0);
  return {
    score:   Math.round((earned / maxScore) * 100),
    missing: results.filter(r => !r.present).sort((a, b) => b.weight - a.weight),
    done:    results.filter(r => r.present),
  };
}

// ── Resume auto-detection ─────────────────────────────────────────────────────
function detectFromResume(text, key) {
  if (!text) return '';
  switch (key) {
    case 'full_name': {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines.slice(0, 6))
        if (/^[A-Z][a-z]+([\s-][A-Z][a-z]+){1,3}$/.test(line)) return line;
      return '';
    }
    case 'current_title': {
      const m = text.match(/(Senior|Junior|Lead|Principal|Staff|Software|Backend|Frontend|Full[- ]?Stack|Data|DevOps|Cloud|Java|Python|React)[^\n]{4,60}(Engineer|Developer|Architect|Scientist|Analyst|Manager|Consultant|Specialist)/i);
      return m ? m[0].trim() : '';
    }
    case 'current_company': {
      const m = text.match(/(?:at|@|with)\s+([A-Z][A-Za-z0-9& ]{2,30}(?:Inc|Ltd|Pvt|Pvt\.?\s*Ltd|Technologies|Solutions|Systems|Tech|Labs)?)\b/);
      return m ? m[1].trim() : '';
    }
    case 'phone': {
      const m = text.match(/(?:\+\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}/);
      return m ? m[0].trim() : '';
    }
    case 'total_experience': {
      const m = text.match(/(\d+\.?\d*)\s*\+?\s*years?\s*(of\s+)?(experience|exp)/i);
      return m ? `${m[1]} years` : '';
    }
    case 'location': {
      const m = text.match(/\b([A-Z][a-z]+(?:[\s,]+[A-Z][a-zA-Z]+){0,2})\s*[,|·]\s*(?:India|IN|Remote)/i);
      return m ? m[1].trim() : '';
    }
    case 'linkedin_url': {
      const m = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s,)>"]+/);
      return m?.[0] || '';
    }
    case 'github_url': {
      const m = text.match(/https?:\/\/(?:www\.)?github\.com\/[^\s,)>"]+/);
      return m?.[0] || '';
    }
    case 'portfolio_url': {
      const m = text.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.com)[a-z0-9-]+\.[a-z]{2,}[^\s,)>"]{0,60}/i);
      return m?.[0] || '';
    }
    case 'summary': {
      const paras = text.split(/\n{2,}/).map(p => p.trim())
        .filter(p => p.length > 80 && !/^(EDUCATION|EXPERIENCE|SKILLS|CERTIF|PROJECT|WORK|LANGUAGE)/i.test(p));
      return paras[0]?.slice(0, 600) || '';
    }
    default: return '';
  }
}

// ── Priority badge ────────────────────────────────────────────────────────────
const PRIORITY = {
  high:   { label: 'High',   cls: 'bg-red-100 text-red-700 border-red-200' },
  medium: { label: 'Medium', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  low:    { label: 'Low',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};
function priority(weight) {
  return weight >= 10 ? 'high' : weight >= 6 ? 'medium' : 'low';
}

// ── Skills inline editor ──────────────────────────────────────────────────────
function SkillsEditor({ profile, onSave, onClose }) {
  const resumeSkills  = useMemo(() => extractSkills(profile?.resume_text || ''), [profile?.resume_text]);
  const existing      = useMemo(() => { try { return JSON.parse(profile?.skills || '[]'); } catch { return []; } }, [profile?.skills]);
  const [skills, setSkills] = useState(existing);
  const [input,  setInput]  = useState('');
  const [saving, setSaving] = useState(false);

  const newFromResume = resumeSkills.filter(s => !skills.map(x => x.toLowerCase()).includes(s.toLowerCase()));

  function add(s) {
    const v = s.trim();
    if (!v || skills.map(x => x.toLowerCase()).includes(v.toLowerCase())) return;
    setSkills(prev => [...prev, v]);
    setInput('');
  }

  function remove(s) { setSkills(prev => prev.filter(x => x !== s)); }

  async function save() {
    setSaving(true);
    try { await onSave({ skills: JSON.stringify(skills) }); onClose(); }
    finally { setSaving(false); }
  }

  return (
    <div className="mt-2 p-4 bg-white border border-blue-200 rounded-xl shadow-sm space-y-3">
      {/* Current skills */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Current skills</p>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {skills.length === 0 && <span className="text-xs text-gray-300 italic">None added yet</span>}
          {skills.map(s => (
            <span key={s} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs px-2.5 py-0.5 rounded-full">
              {s}
              <button onClick={() => remove(s)} className="text-blue-400 hover:text-red-500 text-xs leading-none">&times;</button>
            </span>
          ))}
        </div>
      </div>

      {/* Skills from resume */}
      {newFromResume.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Detected in your resume — click to add</p>
          <div className="flex flex-wrap gap-1.5">
            {newFromResume.slice(0, 30).map(s => (
              <button key={s} onClick={() => add(s)}
                className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 rounded-full hover:bg-indigo-100 transition">
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual add */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add(input))}
          placeholder="Type a skill and press Enter"
          className="flex-1 border rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300"
        />
        <button onClick={() => add(input)} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700">
          + Add
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving}
          className="px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving…' : `Save ${skills.length} skills`}
        </button>
        <button onClick={onClose} className="px-4 py-1.5 border rounded-lg text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
}

// ── Generic field editor ──────────────────────────────────────────────────────
function FieldEditor({ fieldKey, label, profile, onSave, onClose }) {
  const resumeText = profile?.resume_text || '';
  const detected   = detectFromResume(resumeText, fieldKey);
  const current    = fieldKey !== '_skills' && fieldKey !== 'resume_text' ? (profile?.[fieldKey] || '') : '';
  const [value,  setValue]  = useState(current || detected);
  const [saving, setSaving] = useState(false);

  // Prompt for resume upload
  if (fieldKey === 'resume_text') {
    return (
      <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 space-y-2">
        <p className="font-semibold">Upload your resume in the Resume section</p>
        <p className="text-xs">Scroll down to the Resume card and click "Upload Resume" or "Update Resume". PDF, DOCX, and TXT are supported. Skills, title, and experience are extracted automatically.</p>
        <button onClick={onClose} className="text-xs text-amber-600 underline">Got it</button>
      </div>
    );
  }

  const isTextarea = fieldKey === 'summary';
  const isUrl      = ['linkedin_url', 'github_url', 'portfolio_url'].includes(fieldKey);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try { await onSave({ [fieldKey]: value.trim() }); onClose(); }
    finally { setSaving(false); }
  }

  const showDetected = detected && detected !== current && detected !== value;

  return (
    <div className="mt-2 p-4 bg-white border border-blue-200 rounded-xl shadow-sm space-y-3">
      {/* Auto-detected banner */}
      {showDetected && (
        <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
          <span className="text-xs text-indigo-700 flex-1">
            <span className="font-semibold">Detected from resume:</span>{' '}
            <span className="font-mono">{detected.length > 80 ? detected.slice(0, 80) + '…' : detected}</span>
          </span>
          <button
            onClick={() => setValue(detected)}
            className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded font-semibold hover:bg-indigo-700 whitespace-nowrap shrink-0"
          >
            Use this
          </button>
        </div>
      )}

      {/* Input */}
      {isTextarea ? (
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={5}
          autoFocus
          placeholder={`Enter your ${label.toLowerCase()}…`}
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
        />
      ) : (
        <input
          type={isUrl ? 'url' : 'text'}
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
          placeholder={isUrl ? 'https://' : `Enter your ${label.toLowerCase()}…`}
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300"
        />
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !value.trim()}
          className="px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose} className="px-4 py-1.5 border rounded-lg text-xs text-gray-500 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Score ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score }) {
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : score >= 40 ? '#ea580c' : '#dc2626';
  const r = 38, cx = 48;
  const circumference = 2 * Math.PI * r;
  const dash = (score / 100) * circumference;

  return (
    <svg width={96} height={96} viewBox="0 0 96 96">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={10} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={10}
        strokeDasharray={`${dash} ${circumference - dash}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx + 1} textAnchor="middle" dominantBaseline="middle" fontSize={18} fontWeight="bold" fill={color}>{score}</text>
      <text x={cx} y={cx + 17} textAnchor="middle" fontSize={9} fill="#6b7280">/ 100</text>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProfileAnalyzer({ profile, onSave }) {
  const { score, missing, done } = useMemo(() => scoreProfile(profile), [profile]);
  const [openKey, setOpenKey] = useState(null);

  const label = score >= 80 ? { text: 'Strong profile',      cls: 'text-green-600' }
              : score >= 60 ? { text: 'Good — a few gaps',   cls: 'text-yellow-600' }
              : score >= 40 ? { text: 'Needs improvement',   cls: 'text-orange-600' }
              :               { text: 'Incomplete profile',  cls: 'text-red-600' };

  function toggle(key) { setOpenKey(prev => prev === key ? null : key); }

  async function handleSave(updates) {
    await onSave(updates);
    // Score ring refreshes automatically via profile prop change
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5 space-y-5">

      {/* Score ring + label */}
      <div className="flex items-center gap-4">
        <ScoreRing score={score} />
        <div>
          <h3 className="font-bold text-gray-900 text-base">Profile Completeness</h3>
          <p className={`text-sm font-semibold mt-0.5 ${label.cls}`}>{label.text}</p>
          <p className="text-xs text-gray-400 mt-1">{done.length}/{done.length + missing.length} sections complete</p>
        </div>
      </div>

      {/* Action items */}
      {missing.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Action Items</p>
          <div className="space-y-1.5">
            {missing.map(m => {
              const p  = priority(m.weight);
              const pi = PRIORITY[p];
              const isOpen = openKey === m.key;

              return (
                <div key={m.key}>
                  {/* Clickable row */}
                  <button
                    onClick={() => toggle(m.key)}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all ${
                      isOpen
                        ? 'bg-blue-50 border-blue-200 shadow-sm'
                        : 'bg-gray-50 border-gray-100 hover:bg-white hover:border-gray-200 hover:shadow-sm'
                    }`}
                  >
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${pi.cls}`}>
                      {pi.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{m.label}</p>
                      {!isOpen && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{m.hint}</p>}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">+{m.weight}pts</span>
                    <span className={`text-gray-400 text-xs shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
                  </button>

                  {/* Inline editor panel */}
                  {isOpen && (
                    m.key === '_skills' ? (
                      <SkillsEditor
                        profile={profile}
                        onSave={handleSave}
                        onClose={() => setOpenKey(null)}
                      />
                    ) : (
                      <FieldEditor
                        fieldKey={m.key}
                        label={m.label}
                        profile={profile}
                        onSave={handleSave}
                        onClose={() => setOpenKey(null)}
                      />
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Completed */}
      {done.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Completed</p>
          <div className="flex flex-wrap gap-1.5">
            {done.map(d => (
              <span key={d.key} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-0.5 rounded-full font-medium">
                ✓ {d.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {score === 100 && (
        <div className="text-center text-green-600 font-semibold text-sm py-2">
          🎉 Perfect profile! You're ready for outreach.
        </div>
      )}
    </div>
  );
}
