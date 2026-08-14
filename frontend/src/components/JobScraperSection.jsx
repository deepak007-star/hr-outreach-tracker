import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import JobCard from './JobCard.jsx';

const DEFAULT_CITIES = ['Delhi', 'Bangalore', 'Pune', 'Noida', 'Gurugram'];
function parsePreferredCities(val) {
  if (!val || val === '') return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [String(parsed)].filter(Boolean);
  } catch { return val ? [val] : []; }
}
function getEffectiveCities(val) {
  const c = parsePreferredCities(val);
  return c.length ? c : DEFAULT_CITIES;
}

// ─── Category definitions ─────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id:       'general',
    label:    '🏢 General Jobs',
    desc:     'LinkedIn Jobs · Naukri.com · Internshala · Instahyre · Foundit',
    scrapers: ['linkedin-jobs', 'naukri', 'internshala', 'instahyre', 'foundit'],
    dbCat:    'general',
  },
  {
    id:       'remote',
    label:    '🌐 Remote Jobs',
    desc:     'Arbeitnow · RemoteOK · We Work Remotely · Remotive',
    scrapers: ['general'],
    dbCat:    'remote',
  },
  {
    id:       'international',
    label:    '🌍 International Jobs',
    desc:     'Jora — Australia · Singapore · Hong Kong · Indonesia · Malaysia · New Zealand',
    scrapers: ['jora'],
    dbCat:    'international',
  },
];

const SINCE_OPTIONS = [
  { value: '1d',  label: 'Last 1 day'   },
  { value: '3d',  label: 'Last 3 days'  },
  { value: '7d',  label: 'Last 7 days'  },
  { value: '24d', label: 'Last 24 days' },
  { value: '30d', label: 'Last 30 days' },
];

const LIMIT_OPTIONS = [25, 50, 100, 200, 400];

// ─── Component ────────────────────────────────────────────────────────────────

