import { useState } from 'react';

const FEATURES = [
  {
    icon: '🎯', bg: 'bg-pink-50',
    title: 'Job match score',
    desc: 'Paste any job post and your resume — get an instant match score with exactly which skills are missing, powered by keyword-aware analysis, not guesswork.',
    detail: '0–100 score · skill-by-skill breakdown',
  },
  {
    icon: '🚀', bg: 'bg-blue-50',
    title: 'Bulk Apply',
    desc: 'Paste a whole list of job URLs at once. We scrape every posting, merge the skills you’re missing across all of them into one resume, and open every tab to apply.',
    detail: 'Unlimited URLs · one merged resume',
  },
  {
    icon: '📧', bg: 'bg-emerald-50',
    title: 'Cold email that sends itself',
    desc: 'Connect Gmail once, then compose and send tracked outreach to HR contacts — with open/bounce tracking and a 14-day duplicate-send guard built in.',
    detail: 'No app password · one-click Google connect',
  },
  {
    icon: '💼', bg: 'bg-amber-50',
    title: 'LinkedIn job & HR scraping',
    desc: 'Auto-collect hiring posts and recruiter contacts from LinkedIn feeds every morning, ready to add straight into your outreach pipeline.',
    detail: 'Runs automatically, every morning',
  },
  {
    icon: '📂', bg: 'bg-purple-50',
    title: 'Resume Vault & ATS templates',
    desc: 'Keep tailored resume versions for every role you target, scored for ATS-friendliness, and reuse the best-fit version with one click.',
    detail: 'Unlimited saved versions',
  },
  {
    icon: '📋', bg: 'bg-teal-50',
    title: 'Contact CRM, Excel-synced',
    desc: 'Every HR contact you add or import stays in sync with a colour-coded Excel export — your outreach pipeline, always downloadable.',
    detail: 'Auto-synced on every change',
  },
];

const STEPS = [
  {
    n: '01', title: 'Import your contacts & connect Gmail',
    desc: 'Bring in HR contacts by CSV/Excel import or let the LinkedIn feed scraper find them for you. Connect Gmail once to send from your own inbox.',
    tag: '📇 CSV · Excel · LinkedIn feed',
  },
  {
    n: '02', title: 'Analyze the job, tailor your resume',
    desc: 'Paste a job post (or a whole list for Bulk Apply). See your match score, missing skills, and merge them into your resume in one click.',
    tag: '🎯 Match score · skill gaps',
  },
  {
    n: '03', title: 'Send tracked outreach & apply',
    desc: 'Compose and send outreach with delivery tracking, or open every job tab at once with Bulk Apply. Everything logs back to your contact pipeline.',
    tag: '⚡ Tracked · one click',
  },
];

const STATS = [
  { value: '20+/day',  label: 'Emails automated',  sub: 'Configurable daily send cap' },
  { value: '6-in-1',   label: 'Tools in one place', sub: 'CRM, email, scraper, analyzer, vault' },
  { value: '1-click',  label: 'Bulk Apply',         sub: 'Every job tab opens at once' },
  { value: '0–100', label: 'Match score',        sub: 'Resume vs. job compatibility' },
];

const FAQS = [
  {
    q: 'Do I have to share my Gmail password?',
    a: 'No. You connect Gmail through Google’s own one-click OAuth sign-in — no app passwords, nothing typed into our forms. You can disconnect it from Settings at any time and outreach sending stops immediately.',
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
    a: 'Yes — that’s exactly what Bulk Apply is for. Paste in every job URL you’re targeting, review the combined skill gaps across all of them, merge them into one resume, and open every tab to apply in one click.',
  },
  {
    q: 'Is it free to use?',
    a: 'Yes — create a free account to send outreach, run Job Analyzer / Bulk Apply, and save resume versions. Daily send caps and visible contact limits scale up with your plan.',
  },
];

function NavLink({ href, children }) {
  return (
    <a href={href} className="text-sm text-stone-500 hover:text-stone-800 transition-colors">
      {children}
    </a>
  );
}

function EyebrowPill({ children }) {
  return (
    <span className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-3.5 py-1.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      {children}
    </span>
  );
}

function SectionEyebrow({ children }) {
  return (
    <p className="flex items-center gap-2 text-xs font-bold tracking-widest text-emerald-700 uppercase mb-3">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
      {children}
    </p>
  );
}

