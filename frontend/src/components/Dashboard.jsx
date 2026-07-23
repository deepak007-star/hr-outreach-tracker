import { useMemo, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import PrepHub from './PrepHub.jsx';

// ── Static data ────────────────────────────────────────────────────────────
const PIPELINE_ORDER = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected'];

const BAR_COLOR = {
  New:       'bg-gray-300',
  Drafted:   'bg-blue-400',
  Sent:      'bg-yellow-400',
  Opened:    'bg-lime-400',
  Replied:   'bg-green-500',
  Interview: 'bg-emerald-500',
  Rejected:  'bg-red-400',
};

const STATUS_PILL = {
  New:       'bg-gray-100 text-gray-600',
  Drafted:   'bg-blue-100 text-blue-700',
  Sent:      'bg-yellow-100 text-yellow-700',
  Opened:    'bg-lime-100 text-lime-700',
  Replied:   'bg-green-100 text-green-700',
  Interview: 'bg-emerald-100 text-emerald-700',
  Rejected:  'bg-red-100 text-red-700',
};

const SALARY_DATA = [
  { role: 'Java Backend Engineer',   junior: '₹6–14 LPA',  mid: '₹14–28 LPA', senior: '₹28–55 LPA', icon: '☕' },
  { role: 'Frontend Developer',      junior: '₹5–12 LPA',  mid: '₹12–24 LPA', senior: '₹24–45 LPA', icon: '🎨' },
  { role: 'Full Stack Developer',    junior: '₹6–14 LPA',  mid: '₹14–28 LPA', senior: '₹28–50 LPA', icon: '⚡' },
  { role: 'DevOps / SRE',            junior: '₹8–16 LPA',  mid: '₹16–32 LPA', senior: '₹32–60 LPA', icon: '🔧' },
  { role: 'Data Engineer',           junior: '₹8–18 LPA',  mid: '₹18–36 LPA', senior: '₹36–65 LPA', icon: '📊' },
  { role: 'ML / AI Engineer',        junior: '₹10–20 LPA', mid: '₹20–45 LPA', senior: '₹45–90 LPA', icon: '🤖' },
  { role: 'Mobile (Android / iOS)',  junior: '₹6–14 LPA',  mid: '₹14–26 LPA', senior: '₹26–48 LPA', icon: '📱' },
  { role: 'QA / SDET',              junior: '₹4–10 LPA',  mid: '₹10–20 LPA', senior: '₹20–38 LPA', icon: '🧪' },
];


const COMPANY_RESEARCH = [
  { label: 'Glassdoor',    icon: '🏢', desc: 'Salaries, reviews, interview experiences', url: 'https://www.glassdoor.co.in' },
  { label: 'Levels.fyi',  icon: '📈', desc: 'Verified compensation data at tech companies', url: 'https://www.levels.fyi/?compare=Google,Facebook,Microsoft&track=Software+Engineer' },
  { label: 'AmbitionBox', icon: '🎯', desc: 'India-specific salaries & company reviews', url: 'https://www.ambitionbox.com' },
  { label: 'LinkedIn',    icon: '💼', desc: 'Job posts, company pages, recruiter contacts', url: 'https://www.linkedin.com/jobs' },
  { label: 'Blind',       icon: '👁',  desc: 'Anonymous employee discussions & comp data', url: 'https://www.teamblind.com' },
  { label: 'Naukri',      icon: '🔍', desc: 'India job board — check salary ranges per JD', url: 'https://www.naukri.com' },
];

const JOB_PORTALS = [
  { label: 'Naukri',         icon: '🔍', desc: 'India\'s #1 job portal — widest reach for tech roles', tag: 'Most Popular', tagColor: 'bg-orange-100 text-orange-700', url: 'https://www.naukri.com/jobs-in-india?q=software+engineer' },
  { label: 'LinkedIn Jobs',  icon: '💼', desc: 'Recruiter connections + job applications in one place', tag: 'Best for Networking', tagColor: 'bg-blue-100 text-blue-700', url: 'https://www.linkedin.com/jobs' },
  { label: 'Foundit',        icon: '🔎', desc: 'Formerly Monster India — strong MNC job listings', tag: 'MNC Focus', tagColor: 'bg-purple-100 text-purple-700', url: 'https://www.foundit.in/srp/results?query=software+engineer' },
  { label: 'InstaHyre',      icon: '⚡', desc: 'Instant hiring platform — get noticed in 48 hrs', tag: 'Fast Hiring', tagColor: 'bg-yellow-100 text-yellow-700', url: 'https://www.instahyre.com' },
  { label: 'Wellfound',      icon: '🚀', desc: 'AngelList for startups — equity + salary transparency', tag: 'Startups', tagColor: 'bg-green-100 text-green-700', url: 'https://wellfound.com/jobs' },
  { label: 'Y Combinator',   icon: '🏆', desc: 'Work at a YC startup — top-tier funded companies', tag: 'YC Startups', tagColor: 'bg-amber-100 text-amber-700', url: 'https://www.ycombinator.com/jobs' },
  { label: 'Cutshort',       icon: '✂️', desc: 'AI-matched jobs for dev roles — no resume spam', tag: 'AI Matching', tagColor: 'bg-indigo-100 text-indigo-700', url: 'https://cutshort.io/jobs' },
  { label: 'Indeed India',   icon: '🌐', desc: 'Global job board with strong India presence', tag: 'High Volume', tagColor: 'bg-sky-100 text-sky-700', url: 'https://in.indeed.com/q-software-engineer-jobs.html' },
  { label: 'Unstop',         icon: '🎓', desc: 'Competitions, hackathons & freshers hiring', tag: 'Freshers', tagColor: 'bg-rose-100 text-rose-700', url: 'https://unstop.com/jobs' },
  { label: 'HackerEarth',    icon: '💻', desc: 'Skill-based hiring — solve to get noticed', tag: 'Coding Tests', tagColor: 'bg-teal-100 text-teal-700', url: 'https://www.hackerearth.com/jobs' },
  { label: 'Toptal',         icon: '🌟', desc: 'Freelance / remote work for top 3% talent', tag: 'Remote Elite', tagColor: 'bg-violet-100 text-violet-700', url: 'https://www.toptal.com/developers/apply' },
  { label: 'Internshala',    icon: '📚', desc: 'Internships + fresher jobs + online courses', tag: 'Internships', tagColor: 'bg-pink-100 text-pink-700', url: 'https://internshala.com/jobs' },
];

const DAILY_TIP = [
  "Personalise every cold email — mention a specific product or recent news about the company.",
  "Follow up exactly once after 5–7 days. Most replies come after the first follow-up.",
  "LinkedIn connection + InMail combo has 3× higher reply rates than InMail alone.",
  "Your subject line decides 47% of email open rates — keep it under 9 words.",
  "Apply within 3 days of a job post going live — applications drop 28% after day 3.",
  "HR managers spend 6–10 seconds on the first resume scan — lead with impact numbers.",
  "A referral makes you 9× more likely to get an interview than an online application.",
];

// ── Sub-components ─────────────────────────────────────────────────────────
function ImpactCard({ icon, value, label, sub, gradient, accent }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient} shadow-sm`}>
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-3">
          <span className="text-3xl">{icon}</span>
          <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${accent}`}>{sub}</div>
        </div>
        <p className="text-3xl font-black text-white leading-none">{value}</p>
        <p className="text-sm font-semibold text-white/80 mt-1.5">{label}</p>
      </div>
      <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />
    </div>
  );
}


