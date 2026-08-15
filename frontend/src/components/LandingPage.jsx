import { useState } from 'react';
import {
  Target, Zap, Mail, Rss, Archive, Users,
  CheckCircle, BarChart2, Radio, ArrowRight,
  ChevronDown, ChevronUp, Crown,
} from 'lucide-react';
import Logo from './Logo.jsx';

// ─── Data ─────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <Target size={20} />,
    accent: 'bg-brand-50 text-brand-600 border-brand-100',
    title: 'Job match score',
    desc: 'Paste any job post and your resume — get an instant match score with exactly which skills are missing, powered by keyword-aware analysis, not guesswork.',
    detail: '0–100 score · skill-by-skill breakdown',
  },
  {
    icon: <Zap size={20} />,
    accent: 'bg-amber-50 text-amber-600 border-amber-100',
    title: 'Bulk Apply',
    desc: 'Paste a whole list of job URLs at once. We scrape every posting, merge the skills you\'re missing across all of them into one resume, and open every tab to apply.',
    detail: 'Unlimited URLs · one merged resume',
  },
  {
    icon: <Mail size={20} />,
    accent: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    title: 'Cold email that sends itself',
    desc: 'Connect Gmail once, then compose and send tracked outreach to HR contacts — with open/bounce tracking and a 14-day duplicate-send guard built in.',
    detail: 'No app password · one-click Google connect',
  },
  {
    icon: <Rss size={20} />,
    accent: 'bg-violet-50 text-violet-600 border-violet-100',
    title: 'LinkedIn job & HR scraping',
    desc: 'Auto-collect hiring posts and recruiter contacts from LinkedIn feeds every morning, ready to add straight into your outreach pipeline.',
    detail: 'Runs automatically, every morning',
  },
  {
    icon: <Archive size={20} />,
    accent: 'bg-blue-50 text-blue-600 border-blue-100',
    title: 'Resume Vault & ATS templates',
    desc: 'Keep tailored resume versions for every role you target, scored for ATS-friendliness, and reuse the best-fit version with one click.',
    detail: 'Unlimited saved versions',
  },
  {
    icon: <Users size={20} />,
    accent: 'bg-brand-50 text-brand-600 border-brand-100',
    title: 'Contact CRM, Excel-synced',
    desc: 'Every HR contact you add or import stays in sync with a colour-coded Excel export — your outreach pipeline, always downloadable.',
    detail: 'Auto-synced on every change',
  },
];

const STEPS = [
  {
    n: '01', title: 'Import your contacts & connect Gmail',
    desc: 'Bring in HR contacts by CSV/Excel import or let the LinkedIn feed scraper find them for you. Connect Gmail once to send from your own inbox.',
    detail: 'CSV · Excel · LinkedIn feed',
  },
  {
    n: '02', title: 'Analyse the job, tailor your resume',
    desc: 'Paste a job post (or a whole list for Bulk Apply). See your match score, missing skills, and merge them into your resume in one click.',
    detail: 'Match score · skill gaps',
  },
  {
    n: '03', title: 'Send tracked outreach & apply',
    desc: 'Compose and send outreach with delivery tracking, or open every job tab at once with Bulk Apply. Everything logs back to your contact pipeline.',
    detail: 'Tracked · one click',
  },
];

const STATS = [
  { value: '20+',  unit: '/day', label: 'Emails automated',    sub: 'Configurable daily send cap' },
  { value: '6',    unit: '-in-1',label: 'Tools in one place',  sub: 'CRM, email, scraper, analyser, vault' },
  { value: '1',    unit: '-click',label: 'Bulk Apply',          sub: 'Every job tab opens at once' },
  { value: '0–100',unit: '',     label: 'Match score',         sub: 'Resume vs. job compatibility' },
];

