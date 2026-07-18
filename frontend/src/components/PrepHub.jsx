import { useState, useMemo, useEffect } from 'react';
import { toast } from 'react-hot-toast';

const STORAGE_KEY = 'hr_prep_resources_v2';

// ── Resource type detection ────────────────────────────────────────────────
function detectType(url = '') {
  const u = url.toLowerCase();
  if (/youtube\.com\/watch|youtube\.com\/@|youtu\.be/.test(u)) return 'youtube';
  if (/github\.com/.test(u))                                    return 'github';
  if (/leetcode\.com/.test(u))                                  return 'leetcode';
  if (/udemy\.com|coursera\.org|educative\.io|pluralsight\.com|algoexpert\.io|kodekloud\.com/.test(u)) return 'course';
  if (/medium\.com|dev\.to|hashnode|substack|baeldung\.com|freecodecamp\.org|geeksforgeeks\.org/.test(u)) return 'article';
  return 'link';
}

const TYPE_META = {
  youtube:  { icon: '▶️', label: 'YouTube',  cls: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' },
  github:   { icon: '🐙', label: 'GitHub',   cls: 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100' },
  leetcode: { icon: '💻', label: 'LeetCode', cls: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' },
  course:   { icon: '🎓', label: 'Course',   cls: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' },
  article:  { icon: '📄', label: 'Article',  cls: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' },
  link:     { icon: '🔗', label: 'Link',     cls: 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100' },
};

// ── Default curated content ────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: 'dsa', label: 'DSA & Coding', icon: '🧠', color: 'from-blue-500 to-indigo-600',
    tips: [
      'Master 14 patterns: sliding window, two-pointer, BFS/DFS, dynamic programming, backtracking',
      'Solve 150 quality problems rather than 500 random ones',
      'Time yourself: 45 min max per problem in practice',
      'Read editorial discussions AFTER each attempt, not before',
    ],
    resources: [
      { title: 'NeetCode — Pattern-based solutions', url: 'https://www.youtube.com/@NeetCode', type: 'youtube' },
      { title: 'Abdul Bari — Algorithm deep dives', url: 'https://www.youtube.com/@abdul_bari', type: 'youtube' },
      { title: 'William Fiset — Graph algorithms', url: 'https://www.youtube.com/@WilliamFiset-videos', type: 'youtube' },
      { title: 'Striver — A-Z DSA sheet', url: 'https://www.youtube.com/@takeUforward', type: 'youtube' },
      { title: 'Coding Interview University', url: 'https://github.com/jwasham/coding-interview-university', type: 'github' },
      { title: 'The Algorithms (Python)', url: 'https://github.com/TheAlgorithms/Python', type: 'github' },
      { title: 'NeetCode 150 Practice List', url: 'https://neetcode.io/practice', type: 'link' },
      { title: 'LeetCode', url: 'https://leetcode.com', type: 'leetcode' },
      { title: 'AlgoExpert — 160 curated problems', url: 'https://www.algoexpert.io', type: 'course' },
    ],
  },
  {
    id: 'system-design', label: 'System Design', icon: '🏗️', color: 'from-purple-500 to-violet-600',
    tips: [
      'Always start with requirements: functional, non-functional, scale estimate',
      'Know CAP theorem — consistency vs availability trade-offs in real systems',
      'Practice: URL shortener, Twitter feed, WhatsApp, Netflix, Uber, Rate Limiter',
      'Draw data flow diagrams — whiteboard skill matters as much as knowledge',
    ],
    resources: [
      { title: 'Gaurav Sen — System Design playlist', url: 'https://www.youtube.com/@gkcs', type: 'youtube' },
      { title: 'ByteByteGo — Visual system design', url: 'https://www.youtube.com/@ByteByteGo', type: 'youtube' },
      { title: 'Hussein Nasser — Backend & protocols', url: 'https://www.youtube.com/@hnasr', type: 'youtube' },
      { title: 'Arpit Bhayani — System design deep dives', url: 'https://www.youtube.com/@AsliEngineering', type: 'youtube' },
      { title: 'System Design Primer', url: 'https://github.com/donnemartin/system-design-primer', type: 'github' },
      { title: 'System Design 101', url: 'https://github.com/ByteByteGoHq/system-design-101', type: 'github' },
      { title: 'Awesome Scalability', url: 'https://github.com/binhnguyennus/awesome-scalability', type: 'github' },
      { title: 'Grokking System Design Interview', url: 'https://www.educative.io/courses/grokking-the-system-design-interview', type: 'course' },
    ],
  },
  {
    id: 'behavioral', label: 'Behavioral (STAR)', icon: '💬', color: 'from-green-500 to-emerald-600',
    tips: [
      'Prepare 6-8 STAR stories covering leadership, conflict, failure, impact, ambiguity',
      'Map each story to 3-4 competencies — reuse with different framing',
      '"Tell me about yourself" — keep under 2 minutes, end with why this role',
      'Always have a genuine failure story ready — interviewers respect self-awareness',
    ],
    resources: [
      { title: 'Dan Croitor — Amazon Leadership Principles', url: 'https://www.youtube.com/@DanCroitor', type: 'youtube' },
      { title: 'Jeff H Sipe — Google behavioral prep', url: 'https://www.youtube.com/@JeffHSipe', type: 'youtube' },
      { title: 'Don Georgevich — Interview answers', url: 'https://www.youtube.com/@JobInterviewTools', type: 'youtube' },
      { title: 'Amazon Leadership Principles', url: 'https://www.amazon.jobs/content/en/our-workplace/leadership-principles', type: 'link' },
      { title: 'STAR Method in-depth guide', url: 'https://www.themuse.com/advice/star-interview-method', type: 'article' },
      { title: 'Tech Interview Handbook — Behavioral', url: 'https://www.techinterviewhandbook.org/behavioral-interview/', type: 'article' },
    ],
  },
  {
    id: 'java', label: 'Java / Spring Boot', icon: '☕', color: 'from-orange-500 to-red-500',
    tips: [
      'JVM internals: GC algorithms (G1, ZGC), heap regions, class loading',
      'Spring auto-configuration, bean lifecycle, AOP, and transaction management',
      'Concurrency: ReentrantLock, CompletableFuture, thread pools, virtual threads (Java 21)',
      'Kafka: consumer groups, offset management, exactly-once semantics',
    ],
    resources: [
      { title: 'Amigoscode — Spring Boot full course', url: 'https://www.youtube.com/@amigoscode', type: 'youtube' },
      { title: 'Marco Codes — Advanced Java & Spring', url: 'https://www.youtube.com/@MarcoCodess', type: 'youtube' },
      { title: 'in28minutes — Microservices with Spring', url: 'https://www.youtube.com/@in28minutes', type: 'youtube' },
      { title: 'Java Brains — Spring Framework', url: 'https://www.youtube.com/@Java.Brains', type: 'youtube' },
      { title: 'Java Concurrency in Practice notes', url: 'https://github.com/jdemaagd/java-concurrency-in-practice', type: 'github' },
      { title: 'Baeldung — Java & Spring guides', url: 'https://www.baeldung.com', type: 'article' },
      { title: 'Java Concurrency course (Jenkov)', url: 'https://jenkov.com/tutorials/java-concurrency/index.html', type: 'article' },
    ],
  },
  {
    id: 'frontend', label: 'Frontend / React', icon: '⚛️', color: 'from-cyan-500 to-blue-500',
    tips: [
      'Master React hooks: useState, useEffect, useMemo, useCallback, useRef',
      'Understand reconciliation, fibers, and React 18 concurrent features',
      'CSS mastery: Flexbox, Grid, custom properties, responsive design',
      'Build a portfolio project — interviewers often ask you to walk through it',
    ],
    resources: [
      { title: 'Fireship — React & modern JS', url: 'https://www.youtube.com/@Fireship', type: 'youtube' },
      { title: 'Theo t3.gg — React ecosystem', url: 'https://www.youtube.com/@t3dotgg', type: 'youtube' },
      { title: 'Kevin Powell — CSS mastery', url: 'https://www.youtube.com/@KevinPowell', type: 'youtube' },
      { title: 'Web Dev Simplified', url: 'https://www.youtube.com/@WebDevSimplified', type: 'youtube' },
      { title: 'Awesome React', url: 'https://github.com/enaqx/awesome-react', type: 'github' },
      { title: 'Frontend Interview Handbook', url: 'https://www.frontendinterviewhandbook.com', type: 'article' },
      { title: 'JavaScript.info — modern JS guide', url: 'https://javascript.info', type: 'article' },
    ],
  },
  {
    id: 'devops', label: 'DevOps & Cloud', icon: '🐳', color: 'from-slate-600 to-slate-800',
    tips: [
      'Docker: images, containers, volumes, networking, multi-stage builds',
      'Kubernetes: pods, services, deployments, HPA, ingress controllers',
      'CI/CD: GitHub Actions, Jenkins pipelines, blue-green & canary deployments',
      'AWS core: EC2, S3, RDS, Lambda, EKS, CloudWatch',
    ],
    resources: [
      { title: 'TechWorld with Nana — Docker & K8s', url: 'https://www.youtube.com/@TechWorldwithNana', type: 'youtube' },
      { title: 'KodeKloud — Hands-on DevOps', url: 'https://www.youtube.com/@KodeKloud', type: 'youtube' },
      { title: 'NetworkChuck — Cloud & networking', url: 'https://www.youtube.com/@NetworkChuck', type: 'youtube' },
      { title: 'Awesome DevOps', url: 'https://github.com/wmariuss/awesome-devops', type: 'github' },
      { title: '90DaysOfDevOps challenge', url: 'https://github.com/MichaelCade/90DaysOfDevOps', type: 'github' },
      { title: 'AWS Free Tier', url: 'https://aws.amazon.com/free/', type: 'link' },
      { title: 'Roadmap.sh — DevOps path', url: 'https://roadmap.sh/devops', type: 'article' },
    ],
  },
  {
    id: 'python', label: 'Python', icon: '🐍', color: 'from-yellow-500 to-green-500',
    tips: [
      'Python internals: GIL, generators, decorators, context managers, metaclasses',
      'Master list/dict/set comprehensions, lambda, *args/**kwargs',
      'asyncio and async/await for concurrent Python',
      'pandas + numpy if targeting data engineering or ML roles',
    ],
    resources: [
      { title: 'Corey Schafer — Python tutorials', url: 'https://www.youtube.com/@coreyms', type: 'youtube' },
      { title: 'Tech With Tim — Python projects', url: 'https://www.youtube.com/@TechWithTim', type: 'youtube' },
      { title: 'mCoding — Python internals', url: 'https://www.youtube.com/@mCoding', type: 'youtube' },
      { title: 'TheAlgorithms Python', url: 'https://github.com/TheAlgorithms/Python', type: 'github' },
      { title: 'Real Python — in-depth articles', url: 'https://realpython.com', type: 'article' },
      { title: 'Python Roadmap', url: 'https://roadmap.sh/python', type: 'article' },
    ],
  },
  {
    id: 'database', label: 'Databases & SQL', icon: '🗄️', color: 'from-teal-500 to-cyan-600',
    tips: [
      'Master JOINs, subqueries, window functions (RANK, ROW_NUMBER, LAG/LEAD), CTEs',
      'Indexing: B-tree, composite indexes, covering indexes, partial indexes',
      'ACID properties, isolation levels, deadlocks, and connection pooling',
      'NoSQL trade-offs: document (Mongo), key-value (Redis), wide-column (Cassandra)',
    ],
    resources: [
      { title: 'CMU Database Group — DB internals', url: 'https://www.youtube.com/@CMUDatabaseGroup', type: 'youtube' },
      { title: 'Hussein Nasser — Database engineering', url: 'https://www.youtube.com/@hnasr', type: 'youtube' },
      { title: 'Awesome Databases', url: 'https://github.com/numetriclabz/awesome-db', type: 'github' },
      { title: 'SQLZoo — interactive SQL', url: 'https://sqlzoo.net', type: 'link' },
      { title: 'HackerRank SQL challenges', url: 'https://www.hackerrank.com/domains/sql', type: 'leetcode' },
      { title: 'Use The Index, Luke — indexing guide', url: 'https://use-the-index-luke.com', type: 'article' },
    ],
  },
];

// ── localStorage helpers ───────────────────────────────────────────────────
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function persist(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── ResourceCard ───────────────────────────────────────────────────────────
function ResourceCard({ resource, onDelete }) {
  const type = resource.type || detectType(resource.url);
  const meta = TYPE_META[type] || TYPE_META.link;
  return (
    <a href={resource.url} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className={`group relative flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all ${meta.cls}`}
    >
      <span className="text-lg shrink-0 mt-0.5">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-tight line-clamp-2 group-hover:underline">{resource.title}</p>
        <p className="text-[10px] mt-1 opacity-60 truncate">{resource.url.replace(/^https?:\/\//, '').split('/')[0]}</p>
        {resource.userAdded && (
          <span className="text-[9px] bg-white/70 px-1.5 py-0.5 rounded-full font-bold mt-1 inline-block">My resource</span>
        )}
      </div>
      {onDelete && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 bg-white rounded-full flex items-center justify-center text-red-400 hover:text-red-600 text-xs shadow-sm border border-red-100"
          title="Remove"
        >×</button>
      )}
    </a>
  );
}

// ── Add Resource Form ──────────────────────────────────────────────────────
function AddResourceForm({ onAdd }) {
  const [url,   setUrl]   = useState('');
  const [title, setTitle] = useState('');
  const [open,  setOpen]  = useState(false);

  const detectedType = url ? detectType(url) : null;
  const meta         = detectedType ? TYPE_META[detectedType] : null;

  function submit(e) {
    e.preventDefault();
    if (!url.trim())   { toast.error('URL is required'); return; }
    if (!title.trim()) { toast.error('Title is required'); return; }
    onAdd({ url: url.trim(), title: title.trim(), type: detectedType || 'link', userAdded: true, addedAt: Date.now() });
    setUrl(''); setTitle(''); setOpen(false);
    toast.success('Resource added!');
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-blue-600 border-2 border-dashed border-gray-200 hover:border-blue-300 rounded-xl px-3 py-2.5 transition-all w-full justify-center">
        + Add your own resource
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-blue-50 border-2 border-blue-200 rounded-xl p-3 space-y-2">
      <p className="text-xs font-bold text-blue-700">Add Resource — YouTube, GitHub, Article, Course…</p>
      <div className="flex gap-2 items-start">
        <div className="relative flex-1">
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="Paste URL (YouTube, GitHub, article, course…)"
            className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
          {meta && (
            <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${meta.cls}`}>
              {meta.icon} {meta.label}
            </span>
          )}
        </div>
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Resource title (e.g. 'NeetCode - Binary Search')"
        className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
      <div className="flex gap-2">
        <button type="submit"
          className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="px-4 py-1.5 border border-gray-200 text-xs text-gray-500 rounded-lg hover:bg-white transition">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Category Panel ─────────────────────────────────────────────────────────
function CategoryPanel({ cat, userResources, onAddResource, onDeleteResource }) {
  const [showTips, setShowTips] = useState(false);

  const allResources = useMemo(() => [
    ...cat.resources,
    ...(userResources || []),
  ], [cat.resources, userResources]);

  return (
    <div className="space-y-4">
      {/* Tips — collapsible */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <button onClick={() => setShowTips(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">💡 Key Interview Tips</span>
          <span className="text-gray-400 text-sm">{showTips ? '▲' : '▼'}</span>
        </button>
        {showTips && (
          <div className="px-4 pb-4 space-y-2 border-t border-gray-100 pt-3">
            {cat.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm text-gray-600">
                <span className="text-blue-400 font-bold shrink-0 mt-0.5">{i + 1}.</span>
                <span className="leading-relaxed">{tip}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resources grid */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Resources <span className="text-gray-300 font-normal">({allResources.length})</span>
          </p>
          <div className="flex gap-1.5 text-[10px] text-gray-400">
            {Object.entries(TYPE_META).map(([k, v]) => {
              const count = allResources.filter(r => (r.type || detectType(r.url)) === k).length;
              return count > 0 ? (
                <span key={k} className={`px-2 py-0.5 rounded-full border font-semibold ${v.cls}`}>{v.icon} {count}</span>
              ) : null;
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {allResources.map((r, i) => (
            <ResourceCard
              key={r.url + i}
              resource={r}
              onDelete={r.userAdded ? () => onDeleteResource(cat.id, i - cat.resources.length) : null}
            />
          ))}
        </div>

        <div className="mt-3">
          <AddResourceForm onAdd={res => onAddResource(cat.id, res)} />
        </div>
      </div>
    </div>
  );
}

// ── Main PrepHub ───────────────────────────────────────────────────────────
export default function PrepHub() {
  const [activeId,  setActiveId]  = useState(CATEGORIES[0].id);
  const [search,    setSearch]    = useState('');
  const [userRes,   setUserRes]   = useState(loadSaved);

  const activeCat = CATEGORIES.find(c => c.id === activeId) || CATEGORIES[0];

  function addResource(catId, resource) {
    setUserRes(prev => {
      const next = { ...prev, [catId]: [...(prev[catId] || []), resource] };
      persist(next);
      return next;
    });
  }

  function deleteResource(catId, idx) {
    setUserRes(prev => {
      const list = [...(prev[catId] || [])];
      list.splice(idx, 1);
      const next = { ...prev, [catId]: list };
      persist(next);
      return next;
    });
  }

  // Search across all resources
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const results = [];
    CATEGORIES.forEach(cat => {
      const all = [...cat.resources, ...(userRes[cat.id] || [])];
      all.forEach((r, i) => {
        if (r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q)) {
          results.push({ ...r, catLabel: cat.label, catId: cat.id, catIdx: i });
        }
      });
    });
    return results;
  }, [search, userRes]);

  const totalUserAdded = useMemo(() =>
    Object.values(userRes).reduce((s, arr) => s + arr.length, 0), [userRes]);

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Interview Prep Hub</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {CATEGORIES.length} topics · {CATEGORIES.reduce((s, c) => s + c.resources.length, 0)} curated resources
            {totalUserAdded > 0 && ` · ${totalUserAdded} added by you`}
          </p>
        </div>
        {/* Search */}
        <div className="relative">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search all resources…"
            className="text-xs border border-gray-200 rounded-xl pl-8 pr-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 w-52" />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">×</button>
          )}
        </div>
      </div>

      {/* Search results */}
      {search.trim() && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 mb-3">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{search}"
          </p>
          {searchResults.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No resources found — try a different keyword</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {searchResults.map((r, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-[10px] text-gray-400 font-semibold">{r.catLabel}</p>
                  <ResourceCard resource={r} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category tabs */}
      {!search.trim() && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {CATEGORIES.map(cat => {
              const userCount = (userRes[cat.id] || []).length;
              const isActive  = activeId === cat.id;
              return (
                <button key={cat.id} onClick={() => setActiveId(cat.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap border transition-all shrink-0 ${
                    isActive
                      ? `bg-gradient-to-r ${cat.color} text-white border-transparent shadow-md`
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <span className="text-base">{cat.icon}</span>
                  <span>{cat.label}</span>
                  {userCount > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'}`}>
                      +{userCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active category header */}
          <div className={`rounded-2xl bg-gradient-to-br ${activeCat.color} p-5 text-white`}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">{activeCat.icon}</span>
              <div>
                <h3 className="text-lg font-black">{activeCat.label}</h3>
                <p className="text-white/70 text-xs mt-0.5">
                  {activeCat.resources.length} curated · {(userRes[activeCat.id] || []).length} added by you
                </p>
              </div>
            </div>
          </div>

          {/* Category content */}
          <CategoryPanel
            cat={activeCat}
            userResources={userRes[activeCat.id] || []}
            onAddResource={addResource}
            onDeleteResource={deleteResource}
          />
        </>
      )}
    </div>
  );
}
