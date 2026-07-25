import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { extractSkills } from '../data/techSkills.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { modifyResume, downloadAsPdf, downloadAsWord, cleanResumeText } from '../utils/resumeUtils.js';
import { analyzeAts } from '../utils/atsUtils.js';
import ResumePreview from './ResumePreview.jsx';

// ── ATS sub-components ────────────────────────────────────────────────────────

function ScoreGauge({ score }) {
  const r    = 44;
  const circ = 2 * Math.PI * r;
  const clr  = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#e5e7eb" strokeWidth="9" />
        <circle
          cx="55" cy="55" r={r} fill="none" stroke={clr} strokeWidth="9"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeLinecap="round" transform="rotate(-90 55 55)"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text x="55" y="51" textAnchor="middle" fontSize="24" fontWeight="bold" fill={clr}>{score}</text>
        <text x="55" y="66" textAnchor="middle" fontSize="10" fill="#9ca3af">/ 100</text>
      </svg>
      <p className="text-xs font-semibold text-center" style={{ color: clr }}>
        {score >= 80 ? '✓ ATS Ready' : score >= 60 ? '⚡ Good — improve further' : '⚠ Needs improvement'}
      </p>
    </div>
  );
}

function BreakdownBar({ label, score, max }) {
  const pct = Math.round((score / max) * 100);
  const bg  = pct >= 80 ? 'bg-green-500' : pct >= 55 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div>
      <div className="flex justify-between items-baseline mb-0.5">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-bold text-gray-700">{score}<span className="text-gray-400 font-normal text-[10px]">/{max}</span></span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${bg} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const PRIORITY_STYLE = {
  high:   { card: 'border-red-200 bg-red-50',    badge: 'bg-red-100 text-red-700'    },
  medium: { card: 'border-yellow-200 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700' },
  low:    { card: 'border-gray-200 bg-gray-50',  badge: 'bg-gray-100 text-gray-600'  },
};

function SuggestionCard({ s, onApplySkills, onTabSwitch }) {
  const st = PRIORITY_STYLE[s.priority] || PRIORITY_STYLE.low;
  return (
    <div className={`border rounded-sm p-3 ${st.card}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-bold text-gray-800 leading-snug flex-1">{s.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold capitalize ${st.badge}`}>{s.priority}</span>
          {s.impact > 0 && (
            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">+{s.impact}pt</span>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-600 leading-relaxed">{s.description}</p>
      {s.items?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.items.map((item, i) => (
            <span key={i} className="text-[11px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700">{item}</span>
          ))}
        </div>
      )}
      {s.action === 'add_skills' && (
        <button
          onClick={() => { onApplySkills(s.items); onTabSwitch('resume'); }}
          className="mt-2 text-xs bg-brand-600 text-white px-3 py-1.5 rounded-sm hover:bg-brand-700 font-semibold transition"
        >
          ✚ Add to Resume →
        </button>
      )}
    </div>
  );
}

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/;

function extractEmail(text) {
  return (text || '').match(EMAIL_RE)?.[0] || '';
}

