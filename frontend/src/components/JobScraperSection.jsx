import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { api, API_ROOT } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import JobCard from './JobCard.jsx';

// ─── Category definitions ─────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id:       'general',
    label:    '🏢 General Jobs',
    desc:     'LinkedIn Jobs + Naukri.com',
    scrapers: ['linkedin-jobs', 'naukri'],
    dbCat:    'general',
  },
  {
    id:       'remote',
    label:    '🌐 Remote Jobs',
    desc:     'Internshala · Arbeitnow · RemoteOK',
    scrapers: ['general'],
    dbCat:    'remote',
  },
  {
    id:       'international',
    label:    '🌍 International Jobs',
    desc:     'Coming Soon',
    scrapers: [],
    dbCat:    'international',
    comingSoon: true,
  },
];

const SINCE_OPTIONS = [
  { value: '1d',  label: 'Last 1 day'   },
  { value: '3d',  label: 'Last 3 days'  },
  { value: '7d',  label: 'Last 7 days'  },
  { value: '24d', label: 'Last 24 days' },
  { value: '30d', label: 'Last 30 days' },
];

const LIMIT_OPTIONS = [25, 50, 100];

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
  const logsEndRef = useRef(null);

  const cat = CATEGORIES.find(c => c.id === activeCat) || CATEGORIES[0];

  // Load user profile for preference-based defaults
  useEffect(() => {
    if (!user) return;
    api.get('/profile').then(p => setProfile(p)).catch(() => {});
  }, [user]);

  // Fetch stored jobs
  const fetchJobs = useCallback(async () => {
    if (cat.comingSoon) { setJobs([]); setLoading(false); return; }
    setLoading(true);
    try {
      const params = { category: cat.dbCat, since, limit, page };
      if (search) params.search = search;
      const data = await api.get('/scraped-jobs', { params });
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [activeCat, since, limit, page, search]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => { setPage(1); }, [activeCat, since, limit, search]);

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
    const location = profile?.location || profile?.preferred_city || 'India';

    try {
      const body = {
        scraper:  scraperKey,
        titles,
        since,
        limit,
        location,
        ...(profile?.preferred_city ? { city: profile.preferred_city.toLowerCase() } : {}),
      };

      const resp = await fetch(`${API_ROOT}/api/scraper/run`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('hr_token')}`,
        },
        body: JSON.stringify(body),
      });

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
      <div className="bg-white border rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-48">
          <label className="text-xs font-semibold text-gray-500 block mb-1">Job Category</label>
          <div className="relative">
            <select
              value={activeCat}
              onChange={e => setActiveCat(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white focus:ring-2 focus:ring-blue-300 outline-none appearance-none cursor-pointer"
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
            className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-300 outline-none"
          >
            {SINCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">Show</label>
          <select
            value={limit}
            onChange={e => setLimit(parseInt(e.target.value))}
            className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-300 outline-none"
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
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5 pt-5">
          {cat.comingSoon ? (
            <span className="px-5 py-2.5 bg-gray-200 text-gray-500 rounded-xl text-sm font-semibold cursor-not-allowed">
              Coming Soon
            </span>
          ) : (
            <button
              onClick={runAllScrapers}
              disabled={scraping}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {scraping ? '⏳ Scraping…' : '🔍 Scrape Now'}
            </button>
          )}
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="px-4 py-1.5 border border-gray-300 text-gray-600 rounded-xl text-xs font-medium hover:bg-gray-50 transition-colors"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Profile preferences hint */}
      {profile && !search && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
          <span>💡</span>
          <span>
            Showing jobs matching your profile preferences:{' '}
            <strong>{buildTitlesFromProfile(profile, '').join(', ')}</strong>
            {profile.preferred_city && <> · <strong>{profile.preferred_city}</strong></>}
          </span>
        </div>
      )}

      {/* Scraper logs */}
      {showLogs && (
        <details open className="bg-gray-900 rounded-xl overflow-hidden">
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
                className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="px-2 py-1.5 text-xs text-gray-500">{page}/{pages}</span>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-40"
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
            <div key={i} className="h-48 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <span className="text-4xl mb-3">🔍</span>
          <p className="text-sm font-semibold">No jobs in this time range</p>
          <p className="text-xs mt-1">Click "Scrape Now" to fetch the latest jobs from {cat.desc}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {jobs.map(job => <JobCard key={job.id} job={job} />)}
        </div>
      )}
    </div>
  );
}
