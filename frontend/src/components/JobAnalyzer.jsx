import { useState, useMemo, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { extractSkills } from '../data/techSkills.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { modifyResume, downloadAsPdf, downloadAsWord } from '../utils/resumeUtils.js';
import ResumePreview from './ResumePreview.jsx';

// ── Skill chip ────────────────────────────────────────────────────────────

function SkillChip({ label, color = 'gray', selected, onClick }) {
  const base = 'text-xs px-2.5 py-1 rounded-full font-medium border cursor-pointer select-none transition-all';
  const colors = {
    green:  `bg-green-50  border-green-300  text-green-700  hover:bg-green-100`,
    red:    `bg-red-50    border-red-300    text-red-700    hover:bg-red-100`,
    blue:   selected
      ? 'bg-blue-600  border-blue-600    text-white'
      : 'bg-blue-50   border-blue-300    text-blue-700   hover:bg-blue-100',
    gray:   `bg-gray-100  border-gray-300    text-gray-600`,
  };
  return (
    <span className={`${base} ${colors[color]}`} onClick={onClick}>
      {label}
    </span>
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

  // Selection
  const [selectedSkills, setSelectedSkills] = useState(new Set());
  const [addedSkills,    setAddedSkills]    = useState([]);

  const modifiedText = useMemo(
    () => modifyResume(resumeText, addedSkills),
    [resumeText, addedSkills],
  );

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleScrape = async () => {
    const url = jobUrl.trim();
    if (!url) return;
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

  const hasJobContent   = jobContent.trim().length > 50;
  const hasResumeText   = resumeText.trim().length > 50;
  const showComparison  = hasJobContent && hasResumeText;
  const showPreview     = addedSkills.length > 0 && hasResumeText;

  return (
    <div className="space-y-4">

      {/* ── Two-column layout ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* ── LEFT: Job Post ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-800">📋 Job Post</h2>

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
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              />
              <button
                onClick={handleScrape}
                disabled={scraping || !jobUrl.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
              >
                {scraping ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
            {scrapeErr && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
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
              className="w-full border rounded-lg px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-blue-300 outline-none"
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
        <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-800">📄 Your Resume</h2>

          {/* Upload */}
          <div className="space-y-2">
            {usingProfileResume && (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-blue-700">
                  <span>👤</span>
                  <span><strong>Using resume from your Profile.</strong> Skills pre-loaded.</span>
                </div>
                <button
                  onClick={() => { setResumeText(''); setUsingProfileResume(false); setAddedSkills([]); setSelectedSkills(new Set()); }}
                  className="text-xs text-blue-500 hover:text-red-500 underline ml-2 whitespace-nowrap"
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
              className="w-full border-2 border-dashed border-gray-300 rounded-lg py-4 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition disabled:opacity-50"
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
              className="w-full border rounded-lg px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-blue-300 outline-none"
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
                    ✅ Already in your resume ({presentSkills.length})
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
                    ❌ Missing from your resume ({missingSkills.length})
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
                      className="px-4 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition"
                    >
                      ✚ Add All Missing ({missingSkills.length})
                    </button>
                    <button
                      onClick={addSelected}
                      disabled={selectedSkills.size === 0}
                      className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
                    >
                      ✚ Add Selected ({selectedSkills.size})
                    </button>
                    {addedSkills.length > 0 && (
                      <button
                        onClick={() => { setAddedSkills([]); setSelectedSkills(new Set()); }}
                        className="px-4 py-2 border text-xs font-medium rounded-lg hover:bg-gray-50 text-gray-600 transition"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
                  🎉 Your resume already covers all detected skills for this job!
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

      {/* ── Apply bar ─────────────────────────────────────────────────────── */}
      {jobUrl && hasJobContent && (
        <div className="bg-white rounded-xl border shadow-sm px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {jobTitle || 'Job Post'}
            </p>
            <p className="text-xs text-gray-400 truncate max-w-lg">{jobUrl}</p>
          </div>
          {user ? (
            <button
              onClick={() => window.open(jobUrl, '_blank', 'noopener')}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition whitespace-nowrap"
            >
              Open Job Post &amp; Apply →
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                🔒 Sign in to apply
              </span>
              <button
                onClick={() => {/* App.jsx will handle this via context — we use a custom event */
                  window.dispatchEvent(new CustomEvent('hr-open-login'));
                }}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition whitespace-nowrap"
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
