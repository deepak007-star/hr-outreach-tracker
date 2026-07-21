const FEATURES = [
  {
    icon: '🎯', bg: 'bg-pink-50',
    title: 'Job match score',
    desc: 'Paste any job post and your resume — get an instant match score with exactly which skills are missing, powered by keyword-aware analysis, not guesswork.',
  },
  {
    icon: '🚀', bg: 'bg-blue-50',
    title: 'Bulk Apply',
    desc: 'Paste a whole list of job URLs at once. We scrape every posting, merge the skills you’re missing across all of them into one resume, and open every tab to apply.',
  },
  {
    icon: '📧', bg: 'bg-emerald-50',
    title: 'Cold email that sends itself',
    desc: 'Connect Gmail once, then compose and send tracked outreach to HR contacts — with open/bounce tracking and a 14-day duplicate-send guard built in.',
  },
  {
    icon: '💼', bg: 'bg-amber-50',
    title: 'LinkedIn job & HR scraping',
    desc: 'Auto-collect hiring posts and recruiter contacts from LinkedIn feeds every morning, ready to add straight into your outreach pipeline.',
  },
  {
    icon: '📂', bg: 'bg-purple-50',
    title: 'Resume Vault & ATS templates',
    desc: 'Keep tailored resume versions for every role you target, scored for ATS-friendliness, and reuse the best-fit version with one click.',
  },
  {
    icon: '📋', bg: 'bg-teal-50',
    title: 'Contact CRM, Excel-synced',
    desc: 'Every HR contact you add or import stays in sync with a colour-coded Excel export — your outreach pipeline, always downloadable.',
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

function MockScoreCard() {
  const rows = [
    { label: 'Skills',     pct: 90, color: 'bg-emerald-500' },
    { label: 'Keywords',   pct: 78, color: 'bg-emerald-500' },
    { label: 'Experience', pct: 65, color: 'bg-amber-400' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 flex items-center gap-5">
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
            <NavLink href="#how-it-works">How it works</NavLink>
            <NavLink href="#job-analyzer">Job Analyzer</NavLink>
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

        <div className="flex items-center justify-center gap-3 mb-10">
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

        {/* Mock preview card, tied to the Job Analyzer feature */}
        <div className="max-w-md mx-auto">
          <MockScoreCard />
          <p className="text-xs text-stone-400 mt-3">Live preview of the Job Analyzer’s match score panel</p>
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
              <p className="text-sm text-stone-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
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
              <a href="#how-it-works" className="hover:text-stone-800 transition-colors">How it works</a>
              <a href="#job-analyzer" className="hover:text-stone-800 transition-colors">Job Analyzer</a>
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
