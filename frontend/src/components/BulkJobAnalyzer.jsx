import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { extractSkills } from '../data/techSkills.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { modifyResume, downloadAsPdf, downloadAsWord, normalizeResumeText } from '../utils/resumeUtils.js';
import ResumePreview from './ResumePreview.jsx';
import StepGuide from './StepGuide.jsx';

const STEPS = [
  { n: '01', title: 'Paste every job URL', desc: 'One per line — we scrape each one and detect the skills every posting is asking for.' },
  { n: '02', title: 'Add your resume once', desc: 'Upload a file, paste the text, or let your Profile resume load in automatically.' },
  { n: '03', title: 'Merge & apply to all', desc: 'See your combined match score, merge the missing skills, then open every job tab at once.' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function SkillChip({ label, color = 'gray', selected, onClick }) {
  const base   = 'text-xs px-2.5 py-1 rounded-full font-medium border cursor-pointer select-none transition-all';
  const colors = {
    green: 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100',
    red:   'bg-red-50   border-red-300   text-red-700   hover:bg-red-100',
    blue:  selected
      ? 'bg-emerald-600 border-emerald-600 text-white'
      : 'bg-emerald-50  border-emerald-300 text-emerald-700 hover:bg-emerald-100',
    gray:  'bg-gray-100 border-gray-300 text-gray-600',
  };
  return <span className={`${base} ${colors[color]}`} onClick={onClick}>{label}</span>;
}
function StatusBadge({ status }) {
  const map = {
    pending:  'bg-gray-100 text-gray-500',
    fetching: 'bg-emerald-100 text-emerald-600 animate-pulse',
    done:     'bg-green-100 text-green-700',
    error:    'bg-red-100 text-red-600',
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${map[status] || map.pending}`}>
      {status === 'fetching' ? '…' : status === 'done' ? '✓' : status === 'error' ? '✗' : '·'}
    </span>
  );
}

// ── Match score ring (mirrors JobAnalyzer's, computed across all jobs) ────
function MatchScoreCard({ score, presentCount, missingCount }) {
  const ring = score >= 70 ? 'border-emerald-500' : score >= 40 ? 'border-amber-400' : 'border-red-400';
  return (
    <div className="bg-white rounded-md shadow-card border border-gray-100 p-5 flex items-center gap-5">
      <div className={`w-20 h-20 rounded-full border-4 ${ring} flex flex-col items-center justify-center shrink-0`}>
        <span className="font-display text-2xl font-bold text-stone-900 leading-none">{score}</span>
        <span className="text-[10px] text-stone-400">/100</span>
      </div>
      <div className="flex-1 space-y-1.5">
        <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Combined Skill Match</p>
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

// ── Main component ──────────────────────────────────────────────────────────

export default function BulkJobAnalyzer() {
  const { user } = useAuth();

  const [urlsInput,   setUrlsInput]   = useState('');
  const [jobs,        setJobs]        = useState([]); // [{url, title, content, status, error}]
  const [analyzing,   setAnalyzing]   = useState(false);

  const [resumeText,         setResumeText]         = useState('');
  const [usingProfileResume, setUsingProfileResume] = useState(false);
  const [parsingResume,      setParsingResume]      = useState(false);
  const fileRef = useRef(null);

  const [selectedSkills, setSelectedSkills] = useState(new Set());
  const [addedSkills,    setAddedSkills]    = useState([]);

  // Auto-load profile resume
  useEffect(() => {
    if (!user) return;
    api.get('/profile').then(p => {
      if (p.resume_text && !resumeText) {
        setResumeText(normalizeResumeText(p.resume_text));
        setUsingProfileResume(true);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Aggregated skills from ALL job posts
  const allJobSkills = useMemo(() => {
    const set = new Set();
    jobs.filter(j => j.status === 'done').forEach(j => extractSkills(j.content).forEach(s => set.add(s)));
    return [...set].sort();
  }, [jobs]);

  const resumeSkills  = useMemo(() => extractSkills(resumeText), [resumeText]);
  const missingSkills = useMemo(() => allJobSkills.filter(s => !resumeSkills.includes(s)), [allJobSkills, resumeSkills]);
  const presentSkills = useMemo(() => allJobSkills.filter(s =>  resumeSkills.includes(s)), [allJobSkills, resumeSkills]);

  const modifiedText = useMemo(() => modifyResume(resumeText, addedSkills), [resumeText, addedSkills]);

  const jobUrls = useMemo(() => {
    return urlsInput.split('\n').map(l => l.trim()).filter(Boolean);
  }, [urlsInput]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleAnalyzeAll = async () => {
    if (!jobUrls.length) { toast.error('Enter at least one job URL'); return; }
    const invalidUrls = jobUrls.filter(u => { try { new URL(u); return !/^https?:\/\//i.test(u); } catch { return true; } });
    if (invalidUrls.length) {
      toast.error(`${invalidUrls.length} invalid URL${invalidUrls.length > 1 ? 's' : ''} — each must start with https://`);
      return;
    }
    setAnalyzing(true);
    setAddedSkills([]);
    setSelectedSkills(new Set());

    const initial = jobUrls.map(url => ({ url, title: '', content: '', status: 'pending', error: '' }));
    setJobs(initial);

    for (let i = 0; i < initial.length; i++) {
      setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: 'fetching' } : j));
      try {
        const data = await api.post('/jobs/scrape', { url: initial[i].url });
        setJobs(prev => prev.map((j, idx) => idx === i
          ? { ...j, status: 'done', title: data.title, content: data.content }
          : j
        ));
      } catch (err) {
        const msg = err.response?.data?.error || 'Failed to fetch';
        setJobs(prev => prev.map((j, idx) => idx === i
          ? { ...j, status: 'error', error: msg }
          : j
        ));
      }
    }

    setAnalyzing(false);
    toast.success('Analysis complete!');
  };

  const handleResumeFile = async (file) => {
    if (!file) return;
    setParsingResume(true);
    const form = new FormData();
    form.append('resume', file);
    try {
      const data = await api.post('/jobs/parse-resume', form);
      setResumeText(normalizeResumeText(data.text));
      setUsingProfileResume(false);
      toast.success('Resume parsed');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to parse resume');
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

  const addAllMissing = () => {
    setAddedSkills(missingSkills);
    setSelectedSkills(new Set(missingSkills));
    toast.success(`${missingSkills.length} skills merged into resume`);
  };

  const addSelected = () => {
    if (!selectedSkills.size) { toast.error('Select at least one skill'); return; }
    setAddedSkills([...selectedSkills]);
    toast.success(`${selectedSkills.size} skills merged into resume`);
  };

  const [applyLinks, setApplyLinks] = useState(false);

  const applyAll = useCallback(() => {
    const successUrls = jobs.filter(j => j.status === 'done').map(j => j.url);
    if (!successUrls.length) { toast.error('No successfully fetched jobs to apply to'); return; }

    // Open first tab immediately (within the user-gesture context)
    const first = window.open(successUrls[0], '_blank');

    // Open remaining tabs with small staggered delays
    // Browsers allow this if done quickly after a real click event
    successUrls.slice(1).forEach((url, i) => {
      setTimeout(() => {
        const w = window.open(url, '_blank');
        if (!w) {
          // Popup was blocked — show manual links as fallback
          setApplyLinks(true);
          toast('Some tabs were blocked — use the links below to open manually', { icon: '⚠️' });
        }
      }, (i + 1) * 300);
    });

    if (!first) {
      setApplyLinks(true);
      toast('Popup blocked — use the links below to open manually', { icon: '⚠️' });
    } else {
      toast.success(`Opening ${successUrls.length} job tab${successUrls.length > 1 ? 's' : ''}…`);
    }
  }, [jobs]);

  const doneCount  = jobs.filter(j => j.status === 'done').length;
  const hasJobs    = doneCount > 0;
  const hasResume  = resumeText.trim().length > 50;
  const showAnalysis = hasJobs && hasResume;
  const showPreview  = addedSkills.length > 0 && hasResume;
  const matchScore   = allJobSkills.length ? Math.round((presentSkills.length / allJobSkills.length) * 100) : 0;

  return (
    <div className="space-y-4">

      {/* ── Section header ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-md p-5 text-white">
        <h2 className="font-display text-lg font-bold">🚀 Bulk Apply</h2>
        <p className="text-emerald-100 text-sm mt-0.5">
          Paste every job you want to apply to — we'll score your combined skill match and open every tab at once.
        </p>
      </div>

      <StepGuide steps={STEPS} />

      {/* ── Combined match score ─────────────────────────────────────────── */}
      {showAnalysis && (
        <MatchScoreCard score={matchScore} presentCount={presentSkills.length} missingCount={missingSkills.length} />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* ── LEFT: Job URLs + Results ──────────────────────────────────────── */}
        <div className="bg-white rounded-md shadow-card border border-gray-100 p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold tracking-widest text-emerald-700 uppercase">Job Post URLs</p>
            <h2 className="text-sm font-bold text-gray-800 mt-0.5">📋 Paste every job to apply to</h2>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-600">Jitne chaho utne daalo — hum sabka hisaab rakhenge</label>
            <textarea
              value={urlsInput}
              onChange={e => setUrlsInput(e.target.value)}
              rows={6}
              placeholder={`https://careers.google.com/jobs/1234\nhttps://jobs.lever.co/company/5678\nhttps://www.naukri.com/job/...`}
              className="w-full border rounded-sm px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-emerald-300 outline-none"
            />
          </div>

          <button
            onClick={handleAnalyzeAll}
            disabled={analyzing || !urlsInput.trim()}
            className="w-full py-2 bg-emerald-600 text-white text-sm font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {analyzing ? '⏳ Analyzing…' : `🔍 Analyze All (${jobUrls.length} URL${jobUrls.length !== 1 ? 's' : ''})`}
          </button>

          {/* URL status list */}
          {jobs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">Results</p>
              {jobs.map((j, i) => (
                <div key={i} className={`rounded-sm border px-3 py-2 text-xs flex items-start gap-2 ${
                  j.status === 'done'    ? 'border-green-200 bg-green-50' :
                  j.status === 'error'   ? 'border-red-200 bg-red-50'    :
                  j.status === 'fetching'? 'border-emerald-200 bg-emerald-50' :
                  'border-gray-200 bg-gray-50'
                }`}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-700 truncate">{j.title || j.url}</p>
                    <p className="text-gray-400 truncate">{j.url}</p>
                    {j.error && <p className="text-red-600 mt-0.5">{j.error}</p>}
                    {j.status === 'done' && (
                      <p className="text-green-600 mt-0.5">{extractSkills(j.content).length} skills detected</p>
                    )}
                  </div>
                  <StatusBadge status={j.status} />
                </div>
              ))}
            </div>
          )}

          {/* Aggregated skills */}
          {hasJobs && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-semibold text-gray-600">Aggregated Skills ({allJobSkills.length} unique across {doneCount} jobs)</p>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                {allJobSkills.map(s => (
                  <SkillChip key={s} label={s} color={resumeSkills.includes(s) ? 'green' : 'red'} />
                ))}
              </div>
              <p className="text-xs text-gray-400">
                <span className="text-green-600 font-medium">Green</span> = in your resume ·{' '}
                <span className="text-red-600 font-medium">Red</span> = missing
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT: Resume + Analysis ──────────────────────────────────────── */}
        <div className="bg-white rounded-md shadow-card border border-gray-100 p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold tracking-widest text-emerald-700 uppercase">Your Resume</p>
            <h2 className="text-sm font-bold text-gray-800 mt-0.5">📄 Upload or paste your resume</h2>
          </div>

          {/* Upload */}
          <div className="space-y-2">
            {usingProfileResume && (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <p className="text-xs text-emerald-700"><strong>👤 Using resume from Profile.</strong></p>
                <button
                  onClick={() => { setResumeText(''); setUsingProfileResume(false); setAddedSkills([]); }}
                  className="text-xs text-emerald-500 hover:text-red-500 underline"
                >
                  Clear
                </button>
              </div>
            )}
            <input type="file" accept=".pdf,.docx,.doc,.txt" ref={fileRef} className="hidden"
              onChange={e => handleResumeFile(e.target.files?.[0])} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={parsingResume}
              className="w-full border-2 border-dashed border-gray-300 rounded-sm py-3 text-sm text-gray-500 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-50"
            >
              {parsingResume ? '⏳ Parsing…' : usingProfileResume ? '↺ Upload different resume' : '⬆ Upload PDF, DOCX, or TXT'}
            </button>
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t" /><span className="text-xs text-gray-400">or paste below</span><div className="flex-1 border-t" />
            </div>
            <textarea
              value={resumeText}
              onChange={e => setResumeText(e.target.value)}
              placeholder="Paste your resume text here…"
              rows={8}
              className="w-full border rounded-sm px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-emerald-300 outline-none"
            />
          </div>

          {/* Skills comparison */}
          {showAnalysis && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Skills Gap Analysis</p>

              {presentSkills.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-green-700 mb-1">In your resume ({presentSkills.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {presentSkills.map(s => <SkillChip key={s} label={s} color="green" />)}
                  </div>
                </div>
              )}

              {missingSkills.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-red-700">Missing from your resume ({missingSkills.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {missingSkills.map(s => (
                      <SkillChip key={s} label={s} color="blue" selected={selectedSkills.has(s)} onClick={() => toggleSkill(s)} />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">Click skills to select specific ones</p>
                  <div className="flex gap-2 flex-wrap pt-1">
                    <button onClick={addAllMissing}
                      className="px-4 py-2 bg-green-600 text-white text-xs font-semibold rounded-sm hover:bg-green-700 transition">
                      ✚ Add All Missing ({missingSkills.length})
                    </button>
                    <button onClick={addSelected} disabled={selectedSkills.size === 0}
                      className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-40 transition">
                      ✚ Add Selected ({selectedSkills.size})
                    </button>
                    {addedSkills.length > 0 && (
                      <button onClick={() => { setAddedSkills([]); setSelectedSkills(new Set()); }}
                        className="px-4 py-2 border text-xs font-medium rounded-sm hover:bg-gray-50 text-gray-600 transition">
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-sm p-3 text-xs text-green-700">
                  Your resume already covers all skills across these {doneCount} jobs!
                </div>
              )}
            </div>
          )}

          {/* Modified resume preview + download */}
          {showPreview && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Generalized Resume Preview</p>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => downloadAsPdf(modifiedText,  'bulk_resume')} className="text-xs text-red-600  hover:text-red-800  font-medium border border-red-200  rounded px-2 py-1 hover:bg-red-50  transition">⬇ PDF</button>
                  <button onClick={() => downloadAsWord(modifiedText, 'bulk_resume')} className="text-xs text-brand-700 hover:text-brand-900 font-medium border border-brand-200 rounded px-2 py-1 hover:bg-brand-50 transition">⬇ Word</button>
                </div>
              </div>
              <p className="text-xs text-gray-400">✨ Green highlights show exactly where each skill was inserted in your resume</p>
              <ResumePreview text={modifiedText} />
            </div>
          )}
        </div>
      </div>

      {/* ── Apply All bar ──────────────────────────────────────────────────── */}
      {hasJobs && (
        <div className="bg-white rounded-md shadow-card border border-gray-100 px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {doneCount} job{doneCount !== 1 ? 's' : ''} ready to apply
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {jobs.filter(j => j.status === 'error').length} failed · {jobs.filter(j => j.status === 'pending' || j.status === 'fetching').length} pending
              </p>
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              {!user && (
                <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-sm">
                  Sign in to apply
                </span>
              )}
              <button
                onClick={user ? applyAll : () => window.dispatchEvent(new CustomEvent('hr-open-login'))}
                disabled={doneCount === 0}
                className="px-6 py-2 bg-emerald-600 text-white rounded-sm text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {user ? `Open All ${doneCount} Job Tabs →` : 'Sign In to Apply →'}
              </button>
            </div>
          </div>

          {/* Fallback links when popup blocker fires */}
          {applyLinks && (
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-amber-700 mb-2">
                ⚠ Popup blocker detected — click each link below to open manually:
              </p>
              <div className="space-y-1.5">
                {jobs.filter(j => j.status === 'done').map((j, i) => (
                  <a
                    key={i}
                    href={j.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-emerald-700 hover:text-emerald-900 hover:underline"
                  >
                    <span className="w-5 h-5 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0">{i + 1}</span>
                    <span className="truncate">{j.title || j.url}</span>
                    <span className="text-gray-400 shrink-0">↗</span>
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-2">
                Tip: Allow popups from this site in your browser settings to enable one-click open.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