export default function JobScraperSection() {
  const { user } = useAuth();
  const [activeCat,   setActiveCat]   = useState('general');
  const [jobs,        setJobs]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [scraping,    setScraping]    = useState(false);
  const [scraperLogs, setScraperLogs] = useState([]);
  const [showLogs,    setShowLogs]    = useState(false);
  const [since,       setSince]       = useState('7d');
  const [limit,       setLimit]       = useState(50);
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [total,       setTotal]       = useState(0);
  const [pages,       setPages]       = useState(1);
  const [profile,     setProfile]     = useState(null);
  const [suppressProfileFilter, setSuppressProfileFilter] = useState(false);
  const [fetchError,  setFetchError]  = useState(null); // 'auth' | 'other' | null
  const logsEndRef = useRef(null);

  const cat = CATEGORIES.find(c => c.id === activeCat) || CATEGORIES[0];

  // Load user profile for preference-based defaults
  useEffect(() => {
    if (!user) return;
    api.get('/profile').then(p => { setProfile(p); setSuppressProfileFilter(false); }).catch(() => {});
  }, [user]);

  // Fetch stored jobs — when no manual search, auto-filter by user's profile title
  const fetchJobs = useCallback(async () => {
    if (cat.comingSoon) { setJobs([]); setLoading(false); return; }
    // /scraped-jobs requires auth — without this guard, a logged-out visitor
    // (this tab has no requiresAuth gate) or anyone whose session just expired
    // gets a silent 401 that renders identically to "no jobs found," which is
    // exactly indistinguishable from genuinely empty data.
    if (!user) { setJobs([]); setLoading(false); setFetchError('auth'); return; }
    setLoading(true);
    setFetchError(null);
    try {
      const params = { category: cat.dbCat, since, limit, page };
      const profileTitle = !suppressProfileFilter && profile && [profile.job_title_1, profile.job_title_2, profile.job_title_3, profile.current_title].filter(Boolean)[0];
      const effectiveSearch = search || profileTitle || '';
      if (effectiveSearch) params.search = effectiveSearch;
      const data = await api.get('/scraped-jobs', { params });
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (e) {
      setJobs([]);
      setFetchError(e?.response?.status === 401 ? 'auth' : 'other');
    } finally {
      setLoading(false);
    }
  }, [activeCat, since, limit, page, search, profile, suppressProfileFilter, user]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { setPage(1); }, [activeCat, since, limit, search, suppressProfileFilter]);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scraperLogs]);

  // ── SSE scrape trigger ────────────────────────────────────────────────────

  async function runScraper(scraperKey) {
    if (scraping) return;
    setScraping(true);
    setScraperLogs([]);
    setShowLogs(true);

    // Build titles from profile preferences if no search query
    const titles = buildTitlesFromProfile(profile, search);
    const cities   = getEffectiveCities(profile?.preferred_city);
    const location = cities.join(', ') || profile?.location || 'India';

    try {
      const body = {
        scraper:  scraperKey,
        titles,
        since,
        limit,
        location,
        cities: cities.map(c => c.toLowerCase()),
      };

      const resp = await fetch(`${API_ROOT}/api/scraper/run`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('hr_token')}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        let msg = `Scraper error (${resp.status})`;
        try { const d = await resp.json(); msg = d.error || msg; } catch {}
        setScraperLogs(prev => [...prev, { type: 'error', text: msg }]);
        setScraping(false);
        return;
      }

      const reader   = resp.body.getReader();
      const decoder  = new TextDecoder();
      let   buffer   = '';
      let   stored   = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const msg = JSON.parse(line.slice(5).trim());
            if (msg.type === 'log' || msg.type === 'err') {
              setScraperLogs(prev => [...prev, { type: msg.type, text: msg.data }]);
            } else if (msg.type === 'done') {
              stored = msg.data.stored || 0;
              if (msg.data.code === 0) {
                toast.success(`Scrape complete! ${stored} jobs stored`);
                fetchJobs();
              } else {
                toast.error('Scraper exited with errors — check logs');
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error('Scraper failed: ' + err.message);
    } finally {
      setScraping(false);
    }
  }

  async function runAllScrapers() {
    for (const scraperKey of cat.scrapers) {
      await runScraper(scraperKey);
    }
  }

  // Build search titles from profile
  function buildTitlesFromProfile(p, searchQuery) {
    if (searchQuery) return [searchQuery];
    const titles = [p?.job_title_1, p?.job_title_2, p?.job_title_3, p?.current_title]
      .filter(Boolean).slice(0, 3);
    return titles.length ? titles : ['Software Developer'];
  }

  return (
    <div className="space-y-4">
      {/* Category dropdown */}
      <div className="bg-white border rounded-md p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-48">
          <label className="text-xs font-semibold text-gray-500 block mb-1">Job Category</label>
          <div className="relative">
            <select
              value={activeCat}
              onChange={e => setActiveCat(e.target.value)}
              className="w-full border border-gray-300 rounded-sm px-4 py-2.5 text-sm font-semibold bg-white focus:ring-2 focus:ring-brand-300 outline-none appearance-none cursor-pointer"
            >
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id} disabled={c.comingSoon}>
                  {c.label}{c.comingSoon ? ' (Coming Soon)' : ''}
                </option>
              ))}
            </select>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">▾</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">{cat.desc}</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Time Range</label>
          <select
            value={since}
            onChange={e => setSince(e.target.value)}
            className="border border-gray-300 rounded-sm px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-brand-300 outline-none"
          >
            {SINCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Show</label>
          <select
            value={limit}
            onChange={e => setLimit(parseInt(e.target.value))}
            className="border border-gray-300 rounded-sm px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-brand-300 outline-none"
          >
            {LIMIT_OPTIONS.map(l => <option key={l} value={l}>{l} jobs</option>)}
          </select>
        </div>

        <div className="flex-1 min-w-48">
          <label className="text-xs font-semibold text-gray-500 block mb-1">Search / Keywords</label>
          <input
            type="text"
            placeholder={profile ? `Defaults: ${buildTitlesFromProfile(profile, '').join(', ')}` : 'e.g. React Developer'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-sm px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5 pt-5">
          {cat.comingSoon ? (
            <span className="px-5 py-2.5 bg-gray-200 text-gray-500 rounded-sm text-sm font-semibold cursor-not-allowed">
              Coming Soon
            </span>
          ) : user?.role === 'admin' ? (
            <button
              onClick={runAllScrapers}
              disabled={scraping}
              className="px-5 py-2.5 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {scraping ? '⏳ Scraping…' : '🔍 Scrape Now (admin)'}
            </button>
          ) : null}
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded-sm text-xs font-medium hover:bg-gray-50 transition-colors"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Profile preferences hint */}
      {(() => {
        const profileTitles = profile ? [profile.job_title_1, profile.job_title_2, profile.job_title_3, profile.current_title].filter(Boolean) : [];
        const isProfileFiltering = profile && !search && !suppressProfileFilter && profileTitles.length > 0;
        const isShowingAll = profile && !search && suppressProfileFilter && profileTitles.length > 0;
        if (isProfileFiltering) return (
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-brand-50 border border-brand-100 rounded-sm px-3 py-2">
            <span>🎯</span>
            <span className="flex-1">
              Showing jobs for your profile:{' '}
              <strong>{profileTitles.slice(0, 3).join(', ')}</strong>
              {' '}· <strong>{getEffectiveCities(profile?.preferred_city).join(', ')}</strong>
            </span>
            <button onClick={() => setSuppressProfileFilter(true)} className="ml-auto text-gray-400 hover:text-gray-700 underline whitespace-nowrap">
              Show all jobs →
            </button>
          </div>
        );
        if (isShowingAll) return (
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-sm px-3 py-2">
            <span>📋</span>
            <span className="flex-1">Showing all jobs (profile filter paused).</span>
            <button onClick={() => setSuppressProfileFilter(false)} className="ml-auto text-brand-600 hover:text-brand-800 underline whitespace-nowrap">
              ← Filter by profile
            </button>
          </div>
        );
        return null;
      })()}

      {/* Scraper logs */}
      {showLogs && (
        <details open className="bg-gray-900 rounded-md overflow-hidden">
          <summary className="px-4 py-2.5 text-sm text-gray-300 font-mono cursor-pointer hover:bg-gray-800 flex items-center justify-between">
            <span>🖥️ Scraper Output</span>
            <button onClick={() => setShowLogs(false)} className="text-gray-500 hover:text-gray-300 text-xs ml-2">✕</button>
          </summary>
          <div className="p-4 max-h-60 overflow-y-auto font-mono text-xs">
            {scraperLogs.map((entry, i) => (
              <div key={i} className={`${entry.type === 'err' ? 'text-red-400' : 'text-green-300'} whitespace-pre-wrap`}>
                {entry.text}
              </div>
            ))}
            {scraping && <div className="text-yellow-400 animate-pulse">Running…</div>}
            <div ref={logsEndRef} />
          </div>
        </details>
      )}

      {/* Jobs count + stats */}
      {!cat.comingSoon && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {loading ? 'Loading…' : `${total} job${total !== 1 ? 's' : ''} found`}
            {total > 0 && <span className="text-xs text-gray-400 ml-2">· {since} window</span>}
          </p>
          {pages > 1 && (
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border rounded-sm hover:bg-gray-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="px-2 py-1.5 text-xs text-gray-500">{page}/{pages}</span>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="px-3 py-1.5 text-xs border rounded-sm hover:bg-gray-50 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Job Grid */}
      {cat.comingSoon ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <span className="text-5xl mb-3">🌍</span>
          <p className="text-lg font-semibold">International Jobs — Coming Soon</p>
          <p className="text-sm mt-1">We're working on aggregating global job boards. Stay tuned!</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-48 bg-gray-100 animate-pulse rounded-md" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <span className="text-4xl mb-3">{fetchError === 'auth' ? '🔒' : fetchError === 'other' ? '⚠️' : '🔍'}</span>
          <p className="text-sm font-semibold">
            {fetchError === 'auth' ? 'Sign in to view jobs'
              : fetchError === 'other' ? 'Could not load jobs'
              : 'No jobs in this time range'}
          </p>
          <p className="text-xs mt-1">
            {fetchError === 'auth' ? 'Your session may have expired — sign in again to see stored jobs.'
              : fetchError === 'other' ? 'The backend request failed — try Refresh, or check your connection.'
              : (() => {
                  const profileTitles = profile ? [profile.job_title_1, profile.job_title_2, profile.job_title_3, profile.current_title].filter(Boolean) : [];
                  if (profile && !search && !suppressProfileFilter && profileTitles.length > 0) {
                    return <>No jobs match your profile title(s) in this range — try <button onClick={() => setSuppressProfileFilter(true)} className="text-brand-600 underline">Show all jobs</button>.</>;
                  }
                  return user?.role === 'admin'
                    ? `Click "Scrape Now" to fetch the latest jobs from ${cat.desc}`
                    : 'Jobs refresh automatically every morning — try a wider time range above.';
                })()}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {jobs.map(job => <JobCard key={job.id} job={job} />)}
        </div>
      )}
    </div>
  );
}
