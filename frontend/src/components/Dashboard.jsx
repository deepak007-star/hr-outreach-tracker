import { useMemo, useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../api/client.js';
import ActivityCalendar from './ActivityCalendar.jsx';
import PrepHub from './PrepHub.jsx';
import { Button, CardFlush, StatusPill, StatTile, Tabs, EmptyState } from './ui/index.js';
import {
  Users, Mail, Radio, TrendingUp, Calendar, Building2,
  UserPlus, MailCheck, Lightbulb, ExternalLink,
  Star, DollarSign, Target, Linkedin, EyeOff, Search, Newspaper,
  Globe, BookOpen, ListChecks, ArrowRight,
} from 'lucide-react';

// ── Static data ────────────────────────────────────────────────────────────
const PIPELINE_ORDER = ['New', 'Drafted', 'Sent', 'Opened', 'Replied', 'Interview', 'Rejected'];

// Bar colors match StatusPill semantic palette exactly
const PIPELINE_BAR = {
  New:       'bg-slate-300',
  Drafted:   'bg-brand-300',
  Sent:      'bg-amber-400',
  Opened:    'bg-violet-400',
  Replied:   'bg-emerald-500',
  Interview: 'bg-green-500',
  Rejected:  'bg-red-400',
};

const SALARY_DATA = [
  { role: 'Java Backend Engineer',  junior: '₹6–14 LPA',  mid: '₹14–28 LPA', senior: '₹28–55 LPA', icon: '☕' },
  { role: 'Frontend Developer',     junior: '₹5–12 LPA',  mid: '₹12–24 LPA', senior: '₹24–45 LPA', icon: '🎨' },
  { role: 'Full Stack Developer',   junior: '₹6–14 LPA',  mid: '₹14–28 LPA', senior: '₹28–50 LPA', icon: '⚡' },
  { role: 'DevOps / SRE',           junior: '₹8–16 LPA',  mid: '₹16–32 LPA', senior: '₹32–60 LPA', icon: '🔧' },
  { role: 'Data Engineer',          junior: '₹8–18 LPA',  mid: '₹18–36 LPA', senior: '₹36–65 LPA', icon: '📊' },
  { role: 'ML / AI Engineer',       junior: '₹10–20 LPA', mid: '₹20–45 LPA', senior: '₹45–90 LPA', icon: '🤖' },
  { role: 'Mobile (Android / iOS)', junior: '₹6–14 LPA',  mid: '₹14–26 LPA', senior: '₹26–48 LPA', icon: '📱' },
  { role: 'QA / SDET',             junior: '₹4–10 LPA',  mid: '₹10–20 LPA', senior: '₹20–38 LPA', icon: '🧪' },
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

const COMPANY_RESEARCH = [
  { label: 'Glassdoor',    Icon: Building2,   desc: 'Salaries, reviews, interview experiences',     url: 'https://www.glassdoor.co.in' },
  { label: 'Levels.fyi',  Icon: TrendingUp,   desc: 'Verified compensation data at tech companies', url: 'https://www.levels.fyi/?compare=Google,Facebook,Microsoft&track=Software+Engineer' },
  { label: 'AmbitionBox', Icon: Target,       desc: 'India-specific salaries & company reviews',    url: 'https://www.ambitionbox.com' },
  { label: 'LinkedIn',    Icon: Linkedin,     desc: 'Job posts, company pages, recruiter contacts', url: 'https://www.linkedin.com/jobs' },
  { label: 'Blind',       Icon: EyeOff,       desc: 'Anonymous employee discussions & comp data',   url: 'https://www.teamblind.com' },
  { label: 'Naukri',      Icon: Search,       desc: 'India job board — check salary ranges per JD', url: 'https://www.naukri.com' },
];

const RESEARCH_ACTIONS = [
  { Icon: Star,       label: 'Reviews',     desc: 'Glassdoor employee reviews',    cls: 'border-green-200  bg-green-50  hover:bg-green-100',   iconCls: 'text-green-600',   urlFn: co => `https://www.glassdoor.co.in/Reviews/${encodeURIComponent(co.replace(/\s+/g,'-'))}-Reviews-E1_IE1.htm?filter.countryId=115` },
  { Icon: DollarSign, label: 'Salaries',    desc: 'Role-wise salary data',         cls: 'border-blue-200   bg-blue-50   hover:bg-blue-100',    iconCls: 'text-blue-600',    urlFn: co => `https://www.glassdoor.co.in/Salary/${encodeURIComponent(co.replace(/\s+/g,'-'))}-Salaries-E1.htm` },
  { Icon: Target,     label: 'AmbitionBox', desc: 'India ratings & interviews',    cls: 'border-orange-200 bg-orange-50 hover:bg-orange-100',  iconCls: 'text-orange-600',  urlFn: co => `https://www.ambitionbox.com/overview/${encodeURIComponent(co.toLowerCase().replace(/\s+/g,'-'))}-overview` },
  { Icon: Linkedin,   label: 'LinkedIn',    desc: 'Company page & job posts',      cls: 'border-sky-200    bg-sky-50    hover:bg-sky-100',      iconCls: 'text-sky-600',     urlFn: co => `https://www.linkedin.com/company/${encodeURIComponent(co.toLowerCase().replace(/\s+/g,'-'))}` },
  { Icon: Users,      label: 'Find HRs',    desc: 'Search recruiters on LinkedIn', cls: 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100',  iconCls: 'text-indigo-600',  urlFn: co => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(co)}+recruiter+HR` },
  { Icon: EyeOff,     label: 'Blind',       desc: 'Anonymous employee talk',       cls: 'border-gray-200   bg-gray-50   hover:bg-gray-100',    iconCls: 'text-gray-600',    urlFn: co => `https://www.teamblind.com/search?q=${encodeURIComponent(co)}` },
  { Icon: Search,     label: 'Naukri Jobs', desc: 'Open positions right now',      cls: 'border-red-200    bg-red-50    hover:bg-red-100',      iconCls: 'text-red-600',     urlFn: co => `https://www.naukri.com/${encodeURIComponent(co.toLowerCase().replace(/\s+/g,'-'))}-jobs` },
  { Icon: Newspaper,  label: 'News',        desc: 'Recent hiring & funding news',  cls: 'border-amber-200  bg-amber-50  hover:bg-amber-100',   iconCls: 'text-amber-600',   urlFn: co => `https://www.google.com/search?q=${encodeURIComponent(co)}+hiring+layoffs+funding+2025` },
];

const JOB_PORTALS = [
  { label: 'Naukri',        chip: 'NA', chipCls: 'bg-orange-100 text-orange-700', desc: "India's #1 job portal — widest reach for tech roles",  tag: 'Most Popular',     tagColor: 'bg-orange-100 text-orange-700', url: 'https://www.naukri.com/jobs-in-india?q=software+engineer' },
  { label: 'LinkedIn Jobs', chip: 'LI', chipCls: 'bg-blue-100   text-blue-700',   desc: 'Recruiter connections + job applications in one place', tag: 'Best Networking',  tagColor: 'bg-blue-100 text-blue-700',     url: 'https://www.linkedin.com/jobs' },
  { label: 'Foundit',       chip: 'FO', chipCls: 'bg-purple-100 text-purple-700', desc: 'Formerly Monster India — strong MNC job listings',      tag: 'MNC Focus',        tagColor: 'bg-purple-100 text-purple-700', url: 'https://www.foundit.in/srp/results?query=software+engineer' },
  { label: 'InstaHyre',     chip: 'IH', chipCls: 'bg-amber-100  text-amber-700',  desc: 'Instant hiring platform — get noticed in 48 hrs',       tag: 'Fast Hiring',      tagColor: 'bg-amber-100 text-amber-700',   url: 'https://www.instahyre.com' },
  { label: 'Wellfound',     chip: 'WF', chipCls: 'bg-green-100  text-green-700',  desc: 'AngelList for startups — equity + salary transparency',  tag: 'Startups',         tagColor: 'bg-green-100 text-green-700',   url: 'https://wellfound.com/jobs' },
  { label: 'Y Combinator',  chip: 'YC', chipCls: 'bg-amber-100  text-amber-800',  desc: 'Work at a YC startup — top-tier funded companies',       tag: 'YC Startups',      tagColor: 'bg-amber-100 text-amber-700',   url: 'https://www.ycombinator.com/jobs' },
  { label: 'Cutshort',      chip: 'CS', chipCls: 'bg-indigo-100 text-indigo-700', desc: 'AI-matched jobs for dev roles — no resume spam',         tag: 'AI Matching',      tagColor: 'bg-indigo-100 text-indigo-700', url: 'https://cutshort.io/jobs' },
  { label: 'Indeed India',  chip: 'IN', chipCls: 'bg-sky-100    text-sky-700',    desc: 'Global job board with strong India presence',            tag: 'High Volume',      tagColor: 'bg-sky-100 text-sky-700',       url: 'https://in.indeed.com/q-software-engineer-jobs.html' },
  { label: 'Unstop',        chip: 'UN', chipCls: 'bg-rose-100   text-rose-700',   desc: 'Competitions, hackathons & freshers hiring',             tag: 'Freshers',         tagColor: 'bg-rose-100 text-rose-700',     url: 'https://unstop.com/jobs' },
  { label: 'HackerEarth',   chip: 'HE', chipCls: 'bg-teal-100   text-teal-700',   desc: 'Skill-based hiring — solve to get noticed',              tag: 'Coding Tests',     tagColor: 'bg-teal-100 text-teal-700',     url: 'https://www.hackerearth.com/jobs' },
  { label: 'Toptal',        chip: 'TP', chipCls: 'bg-violet-100 text-violet-700', desc: 'Freelance / remote work for top 3% talent',              tag: 'Remote Elite',     tagColor: 'bg-violet-100 text-violet-700', url: 'https://www.toptal.com/developers/apply' },
  { label: 'Internshala',   chip: 'IS', chipCls: 'bg-pink-100   text-pink-700',   desc: 'Internships + fresher jobs + online courses',            tag: 'Internships',      tagColor: 'bg-pink-100 text-pink-700',     url: 'https://internshala.com/jobs' },
];

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

  const doneCount = checked.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-brand-600 font-semibold">{doneCount}/{CHECKLIST_ITEMS.length} complete</p>
        <div className="h-1.5 w-32 bg-brand-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-600 rounded-full transition-all duration-500"
            style={{ width: `${Math.round((doneCount / CHECKLIST_ITEMS.length) * 100)}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CHECKLIST_ITEMS.map((item, i) => (
          <label key={i} className="flex items-center gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={checked.includes(i)}
              onChange={() => toggle(i)}
              className="w-4 h-4 rounded border-brand-300 text-brand-600 focus:ring-brand-400 shrink-0 accent-teal-600"
            />
            {item.link ? (
              <a href={item.link} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-700 group-hover:underline font-medium">
                {item.check} ↗
              </a>
            ) : (
              <span className={`text-sm font-medium transition-colors ${
                checked.includes(i) ? 'line-through text-brand-300' : 'text-brand-700'
              }`}>{item.check}</span>
            )}
          </label>
        ))}
      </div>
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
  activityKey = 0,
}) {
  const { user } = useAuth();
  const [companySearch, setCompanySearch] = useState('');
  const [salarySearch,  setSalarySearch]  = useState('');
  const [resourceTab,   setResourceTab]   = useState('portals');
  const [weekDigest,    setWeekDigest]    = useState(null); // { thisWeek, lastWeek }

  // Full-pool aggregates (status pipeline, per-source conversion, stalled
  // follow-ups, company count) computed server-side — `contacts` below is
  // now a paginated slice of the main list, not the whole pool, so these
  // can't be derived client-side from it anymore without under-counting.
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!user) return;
    api.get('/contacts/dashboard-stats').then(setStats).catch(() => {});
  }, [user, activityKey]);

  // Week-over-week momentum — the stat tiles below are single-point snapshots
  // with no sense of trend; this answers "am I doing more or less than last week."
  useEffect(() => {
    if (!user) return;
    api.get('/stats/activity', { params: { days: 14 } }).then(rows => {
      if (!Array.isArray(rows)) return;
      const today = new Date();
      const dayMs = 86_400_000;
      const cutoff7  = new Date(today - 7 * dayMs).toISOString().slice(0, 10);
      const cutoff14 = new Date(today - 14 * dayMs).toISOString().slice(0, 10);
      let thisWeek = 0, lastWeek = 0;
      for (const r of rows) {
        if (r.date >= cutoff7)                       thisWeek += r.emails_sent;
        else if (r.date >= cutoff14 && r.date < cutoff7) lastWeek += r.emails_sent;
      }
      setWeekDigest({ thisWeek, lastWeek });
    }).catch(() => {});
  }, [user, activityKey]);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr  = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayTip = DAILY_TIP[new Date().getDay() % DAILY_TIP.length];

  // `pipeline` etc. now come from the server-side aggregate (`stats`, fetched
  // above) — the full pool, not whatever page of `contacts` happens to be
  // loaded on the (now-paginated) Contacts tab.
  const pipeline = stats?.pipeline ?? {};

  const total          = Object.values(pipeline).reduce((a, b) => a + b, 0);
  const sentToday      = emailStats?.sentToday ?? 0;
  const dailyCap       = emailStats?.dailyCap  ?? 20;
  const interviews     = pipeline.Interview || 0;
  const replied        = pipeline.Replied   || 0;
  const emailed        = (pipeline.Sent || 0) + (pipeline.Opened || 0);
  const sent           = emailed + replied + interviews;
  // Denominator must be everyone ever emailed (`sent`), not `emailed` — the
  // latter excludes contacts that already moved to Replied/Interview, which
  // silently inflated this rate.
  const responseRate   = sent > 0 ? Math.round(((replied + interviews) / sent) * 100) : 0;
  const activeOutreach = (pipeline.Sent || 0) + (pipeline.Opened || 0) + replied;

  // Same UTC-string-without-suffix parsing hazard as NotificationPanel.jsx —
  // harmless for straight comparison since both sides shift equally, but
  // normalize anyway so this doesn't silently break if the format ever varies.
  const toDate = (s) => new Date(s?.includes('T') ? s : s?.replace(' ', 'T') + 'Z');
  // `contacts` is page 1 of the main list (already ORDER BY date_added DESC
  // server-side), so the most recent few are always among the first loaded —
  // no need for a dedicated aggregate just for this.
  const recent = useMemo(() =>
    [...contacts].sort((a, b) => toDate(b.date_added) - toDate(a.date_added)).slice(0, 6),
    [contacts],
  );

  // Contacts sitting in Sent/Opened for >7 days with no reply — a concrete
  // follow-up list, not just the aggregate "keep the momentum" nudge below.
  // Filtered server-side (dashboard-stats) since it needs to scan the whole
  // pool, not just the loaded page.
  const stalledContacts = useMemo(() =>
    (stats?.stalledContacts ?? []).map(c => ({
      ...c,
      _staleDays: Math.floor((Date.now() - toDate(c.date_last_contacted).getTime()) / 86_400_000),
    })),
    [stats],
  );

  // Per-source response-rate breakdown — which channel (job-intel vs manual
  // vs CSV import vs Apify) actually converts, not just where volume comes from.
  const [showBreakdown, setShowBreakdown] = useState(false);
  const sourceBreakdown = stats?.sourceBreakdown ?? [];

  const companyCount = stats?.companyCount ?? 0;
  const myCompanies  = stats?.myCompanies  ?? [];

  const researchedCompany = companySearch.trim();

  const nextAction = useMemo(() => {
    if (total === 0)      return { text: 'Add your first contact to start tracking outreach.', cta: 'Add Contact', onClick: onAddContact };
    if (sentToday === 0)  return { text: "You haven't sent any emails today — compose one now.", cta: 'Compose', onClick: onCompose };
    if (interviews > 0)   return { text: `${interviews} interview${interviews > 1 ? 's' : ''} lined up — prep with the Hub below.` };
    if (replied > 0)      return { text: `${replied} contact${replied > 1 ? 's' : ''} replied — update their status in Roster.`, cta: 'View Roster', onClick: onGoToContacts };
    return { text: 'Keep the momentum — follow up on contacts marked Sent or Opened.', cta: 'View Roster', onClick: onGoToContacts };
  }, [total, sentToday, interviews, replied, onAddContact, onCompose, onGoToContacts]);

  const RESOURCE_TABS = [
    { id: 'portals',  label: 'Job Portals',     icon: <Globe size={13} /> },
    { id: 'salary',   label: 'Salary Data',     icon: <DollarSign size={13} /> },
    { id: 'research', label: 'Company Research', icon: <Search size={13} /> },
    { id: 'prep',     label: 'Prep Hub',         icon: <BookOpen size={13} /> },
  ];

  return (
    <div className="space-y-8">

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-md shadow-card border border-gray-100 p-6">
        <div className="flex flex-col md:flex-row md:items-start gap-6">
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-1">{dateStr}</p>
            <h1 className="text-2xl font-semibold text-gray-900">
              {greeting}{user ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-sm text-gray-400 mt-1">Your job-hunt command centre — track every signal, land the offer.</p>

            {/* Next-action nudge */}
            <div className="flex items-center gap-2.5 mt-4 px-4 py-3 bg-brand-50 border border-brand-100 rounded-sm">
              <Radio size={14} className="text-brand-600 shrink-0" />
              <p className="text-sm text-brand-700 flex-1">{nextAction.text}</p>
              {nextAction.cta && (
                <button onClick={nextAction.onClick}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-800 whitespace-nowrap flex items-center gap-1 transition-colors">
                  {nextAction.cta} <ArrowRight size={12} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-3 mt-4">
              <Button variant="primary" size="md" onClick={onAddContact}>
                <UserPlus size={15} /> Add Contact
              </Button>
              <Button variant="secondary" size="md" onClick={onCompose}>
                <MailCheck size={15} /> Compose Email
              </Button>
            </div>
          </div>

          {/* Daily tip */}
          <div className="shrink-0 bg-amber-50 border border-amber-100 rounded-sm px-5 py-4 max-w-xs w-full md:w-auto">
            <div className="flex items-center gap-1.5 mb-2">
              <Lightbulb size={13} className="text-amber-600" />
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">Tip of the day</p>
            </div>
            <p className="text-sm text-amber-900/80 leading-relaxed">{todayTip}</p>
          </div>
        </div>
      </div>

      {/* ── Stat tiles ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Your Outreach Impact</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile icon={<Users size={18} />}         label="Contacts Tracked"  value={total}              sub="total"               accent="brand"   />
          <StatTile icon={<Mail size={18} />}           label="Emails Today"      value={sentToday}          sub={`cap ${dailyCap}`}   accent="violet"  pulse={sentToday > 0} />
          <StatTile icon={<Radio size={18} />}          label="Active Outreach"   value={activeOutreach}     sub="in pipeline"         accent="amber"   />
          <StatTile icon={<TrendingUp size={18} />}     label="Response Rate"     value={`${responseRate}%`} sub={`${replied} replied`} accent="emerald" />
          <StatTile icon={<Calendar size={18} />}       label="Interviews"        value={interviews}         sub="scheduled"           accent="green"   />
          <StatTile icon={<Building2 size={18} />}      label="Companies"         value={companyCount}       sub="researched"          accent="slate"   />
        </div>
      </div>

      {/* ── Week-over-week digest ────────────────────────────────────────────── */}
      {weekDigest && (weekDigest.thisWeek > 0 || weekDigest.lastWeek > 0) && (
        <div className="bg-brand-50 border border-brand-100 rounded-sm px-5 py-3 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-brand-800">
            <strong>{weekDigest.thisWeek}</strong> email{weekDigest.thisWeek !== 1 ? 's' : ''} sent this week
            {weekDigest.lastWeek > 0 && (() => {
              const delta = weekDigest.thisWeek - weekDigest.lastWeek;
              const pct = Math.round((delta / weekDigest.lastWeek) * 100);
              return (
                <span className={delta >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                  {' '}({delta >= 0 ? '+' : ''}{pct}% vs last week's {weekDigest.lastWeek})
                </span>
              );
            })()}
          </p>
        </div>
      )}

      {/* ── Activity calendar ─────────────────────────────────────────────────── */}
      <ActivityCalendar refreshKey={activityKey} />

      {/* ── Response rate by source — which channel actually converts ────────── */}
      {sourceBreakdown.length > 1 && (
        <div className="bg-white border border-gray-100 rounded-md shadow-card">
          <button
            onClick={() => setShowBreakdown(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-widest hover:bg-gray-50 transition-colors"
          >
            <span>Response Rate by Source</span>
            <span className="text-gray-400">{showBreakdown ? '▲' : '▼'}</span>
          </button>
          {showBreakdown && (
            <div className="px-4 pb-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left py-1 pr-3">Source</th>
                    <th className="text-right py-1 pr-3">Total</th>
                    <th className="text-right py-1 pr-3">Contacted</th>
                    <th className="text-right py-1">Reply rate</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceBreakdown.map(g => (
                    <tr key={g.key} className="border-t border-gray-50">
                      <td className="py-1.5 pr-3 font-medium text-gray-700 capitalize">{g.key.replace(/_/g, ' ')}</td>
                      <td className="py-1.5 pr-3 text-right text-gray-500">{g.total}</td>
                      <td className="py-1.5 pr-3 text-right text-gray-500">{g.contacted}</td>
                      <td className="py-1.5 text-right text-gray-500">{g.contacted ? `${g.rate}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Mid section: Pipeline + Recent + Pacing ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Outreach pipeline */}
        <div className="space-y-2.5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Outreach Pipeline</p>
          <CardFlush className="h-[320px]">
            {total === 0 ? (
              <EmptyState
                icon={<Radio size={20} strokeWidth={1.5} />}
                title="No pipeline yet"
                description="Add contacts to see your outreach funnel"
                action={{ label: 'Add Contact', onClick: onAddContact }}
                className="h-full py-8"
              />
            ) : (
              <div className="p-5 space-y-3.5 overflow-y-auto h-full">
                {PIPELINE_ORDER.map(status => {
                  const count = pipeline[status] || 0;
                  const pct   = total ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={status}>
                      <div className="flex items-center justify-between mb-1.5">
                        <StatusPill status={status} />
                        <span className="text-xs text-gray-400 tabular-nums">
                          {count} <span className="text-gray-300">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${PIPELINE_BAR[status]}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardFlush>
        </div>

        {/* Recent contacts */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Recent Contacts</p>
            <button onClick={onGoToContacts}
              className="text-xs text-brand-600 hover:text-brand-800 font-medium transition-colors">
              View all →
            </button>
          </div>
          <CardFlush className="h-[320px]">
            {recent.length === 0 ? (
              <EmptyState
                icon={<Users size={20} strokeWidth={1.5} />}
                title="No contacts yet"
                description="Add your first HR contact to get started"
                action={{ label: 'Add Contact', onClick: onAddContact }}
                className="h-full py-8"
              />
            ) : (
              <div className="divide-y divide-gray-50 overflow-y-auto h-full">
                {recent.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/80 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                      {(c.name || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                      <p className="text-xs text-gray-400 truncate">{[c.title, c.company].filter(Boolean).join(' @ ') || '—'}</p>
                    </div>
                    <StatusPill status={c.status} />
                  </div>
                ))}
              </div>
            )}
          </CardFlush>
        </div>

        {/* Email pacing */}
        <div className="space-y-2.5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Email Pacing</p>
          <CardFlush className="h-[320px]">
            <div className="p-5 h-full flex flex-col justify-between">
              <div>
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <p className="text-4xl font-semibold text-gray-900">{sentToday}</p>
                    <p className="text-sm text-gray-400 mt-1">emails sent today</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-gray-500">{dailyCap - sentToday}</p>
                    <p className="text-xs text-gray-400">remaining</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-3 mb-1">
                  <div
                    className="h-full bg-brand-600 rounded-full transition-all duration-700"
                    style={{ width: `${dailyCap > 0 ? Math.min((sentToday / dailyCap) * 100, 100) : 0}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 text-right">
                  {dailyCap > 0 ? Math.round((sentToday / dailyCap) * 100) : 0}% of daily cap
                </p>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3">
                {[
                  { label: 'Total emails sent (all time)', value: sent },
                  { label: 'Contacts replied',             value: replied },
                  { label: 'Interview conversion',         value: `${responseRate}%` },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">{r.label}</span>
                    <span className="font-semibold text-gray-900">{r.value}</span>
                  </div>
                ))}
              </div>

              <Button variant="primary" size="md" onClick={onCompose} className="w-full justify-center">
                <MailCheck size={15} /> Compose Outreach Email
              </Button>
            </div>
          </CardFlush>
        </div>
      </div>

      {/* ── Stalled outreach — concrete follow-up list ───────────────────────── */}
      {stalledContacts.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Stalled Outreach — {stalledContacts.length} waiting 7+ days
            </p>
            <button onClick={onGoToContacts}
              className="text-xs text-brand-600 hover:text-brand-800 font-medium transition-colors">
              View all →
            </button>
          </div>
          <CardFlush>
            <div className="divide-y divide-gray-50">
              {stalledContacts.map(c => (
                <button
                  key={c.id}
                  onClick={onGoToContacts}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50/60 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                    {(c.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                    <p className="text-xs text-gray-400 truncate">{[c.title, c.company].filter(Boolean).join(' @ ') || '—'}</p>
                  </div>
                  <StatusPill status={c.status} />
                  <span className="text-xs text-amber-600 font-medium whitespace-nowrap">{c._staleDays}d ago</span>
                </button>
              ))}
            </div>
          </CardFlush>
        </div>
      )}

      {/* ── Resources tabbed panel ──────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Resources</p>
        <div className="bg-white rounded-md shadow-card border border-gray-100 overflow-hidden">
          <Tabs tabs={RESOURCE_TABS} active={resourceTab} onChange={setResourceTab} />

          <div className="p-5">

            {/* Job Portals */}
            {resourceTab === 'portals' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {JOB_PORTALS.map(p => (
                  <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
                    className="group bg-white border border-gray-200 rounded-md p-4 hover:shadow-card hover:border-brand-200 hover:-translate-y-0.5 transition-all flex flex-col gap-2.5">
                    <div className="flex items-start justify-between">
                      <div className={`w-9 h-9 rounded-sm flex items-center justify-center text-xs font-bold shrink-0 ${p.chipCls}`}>
                        {p.chip}
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${p.tagColor}`}>{p.tag}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800 group-hover:text-brand-600 transition-colors">{p.label}</p>
                      <p className="text-xs text-gray-400 leading-relaxed mt-0.5">{p.desc}</p>
                    </div>
                    <p className="text-[11px] text-brand-600 font-semibold mt-auto flex items-center gap-1">
                      Open portal <ExternalLink size={10} />
                    </p>
                  </a>
                ))}
              </div>
            )}

            {/* Salary Data */}
            {resourceTab === 'salary' && (
              <div>
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">2024–25 Range</span>
                  <div className="ml-auto flex gap-2 items-center flex-wrap">
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        value={salarySearch}
                        onChange={e => setSalarySearch(e.target.value)}
                        placeholder="Filter by role…"
                        className="text-xs border border-gray-200 rounded-sm pl-8 pr-3 py-1.5 outline-none focus:ring-2 focus:ring-brand-300 w-44"
                      />
                    </div>
                    {salarySearch && (
                      <a href={`https://www.glassdoor.co.in/Salaries/${encodeURIComponent(salarySearch.replace(/\s+/g,'-').toLowerCase())}-salary-SRCH_KO0,${salarySearch.length}.htm`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-sm font-semibold hover:bg-green-200 transition whitespace-nowrap">
                        Glassdoor ↗
                      </a>
                    )}
                    {salarySearch && (
                      <a href={`https://www.ambitionbox.com/salaries/${encodeURIComponent(salarySearch.toLowerCase().replace(/\s+/g,'-'))}-salary`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs bg-orange-100 text-orange-700 px-3 py-1.5 rounded-sm font-semibold hover:bg-orange-200 transition whitespace-nowrap">
                        AmbitionBox ↗
                      </a>
                    )}
                    {salarySearch && (
                      <a href={`https://www.naukri.com/${encodeURIComponent(salarySearch.toLowerCase().replace(/\s+/g,'-'))}-jobs`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-sm font-semibold hover:bg-red-200 transition whitespace-nowrap">
                        Naukri JDs ↗
                      </a>
                    )}
                  </div>
                </div>

                <div className="rounded-sm border border-gray-100 overflow-hidden">
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
                            <td className="px-5 py-3.5 font-semibold text-gray-800">
                              <div className="flex items-center gap-2.5">
                                <span className="text-base">{row.icon}</span>
                                <span className="truncate">{row.role}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="text-xs font-bold bg-green-50 text-green-700 px-2.5 py-1 rounded-sm">{row.junior}</span>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-sm">{row.mid}</span>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="text-xs font-bold bg-purple-50 text-purple-700 px-2.5 py-1 rounded-sm">{row.senior}</span>
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <a href={`https://www.glassdoor.co.in/Salaries/${encodeURIComponent(row.role.split(' ').slice(0,2).join('-'))}-salary-SRCH_KO0,${row.role.split(' ').slice(0,2).join('-').length}.htm`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded hover:bg-green-200 transition">Glassdoor</a>
                                <a href="https://www.levels.fyi/?track=Software+Engineer"
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
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  * Approximate median CTC for India metro cities (Bangalore, Hyderabad, Pune, Delhi NCR, Mumbai) sourced from Glassdoor, AmbitionBox, and Levels.fyi.
                </p>
              </div>
            )}

            {/* Company Research */}
            {resourceTab === 'research' && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    Research any company — type a name to get direct links
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        value={companySearch}
                        onChange={e => setCompanySearch(e.target.value)}
                        placeholder="e.g. Google, Flipkart, Infosys, Razorpay…"
                        className="w-full text-sm border border-gray-200 rounded-sm pl-9 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400"
                      />
                    </div>
                    {companySearch && (
                      <button onClick={() => setCompanySearch('')}
                        className="px-3 py-2 text-gray-400 hover:text-gray-600 border border-gray-200 rounded-sm text-sm transition">
                        Clear
                      </button>
                    )}
                  </div>

                  {myCompanies.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] text-gray-400 font-semibold mb-2 uppercase tracking-wide">From your contacts:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {myCompanies.map(c => (
                          <button key={c} onClick={() => setCompanySearch(c)}
                            className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
                              companySearch === c
                                ? 'bg-brand-600 border-brand-600 text-white'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700'
                            }`}>
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {researchedCompany ? (
                  <div className="border-t border-gray-100 pt-5">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-9 h-9 rounded-sm bg-brand-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                        {researchedCompany[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{researchedCompany}</p>
                        <p className="text-xs text-gray-400">8 research actions available</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {RESEARCH_ACTIONS.map(action => (
                        <a key={action.label} href={action.urlFn(researchedCompany)} target="_blank" rel="noopener noreferrer"
                          className={`flex items-start gap-3 p-3 rounded-sm border transition-all ${action.cls}`}>
                          <action.Icon size={15} className={`shrink-0 mt-0.5 ${action.iconCls}`} />
                          <div className="min-w-0">
                            <p className={`text-xs font-bold ${action.iconCls}`}>{action.label} ↗</p>
                            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{action.desc}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-gray-100 pt-4">
                    <EmptyState
                      icon={<Building2 size={20} strokeWidth={1.5} />}
                      title="Type a company name above"
                      description="Unlock 8 research actions: Reviews · Salary · LinkedIn · Find HRs · Jobs · News"
                      className="py-8"
                    />
                  </div>
                )}

                <div className="border-t border-gray-100 pt-4">
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-widest mb-3">General Research Tools</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {COMPANY_RESEARCH.map(r => (
                      <a key={r.label} href={r.url} target="_blank" rel="noopener noreferrer"
                        className="group bg-white border border-gray-200 rounded-sm p-3 hover:shadow-card hover:border-brand-200 transition-all text-center">
                        <r.Icon size={20} className="mx-auto mb-2 text-gray-500 group-hover:text-brand-600 transition-colors" />
                        <p className="text-xs font-semibold text-gray-700 group-hover:text-brand-600 transition-colors">{r.label}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">{r.desc}</p>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Prep Hub */}
            {resourceTab === 'prep' && <PrepHub />}

          </div>
        </div>
      </div>

      {/* ── Checklist ──────────────────────────────────────────────────────── */}
      <div className="bg-brand-50 border border-brand-100 rounded-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-sm bg-brand-100 border border-brand-200 flex items-center justify-center shrink-0">
            <ListChecks size={16} className="text-brand-700" />
          </div>
          <h2 className="text-base font-semibold text-brand-900">Application Readiness Checklist</h2>
        </div>
        <ChecklistItems />
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="bg-gray-900 rounded-md px-8 py-10 text-center space-y-4">
        <div className="flex items-center justify-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-sm bg-brand-600 flex items-center justify-center">
            <Radio size={14} className="text-white" />
          </div>
          <p className="text-lg font-semibold text-white tracking-tight">HR Outreach Tracker</p>
        </div>
        <p className="text-gray-300 text-base font-medium italic">
          "Every email is a new door."
        </p>
        <p className="text-gray-500 text-sm max-w-md mx-auto leading-relaxed">
          Built for developers who believe that smart outreach beats blind applications. Track every lead, follow up at the right time, and land the interviews you deserve.
        </p>
        <div className="flex flex-wrap justify-center gap-4 pt-2">
          {[
            { label: 'Glassdoor',     url: 'https://www.glassdoor.co.in' },
            { label: 'Levels.fyi',   url: 'https://www.levels.fyi' },
            { label: 'LeetCode',     url: 'https://leetcode.com' },
            { label: 'AmbitionBox',  url: 'https://www.ambitionbox.com' },
            { label: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs' },
            { label: 'NeetCode',     url: 'https://neetcode.io' },
          ].map(l => (
            <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-white transition-colors underline underline-offset-2">
              {l.label}
            </a>
          ))}
        </div>
        <p className="text-gray-600 text-xs pt-2">Made for job seekers · {new Date().getFullYear()}</p>
      </footer>

    </div>
  );
}