function SkillChip({ label, color = 'gray' }) {
  const cls = {
    green: 'bg-green-50 border-green-300 text-green-700',
    red:   'bg-red-50 border-red-300 text-red-700',
    blue:  'bg-blue-50 border-blue-300 text-blue-700',
    gray:  'bg-gray-100 border-gray-300 text-gray-600',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls[color]}`}>{label}</span>;
}

const TAB_IDS = ['contact', 'resume', 'email', 'ats'];
const TAB_LABELS = { contact: '📬 Contact', resume: '📄 Resume', email: '✉️ Email', ats: '📊 ATS' };

export default function PostWorkflowModal({ post, onClose, onStatusChange }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('contact');

  // Auto-mark as viewed when modal first opens
  useEffect(() => {
    if (post.status === 'new') {
      onStatusChange?.(post.id, 'viewed');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Contact ──────────────────────────────────────────────────────────────
  const extractedEmail = useMemo(() => extractEmail(post.description), [post.description]);
  const [contactEmail, setContactEmail] = useState(extractedEmail);

  // ── Resume ───────────────────────────────────────────────────────────────
  const [resumeText,    setResumeText]    = useState('');
  const [parsingResume, setParsingResume] = useState(false);
  const [addedSkills,   setAddedSkills]   = useState([]);
  const [selectedMissing, setSelectedMissing] = useState(new Set());
  const [savingResume,  setSavingResume]  = useState(false);
  const fileRef = useRef(null);

  const jobSkills    = useMemo(() => {
    const fromStack = post.tech_stack || [];
    const fromDesc  = extractSkills(post.description);
    return [...new Set([...fromStack, ...fromDesc])];
  }, [post]);

  const resumeSkills  = useMemo(() => extractSkills(resumeText), [resumeText]);
  const missingSkills = useMemo(() => jobSkills.filter(s => !resumeSkills.includes(s)), [jobSkills, resumeSkills]);
  const presentSkills = useMemo(() => jobSkills.filter(s =>  resumeSkills.includes(s)), [jobSkills, resumeSkills]);
  const modifiedText  = useMemo(() => modifyResume(resumeText, addedSkills), [resumeText, addedSkills]);

  // Auto-load profile resume when on resume tab
  useEffect(() => {
    if (!user || resumeText) return;
    api.get('/profile').then(p => {
      if (p.resume_text) setResumeText(p.resume_text);
    }).catch(() => {});
  }, [user, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResumeFile = async (file) => {
    if (!file) return;
    setParsingResume(true);
    const form = new FormData();
    form.append('resume', file);
    try {
      const data = await api.post('/jobs/parse-resume', form);
      setResumeText(data.text);
      setAddedSkills([]);
      toast.success('Resume parsed');
    } catch { toast.error('Failed to parse resume'); }
    finally  { setParsingResume(false); }
  };

  const toggleMissing = (s) => setSelectedMissing(prev => {
    const n = new Set(prev);
    n.has(s) ? n.delete(s) : n.add(s);
    return n;
  });

  const addAllMissing = () => {
    setAddedSkills(missingSkills);
    setSelectedMissing(new Set(missingSkills));
    toast.success(`${missingSkills.length} skills added to resume`);
  };

  const addSelectedSkills = () => {
    if (!selectedMissing.size) { toast.error('Select skills first'); return; }
    setAddedSkills([...selectedMissing]);
    toast.success(`${selectedMissing.size} skills added`);
  };

  // ── ATS ──────────────────────────────────────────────────────────────────
  const [atsResult,  setAtsResult]  = useState(null);
  const [atsRunning, setAtsRunning] = useState(false);

  const modifiedSkills = useMemo(
    () => addedSkills.length > 0 ? [...new Set([...resumeSkills, ...addedSkills])] : resumeSkills,
    [resumeSkills, addedSkills],
  );

  const runAts = useCallback(() => {
    const textToAnalyze = addedSkills.length > 0 ? modifiedText : resumeText;
    if (!textToAnalyze) return;
    setAtsRunning(true);
    setAtsResult(null);
    setTimeout(() => {
      const result = analyzeAts(textToAnalyze, post.description || '', jobSkills, modifiedSkills);
      setAtsResult(result);
      setAtsRunning(false);
    }, 400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeText, modifiedText, addedSkills, post.description, jobSkills, modifiedSkills]);

  // Auto-run when switching to ATS tab (if resume is loaded)
  useEffect(() => {
    if (tab === 'ats' && resumeText && !atsResult && !atsRunning) runAts();
  }, [tab, resumeText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear result when resume text or added skills change so it re-analyzes
  useEffect(() => { setAtsResult(null); }, [resumeText, addedSkills]);

  const handleApplyAtsSkills = useCallback((skills) => {
    setAddedSkills(prev => [...new Set([...prev, ...skills])]);
    setSelectedMissing(prev => { const n = new Set(prev); skills.forEach(s => n.add(s)); return n; });
    toast.success(`${skills.length} skill${skills.length > 1 ? 's' : ''} added to resume`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save resume to profile ────────────────────────────────────────────────
  const handleSaveResume = async () => {
    const finalText = cleanResumeText(addedSkills.length > 0 ? modifiedText : resumeText);
    if (!finalText) { toast.error('No resume to save'); return; }
    setSavingResume(true);
    try {
      await api.put('/profile', { resume_text: finalText });
      // Create a notification
      await api.post('/notifications', {
        title: 'Resume updated',
        body: addedSkills.length > 0 ? `Added ${addedSkills.length} skill${addedSkills.length > 1 ? 's' : ''} and saved resume to profile.` : 'Resume saved to profile.',
        type: 'success',
      }).catch(() => {});
      toast.success('Resume saved to profile!');
      // Update local text, clear added skills, then switch to ATS tab
      setResumeText(finalText);
      setAddedSkills([]);
      setSelectedMissing(new Set());
      setTab('ats');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save resume');
    } finally {
      setSavingResume(false);
    }
  };

  // ── Email ─────────────────────────────────────────────────────────────────
  const [emailTo,      setEmailTo]      = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody,    setEmailBody]    = useState('');
  const [sending,      setSending]      = useState(false);

  // Pre-fill email fields when switching to email tab
  useEffect(() => {
    if (tab !== 'email') return;
    if (!emailTo)      setEmailTo(contactEmail);
    if (!emailSubject) setEmailSubject(`Application for ${post.title || 'the role'} at ${post.company_name || 'your company'}`);
    if (!emailBody) {
      const skills = presentSkills.slice(0, 8).join(', ');
      setEmailBody(
`Hi ${post.author_name || 'Hiring Manager'},

I came across your post about "${post.title || 'the opening'}" and I'm excited to apply.

${skills ? `My skill set includes: ${skills}.` : 'I have relevant experience that aligns with your requirements.'}

I'd love to discuss how I can contribute to your team. Please find my updated resume attached.

Looking forward to hearing from you.

Best regards`
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleSendEmail = async () => {
    if (!emailTo)      { toast.error('Recipient email is required'); return; }
    if (!emailSubject) { toast.error('Subject is required'); return; }
    if (!emailBody)    { toast.error('Email body is required'); return; }

    setSending(true);
    try {
      await api.post('/email/send-direct', { to: emailTo, subject: emailSubject, body: emailBody });
      toast.success(`Email sent to ${emailTo}!`);
      onStatusChange?.(post.id, 'contacted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };


  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:rounded-md shadow-modal sm:max-w-4xl max-h-[95vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b bg-white">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-extrabold text-gray-900 text-base leading-tight truncate">{post.title || 'LinkedIn Post'}</h2>
              {post.confidence_score >= 0.8 && (
                <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                  ✓ {Math.round(post.confidence_score * 100)}% match
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {[post.company_name, post.location].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-lg font-bold shrink-0">×</button>
        </div>

        {/* Tab nav */}
        <div className="flex border-b bg-white shrink-0">
          {TAB_IDS.map(id => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1 ${
                tab === id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[id]}
              {id === 'ats' && atsResult && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${
                  atsResult.overall >= 80 ? 'bg-green-100 text-green-700' :
                  atsResult.overall >= 60 ? 'bg-yellow-100 text-yellow-700' :
                                            'bg-red-100 text-red-700'
                }`}>{atsResult.overall}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-5 h-full">

            {/* Left: post info */}
            <div className="md:col-span-2 border-r p-4 space-y-3 bg-gray-50">
              {post.author_name && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Author</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">{post.author_name}</p>
                  {post.author_headline && <p className="text-xs text-gray-500">{post.author_headline}</p>}
                  {post.author_linkedin && (
                    <a href={post.author_linkedin} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand-600 hover:underline">LinkedIn Profile →</a>
                  )}
                </div>
              )}

              {post.company_name && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5">{post.company_name}</p>
                </div>
              )}

              {post.location && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</p>
                  <p className="text-xs text-gray-700 mt-0.5">📍 {post.location}</p>
                </div>
              )}

              {post.tech_stack?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tech Stack</p>
                  <div className="flex flex-wrap gap-1">
                    {post.tech_stack.map(t => <SkillChip key={t} label={t} color="blue" />)}
                  </div>
                </div>
              )}

              {post.posted_at && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Posted</p>
                  <p className="text-xs text-gray-600 mt-0.5">{new Date(post.posted_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</p>
                </div>
              )}

              {post.post_url && (
                <a href={post.post_url} target="_blank" rel="noopener noreferrer"
                  onClick={() => {
                    if (post.status !== 'applied' && post.status !== 'contacted') {
                      onStatusChange?.(post.id, 'viewed');
                    }
                  }}
                  className="block w-full text-center py-2 bg-brand-600 text-white text-xs font-bold rounded-sm hover:bg-brand-700 transition">
                  View LinkedIn Post →
                </a>
              )}

              {post.description && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-8 whitespace-pre-line">
                    {post.description}
                  </p>
                </div>
              )}
            </div>

            {/* Right: tab content */}
            <div className="md:col-span-3 p-5 space-y-4">

              {/* ── CONTACT TAB ── */}
              {tab === 'contact' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Recipient Email
                      {extractedEmail && <span className="ml-2 text-green-600 font-normal text-xs">✓ Found in post description</span>}
                      {!extractedEmail && <span className="ml-2 text-amber-500 font-normal text-xs">Not found — enter manually</span>}
                    </label>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)}
                      placeholder="recruiter@company.com"
                      className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Name</p>
                      <p className="text-sm text-gray-800">{post.author_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Company</p>
                      <p className="text-sm text-gray-800">{post.company_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Role</p>
                      <p className="text-sm text-gray-800">{post.job_type || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Location</p>
                      <p className="text-sm text-gray-800">{post.location || '—'}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => { setEmailTo(contactEmail); setTab('email'); }}
                      disabled={!contactEmail}
                      className="flex-1 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 disabled:opacity-50 transition"
                    >
                      ✉️ Compose Email →
                    </button>
                    <button
                      onClick={() => setTab('resume')}
                      className="flex-1 py-2 border text-sm font-semibold rounded-sm hover:bg-gray-50 transition text-gray-700"
                    >
                      📄 Update Resume →
                    </button>
                  </div>

                  {/* Status update */}
                  <div className="border-t pt-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Update Status</p>
                    <div className="flex gap-2 flex-wrap">
                      {['new','viewed','contacted','applied','rejected'].map(s => (
                        <button
                          key={s}
                          onClick={() => onStatusChange?.(post.id, s)}
                          className={`text-xs px-3 py-1 rounded-full border font-medium capitalize transition ${
                            post.status === s
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── RESUME TAB ── */}
              {tab === 'resume' && (
                <div className="space-y-4">
                  {/* Upload */}
                  <input type="file" accept=".pdf,.docx,.doc,.txt" ref={fileRef} className="hidden"
                    onChange={e => handleResumeFile(e.target.files?.[0])} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={parsingResume}
                    className="w-full border-2 border-dashed border-gray-300 rounded-sm py-3 text-sm text-gray-500 hover:border-brand-400 hover:bg-brand-50 transition disabled:opacity-50"
                  >
                    {parsingResume ? '⏳ Parsing…' : '⬆ Upload Resume (PDF, DOCX, TXT)'}
                  </button>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 border-t" /><span className="text-xs text-gray-400">or paste below</span><div className="flex-1 border-t" />
                  </div>

                  <textarea
                    value={resumeText}
                    onChange={e => setResumeText(e.target.value)}
                    rows={5}
                    placeholder="Paste your resume text here…"
                    className="w-full border rounded-sm px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-brand-300 outline-none"
                  />

                  {/* Skill analysis */}
                  {resumeText && jobSkills.length > 0 && (
                    <div className="space-y-3 border-t pt-3">
                      {presentSkills.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-green-700 mb-1">✅ Matching ({presentSkills.length})</p>
                          <div className="flex flex-wrap gap-1">
                            {presentSkills.map(s => <SkillChip key={s} label={s} color="green" />)}
                          </div>
                        </div>
                      )}

                      {missingSkills.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-red-700 mb-1">❌ Missing ({missingSkills.length}) — click to select</p>
                          <div className="flex flex-wrap gap-1">
                            {missingSkills.map(s => (
                              <span
                                key={s}
                                onClick={() => toggleMissing(s)}
                                className={`text-xs px-2 py-0.5 rounded-full border font-medium cursor-pointer transition ${
                                  selectedMissing.has(s)
                                    ? 'bg-brand-600 text-white border-brand-600'
                                    : 'bg-red-50 border-red-300 text-red-700'
                                }`}
                              >{s}</span>
                            ))}
                          </div>
                          <div className="flex gap-2 mt-2">
                            <button onClick={addAllMissing}
                              className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition">
                              ✚ Add All
                            </button>
                            <button onClick={addSelectedSkills} disabled={!selectedMissing.size}
                              className="px-3 py-1.5 bg-brand-600 text-white text-xs font-semibold rounded-sm hover:bg-brand-700 disabled:opacity-40 transition">
                              ✚ Add Selected ({selectedMissing.size})
                            </button>
                            {addedSkills.length > 0 && (
                              <button onClick={() => { setAddedSkills([]); setSelectedMissing(new Set()); }}
                                className="px-3 py-1.5 border text-xs rounded-sm hover:bg-gray-50 text-gray-600 transition">
                                Reset
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Download original */}
                  {resumeText && addedSkills.length === 0 && (
                    <div className="flex items-center justify-between border-t pt-3">
                      <p className="text-xs font-semibold text-gray-500">Download resume</p>
                      <div className="flex gap-2">
                        <button onClick={() => downloadAsPdf(resumeText, 'resume')} className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50 transition">⬇ PDF</button>
                        <button onClick={() => downloadAsWord(resumeText, 'resume')} className="text-xs text-brand-700 border border-brand-200 rounded px-2 py-1 hover:bg-brand-50 transition">⬇ Word</button>
                      </div>
                    </div>
                  )}

                  {/* Modified resume preview */}
                  {addedSkills.length > 0 && (
                    <div className="space-y-2 border-t pt-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-xs font-bold text-gray-700 uppercase">Updated Resume</p>
                        <div className="flex gap-2">
                          <button onClick={() => downloadAsPdf(modifiedText,  'updated_resume')} className="text-xs text-red-600  border border-red-200  rounded px-2 py-0.5 hover:bg-red-50  transition">⬇ PDF</button>
                          <button onClick={() => downloadAsWord(modifiedText, 'updated_resume')} className="text-xs text-brand-700 border border-brand-200 rounded px-2 py-0.5 hover:bg-brand-50 transition">⬇ Word</button>
                        </div>
                      </div>
                      <ResumePreview text={modifiedText} maxH="48" />
                    </div>
                  )}

                  {/* Save to profile */}
                  {resumeText && user && (
                    <div className="border-t pt-3">
                      <button
                        onClick={handleSaveResume}
                        disabled={savingResume}
                        className="w-full py-2.5 bg-green-600 text-white text-sm font-bold rounded-sm hover:bg-green-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
                      >
                        {savingResume ? '⏳ Saving…' : (
                          <>
                            <span>💾</span>
                            <span>{addedSkills.length > 0 ? `Save Updated Resume to Profile (${addedSkills.length} skills added)` : 'Save Resume to Profile'}</span>
                          </>
                        )}
                      </button>
                      <p className="text-[10px] text-gray-400 text-center mt-1">
                        {addedSkills.length > 0 ? 'Saves the updated version · ATS score will refresh automatically' : 'Saves current resume · ATS score will refresh automatically'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── EMAIL TAB ── */}
              {tab === 'email' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">To</label>
                    <input
                      type="email"
                      value={emailTo}
                      onChange={e => setEmailTo(e.target.value)}
                      placeholder="recruiter@company.com"
                      className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
                    />
                    {!emailTo && (
                      <p className="text-xs text-amber-600 mt-1">
                        ⚠ No email found in post. Go to <button onClick={() => setTab('contact')} className="underline">Contact tab</button> to enter manually.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Subject</label>
                    <input
                      value={emailSubject}
                      onChange={e => setEmailSubject(e.target.value)}
                      className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Body</label>
                    <textarea
                      value={emailBody}
                      onChange={e => setEmailBody(e.target.value)}
                      rows={9}
                      className="w-full border rounded-sm px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-brand-300 outline-none"
                    />
                  </div>

                  {addedSkills.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 text-xs text-green-700">
                      ✨ You've updated your resume with {addedSkills.length} skills. Download it from the <button onClick={() => setTab('resume')} className="underline font-semibold">Resume tab</button> to attach manually.
                    </div>
                  )}

                  <button
                    onClick={handleSendEmail}
                    disabled={sending || !emailTo}
                    className="w-full py-2.5 bg-brand-600 text-white text-sm font-bold rounded-sm hover:bg-brand-700 disabled:opacity-50 transition"
                  >
                    {sending ? '⏳ Sending…' : '✉️ Send Email'}
                  </button>

                  <p className="text-xs text-gray-400 text-center">Uses your configured SMTP settings</p>
                </div>
              )}

              {/* ── ATS TAB ── */}
              {tab === 'ats' && (
                <div className="space-y-4">

                  {/* No resume loaded */}
                  {!resumeText && (
                    <div className="flex flex-col items-center justify-center h-52 text-center space-y-3">
                      <div className="text-4xl">📄</div>
                      <div>
                        <p className="font-semibold text-gray-700">No resume loaded</p>
                        <p className="text-sm text-gray-400 mt-1">Upload or paste your resume in the Resume tab first</p>
                      </div>
                      <button onClick={() => setTab('resume')}
                        className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-sm hover:bg-brand-700 transition">
                        Go to Resume Tab →
                      </button>
                    </div>
                  )}

                  {/* Running */}
                  {resumeText && atsRunning && (
                    <div className="flex flex-col items-center justify-center h-52 gap-3">
                      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-gray-400 animate-pulse">Analyzing your resume…</p>
                    </div>
                  )}

                  {/* No result yet — manual trigger */}
                  {resumeText && !atsRunning && !atsResult && (
                    <div className="flex flex-col items-center justify-center h-52 text-center space-y-3">
                      <div className="text-4xl">📊</div>
                      <div>
                        <p className="font-semibold text-gray-700">ATS Score Checker</p>
                        <p className="text-sm text-gray-400 mt-1">See how well your resume matches this job post</p>
                      </div>
                      <button onClick={runAts}
                        className="px-5 py-2.5 bg-brand-600 text-white font-semibold rounded-sm hover:bg-brand-700 transition shadow-sm">
                        📊 Check ATS Score
                      </button>
                    </div>
                  )}

                  {/* Results */}
                  {resumeText && !atsRunning && atsResult && (
                    <>
                      {/* Score + breakdown */}
                      <div className="flex gap-4 items-start bg-gray-50 rounded-md p-4 border">
                        <ScoreGauge score={atsResult.overall} />
                        <div className="flex-1 space-y-2.5 min-w-0">
                          {atsResult.breakdown.map(b => (
                            <BreakdownBar key={b.label} {...b} />
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                          {atsResult.suggestions.length > 0
                            ? `${atsResult.suggestions.length} Improvement${atsResult.suggestions.length > 1 ? 's' : ''} Found`
                            : '🎉 No issues found!'}
                        </p>
                        <button onClick={runAts}
                          className="text-xs text-gray-400 hover:text-brand-600 underline transition">
                          ↺ Re-analyze
                        </button>
                      </div>

                      {/* Suggestions */}
                      {atsResult.suggestions.length > 0 ? (
                        <div className="space-y-2">
                          {atsResult.suggestions.map(s => (
                            <SuggestionCard
                              key={s.id}
                              s={s}
                              onApplySkills={handleApplyAtsSkills}
                              onTabSwitch={setTab}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="bg-green-50 border border-green-200 rounded-md p-5 text-center">
                          <p className="text-green-700 font-bold text-base">Great ATS score!</p>
                          <p className="text-green-600 text-sm mt-1">Your resume is well-optimized for this job posting.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