const FAQS = [
  {
    q: 'Do I have to share my Gmail password?',
    a: 'No. You connect Gmail through Google\'s own one-click OAuth sign-in — no app passwords, nothing typed into our forms. You can disconnect it from Settings at any time and outreach sending stops immediately.',
  },
  {
    q: 'How is my contact and resume data kept private?',
    a: 'Everything you add is tied to your account only — other users never see your contacts, resume text, or sent-email history. Long-lived credentials like your Gmail refresh token are encrypted at rest (AES-256-GCM), not stored as plain text.',
  },
  {
    q: 'How does the job match score actually work?',
    a: 'It compares the skills and keywords detected in a job description against the skills detected in your resume — a clear, explainable score plus exactly which ones are missing, not a black-box AI guess.',
  },
  {
    q: 'What happens if an outreach email bounces?',
    a: 'A hard bounce automatically marks that contact Do Not Contact, so you never waste another send on a dead address — and a 14-day guard stops you from double-emailing someone by accident.',
  },
  {
    q: 'Can I apply to a big batch of jobs at once?',
    a: 'Yes — that\'s exactly what Bulk Apply is for. Paste in every job URL you\'re targeting, review the combined skill gaps across all of them, merge them into one resume, and open every tab to apply in one click.',
  },
  {
    q: 'Is it free to use?',
    a: 'Yes — create a free account to send outreach, run Job Analyzer / Bulk Apply, and save resume versions. Daily send caps and visible contact limits scale up with your plan.',
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function NavLink({ href, children }) {
  return (
    <a href={href} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
      {children}
    </a>
  );
}

function SectionEyebrow({ children }) {
  return (
    <p className="flex items-center gap-2 text-xs font-bold tracking-widest text-brand-700 uppercase mb-3">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-500 inline-block" />
      {children}
    </p>
  );
}

// Fake browser chrome around illustrative product mockup
function BrowserFrame({ title, children }) {
  return (
    <div className="rounded-md border border-gray-200 shadow-card bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="w-2 h-2 rounded-full bg-red-300" />
        <span className="w-2 h-2 rounded-full bg-amber-300" />
        <span className="w-2 h-2 rounded-full bg-green-300" />
        {title && <span className="ml-2 text-xs text-gray-400 truncate">{title}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// Hero product preview — Job Analyzer match score panel
function MockScoreCard() {
  const rows = [
    { label: 'Skills',     pct: 90, color: 'bg-brand-500' },
    { label: 'Keywords',   pct: 78, color: 'bg-brand-500' },
    { label: 'Experience', pct: 65, color: 'bg-amber-400'  },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Senior Backend Engineer</p>
          <p className="text-xs text-gray-400">Acme Technologies · via careers.acme.com</p>
        </div>
        <span className="text-[10px] bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded-sm font-semibold shrink-0">
          Analysed
        </span>
      </div>
      <div className="flex items-center gap-5">
        {/* Score ring — signature Signal motif: radiating rings behind the score */}
        <div className="relative shrink-0">
          <span className="absolute inset-0 rounded-full bg-brand-400 opacity-10 animate-signal-ping" />
          <div className="relative w-20 h-20 rounded-full border-4 border-brand-500 flex flex-col items-center justify-center">
            <span className="font-display text-2xl font-bold text-gray-900 leading-none">82</span>
            <span className="text-[10px] text-gray-400">/100</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-3 text-xs">
              <span className="w-16 text-gray-500 shrink-0">{r.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${r.color}`} style={{ width: `${r.pct}%` }} />
              </div>
              <span className="w-8 text-right text-gray-500 font-medium">{r.pct}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {['Python', 'Django', 'Docker', 'AWS'].map(s => (
          <span key={s} className="text-[11px] bg-brand-50 border border-brand-200 text-brand-700 px-2 py-0.5 rounded-sm">{s}</span>
        ))}
        {['Kubernetes', 'GraphQL'].map(s => (
          <span key={s} className="text-[11px] bg-red-50 border border-red-200 text-red-600 px-2 py-0.5 rounded-sm">{s}</span>
        ))}
      </div>
    </div>
  );
}

// Product-tour preview — Contacts table
const STATUS_CHIP = {
  'Replied':   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  'Sent':      'bg-amber-50   text-amber-700   border border-amber-200',
  'Interview': 'bg-green-50   text-green-800   border border-green-200 font-semibold',
  'New':       'bg-gray-100   text-gray-500    border border-gray-200',
};

function MockContactsTable() {
  const rows = [
    { name: 'Priya Sharma',  company: 'Nova Fintech',   status: 'Replied'   },
    { name: 'Rahul Mehta',   company: 'Bluewave Cloud', status: 'Sent'      },
    { name: 'Ananya Iyer',   company: 'Northstar Labs',  status: 'Interview' },
    { name: 'Karan Verma',   company: 'Vertex Systems',  status: 'New'       },
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-400 font-semibold uppercase tracking-wide px-1 mb-1">
        <span>Contact</span><span>Status</span>
      </div>
      {rows.map(r => (
        <div key={r.name} className="flex items-center justify-between bg-gray-50 rounded-sm px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>
            <p className="text-xs text-gray-400 truncate">{r.company}</p>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-sm shrink-0 ${STATUS_CHIP[r.status]}`}>{r.status}</span>
        </div>
      ))}
    </div>
  );
}

// Product-tour preview — Compose email
function MockComposePreview() {
  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400">
        <span className="font-semibold text-gray-600">To:</span> priya.sharma@novafintech.com
      </div>
      <div className="text-xs text-gray-400">
        <span className="font-semibold text-gray-600">Subject:</span> Hi Priya, quick question about opportunities at Nova Fintech
      </div>
      <div className="border-t border-gray-100 pt-3 text-xs text-gray-500 leading-relaxed">
        Hi Priya,<br /><br />
        I came across Nova Fintech and was impressed by the work you're doing. I'm a backend
        developer with 4 years of experience — currently exploring new opportunities...
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] bg-brand-50 text-brand-700 border border-brand-200 px-2 py-1 rounded-sm font-semibold">
          ✓ Delivery tracked
        </span>
        <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-1 rounded-sm">Sent via your Gmail</span>
      </div>
    </div>
  );
}

