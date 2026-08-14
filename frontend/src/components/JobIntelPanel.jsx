import { useState, useEffect, useCallback } from 'react';
import { Search, Mail, ExternalLink, RefreshCw, UserPlus, CheckCircle, Globe, Cpu, Zap } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';

const SOURCE_COLORS = {
  // Internal DB sources (most HR emails come from here)
  'linkedin-posts':          { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'LinkedIn Posts'    },
  'linkedin-posts-db':       { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'LinkedIn Posts'    },
  'scraped:naukri':          { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Naukri'            },
  'scraped:linkedin-feed':   { bg: 'bg-blue-50',     text: 'text-blue-600',    label: 'LinkedIn Feed'     },
  'scraped:linkedin-jobs':   { bg: 'bg-blue-50',     text: 'text-blue-600',    label: 'LinkedIn Jobs'     },
  'scraped:instahyre':       { bg: 'bg-purple-100',  text: 'text-purple-700',  label: 'Instahyre'         },
  'scraped:internshala':     { bg: 'bg-green-100',   text: 'text-green-700',   label: 'Internshala'       },
  'scraped:foundit':         { bg: 'bg-teal-100',    text: 'text-teal-700',    label: 'Foundit'           },
  'scraped:jora':            { bg: 'bg-cyan-100',    text: 'text-cyan-700',    label: 'Jora'              },
  'scraped:general':         { bg: 'bg-slate-100',   text: 'text-slate-600',   label: 'Jobs'              },
  'scraped-db':              { bg: 'bg-slate-100',   text: 'text-slate-600',   label: 'Scraped Jobs'      },
  // External API sources
  arbeitnow:                 { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Arbeitnow'         },
  remotive:                  { bg: 'bg-sky-100',     text: 'text-sky-700',     label: 'Remotive'          },
  remoteok:                  { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'RemoteOK'          },
  wwr:                       { bg: 'bg-orange-100',  text: 'text-orange-700',  label: 'We Work Remotely'  },
  adzuna:                    { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Adzuna'            },
  jooble:                    { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Jooble'            },
};

function sourceLabel(source = '') {
  // Exact match first
  if (SOURCE_COLORS[source]) return SOURCE_COLORS[source];
  // Prefix match (handles scraped:unknown, greenhouse:company, lever:company, etc.)
  const key = Object.keys(SOURCE_COLORS).find(k => source.startsWith(k));
  if (key) return { ...SOURCE_COLORS[key] };
  if (source.startsWith('greenhouse:')) return { bg: 'bg-green-100',  text: 'text-green-700',  label: `Greenhouse · ${source.split(':')[1]}` };
  if (source.startsWith('lever:'))      return { bg: 'bg-indigo-100', text: 'text-indigo-700', label: `Lever · ${source.split(':')[1]}` };
  if (source.startsWith('scraped:'))    return { bg: 'bg-slate-100',  text: 'text-slate-600',  label: source.replace('scraped:', '') };
  return { bg: 'bg-gray-100', text: 'text-gray-600', label: source };
}

// Mirrors backend/src/agents/categorize.js CATEGORY_LABELS — display text only.
const CATEGORY_LABELS = {
  java: 'Java', python: 'Python', ai_ml: 'AI / ML', devops_cloud: 'DevOps / Cloud',
  data: 'Data Engineering', frontend: 'Frontend', mern_node: 'MERN / Node.js',
  qa: 'QA / Automation', fullstack: 'Full Stack', backend: 'Backend', general: 'General / SDE',
};

const SINCE_OPTS = [
  { value: '1',   label: 'Last 24 hrs' },
  { value: '7',   label: 'Last 7 days' },
  { value: '30',  label: 'Last 30 days'},
  { value: '90',  label: 'Last 90 days'},
  { value: '',    label: 'All time'    },
];

export default function JobIntelPanel() {
  const [contacts,     setContacts]     = useState([]);
  const [stats,        setStats]        = useState(null);
  const [sources,      setSources]      = useState([]);
  const [categories,   setCategories]   = useState([]);
  const [personalized, setPersonalized] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [total,     setTotal]     = useState(0);
  const [offset,    setOffset]    = useState(0);
  const [added,     setAdded]     = useState(new Set()); // emails already added this session
  const [categoryYield, setCategoryYield] = useState([]);
  const [showYield,     setShowYield]     = useState(false);
  const LIMIT = 30;

  useEffect(() => {
    api.get('/job-intel/category-yield').then(r => setCategoryYield(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const [q,             setQ]            = useState('');
  const [source,        setSource]       = useState('');
  const [category,      setCategory]     = useState('');
  const [since,         setSince]        = useState('1');
  const [minSkillMatch, setMinSkillMatch]= useState(''); // '' = off (default: show everything, only reordered)

  const fetchContacts = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset: off };
      if (q)             params.q               = q;
      if (source)        params.source          = source;
      if (category)      params.category        = category;
      if (since)          params.since           = since;
      if (minSkillMatch) params.min_skill_match  = minSkillMatch;

      const [data, statsData, srcData, catData] = await Promise.all([
        api.get('/job-intel/contacts', { params }),
        api.get('/job-intel/stats'),
        api.get('/job-intel/sources'),
        api.get('/job-intel/categories'),
      ]);
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
      setPersonalized(!!data.personalized);
      setStats(statsData);
      setSources(Array.isArray(srcData) ? srcData.filter(s => s.source) : []);
      setCategories(Array.isArray(catData) ? catData.filter(c => c.category) : []);
      setOffset(off);
    } catch (e) {
      console.error('[JobIntel] fetch error', e);
      toast.error('Could not load contacts');
    } finally {
      setLoading(false);
    }
  }, [q, source, category, since, minSkillMatch]);

  useEffect(() => { fetchContacts(0); }, [q, source, category, since, minSkillMatch]);

  // Auto-refresh every 30s when a pipeline run is active (status = 'running')
  useEffect(() => {
    if (stats?.last_run?.status !== 'running') return;
    const t = setInterval(() => fetchContacts(offset), 30_000);
    return () => clearInterval(t);
  }, [stats?.last_run?.status, offset]);

  async function addToHRList(contact, email) {
    if (added.has(email)) return;
    try {
      await api.post('/contacts', {
        name:         contact.extracted_contact_name || contact.company || 'HR Contact',
        email,
        company:      contact.company  || '',
        title:        contact.title    || '',
        email_source: 'job-intel',
        notes:        `Found via Job Intel (${contact.source}) — ${contact.apply_url || ''}`.trim(),
        status:       'New',
      });
      setAdded(prev => new Set([...prev, email]));
      toast.success(`${email} added to HR List`);
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Failed';
      if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('already')) {
        toast('Already in your HR List');
        setAdded(prev => new Set([...prev, email]));
      } else {
        toast.error(msg);
      }
    }
  }

  return (
    <div className="space-y-4">

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Contacts', value: stats.total,     sub: 'in Job Intel',    click: () => setSince('') },
            { label: 'This Week',      value: stats.this_week, sub: 'added this week', click: () => setSince('7') },
            { label: 'Last 24 hrs',    value: stats.today,     sub: 'added today',     click: () => setSince('1') },
            { label: 'Filtered',       value: total,           sub: `with current filter`, click: null },
          ].map(s => (
            <div
              key={s.label}
              onClick={s.click || undefined}
              className={`bg-purple-50 border border-purple-200 rounded-lg p-3 ${s.click ? 'cursor-pointer hover:bg-purple-100 transition-colors' : ''}`}
            >
              <div className="text-2xl font-bold text-purple-800">{s.value ?? '—'}</div>
              <div className="text-xs font-medium text-purple-700 mt-0.5">{s.label}</div>
              <div className="text-[10px] text-purple-400">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Category yield — which categories/keywords are actually converting */}
      {categoryYield.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <button
            onClick={() => setShowYield(s => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <span>📊 Category performance — where scrape effort is paying off</span>
            <span className="text-gray-400">{showYield ? '▲' : '▼'}</span>
          </button>
          {showYield && (
            <div className="px-3 pb-3 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left py-1 pr-3">Category</th>
                    <th className="text-right py-1 pr-3">Scanned</th>
                    <th className="text-right py-1 pr-3">Email yield</th>
                    <th className="text-right py-1">Reply/bounce score</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryYield.map(c => (
                    <tr key={c.category} className="border-t border-gray-50">
                      <td className="py-1 pr-3 font-medium text-gray-700">{c.label}</td>
                      <td className="py-1 pr-3 text-right text-gray-500">{c.scanned}</td>
                      <td className="py-1 pr-3 text-right text-gray-500">{c.emailYieldPct}%</td>
                      <td className="py-1 text-right text-gray-500">{c.outcomeScore != null ? `${c.outcomeScore}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {stats?.last_run && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2 flex items-center gap-2 flex-wrap">
          <Zap size={11} className="text-brand-500 shrink-0" />
          <span>Last run: <span className="font-medium">{stats.last_run.started_at?.slice(0, 16)}</span></span>
          <span>· scanned {stats.last_run.total_fetched || 0} posts</span>
          <span>· <span className="font-medium text-green-700">{stats.last_run.total_new || 0} truly new HR contacts</span></span>
          <span className={`font-medium ${stats.last_run.status === 'success' ? 'text-green-600' : 'text-red-500'}`}>
            · {stats.last_run.status}
          </span>
          {stats.last_run.status === 'running' && (
            <span className="text-blue-600 animate-pulse">· scraping LinkedIn Feed…</span>
          )}
        </div>
      )}

      {personalized && (
        <div className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded px-3 py-2 flex items-center gap-1.5">
          <CheckCircle size={11} className="shrink-0" />
          Ranked by your Profile — Preferred Roles and Skills are both weighed, so close matches surface even without an exact title match. Nothing relevant is hidden, only reordered.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search email, company, name…"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">All sources</option>
          {sources.map(s => (
            <option key={s.source} value={s.source}>{sourceLabel(s.source).label} ({s.count})</option>
          ))}
        </select>

        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">All profiles</option>
          {categories.map(c => (
            <option key={c.category} value={c.category}>
              {CATEGORY_LABELS[c.category] || c.category} ({c.count})
            </option>
          ))}
        </select>

        <select
          value={since}
          onChange={e => setSince(e.target.value)}
          className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {SINCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {personalized && (
          <select
            value={minSkillMatch}
            onChange={e => setMinSkillMatch(e.target.value)}
            title="Only show postings matching at least this % of your Profile skills — off by default, everything relevant still shows"
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Any skill match</option>
            <option value="40">40%+ skill match</option>
            <option value="50">50%+ skill match</option>
            <option value="70">70%+ skill match</option>
          </select>
        )}

        <button
          onClick={() => fetchContacts(0)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Empty state */}
      {contacts.length === 0 && !loading && (
        <div className="text-center py-16 text-gray-400 bg-white border border-gray-200 rounded-lg">
          <Mail size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500">
            {since === '1' ? 'No new contacts in the last 24 hours' : 'No HR contacts found yet'}
          </p>
          <p className="text-sm mt-1 max-w-xs mx-auto">
            {since === '1'
              ? <>Try switching to <button onClick={() => setSince('7')} className="font-medium text-brand-600 hover:underline">Last 7 days</button> or click <span className="font-medium">Scrape + Extract</span> in Admin Panel to fetch fresh data.</>
              : <>Enable the pipeline in <span className="font-medium">Admin Panel → Job Intel Pipeline</span>, then click Run Pipeline Now.</>
            }
          </p>
        </div>
      )}

      {/* Contact cards */}
      <div className="space-y-2">
        {contacts.map(contact => {
          const src      = sourceLabel(contact.source);
          const hasLLM   = contact.extraction_method === 'llm';
          return (
            <div
              key={contact.id}
              className="bg-purple-50/30 border border-purple-200 border-l-4 border-l-purple-500 rounded-lg p-4 hover:shadow-sm hover:bg-purple-50/50 transition-all"
            >
              {/* Source + extraction method badges */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700">
                  🟣 Job Intel
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${src.bg} ${src.text}`}>
                  <Globe size={9} /> {src.label}
                </span>
                {contact.category && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                    {CATEGORY_LABELS[contact.category] || contact.category}
                  </span>
                )}
                {contact.preference_match?.preference && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-800" title="Matches your Profile's Preferred Role">
                    ⭐ Preference {contact.preference_match.preference}
                  </span>
                )}
                {!!contact.preference_match?.skillMatchPercent && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800"
                    title={`${contact.preference_match.matchedSkills.length} of your skills matched (${contact.preference_match.skillMatchMethod === 'embedding' ? 'semantic' : 'keyword'} match): ${contact.preference_match.matchedSkills.join(', ')}`}
                  >
                    🎯 {contact.preference_match.skillMatchPercent}% skill match
                  </span>
                )}
                {hasLLM && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700">
                    <Cpu size={9} /> AI extracted
                  </span>
                )}
                <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-1.5">
                  {contact.fetched_at && (
                    <span title="When this contact was added to Job Intel">
                      Added {contact.fetched_at.slice(0, 16)}
                    </span>
                  )}
                  {contact.posted_at && contact.posted_at !== contact.fetched_at?.slice(0,10) && (
                    <span className="text-gray-300">· posted {contact.posted_at}</span>
                  )}
                </span>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {/* Emails — primary */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {contact.emails.map(email => (
                      <div key={email} className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold bg-green-50 text-green-700 border border-green-200">
                          <Mail size={11} /> {email}
                        </span>
                        <button
                          onClick={() => addToHRList(contact, email)}
                          disabled={added.has(email)}
                          title={added.has(email) ? 'Added to HR List' : 'Add to HR List'}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            added.has(email)
                              ? 'bg-gray-100 text-gray-400 cursor-default'
                              : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100'
                          }`}
                        >
                          {added.has(email)
                            ? <><CheckCircle size={10} /> Added</>
                            : <><UserPlus size={10} /> Add to HR List</>
                          }
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Phone-only lead (WhatsApp hiring post, no email) — informational
                      only, can't be added to the HR List since it has no email. */}
                  {!contact.emails.length && contact.contact_channel?.startsWith('whatsapp:') && (
                    <div className="mb-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                        title="No email found — this posting only gave a WhatsApp number. Reach out manually; it can't be added to the HR List.">
                        📱 WhatsApp: {contact.contact_channel.slice('whatsapp:'.length)}
                      </span>
                    </div>
                  )}

                  {/* Contact name if AI found one */}
                  {contact.extracted_contact_name && (
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      👤 {contact.extracted_contact_name}
                    </p>
                  )}

                  {/* Job context — secondary */}
                  <p className="text-sm text-gray-600">
                    {contact.title && <span className="font-medium">{contact.title}</span>}
                    {contact.title && contact.company && <span className="text-gray-400"> at </span>}
                    {contact.company && <span>{contact.company}</span>}
                    {contact.location && <span className="text-gray-400"> · {contact.location}</span>}
                  </p>

                  {/* Description snippet */}
                  {contact.description && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                      {contact.description.slice(0, 160)}
                    </p>
                  )}
                </div>

                {/* Apply link */}
                {contact.apply_url && (
                  <a
                    href={contact.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 whitespace-nowrap"
                  >
                    View post <ExternalLink size={10} />
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
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()} contacts
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => fetchContacts(Math.max(0, offset - LIMIT))}
              disabled={offset === 0 || loading}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => fetchContacts(offset + LIMIT)}
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