// Fake browser chrome around an illustrative product mockup — deliberately
// NOT a real screenshot of the authenticated app (that would show a real
// signed-in user's name/email), just a hand-built preview in the same
// visual language, the way the reference site's own hero mockup works.
function BrowserFrame({ title, children }) {
  return (
    <div className="rounded-2xl border border-stone-200 shadow-lg bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-100 border-b border-stone-200">
        <span className="w-2.5 h-2.5 rounded-full bg-red-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
        {title && (
          <span className="ml-2 text-xs text-stone-400 truncate">{title}</span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function MockScoreCard() {
  const rows = [
    { label: 'Skills',     pct: 90, color: 'bg-emerald-500' },
    { label: 'Keywords',   pct: 78, color: 'bg-emerald-500' },
    { label: 'Experience', pct: 65, color: 'bg-amber-400' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-800">Senior Backend Engineer</p>
          <p className="text-xs text-stone-400">Acme Technologies · via careers.acme.com</p>
        </div>
        <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold shrink-0">Analyzed</span>
      </div>
      <div className="flex items-center gap-5">
        <div className="w-20 h-20 rounded-full border-4 border-emerald-500 flex flex-col items-center justify-center shrink-0">
          <span className="font-display text-2xl font-bold text-stone-900 leading-none">82</span>
          <span className="text-[10px] text-stone-400">/100</span>
        </div>
        <div className="flex-1 space-y-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-3 text-xs">
              <span className="w-16 text-stone-500 shrink-0">{r.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                <div className={`h-full rounded-full ${r.color}`} style={{ width: `${r.pct}%` }} />
              </div>
              <span className="w-8 text-right text-stone-500 font-medium">{r.pct}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {['Python', 'Django', 'Docker', 'AWS'].map(s => (
          <span key={s} className="text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full">{s}</span>
        ))}
        {['Kubernetes', 'GraphQL'].map(s => (
          <span key={s} className="text-[11px] bg-red-50 border border-red-200 text-red-600 px-2 py-0.5 rounded-full">{s}</span>
        ))}
      </div>
    </div>
  );
}

function MockContactsTable() {
  const rows = [
    { name: 'Priya Sharma',  company: 'Nova Fintech',   status: 'Replied',   color: 'bg-emerald-100 text-emerald-700' },
    { name: 'Rahul Mehta',   company: 'Bluewave Cloud',  status: 'Sent',      color: 'bg-blue-100 text-blue-700' },
    { name: 'Ananya Iyer',   company: 'Northstar Labs',  status: 'Interview', color: 'bg-purple-100 text-purple-700' },
    { name: 'Karan Verma',   company: 'Vertex Systems',   status: 'New',       color: 'bg-gray-100 text-gray-600' },
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-stone-400 font-semibold uppercase tracking-wide px-1">
        <span>Contact</span><span>Status</span>
      </div>
      {rows.map(r => (
        <div key={r.name} className="flex items-center justify-between bg-stone-50 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-stone-800 truncate">{r.name}</p>
            <p className="text-xs text-stone-400 truncate">{r.company}</p>
          </div>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${r.color}`}>{r.status}</span>
        </div>
      ))}
    </div>
  );
}

function MockComposePreview() {
  return (
    <div className="space-y-3">
      <div className="text-xs text-stone-400">
        <span className="font-semibold text-stone-600">To:</span> priya.sharma@novafintech.com
      </div>
      <div className="text-xs text-stone-400">
        <span className="font-semibold text-stone-600">Subject:</span> Hi Priya, quick question about opportunities at Nova Fintech
      </div>
      <div className="border-t border-stone-100 pt-3 text-xs text-stone-500 leading-relaxed">
        Hi Priya,<br /><br />
        I came across Nova Fintech and was impressed by the work you're doing. I'm a backend
        developer with 4 years of experience — currently exploring new opportunities...
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg font-semibold">✓ Delivery tracked</span>
        <span className="text-[11px] bg-stone-100 text-stone-500 px-2 py-1 rounded-lg">Sent via your Gmail</span>
      </div>
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-stone-200 py-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 text-left"
      >
        <span className="text-sm font-semibold text-stone-800">{q}</span>
        <span className={`text-emerald-600 shrink-0 transition-transform ${open ? 'rotate-45' : ''}`}>＋</span>
      </button>
      {open && <p className="text-sm text-stone-500 leading-relaxed mt-2.5 pr-8">{a}</p>}
    </div>
  );
}

export default function LandingPage({ onGetStarted, onSignIn }) {
  return (
    <div className="font-landing bg-stone-50 text-stone-800 min-h-screen">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-stone-200 bg-stone-50/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-sm">📋</span>
            <span className="font-semibold text-stone-900">HR Outreach Tracker</span>
          </div>
          <nav className="hidden sm:flex items-center gap-7">
            <NavLink href="#features">Features</NavLink>
            <NavLink href="#product-tour">Product tour</NavLink>
            <NavLink href="#how-it-works">How it works</NavLink>
            <NavLink href="#job-analyzer">Job Analyzer</NavLink>
            <NavLink href="#faq">FAQ</NavLink>
          </nav>
          <button
            onClick={onSignIn}
            className="text-sm font-semibold text-stone-700 hover:text-stone-900 transition-colors"
          >
            Sign in
          </button>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-10 text-center">
        <div className="flex justify-center mb-6">
          <EyebrowPill>Contact CRM + cold email + job matching, in one tracker</EyebrowPill>
        </div>
        <h1 className="font-display text-5xl sm:text-6xl leading-[1.1] text-stone-900 mb-5">
          Reach out smarter. <span className="italic text-emerald-600">Get hired faster.</span>
        </h1>
        <p className="text-stone-500 text-lg max-w-2xl mx-auto mb-9">
          Track HR contacts, send tracked cold outreach from your own Gmail, and match your resume
          against any job — or a whole list of jobs at once with Bulk Apply.
        </p>

        <div className="flex items-center justify-center gap-3 mb-12">
          <button
            onClick={onGetStarted}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
          >
            Get started free →
          </button>
          <a
            href="#how-it-works"
            className="px-6 py-3 border border-stone-300 text-stone-700 rounded-xl text-sm font-semibold hover:bg-white transition-colors"
          >
            See how it works
          </a>
        </div>

        {/* Illustrative product preview, tied to the Job Analyzer feature */}
        <div className="max-w-lg mx-auto text-left">
          <BrowserFrame title="hr-outreach-tracker.app / job-analyzer">
            <MockScoreCard />
          </BrowserFrame>
          <p className="text-xs text-stone-400 mt-3 text-center">Illustrative preview of the Job Analyzer's match score panel</p>
        </div>
      </section>

      {/* ── Stats strip ─────────────────────────────────────────────────── */}
      <section className="border-y border-stone-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 sm:grid-cols-4 divide-x divide-stone-100">
          {STATS.map(s => (
            <div key={s.label} className="py-8 px-4 text-center sm:text-left">
              <p className="font-display text-3xl text-stone-900">
                {s.value.includes('/') ? (
                  <>
                    <span className="text-emerald-600">{s.value.split('/')[0]}</span>/{s.value.split('/')[1]}
                  </>
                ) : s.value}
              </p>
              <p className="text-sm font-medium text-stone-700 mt-1">{s.label}</p>
              <p className="text-xs text-stone-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-xl mb-12">
          <SectionEyebrow>Features</SectionEyebrow>
          <h2 className="font-display text-4xl text-stone-900 mb-3">Everything your job search needs</h2>
          <p className="text-stone-500">
            One tracker for the whole loop — find contacts, reach out, match jobs to your resume, and apply in bulk.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-white rounded-2xl border border-stone-200 p-6 hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center text-lg mb-4`}>{f.icon}</div>
              <h3 className="font-semibold text-stone-900 mb-1.5">{f.title}</h3>
              <p className="text-sm text-stone-500 leading-relaxed mb-3">{f.desc}</p>
              <span className="inline-block text-xs bg-stone-100 text-stone-500 px-2.5 py-1 rounded-full">{f.detail}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Product tour ─────────────────────────────────────────────────── */}
      <section id="product-tour" className="bg-white border-y border-stone-200 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mb-12">
            <SectionEyebrow>Product tour</SectionEyebrow>
            <h2 className="font-display text-4xl text-stone-900 mb-3">A look inside the tracker</h2>
            <p className="text-stone-500">Three of the screens you'll actually use every day, once you're in.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div>
              <BrowserFrame title="Contacts">
                <MockContactsTable />
              </BrowserFrame>
              <p className="text-sm text-stone-500 mt-3"><strong className="text-stone-800">Your outreach pipeline</strong> — every contact, status, and Excel export in one table.</p>
            </div>
            <div>
              <BrowserFrame title="Compose">
                <MockComposePreview />
              </BrowserFrame>
              <p className="text-sm text-stone-500 mt-3"><strong className="text-stone-800">Tracked cold email</strong> — sent from your own Gmail, delivery and bounces logged automatically.</p>
            </div>
            <div>
              <BrowserFrame title="Job Analyzer">
                <MockScoreCard />
              </BrowserFrame>
              <p className="text-sm text-stone-500 mt-3"><strong className="text-stone-800">Know your fit</strong> — a match score and skill gaps before you ever hit apply.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="bg-emerald-50/40 border-y border-stone-200 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mb-14">
            <SectionEyebrow>How it works</SectionEyebrow>
            <h2 className="font-display text-4xl text-stone-900 mb-3">Three steps to your next offer</h2>
            <p className="text-stone-500">Sign in, connect Gmail, and let the tracker carry your pipeline forward.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 relative">
            {STEPS.map((s, i) => (
              <div key={s.n} className="bg-white rounded-2xl border border-stone-200 p-6 relative">
                <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-display font-bold text-sm mb-5">
                  {s.n}
                </div>
                <h3 className="font-semibold text-stone-900 mb-2">{s.title}</h3>
                <p className="text-sm text-stone-500 leading-relaxed mb-4">{s.desc}</p>
                <span className="inline-block text-xs bg-stone-100 text-stone-500 px-2.5 py-1 rounded-full">{s.tag}</span>
                {i < STEPS.length - 1 && (
                  <span className="hidden sm:block absolute top-11 -right-3 w-6 h-px bg-stone-300" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Job Analyzer / Bulk Apply spotlight ─────────────────────────── */}
      <section id="job-analyzer" className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-xl mb-12">
          <SectionEyebrow>Job Analyzer &amp; Bulk Apply</SectionEyebrow>
          <h2 className="font-display text-4xl text-stone-900 mb-3">Know your fit before you apply</h2>
          <p className="text-stone-500">Every analysis — single job or a whole batch — gives you the same structured breakdown.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            { icon: '📊', title: 'Match score & skill gaps', desc: 'A clear score plus exactly which required skills are missing from your resume — merge them in with one click.' },
            { icon: '🔑', title: 'Keyword detection', desc: 'Skills detected in the job post are highlighted green when already in your resume, red when missing.' },
            { icon: '🚀', title: 'One-click Bulk Apply', desc: 'Paste a whole list of job URLs — we scrape all of them, merge the combined skill gaps, and open every tab to apply.' },
          ].map(c => (
            <div key={c.title} className="bg-white rounded-2xl border border-stone-200 p-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-lg mb-4">{c.icon}</div>
              <h3 className="font-semibold text-stone-900 mb-1.5">{c.title}</h3>
              <p className="text-sm text-stone-500 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="bg-white border-y border-stone-200 py-20">
        <div className="max-w-3xl mx-auto px-6">
          <div className="max-w-xl mb-10">
            <SectionEyebrow>FAQ</SectionEyebrow>
            <h2 className="font-display text-4xl text-stone-900 mb-3">Questions, answered</h2>
            <p className="text-stone-500">The things people usually ask before connecting Gmail.</p>
          </div>
          <div>
            {FAQS.map(f => <FaqItem key={f.q} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="bg-stone-900 text-center py-20">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="font-display text-4xl text-white mb-3">Start tracking your outreach the smart way</h2>
          <p className="text-stone-400 mb-8">Free to use — sign in to send outreach, analyze jobs, and save your resume versions.</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={onGetStarted}
              className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-500 transition-colors"
            >
              Get started free →
            </button>
            <a
              href="#job-analyzer"
              className="px-6 py-3 border border-stone-600 text-stone-200 rounded-xl text-sm font-semibold hover:bg-stone-800 transition-colors"
            >
              Explore Job Analyzer
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-stone-200 bg-stone-50">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row justify-between gap-8">
          <div className="max-w-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs">📋</span>
              <span className="font-semibold text-stone-900">HR Outreach Tracker</span>
            </div>
            <p className="text-sm text-stone-500">
              Contact CRM, cold email automation, LinkedIn scraping, and AI-assisted job matching — all in one place.
            </p>
          </div>
          <div>
            <p className="text-xs font-bold tracking-widest text-stone-400 uppercase mb-3">Product</p>
            <div className="flex flex-col gap-2 text-sm text-stone-500">
              <a href="#features" className="hover:text-stone-800 transition-colors">Features</a>
              <a href="#product-tour" className="hover:text-stone-800 transition-colors">Product tour</a>
              <a href="#how-it-works" className="hover:text-stone-800 transition-colors">How it works</a>
              <a href="#job-analyzer" className="hover:text-stone-800 transition-colors">Job Analyzer</a>
              <a href="#faq" className="hover:text-stone-800 transition-colors">FAQ</a>
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-8 text-xs text-stone-400">
          © {new Date().getFullYear()} HR Outreach Tracker.
        </div>
      </footer>
    </div>
  );
}
