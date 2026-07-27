import { useState, useEffect, useCallback } from 'react';
import { Search, Mail, ExternalLink, RefreshCw, Filter, CheckCircle, AlertCircle, Globe, Cpu, Zap } from 'lucide-react';
import { api } from '../api/client.js';

const SOURCE_COLORS = {
  arbeitnow:  { bg: 'bg-emerald-100',  text: 'text-emerald-700', label: 'Arbeitnow'  },
  remotive:   { bg: 'bg-sky-100',      text: 'text-sky-700',     label: 'Remotive'   },
  remoteok:   { bg: 'bg-violet-100',   text: 'text-violet-700',  label: 'RemoteOK'   },
  wwr:        { bg: 'bg-orange-100',   text: 'text-orange-700',  label: 'WeWorkRemotely' },
  adzuna:     { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Adzuna'     },
  jooble:     { bg: 'bg-amber-100',    text: 'text-amber-700',   label: 'Jooble'     },
};

function sourceColor(source = '') {
  const key = Object.keys(SOURCE_COLORS).find(k => source.startsWith(k));
  if (key) return SOURCE_COLORS[key];
  if (source.startsWith('greenhouse:')) return { bg: 'bg-green-100',  text: 'text-green-700',  label: `GH: ${source.split(':')[1]}` };
  if (source.startsWith('lever:'))      return { bg: 'bg-indigo-100', text: 'text-indigo-700', label: `Lever: ${source.split(':')[1]}` };
  return { bg: 'bg-gray-100', text: 'text-gray-600', label: source };
}

function SourceBadge({ source }) {
  const { bg, text, label } = sourceColor(source);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${bg} ${text}`}>
      <Globe size={10} /> {label}
    </span>
  );
}

function ExtractionBadge({ method }) {
  if (!method) return null;
  if (method === 'llm')   return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700"><Cpu size={9} /> LLM</span>;
  if (method === 'regex') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-100 text-teal-700"><Zap size={9} /> Regex</span>;
  return null;
}

function RelevancePill({ isRelevant, confidence }) {
  if (isRelevant == null) return null;
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  if (isRelevant) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
      <CheckCircle size={9} /> {pct != null ? `${pct}%` : 'Relevant'}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
      <AlertCircle size={9} /> {pct != null ? `${pct}%` : 'Not relevant'}
    </span>
  );
}

function StatCard({ label, value, sub, color = 'gray' }) {
  const colors = {
    blue:  'bg-blue-50 border-blue-100 text-blue-700',
    green: 'bg-green-50 border-green-100 text-green-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    gray:  'bg-gray-50 border-gray-100 text-gray-700',
  };
  return (
    <div className={`border rounded-lg p-3 ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium mt-0.5">{label}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function JobIntelPanel() {
  const [jobs,      setJobs]      = useState([]);
  const [stats,     setStats]     = useState(null);
  const [sources,   setSources]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [total,     setTotal]     = useState(0);
  const [offset,    setOffset]    = useState(0);
  const LIMIT = 30;

  const [filters, setFilters] = useState({
    q: '', source: '', is_relevant: '', has_email: '', seniority: '', needs_review: '',
  });

  const fetchData = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset: off };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });

      // api interceptor already unwraps res.data, so these resolve directly to the payload
      const [jobsRes, statsRes, sourcesRes] = await Promise.all([
        api.get('/job-intel/postings', { params }),
        api.get('/job-intel/stats'),
        api.get('/job-intel/sources'),
      ]);
      setJobs(jobsRes.jobs || []);
      setTotal(jobsRes.total || 0);
      setStats(statsRes);
      setSources(Array.isArray(sourcesRes) ? sourcesRes : []);
      setOffset(off);
    } catch (e) {
      console.error('[JobIntel] fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(0); }, [filters]);

  function setFilter(k, v) {
    setFilters(f => ({ ...f, [k]: v }));
  }

  function parseEmails(raw) {
    try { return JSON.parse(raw || '[]'); } catch { return []; }
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Postings" value={stats.total.toLocaleString()} color="gray" />
          <StatCard label="With Email" value={stats.with_email.toLocaleString()} color="green"
            sub="Direct HR contact found" />
          <StatCard label="Relevant" value={stats.relevant.toLocaleString()} color="blue"
            sub="Matched your target profile" />
          <StatCard label="Needs Review" value={stats.review_needed.toLocaleString()} color="amber"
            sub="Low-confidence / incomplete" />
        </div>
      )}

      {stats?.last_run && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
          Last pipeline run: <span className="font-medium">{stats.last_run.started_at?.slice(0, 16)}</span>
          {' '}— status: <span className={`font-medium ${stats.last_run.status === 'success' ? 'text-green-600' : 'text-red-500'}`}>{stats.last_run.status}</span>
          {' '}— {stats.last_run.total_new} new postings
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search title, company, description…"
              value={filters.q}
              onChange={e => setFilter('q', e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <select
            value={filters.source}
            onChange={e => setFilter('source', e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All sources</option>
            {sources.map(s => (
              <option key={s.source} value={s.source}>{sourceColor(s.source).label} ({s.count})</option>
            ))}
          </select>

          <select
            value={filters.is_relevant}
            onChange={e => setFilter('is_relevant', e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All relevance</option>
            <option value="true">Relevant only</option>
            <option value="false">Not relevant</option>
          </select>

          <select
            value={filters.has_email}
            onChange={e => setFilter('has_email', e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All</option>
            <option value="true">Has email</option>
          </select>

          <select
            value={filters.seniority}
            onChange={e => setFilter('seniority', e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All levels</option>
            {['entry', 'mid', 'senior', 'lead', 'any'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          <button
            onClick={() => fetchData(0)}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Job cards */}
      {jobs.length === 0 && !loading && (
        <div className="text-center py-16 text-gray-400">
          <Globe size={36} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium text-gray-500">No postings found</p>
          <p className="text-sm mt-1">Enable the pipeline in Admin Panel → Job Intel, then trigger a run.</p>
        </div>
      )}

      <div className="space-y-2">
        {jobs.map(job => {
          const emails = parseEmails(job.extracted_emails);
          return (
            <div
              key={job.id}
              className={`bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow ${
                job.needs_review ? 'border-amber-200' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <SourceBadge source={job.source} />
                    <RelevancePill isRelevant={job.is_relevant} confidence={job.classification_confidence} />
                    <ExtractionBadge method={job.extraction_method} />
                    {job.needs_review === 1 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                        <AlertCircle size={9} /> Review needed
                      </span>
                    )}
                  </div>

                  <h3 className="font-semibold text-gray-900 text-sm leading-snug">{job.title}</h3>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {job.company && <span className="font-medium text-gray-700">{job.company}</span>}
                    {job.location && <span> · {job.location}</span>}
                    {job.seniority && job.seniority !== 'any' && (
                      <span className="ml-1 text-brand-600">· {job.seniority}</span>
                    )}
                    {job.posted_at && <span className="ml-1 text-gray-400">· {job.posted_at}</span>}
                  </div>

                  {job.classification_reason && (
                    <p className="text-[11px] text-gray-400 mt-1 italic">{job.classification_reason}</p>
                  )}

                  {job.description && (
                    <p className="text-xs text-gray-600 mt-1.5 line-clamp-2 leading-relaxed">
                      {job.description.slice(0, 200)}
                    </p>
                  )}

                  {emails.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {emails.map(email => (
                        <a
                          key={email}
                          href={`mailto:${email}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                        >
                          <Mail size={9} /> {email}
                        </a>
                      ))}
                      {job.extracted_contact_name && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-gray-100 text-gray-600">
                          👤 {job.extracted_contact_name}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {job.apply_url && (
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-brand-600 border border-brand-200 rounded-md hover:bg-brand-50"
                  >
                    Apply <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-gray-500">
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => fetchData(Math.max(0, offset - LIMIT))}
              disabled={offset === 0 || loading}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => fetchData(offset + LIMIT)}
              disabled={offset + LIMIT >= total || loading}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