// ── Checklist (persisted to localStorage) ─────────────────────────────────
const CHECKLIST_ITEMS = [
  { check: 'ATS-optimised resume ready',        link: null },
  { check: 'LinkedIn profile 90%+ complete',    link: 'https://www.linkedin.com' },
  { check: 'GitHub projects with README',       link: 'https://github.com' },
  { check: '50+ LeetCode problems solved',      link: 'https://leetcode.com' },
  { check: 'System Design mock done',           link: null },
  { check: '6 STAR stories prepared',           link: null },
  { check: 'Negotiation range researched',      link: 'https://www.levels.fyi' },
  { check: 'References / referrals lined up',   link: null },
  { check: 'Email outreach templates ready',    link: null },
];
const CHECKLIST_KEY = 'hr_checklist_v1';

function ChecklistItems() {
  const [checked, setChecked] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CHECKLIST_KEY) || '[]'); } catch { return []; }
  });

  const toggle = useCallback((i) => {
    setChecked(prev => {
      const next = prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i];
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {CHECKLIST_ITEMS.map((item, i) => (
        <label key={i} className="flex items-center gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={checked.includes(i)}
            onChange={() => toggle(i)}
            className="w-4 h-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-400 shrink-0"
          />
          {item.link ? (
            <a href={item.link} target="_blank" rel="noopener noreferrer"
              className="text-sm text-indigo-700 group-hover:underline font-medium">
              {item.check} ↗
            </a>
          ) : (
            <span className={`text-sm font-medium ${checked.includes(i) ? 'line-through text-indigo-400' : 'text-indigo-700'}`}>{item.check}</span>
          )}
        </label>
      ))}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export default function Dashboard({
  contacts = [],
  emailStats,
  onAddContact,
  onCompose,
  onGoToContacts,
}) {
  const { user } = useAuth();
  const [companySearch,  setCompanySearch]  = useState('');
  const [salarySearch,   setSalarySearch]   = useState('');

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr  = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayTip = DAILY_TIP[new Date().getDay() % DAILY_TIP.length];

  const pipeline = useMemo(() => {
    const m = {};
    contacts.forEach(c => { m[c.status] = (m[c.status] || 0) + 1; });
    return m;
  }, [contacts]);

  const total       = contacts.length;
  const sentToday   = emailStats?.sentToday ?? 0;
  const dailyCap    = emailStats?.dailyCap  ?? 20;
  const interviews  = pipeline.Interview || 0;
  const replied     = pipeline.Replied || 0;
  // Denominator = only contacts actively emailed (Sent/Opened), not those who already responded
  const emailed     = (pipeline.Sent || 0) + (pipeline.Opened || 0);
  const sent        = emailed + replied + interviews;
  const responseRate = emailed > 0 ? Math.round(((replied + interviews) / emailed) * 100) : 0;
  const activeOutreach = (pipeline.Sent || 0) + (pipeline.Opened || 0) + replied;

  const recent = useMemo(() =>
    [...contacts].sort((a, b) => new Date(b.date_added) - new Date(a.date_added)).slice(0, 6),
    [contacts],
  );

  // Unique companies from contacts for company research
  const { companyCount, myCompanies } = useMemo(() => {
    const all = [...new Set(contacts.map(c => c.company).filter(Boolean))];
    return { companyCount: all.length, myCompanies: all.slice(0, 12) };
  }, [contacts]);

  const researchedCompany = companySearch.trim();

  return (
    <div className="space-y-8">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="relative bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full translate-y-1/2 -translate-x-1/4" />
        </div>
        <div className="relative px-6 py-8 md:px-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-slate-400 text-sm mb-1">{dateStr}</p>
              <h1 className="text-2xl md:text-3xl font-black text-white">
                {greeting}{user ? `, ${user.name.split(' ')[0]}` : ''} 👋
              </h1>
              <p className="text-slate-400 text-sm mt-3 max-w-lg leading-relaxed">
                Your job-hunt command centre — track outreach, research companies, prep for interviews, and land the offer.
              </p>
              <div className="flex flex-wrap gap-3 mt-5">
                <button onClick={onAddContact}
                  className="px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold rounded-xl transition shadow-lg shadow-blue-900/30">
                  + Add Contact
                </button>
                <button onClick={onCompose}
                  className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-bold rounded-xl transition backdrop-blur-sm">
                  ✉️ Compose Email
                </button>
              </div>
            </div>

            {/* Daily tip */}
            <div className="shrink-0 bg-white/5 border border-white/10 rounded-2xl px-6 py-5 max-w-xs backdrop-blur-sm">
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">💡 Tip of the day</p>
              <p className="text-sm text-white/80 leading-relaxed">{todayTip}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Impact metrics ────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Your Outreach Impact</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <ImpactCard icon="👥" value={total}          label="Contacts Tracked"     sub="total"        gradient="bg-gradient-to-br from-blue-500 to-blue-700"      accent="bg-blue-400/30 text-blue-100" />
          <ImpactCard icon="📨" value={sentToday}      label="Emails Today"         sub={`cap ${dailyCap}`}  gradient="bg-gradient-to-br from-violet-500 to-purple-700"  accent="bg-violet-400/30 text-violet-100" />
          <ImpactCard icon="📡" value={activeOutreach} label="Active Outreach"      sub="in pipeline"  gradient="bg-gradient-to-br from-amber-500 to-orange-600"   accent="bg-amber-400/30 text-amber-100" />
          <ImpactCard icon="💬" value={`${responseRate}%`} label="Response Rate"   sub={`${replied} replied`} gradient="bg-gradient-to-br from-green-500 to-emerald-700" accent="bg-green-400/30 text-green-100" />
          <ImpactCard icon="🎯" value={interviews}     label="Interviews"           sub="scheduled"    gradient="bg-gradient-to-br from-pink-500 to-rose-600"       accent="bg-pink-400/30 text-pink-100" />
          <ImpactCard icon="🏢" value={companyCount}       label="Companies"        sub="researched"   gradient="bg-gradient-to-br from-slate-600 to-slate-800"     accent="bg-slate-400/30 text-slate-200" />
        </div>
      </div>

      {/* ── Mid section: Pipeline + Recent + Prep ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Outreach pipeline */}
        <div className="space-y-2.5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Outreach Pipeline</h2>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3.5 h-[320px] overflow-y-auto">
            {total === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <span className="text-4xl">📋</span>
                <p className="text-sm text-gray-400">Add contacts to see your funnel</p>
                <button onClick={onAddContact} className="text-xs text-blue-600 hover:underline">Add first contact →</button>
              </div>
            ) : (
              PIPELINE_ORDER.map(status => {
                const count = pipeline[status] || 0;
                const pct   = total ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-600 font-medium">{status}</span>
                      <span className="text-gray-400 tabular-nums">{count} <span className="text-gray-300">({pct}%)</span></span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${BAR_COLOR[status]}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent contacts */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Recent Contacts</h2>
            <button onClick={onGoToContacts} className="text-xs text-blue-600 hover:underline font-medium">View all →</button>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden h-[320px] overflow-y-auto">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
                <span className="text-4xl">👤</span>
                <p className="text-sm font-medium text-gray-600">No contacts yet</p>
                <button onClick={onAddContact} className="text-xs text-blue-600 hover:underline mt-1">Add your first →</button>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {recent.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/80 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm">
                      {(c.name || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                      <p className="text-xs text-gray-400 truncate">{[c.title, c.company].filter(Boolean).join(' @ ') || '—'}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_PILL[c.status] || 'bg-gray-100 text-gray-500'}`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Email pacing */}
        <div className="space-y-2.5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Email Pacing</h2>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 h-[320px] flex flex-col justify-between">
            {/* Today */}
            <div>
              <div className="flex items-end justify-between mb-2">
                <div>
                  <p className="text-4xl font-black text-gray-800">{sentToday}</p>
                  <p className="text-sm text-gray-400 mt-1">emails sent today</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-500">{dailyCap - sentToday}</p>
                  <p className="text-xs text-gray-400">remaining</p>
                </div>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden mt-3 mb-1">
                <div className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full transition-all duration-700"
                  style={{ width: `${dailyCap > 0 ? Math.min((sentToday / dailyCap) * 100, 100) : 0}%` }} />
              </div>
              <p className="text-xs text-gray-400 text-right">{dailyCap > 0 ? Math.round((sentToday / dailyCap) * 100) : 0}% of daily cap</p>
            </div>

            <div className="border-t pt-4 space-y-3">
              {[
                { label: 'Total emails sent (all time)', value: sent },
                { label: 'Contacts replied',             value: replied },
                { label: 'Interview conversion',         value: `${responseRate}%` },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{r.label}</span>
                  <span className="font-bold text-gray-800">{r.value}</span>
                </div>
              ))}
            </div>

            <button onClick={onCompose}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition">
              ✉️ Compose Outreach Email
            </button>
          </div>
        </div>
      </div>

      {/* ── Salary Insights ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">India Salary Benchmarks</h2>
          <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">2024–25 Range</span>
          <div className="ml-auto flex gap-2 items-center">
            <input value={salarySearch} onChange={e => setSalarySearch(e.target.value)}
              placeholder="Filter by role…"
              className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-300 w-44" />
            {salarySearch && (
              <a href={`https://www.glassdoor.co.in/Salaries/${encodeURIComponent(salarySearch.replace(/\s+/g,'-').toLowerCase())}-salary-SRCH_KO0,${salarySearch.length}.htm`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-xl font-semibold hover:bg-green-200 transition whitespace-nowrap">
                Glassdoor ↗
              </a>
            )}
            {salarySearch && (
              <a href={`https://www.ambitionbox.com/salaries/${encodeURIComponent(salarySearch.toLowerCase().replace(/\s+/g,'-'))}-salary`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded-xl font-semibold hover:bg-orange-200 transition whitespace-nowrap">
                AmbitionBox ↗
              </a>
            )}
            {salarySearch && (
              <a href={`https://www.naukri.com/${encodeURIComponent(salarySearch.toLowerCase().replace(/\s+/g,'-'))}-jobs`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-xl font-semibold hover:bg-red-200 transition whitespace-nowrap">
                Naukri JDs ↗
              </a>
            )}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-green-600 uppercase tracking-wide">0–3 yrs</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-blue-600 uppercase tracking-wide">3–7 yrs</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-purple-600 uppercase tracking-wide">7+ yrs</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Research</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {SALARY_DATA.filter(row =>
                !salarySearch || row.role.toLowerCase().includes(salarySearch.toLowerCase())
              ).map(row => (
                  <tr key={row.role} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-5 py-3.5 font-semibold text-gray-800 flex items-center gap-2.5">
                      <span className="text-lg">{row.icon}</span>
                      <span className="truncate">{row.role}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="text-xs font-bold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">{row.junior}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">{row.mid}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="text-xs font-bold bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full">{row.senior}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a href={`https://www.glassdoor.co.in/Salaries/${encodeURIComponent(row.role.split(' ').slice(0,2).join('-'))}-salary-SRCH_KO0,${row.role.split(' ').slice(0,2).join('-').length}.htm`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded hover:bg-green-200 transition">Glassdoor</a>
                        <a href={`https://www.levels.fyi/?track=Software+Engineer`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-200 transition">Levels</a>
                        <a href={`https://www.ambitionbox.com/salaries/${encodeURIComponent(row.role.toLowerCase().replace(/\s+/g,'-'))}-salary`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded hover:bg-orange-200 transition">AmbitionBox</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
            * Ranges are approximate median CTC figures for India metro cities (Bangalore, Hyderabad, Pune, Delhi NCR, Mumbai) sourced from Glassdoor, AmbitionBox, and Levels.fyi. Actual compensation varies by company tier and negotiation.
          </div>
        </div>
      </div>

      {/* ── Job Portals ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Job Portals to Apply</h2>
          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">12 portals</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {JOB_PORTALS.map(p => (
            <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
              className="group bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md hover:border-blue-200 hover:-translate-y-0.5 transition-all flex flex-col gap-2">
              <div className="flex items-start justify-between">
                <span className="text-2xl">{p.icon}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${p.tagColor}`}>{p.tag}</span>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800 group-hover:text-blue-600 transition-colors">{p.label}</p>
                <p className="text-xs text-gray-400 leading-relaxed mt-0.5">{p.desc}</p>
              </div>
              <p className="text-[11px] text-blue-500 font-semibold mt-auto">Open portal ↗</p>
            </a>
          ))}
        </div>
      </div>

      {/* ── Company Research ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Company Research</h2>

        {/* Search bar — works for ANY company, no contacts required */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">
            🔍 Research any company — type a name to get direct links for reviews, salary, jobs & more
          </p>
          <div className="flex gap-2">
            <input
              value={companySearch}
              onChange={e => setCompanySearch(e.target.value)}
              placeholder="e.g. Google, Flipkart, Infosys, Razorpay…"
              className="flex-1 text-sm border border-gray-300 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            />
            {companySearch && (
              <button onClick={() => setCompanySearch('')}
                className="px-3 py-2 text-gray-400 hover:text-gray-600 border border-gray-200 rounded-xl text-sm transition">
                ✕ Clear
              </button>
            )}
          </div>

          {/* Quick-pick from contacts */}
          {myCompanies.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-gray-400 font-semibold mb-2 uppercase tracking-wide">From your contacts — click to research:</p>
              <div className="flex flex-wrap gap-1.5">
                {myCompanies.map(c => (
                  <button key={c} onClick={() => setCompanySearch(c)}
                    className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
                      companySearch === c
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
                    }`}>
                    🏢 {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action cards — appear when a company is typed */}
          {researchedCompany ? (
            <div className="mt-5 border-t border-gray-100 pt-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {researchedCompany[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">{researchedCompany}</p>
                  <p className="text-xs text-gray-400">8 research actions available</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  {
                    icon: '⭐', label: 'Reviews',
                    desc: 'Glassdoor employee reviews',
                    color: 'border-green-200 bg-green-50 hover:bg-green-100',
                    textColor: 'text-green-700',
                    url: `https://www.glassdoor.co.in/Reviews/${encodeURIComponent(researchedCompany.replace(/\s+/g,'-'))}-Reviews-E1_IE1.htm?filter.countryId=115`,
                  },
                  {
                    icon: '💰', label: 'Salaries',
                    desc: 'Role-wise salary data',
                    color: 'border-blue-200 bg-blue-50 hover:bg-blue-100',
                    textColor: 'text-blue-700',
                    url: `https://www.glassdoor.co.in/Salary/${encodeURIComponent(researchedCompany.replace(/\s+/g,'-'))}-Salaries-E1.htm`,
                  },
                  {
                    icon: '🎯', label: 'AmbitionBox',
                    desc: 'India ratings & interviews',
                    color: 'border-orange-200 bg-orange-50 hover:bg-orange-100',
                    textColor: 'text-orange-700',
                    url: `https://www.ambitionbox.com/overview/${encodeURIComponent(researchedCompany.toLowerCase().replace(/\s+/g,'-'))}-overview`,
                  },
                  {
                    icon: '💼', label: 'LinkedIn',
                    desc: 'Company page & job posts',
                    color: 'border-sky-200 bg-sky-50 hover:bg-sky-100',
                    textColor: 'text-sky-700',
                    url: `https://www.linkedin.com/company/${encodeURIComponent(researchedCompany.toLowerCase().replace(/\s+/g,'-'))}`,
                  },
                  {
                    icon: '👥', label: 'Find HRs',
                    desc: 'Search recruiters on LinkedIn',
                    color: 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100',
                    textColor: 'text-indigo-700',
                    url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(researchedCompany)}+recruiter+HR`,
                  },
                  {
                    icon: '👁', label: 'Blind',
                    desc: 'Anonymous employee talk',
                    color: 'border-gray-200 bg-gray-50 hover:bg-gray-100',
                    textColor: 'text-gray-700',
                    url: `https://www.teamblind.com/search?q=${encodeURIComponent(researchedCompany)}`,
                  },
                  {
                    icon: '🔍', label: 'Naukri Jobs',
                    desc: 'Open positions right now',
                    color: 'border-red-200 bg-red-50 hover:bg-red-100',
                    textColor: 'text-red-700',
                    url: `https://www.naukri.com/${encodeURIComponent(researchedCompany.toLowerCase().replace(/\s+/g,'-'))}-jobs`,
                  },
                  {
                    icon: '📰', label: 'News',
                    desc: 'Recent hiring & funding news',
                    color: 'border-amber-200 bg-amber-50 hover:bg-amber-100',
                    textColor: 'text-amber-700',
                    url: `https://www.google.com/search?q=${encodeURIComponent(researchedCompany)}+hiring+layoffs+funding+2025`,
                  },
                ].map(action => (
                  <a key={action.label} href={action.url} target="_blank" rel="noopener noreferrer"
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all group ${action.color}`}>
                    <span className="text-xl shrink-0 mt-0.5">{action.icon}</span>
                    <div className="min-w-0">
                      <p className={`text-xs font-bold ${action.textColor}`}>{action.label} ↗</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{action.desc}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 border-t border-gray-100 pt-4 text-center text-xs text-gray-400 space-y-1">
              <p className="text-base">🏢</p>
              <p>Type a company name above to unlock 8 research actions</p>
              <p className="text-[11px]">Reviews · Salary · LinkedIn · Find HRs · Jobs · News</p>
            </div>
          )}
        </div>

        {/* General research tool cards */}
        <div>
          <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-widest mb-2">General Research Tools</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {COMPANY_RESEARCH.map(r => (
              <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer"
                className="group bg-white border border-gray-200 rounded-xl p-3 hover:shadow-md hover:border-blue-200 transition-all text-center">
                <span className="text-2xl block mb-1">{r.icon}</span>
                <p className="text-xs font-bold text-gray-700 group-hover:text-blue-600 transition-colors">{r.label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">{r.desc}</p>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ── Interview Prep Hub ────────────────────────────────────────── */}
      <PrepHub />

      {/* ── Checklist: Ready to Apply? ────────────────────────────────── */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl border border-indigo-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">✅</span>
          <h2 className="text-base font-bold text-indigo-900">Application Readiness Checklist</h2>
        </div>
        <ChecklistItems />
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl px-8 py-10 text-center space-y-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-2xl">🎯</span>
          <p className="text-xl font-black text-white tracking-tight">HR Outreach Tracker</p>
        </div>
        <p className="text-slate-300 text-base font-semibold italic">
          "Your next opportunity is one personalised email away."
        </p>
        <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
          Built for developers who believe that smart outreach beats blind applications. Track every lead, follow up at the right time, and land the interviews you deserve.
        </p>
        <div className="flex flex-wrap justify-center gap-4 pt-2">
          {[
            { label: 'Glassdoor', url: 'https://www.glassdoor.co.in' },
            { label: 'Levels.fyi', url: 'https://www.levels.fyi' },
            { label: 'LeetCode', url: 'https://leetcode.com' },
            { label: 'AmbitionBox', url: 'https://www.ambitionbox.com' },
            { label: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs' },
            { label: 'NeetCode', url: 'https://neetcode.io' },
          ].map(l => (
            <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-slate-400 hover:text-white transition-colors underline underline-offset-2">
              {l.label}
            </a>
          ))}
        </div>
        <p className="text-slate-600 text-xs pt-2">Made with ❤️ for job seekers · {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}
