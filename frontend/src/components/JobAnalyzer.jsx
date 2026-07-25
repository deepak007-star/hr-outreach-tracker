import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { extractSkills } from '../data/techSkills.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { modifyResume, downloadAsPdf, downloadAsWord } from '../utils/resumeUtils.js';
import ResumePreview from './ResumePreview.jsx';
import StepGuide from './StepGuide.jsx';

const STEPS = [
  { n: '01', title: 'Paste or fetch the job', desc: 'Drop in a job posting URL to auto-fetch it, or paste the description directly — either works.' },
  { n: '02', title: 'Add your resume', desc: 'Upload a PDF/DOCX, paste the text, or use the resume already saved on your Profile.' },
  { n: '03', title: 'Review your match score', desc: 'See your score and exactly which skills are missing, then merge them into your resume in one click.' },
];

// ── Skill chip ────────────────────────────────────────────────────────────

function SkillChip({ label, color = 'gray', selected, onClick }) {
  const base = 'text-xs px-2.5 py-1 rounded-full font-medium border cursor-pointer select-none transition-all';
  const colors = {
    green:  `bg-green-50  border-green-300  text-green-700  hover:bg-green-100`,
    red:    `bg-red-50    border-red-300    text-red-700    hover:bg-red-100`,
    blue:   selected
      ? 'bg-emerald-600 border-emerald-600 text-white'
      : 'bg-emerald-50  border-emerald-300 text-emerald-700 hover:bg-emerald-100',
    gray:   `bg-gray-100  border-gray-300    text-gray-600`,
  };
  return (
    <span className={`${base} ${colors[color]}`} onClick={onClick}>
      {label}
    </span>
  );
}