// FAQ accordion
function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-200 py-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 text-left group"
      >
        <span className="text-sm font-semibold text-gray-800 group-hover:text-brand-700 transition-colors">{q}</span>
        <span className="text-brand-600 shrink-0">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>
      {open && <p className="text-sm text-gray-500 leading-relaxed mt-2.5 pr-8">{a}</p>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function LandingPage({ onGetStarted, onSignIn, onPlansClick }) {
  return (
    <div className="bg-stone-50 text-gray-800 min-h-screen font-sans">

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-200 bg-white/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <span className="font-semibold text-gray-900 text-sm">HR Outreach Tracker</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6">
            <NavLink href="#features">Features</NavLink>
            <NavLink href="#product-tour">Product tour</NavLink>
            <NavLink href="#how-it-works">How it works</NavLink>
            <NavLink href="#faq">FAQ</NavLink>
            <button
              onClick={onPlansClick}
              className="flex items-center gap-1 text-sm font-semibold text-violet-600 hover:text-violet-800 transition-colors"
            >
              <Crown size={13} />
              Pricing
            </button>
          </nav>
          <button
            onClick={onSignIn}
            className="text-sm font-semibold text-brand-700 hover:text-brand-900 active:scale-95 transition-all"
          >
            Sign in →
          </button>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-10 text-center">
        {/* Signal eyebrow pill */}
        <div className="flex justify-center mb-6">
          <span className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200 text-brand-700 text-xs font-medium px-3.5 py-1.5 rounded-full">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75 animate-signal-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
            </span>
            CRM + cold email + job matching — one tracker
          </span>
        </div>

        {/* The Signal headline */}
        <h1 className="font-display text-5xl sm:text-6xl leading-[1.1] text-gray-900 mb-5">
          Stop guessing.<br />
          <span className="italic text-brand-600">Start signalling.</span>
        </h1>
        <p className="text-gray-500 text-lg max-w-2xl mx-auto mb-9 leading-relaxed">
          Track HR contacts, send tracked cold outreach from your own Gmail, and see exactly
          how your resume matches any job — before you apply.
        </p>

        <div className="flex items-center justify-center gap-3 mb-12">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 active:scale-[0.97] transition-all shadow-sm"
          >
            Get started free
            <ArrowRight size={16} />
          </button>
          <a
            href="#how-it-works"
            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-sm text-sm font-semibold hover:bg-white hover:border-gray-400 transition-colors"
          >
            See how it works
          </a>
        </div>

        {/* Hero product preview */}
        <div className="max-w-lg mx-auto text-left">
          <BrowserFrame title="hr-outreach-tracker · The Mirror">
            <MockScoreCard />
          </BrowserFrame>
          <p className="text-xs text-gray-400 mt-3 text-center">
            Illustrative preview of the Job Analyzer (The Mirror) match score panel
          </p>
        </div>
      </section>

      {/* ── Stats strip ───────────────────────────────────────────────────── */}
      <section className="border-y border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100">
          {STATS.map(s => (
            <div key={s.label} className="py-8 px-4 text-center sm:text-left">
              <p className="font-display text-3xl text-gray-900">
                <span className="text-brand-600">{s.value}</span>
                {s.unit && <span className="text-gray-400 text-2xl">{s.unit}</span>}
              </p>
              <p className="text-sm font-medium text-gray-700 mt-1">{s.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-xl mb-12">
          <SectionEyebrow>Features</SectionEyebrow>
          <h2 className="font-display text-4xl text-gray-900 mb-3">
            Everything your job search needs
          </h2>
          <p className="text-gray-500">
            One tracker for the whole loop — find contacts, reach out, match jobs to your resume, and apply in bulk.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="bg-white rounded-md border border-gray-200 shadow-card p-5 hover:-translate-y-0.5 hover:shadow-modal transition-all duration-150"
            >
              <div className={`w-9 h-9 rounded-md border flex items-center justify-center mb-4 ${f.accent}`}>
                {f.icon}
              </div>
              <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-3">{f.desc}</p>
              <span className="inline-block text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-sm">
                {f.detail}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Product tour ──────────────────────────────────────────────────── */}
      <section id="product-tour" className="bg-white border-y border-gray-200 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mb-12">
            <SectionEyebrow>Product tour</SectionEyebrow>
            <h2 className="font-display text-4xl text-gray-900 mb-3">A look inside the tracker</h2>
            <p className="text-gray-500">Three of the screens you'll actually use every day, once you're in.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div>
              <BrowserFrame title="Roster · My Contacts">
                <MockContactsTable />
              </BrowserFrame>
              <p className="text-sm text-gray-500 mt-3">
                <strong className="text-gray-800">Your outreach pipeline</strong> — every contact, status, and Excel export in one table.
              </p>
            </div>
            <div>
              <BrowserFrame title="Arsenal · Compose">
                <MockComposePreview />
              </BrowserFrame>
              <p className="text-sm text-gray-500 mt-3">
                <strong className="text-gray-800">Tracked cold email</strong> — sent from your own Gmail, delivery and bounces logged automatically.
              </p>
            </div>
            <div>
              <BrowserFrame title="The Mirror · Job Analyser">
                <MockScoreCard />
              </BrowserFrame>
              <p className="text-sm text-gray-500 mt-3">
                <strong className="text-gray-800">Know your fit</strong> — a match score and skill gaps before you ever hit apply.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how-it-works" className="bg-brand-50/40 border-y border-gray-200 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mb-14">
            <SectionEyebrow>How it works</SectionEyebrow>
            <h2 className="font-display text-4xl text-gray-900 mb-3">Three signals to your next offer</h2>
            <p className="text-gray-500">Sign in, connect Gmail, and let the tracker carry your pipeline forward.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 relative">
            {STEPS.map((s, i) => (
              <div key={s.n} className="bg-white rounded-md border border-gray-200 shadow-card p-5 relative">
                {/* Step number as signal dot */}
                <div className="relative w-8 h-8 mb-5">
                  <span className="absolute inset-0 rounded-full bg-brand-400 opacity-20 animate-signal-ping" style={{ animationDelay: `${i * 0.4}s` }} />
                  <div className="relative w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center font-display font-bold text-xs">
                    {s.n}
                  </div>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2 text-sm">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-4">{s.desc}</p>
                <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-sm">
                  {s.detail}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="hidden sm:block absolute top-9 -right-3 w-6 h-px bg-brand-200" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Job Analyzer spotlight ─────────────────────────────────────────── */}
      <section id="job-analyzer" className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-xl mb-12">
          <SectionEyebrow>The Mirror &amp; Volley</SectionEyebrow>
          <h2 className="font-display text-4xl text-gray-900 mb-3">Know your fit before you apply</h2>
          <p className="text-gray-500">
            Every analysis — single job or a whole batch — gives you the same structured breakdown.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              icon: <BarChart2 size={20} />,
              accent: 'bg-brand-50 text-brand-600 border-brand-100',
              title: 'Match score & skill gaps',
              desc: 'A clear score plus exactly which required skills are missing from your resume — merge them in with one click.',
            },
            {
              icon: <CheckCircle size={20} />,
              accent: 'bg-emerald-50 text-emerald-600 border-emerald-100',
              title: 'Keyword detection',
              desc: 'Skills detected in the job post are highlighted green when already in your resume, red when missing.',
            },
            {
              icon: <Zap size={20} />,
              accent: 'bg-amber-50 text-amber-600 border-amber-100',
              title: 'One-click Bulk Apply (Volley)',
              desc: 'Paste a whole list of job URLs — we scrape all of them, merge the combined skill gaps, and open every tab to apply.',
            },
          ].map(c => (
            <div key={c.title} className="bg-white rounded-md border border-gray-200 shadow-card p-5">
              <div className={`w-9 h-9 rounded-md border flex items-center justify-center mb-4 ${c.accent}`}>
                {c.icon}
              </div>
              <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{c.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section id="faq" className="bg-white border-y border-gray-200 py-20">
        <div className="max-w-3xl mx-auto px-6">
          <div className="max-w-xl mb-10">
            <SectionEyebrow>FAQ</SectionEyebrow>
            <h2 className="font-display text-4xl text-gray-900 mb-3">Questions, answered</h2>
            <p className="text-gray-500">The things people usually ask before connecting Gmail.</p>
          </div>
          <div>
            {FAQS.map(f => <FaqItem key={f.q} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── Final CTA — closes with same Signal motif as hero ─────────────── */}
      <section className="bg-gray-900 text-center py-20 relative overflow-hidden">
        {/* Background signal-ring motif */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
          <div className="w-64 h-64 rounded-full border-2 border-brand-400 animate-signal-ping" />
        </div>
        <div className="relative max-w-2xl mx-auto px-6">
          <p className="text-brand-400 text-sm font-semibold tracking-widest uppercase mb-4">
            Send your first signal
          </p>
          <h2 className="font-display text-4xl text-white mb-3">
            Every email is a new door.
          </h2>
          <p className="text-gray-400 mb-8">
            Free to use — sign in to send outreach, analyse jobs, and save your resume versions.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={onGetStarted}
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-500 active:scale-[0.97] transition-all"
            >
              Get started free
              <ArrowRight size={16} />
            </button>
            <a
              href="#job-analyzer"
              className="px-6 py-3 border border-gray-600 text-gray-200 rounded-sm text-sm font-semibold hover:bg-gray-800 transition-colors"
            >
              Explore The Mirror
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-stone-50">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row flex-wrap justify-between gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2 mb-2">
              <Logo size={26} />
              <span className="font-semibold text-gray-900 text-sm">HR Outreach Tracker</span>
            </div>
            <p className="text-sm text-gray-500">
              Contact CRM, cold email automation, LinkedIn scraping, and AI-assisted job matching — all in one place.
            </p>
            <p className="text-xs text-brand-600 font-medium mt-3 italic">
              "Har email ek naya darwaaza hai."
            </p>
            {/* Social icons */}
            <div className="flex items-center gap-3 mt-4">
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer"
                 aria-label="LinkedIn"
                 className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:border-blue-300 transition shadow-sm">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer"
                 aria-label="GitHub"
                 className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:border-gray-400 transition shadow-sm">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                </svg>
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer"
                 aria-label="Twitter / X"
                 className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:border-gray-400 transition shadow-sm">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.259 5.631L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
                </svg>
              </a>
              <a href="mailto:support@hroutreach.app"
                 aria-label="Email us"
                 className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-brand-600 hover:border-brand-300 transition shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
              </a>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-3">Product</p>
            <div className="flex flex-col gap-2 text-sm text-gray-500">
              <a href="#features"      className="hover:text-gray-800 transition-colors">Features</a>
              <a href="#product-tour"  className="hover:text-gray-800 transition-colors">Product tour</a>
              <a href="#how-it-works"  className="hover:text-gray-800 transition-colors">How it works</a>
              <a href="#job-analyzer"  className="hover:text-gray-800 transition-colors">Job Analyser</a>
              <a href="#faq"           className="hover:text-gray-800 transition-colors">FAQ</a>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-3">Connect</p>
            <div className="flex flex-col gap-2 text-sm text-gray-500">
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                LinkedIn
              </a>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                GitHub
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.259 5.631L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>
                Twitter / X
              </a>
              <a href="mailto:support@hroutreach.app" className="hover:text-brand-600 transition-colors flex items-center gap-2">
                <Mail size={14} className="shrink-0" />
                Contact Us
              </a>
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-8 border-t border-gray-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400">© {new Date().getFullYear()} HR Outreach Tracker. All rights reserved.</p>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>Made with ❤️ in India</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