// ── Match score ring ─────────────────────────────────────────────────────
function MatchScoreCard({ score, presentCount, missingCount }) {
  const ring = score >= 70 ? 'border-emerald-500' : score >= 40 ? 'border-amber-400' : 'border-red-400';
  return (
    <div className="bg-white rounded-md shadow-card border border-gray-100 p-5 flex items-center gap-5">
      <div className={`w-20 h-20 rounded-full border-4 ${ring} flex flex-col items-center justify-center shrink-0`}>
        <span className="font-display text-2xl font-bold text-stone-900 leading-none">{score}</span>
        <span className="text-[10px] text-stone-400">/100</span>
      </div>
      <div className="flex-1 space-y-1.5">
        <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Skill Match Score</p>
        <div className="flex items-center gap-3 text-xs">
          <span className="w-16 text-stone-500 shrink-0">Present</span>
          <div className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${score}%` }} />
          </div>
          <span className="w-6 text-right text-stone-500 font-medium">{presentCount}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="w-16 text-stone-500 shrink-0">Missing</span>
          <div className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
            <div className="h-full rounded-full bg-red-400" style={{ width: `${100 - score}%` }} />
          </div>
          <span className="w-6 text-right text-stone-500 font-medium">{missingCount}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function JobAnalyzer() {
  const { user } = useAuth();

  // Job post
  const [jobUrl,     setJobUrl]     = useState('');
  const [jobContent, setJobContent] = useState('');
  const [jobTitle,   setJobTitle]   = useState('');
  const [scraping,   setScraping]   = useState(false);
  const [scrapeErr,  setScrapeErr]  = useState('');

  // Resume
  const [resumeText,        setResumeText]        = useState('');
  const [usingProfileResume, setUsingProfileResume] = useState(false);
  const [profileSkills,      setProfileSkills]      = useState([]);
  const [parsingResume,      setParsingResume]      = useState(false);
  const [parseErr,           setParseErr]           = useState('');
  const fileRef = useRef(null);

  // Auto-load profile resume when logged in
  useEffect(() => {
    if (!user) return;
    api.get('/profile')
      .then(p => {
        if (p.resume_text && !resumeText) {
          setResumeText(p.resume_text);
          setUsingProfileResume(true);
          setProfileSkills(p.skills || []);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Derived skills (no useState needed — pure derivation)
  const jobSkills     = useMemo(() => extractSkills(jobContent),  [jobContent]);
  const resumeSkills  = useMemo(() => extractSkills(resumeText),  [resumeText]);
  const missingSkills = useMemo(() => jobSkills.filter(k => !resumeSkills.includes(k)),  [jobSkills, resumeSkills]);
  const presentSkills = useMemo(() => jobSkills.filter(k =>  resumeSkills.includes(k)),  [jobSkills, resumeSkills]);

  // Vault suggestion: fire after jobSkills is derived
  useEffect(() => {
    setSuggestDismiss(false);
    setVaultSuggest(null);
    if (!user || jobSkills.length === 0) return;
    api.post('/resume-versions/suggest', { jobSkills, jobTitle })
      .then(r => { if (r.match) setVaultSuggest(r); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobSkills, user]);

  // Selection
  const [selectedSkills, setSelectedSkills] = useState(new Set());
  const [addedSkills,    setAddedSkills]    = useState([]);

  // Resume Vault suggestion
  const [vaultSuggest,   setVaultSuggest]   = useState(null);  // { match, matchCount, totalJobSkills }
  const [suggestDismiss, setSuggestDismiss] = useState(false);
  const [showSaveVault,  setShowSaveVault]  = useState(false);
  const [saveVaultLabel, setSaveVaultLabel] = useState('');
  const [saveVaultRole,  setSaveVaultRole]  = useState('');
  const [savingVault,    setSavingVault]    = useState(false);

  const modifiedText = useMemo(
    () => modifyResume(resumeText, addedSkills),
    [resumeText, addedSkills],
  );

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleScrape = async () => {
    const url = jobUrl.trim();
    if (!url) { setScrapeErr('Please enter a job posting URL'); return; }
    try { new URL(url); } catch {
      setScrapeErr('Enter a valid URL starting with https://');
      return;
    }
    if (!/^https?:\/\//i.test(url)) { setScrapeErr('URL must start with http:// or https://'); return; }
    setScraping(true); setScrapeErr('');
    try {
      const data = await api.post('/jobs/scrape', { url });
      setJobContent(data.content);
      setJobTitle(data.title);
      toast.success('Job post fetched successfully');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to fetch URL';
      setScrapeErr(msg);
    } finally {
      setScraping(false);
    }
  };

  const handleResumeFile = async (file) => {
    if (!file) return;
    setParsingResume(true); setParseErr('');
    const form = new FormData();
    form.append('resume', file);
    try {
      const data = await api.post('/jobs/parse-resume', form);
      setResumeText(data.text);
      setUsingProfileResume(false); // switched to fresh upload
      toast.success('Resume parsed successfully');
    } catch (err) {
      setParseErr(err.response?.data?.error || 'Failed to parse resume');
    } finally {
      setParsingResume(false);
    }
  };

  const toggleSkill = (skill) => {
    setSelectedSkills(prev => {
      const next = new Set(prev);
      next.has(skill) ? next.delete(skill) : next.add(skill);
      return next;
    });
  };

  const addAll = () => {
    setAddedSkills(missingSkills);
    setSelectedSkills(new Set(missingSkills));
    toast.success(`${missingSkills.length} skills added to resume preview`);
  };

  const addSelected = () => {
    if (!selectedSkills.size) return toast.error('Select at least one skill');
    setAddedSkills([...selectedSkills]);
    toast.success(`${selectedSkills.size} skills added to resume preview`);
  };

  const handleDownloadPdf  = () => downloadAsPdf(modifiedText, 'modified_resume');
  const handleDownloadWord = () => downloadAsWord(modifiedText, 'modified_resume');

  const handleSaveVault = async () => {
    if (!modifiedText.trim()) return;
    setSavingVault(true);
    try {
      await api.post('/resume-versions', {
        label:      saveVaultLabel.trim() || `${jobTitle || 'Modified Resume'} — ${new Date().toLocaleDateString('en-IN')}`,
        resumeText: modifiedText,
        targetRole: saveVaultRole.trim() || jobTitle,
        skills:     [...resumeSkills, ...addedSkills],
        autoSaved:  false,
      });
      toast.success('Saved to Resume Vault!');
      setShowSaveVault(false);
      setSaveVaultLabel('');
      setSaveVaultRole('');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save to vault');
    } finally {
      setSavingVault(false);
    }
  };

  const applyVaultResume = (resumeText) => {
    setResumeText(resumeText);
    setUsingProfileResume(false);
    setAddedSkills([]);
    setSelectedSkills(new Set());
    setSuggestDismiss(true);
    toast.success('Vault resume loaded!');
  };

  const hasJobContent   = jobContent.trim().length > 50;
  const hasResumeText   = resumeText.trim().length > 50;
  const showComparison  = hasJobContent && hasResumeText;
  const showPreview     = addedSkills.length > 0 && hasResumeText;
  const matchScore      = jobSkills.length ? Math.round((presentSkills.length / jobSkills.length) * 100) : 0;

  return (
    <div className="space-y-4">

      {/* ── Section header ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-md p-5 text-white">
        <h2 className="font-display text-lg font-bold">🎯 Job Analyzer</h2>
        <p className="text-emerald-100 text-sm mt-0.5">
          Paste a job post and your resume — see your match score and exactly which skills are missing.
        </p>
      </div>

      <StepGuide steps={STEPS} />

      {/* ── Match score ──────────────────────────────────────────────────── */}
      {showComparison && (
        <MatchScoreCard score={matchScore} presentCount={presentSkills.length} missingCount={missingSkills.length} />
      )}

      {/* ── Resume Vault suggestion banner ─────────────────────────────────── */}
      {vaultSuggest && !suggestDismiss && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-md px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-2xl shrink-0">📂</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">
                Resume Match Found — <span className="text-purple-700">{vaultSuggest.match.label}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Covers <strong>{vaultSuggest.matchCount}/{vaultSuggest.totalJobSkills}</strong> required skills
                {vaultSuggest.match.target_role && <> · Target: {vaultSuggest.match.target_role}</>}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => {
                api.get(`/resume-versions/${vaultSuggest.match.id}/text`)
                  .then(r => applyVaultResume(r.resume_text))
                  .catch(() => toast.error('Failed to load vault resume'));
              }}
              className="px-4 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-sm hover:bg-purple-700 transition whitespace-nowrap"
            >
              Use This Resume
            </button>
            <button onClick={() => setSuggestDismiss(true)} className="text-gray-400 hover:text-gray-600 text-sm px-2">✕</button>
          </div>
        </div>
      )}

      {/* ── Two-column layout ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* ── LEFT: Job Post ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-md shadow-card border border-gray-100 p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold tracking-widest text-emerald-700 uppercase">Job Post</p>
            <h2 className="text-sm font-bold text-gray-800 mt-0.5">📋 Paste or fetch the job</h2>
          </div>

          {/* URL input */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Job post URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={jobUrl}
                onChange={e => setJobUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScrape()}
                placeholder="https://careers.company.com/job/12345"
                className="flex-1 border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-300 outline-none"
              />
              <button
                onClick={handleScrape}
                disabled={scraping || !jobUrl.trim()}
                className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
              >
                {scraping ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
            {scrapeErr && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm p-2.5">
                ⚠ {scrapeErr}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t" />
            <span className="text-xs text-gray-400">or paste below</span>
            <div className="flex-1 border-t" />
          </div>

          {/* Job content textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">Job description</label>
              {jobContent && (
                <button
                  onClick={() => { setJobContent(''); setJobTitle(''); setScrapeErr(''); }}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              value={jobContent}
              onChange={e => setJobContent(e.target.value)}
              placeholder="Paste the full job description here…"
              rows={10}
              className="w-full border rounded-sm px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-emerald-300 outline-none"
            />
          </div>

          {/* Extracted keywords */}
          {hasJobContent && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">
                Detected keywords ({jobSkills.length})
              </p>
              {jobSkills.length === 0 ? (
                <p className="text-xs text-gray-400">No known tech skills detected.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {jobSkills.map(skill => (
                    <SkillChip
                      key={skill}
                      label={skill}
                      color={resumeSkills.includes(skill) ? 'green' : 'red'}
                    />
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400">
                <span className="text-green-600 font-medium">Green</span> = in your resume ·{' '}
                <span className="text-red-600 font-medium">Red</span> = missing
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT: Resume ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-md shadow-card border border-gray-100 p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold tracking-widest text-emerald-700 uppercase">Your Resume</p>
            <h2 className="text-sm font-bold text-gray-800 mt-0.5">📄 Upload or paste your resume</h2>
          </div>

          {/* Upload */}
          <div className="space-y-2">
            {usingProfileResume && (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-sm px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-emerald-700">
                  <span>👤</span>
                  <span><strong>Using resume from your Profile.</strong> Skills pre-loaded.</span>
                </div>
                <button
                  onClick={() => { setResumeText(''); setUsingProfileResume(false); setAddedSkills([]); setSelectedSkills(new Set()); }}
                  className="text-xs text-emerald-500 hover:text-red-500 underline ml-2 whitespace-nowrap"
                >
                  Clear
                </button>
              </div>
            )}
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              ref={fileRef}
              className="hidden"
              onChange={e => handleResumeFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={parsingResume}
              className="w-full border-2 border-dashed border-gray-300 rounded-sm py-4 text-sm text-gray-500 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-50"
            >
              {parsingResume
                ? '⏳ Parsing resume…'
                : usingProfileResume
                  ? '↺ Upload different resume (replaces profile one)'
                  : user
                    ? '⬆ Upload PDF, DOCX, or TXT (or use Profile resume above)'
                    : '⬆ Upload PDF, DOCX, or TXT'}
            </button>
            {!user && (
              <p className="text-xs text-gray-400 text-center">
                💡 <strong>Tip:</strong> Sign in and set up your Profile to skip uploading every time.
              </p>
            )}
            {parseErr && <p className="text-xs text-red-600">{parseErr}</p>}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t" />
            <span className="text-xs text-gray-400">or paste below</span>
            <div className="flex-1 border-t" />
          </div>

          {/* Resume textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">Resume text</label>
              {resumeText && (
                <button
                  onClick={() => { setResumeText(''); setAddedSkills([]); setSelectedSkills(new Set()); }}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              value={resumeText}
              onChange={e => setResumeText(e.target.value)}
              placeholder="Paste your resume text here…"
              rows={10}
              className="w-full border rounded-sm px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-emerald-300 outline-none"
            />
          </div>

          {/* ── Skills comparison ──────────────────────────────────────────── */}
          {showComparison && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Skills Analysis</p>

              {/* Present */}
              {presentSkills.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-green-700">
                    In your resume ({presentSkills.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {presentSkills.map(s => <SkillChip key={s} label={s} color="green" />)}
                  </div>
                </div>
              )}

              {/* Missing */}
              {missingSkills.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-red-700">
                    Missing from your resume ({missingSkills.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {missingSkills.map(s => (
                      <SkillChip
                        key={s}
                        label={s}
                        color="blue"
                        selected={selectedSkills.has(s)}
                        onClick={() => toggleSkill(s)}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">Click skills above to select specific ones</p>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap pt-1">
                    <button
                      onClick={addAll}
                      className="px-4 py-2 bg-green-600 text-white text-xs font-semibold rounded-sm hover:bg-green-700 transition"
                    >
                      ✚ Add All Missing ({missingSkills.length})
                    </button>
                    <button
                      onClick={addSelected}
                      disabled={selectedSkills.size === 0}
                      className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-40 transition"
                    >
                      ✚ Add Selected ({selectedSkills.size})
                    </button>
                    {addedSkills.length > 0 && (
                      <button
                        onClick={() => { setAddedSkills([]); setSelectedSkills(new Set()); }}
                        className="px-4 py-2 border text-xs font-medium rounded-sm hover:bg-gray-50 text-gray-600 transition"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-sm p-3 text-xs text-green-700">
                  Your resume already covers all detected skills for this job!
                </div>
              )}
            </div>
          )}

          {/* ── Modified resume preview ────────────────────────────────────── */}
          {showPreview && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                  Modified Resume Preview
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={handleDownloadPdf}  className="text-xs text-red-600   hover:text-red-800   font-medium border border-red-200   rounded px-2 py-1 hover:bg-red-50   transition">⬇ PDF</button>
                  <button onClick={handleDownloadWord} className="text-xs text-blue-700  hover:text-blue-900  font-medium border border-blue-200  rounded px-2 py-1 hover:bg-blue-50  transition">⬇ Word</button>
                  {user && (
                    <button onClick={() => { setSaveVaultLabel(jobTitle || ''); setSaveVaultRole(jobTitle || ''); setShowSaveVault(true); }} className="text-xs text-purple-700 hover:text-purple-900 font-medium border border-purple-200 rounded-sm px-2 py-1 hover:bg-purple-50 transition">Save to Vault</button>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-400">
                ✨ Green highlights show exactly where each skill was inserted in your resume.
              </p>
              <ResumePreview text={modifiedText} />
            </div>
          )}
        </div>
      </div>

      {/* ── Save to Vault modal ───────────────────────────────────────────── */}
      {showSaveVault && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowSaveVault(false)}>
          <div className="bg-white rounded-md shadow-modal w-full max-w-md">
            <div className="px-6 py-4 border-b">
              <h3 className="font-bold text-gray-900">Save Modified Resume to Vault</h3>
              <p className="text-xs text-gray-500 mt-0.5">Saves the resume with the {addedSkills.length} skill(s) you added</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Version Label</label>
                <input
                  value={saveVaultLabel}
                  onChange={e => setSaveVaultLabel(e.target.value)}
                  placeholder={`e.g. ${jobTitle || 'Backend Role'} — modified`}
                  className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Role</label>
                <input
                  value={saveVaultRole}
                  onChange={e => setSaveVaultRole(e.target.value)}
                  placeholder="e.g. Senior Backend Engineer"
                  className="w-full border rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
                  maxLength={80}
                />
              </div>
              <p className="text-xs text-gray-400">Skills saved: {[...resumeSkills, ...addedSkills].slice(0, 6).join(', ')}{([...resumeSkills, ...addedSkills].length > 6 ? ` +${[...resumeSkills, ...addedSkills].length - 6} more` : '')}</p>
            </div>
            <div className="flex gap-3 px-6 pb-5">
              <button onClick={() => setShowSaveVault(false)} className="flex-1 border rounded-sm py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleSaveVault} disabled={savingVault} className="flex-1 bg-purple-600 text-white rounded-sm py-2.5 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 transition">
                {savingVault ? 'Saving…' : 'Save to Vault'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Apply bar ─────────────────────────────────────────────────────── */}
      {jobUrl && hasJobContent && (
        <div className="bg-white rounded-md shadow-card border border-gray-100 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {jobTitle || 'Job Post'}
            </p>
            <p className="text-xs text-gray-400 truncate max-w-lg">{jobUrl}</p>
          </div>
          {user ? (
            <button
              onClick={() => window.open(jobUrl, '_blank', 'noopener')}
              className="px-5 py-2 bg-emerald-600 text-white rounded-sm text-sm font-semibold hover:bg-emerald-700 transition whitespace-nowrap"
            >
              Open Job Post &amp; Apply →
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-sm">
                Sign in to apply
              </span>
              <button
                onClick={() => {/* App.jsx will handle this via context — we use a custom event */
                  window.dispatchEvent(new CustomEvent('hr-open-login'));
                }}
                className="px-5 py-2 bg-emerald-600 text-white rounded-sm text-sm font-semibold hover:bg-emerald-700 transition whitespace-nowrap"
              >
                Sign In to Apply →
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
