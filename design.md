# HR Outreach Tracker — UI/UX Redesign Brief

**Status:** Living document — discussion phase. Nothing in this file is final, and no application code is being touched while it's being built. We add to it turn by turn; implementation only starts once a section is explicitly signed off.

---

## 1. Goal

Turn this from a personal tracking tool into a **real multi-user SaaS product** for job seekers. That changes what "the UI" needs to do:
- The freemium tiers (Guest / Demo / Basic ₹299 / Advanced ₹599), the early-access lead-capture funnel, and the Admin panel are **core product surfaces to design properly** — not placeholders to hide.
- Onboarding, upgrade prompts, and the eventual real payment flow need to feel like a product a stranger can land on and understand, not a personal dashboard with paywall stubs bolted on.

## 2. Target Audience

**Indian tech job seekers** — software engineers / tech professionals. This matches what's already baked into the product (₹ salary benchmarks, Naukri/AmbitionBox/LinkedIn Jobs links, Delhi/Noida-skewed defaults) and should stay the frame of reference for content, tone, and defaults going forward (generalizing beyond tech is out of scope for now).

Context worth designing for: this audience is using the tool during an anxious, high-effort, often long job search. The UI should reduce friction and feel like it's actively helping/motivating, not add more admin overhead on top of an already stressful process.

## 3. Design Direction

- Must feel **"interesting and exciting to use"** — not a sterile enterprise dashboard.
- **Font: locked — Inter, sans-serif.** (Supersedes the earlier Plus Jakarta Sans guess made from the course-platform screenshot.)
- **Background: locked — light, white-forward.** Not the dark canvas explored in Section 10. Gradient stays, but as an accent on light surfaces (hero band, upsell/pricing card, active-nav highlight) rather than a dark base — this reconciles with the original "gradient as accent, not a wash" recommendation, just on a white ground instead of black.
- **Surfaces: locked — flat/opaque, no glassmorphism.** Glass (`backdrop-filter` + translucent fills) was tried and rejected — on translucent cards, any hover-driven opacity change (the corner glow, the gradient ring) bled through the whole card instead of staying contained, reading as an unwanted full-card background shift. Cards, sidebar, buttons, and the tooltip are all fully opaque now.
- **Primary color: locked — blue (`#3E7BFA`)**, not violet/purple. Carries the hero, primary buttons, active nav, logo, and focus ring. Violet is demoted to a secondary tag color.
- **Hover convention: locked** — on hover, only a border/gradient-ring, a slight lift, and a shadow may change. A card or button's own fill/background must never change color on hover — that was the recurring bug across several rounds; a stacked translucent pseudo-element behind a fill is the wrong technique (it washes), `background-clip` (fill layer on `padding-box`, ring on `border-box`) is the right one.
- Icon treatment from your analytics-dashboard screenshot (multicolor soft-badge icons) carries over, re-tinted for contrast on white instead of near-black.
- Component system reference: **shadcn/ui conventions** (Radix primitives + Tailwind) — the frontend already runs Tailwind, so this is a natural fit for implementation later.
- Tooling note: neither a `/frontend-design` skill nor a `shadcn` skill is available in the current environment. Proceeding with UI/UX fundamentals and shadcn/ui's actual conventions applied directly, unless a specific plugin/skill is pointed out.

## 4. Ground rule

**We are not reusing any of the existing UI/UX at any level — 0% reuse.** The current app (inventoried below) is reference material for *what functionality must be accounted for*, not for how anything should look or be laid out.

## 5. Approach

Step by step, one product section at a time. For each section: discuss requirements/priorities → explore direction → agree → only then implement. Starting order: **Dashboard → Contacts**, then the rest (Templates, Job Analyzer, Bulk Apply, Profile, Admin) in a later phase.

---

## 6. Current Product Inventory (reference only — what exists today, functionally)

Captured from a full codebase pass + live walkthrough of the running app. No router is used — it's a single-page tab-switcher app today; that's an implementation detail of the *current* build, not a constraint on the redesign.

### 6.1 Sections (today's 7 tabs)

1. **Dashboard** — hero greeting + quick actions, 6 impact stat cards, outreach pipeline/recent contacts/email pacing panel, static salary benchmark table, job portal links, company research tool, embedded Interview Prep Hub, application readiness checklist (not persisted — dead-ish), resource footer.
2. **Contacts** — *My Contacts* (stats, activity heatmap, search/filter toolbar, bulk actions, contact table with plan-based masking) + *LinkedIn Posts* (Apify-scraped hiring posts feed, admin-only manual fetch trigger).
3. **Templates** — Email Templates (editor/split/preview, variable chips, fake email-client preview) + ATS Resume Templates (code-style editor, live document preview, save to profile).
4. **Job Analyzer** — single job URL/text vs. resume, skill-gap chips, resume patching, PDF/Word export, gated "Apply" action.
5. **Bulk Apply** — same as Job Analyzer but for a list of job URLs, aggregated skill gap, "open all tabs" action.
6. **Profile** (auth-gated) — Overview / Resume & Skills / Links / Profile Score (weighted completeness gauge + actionable checklist).
7. **Admin** (role-gated) — Interest Leads CRM (kanban/list, outreach actions) + User Management (role/plan control).

Plus: persistent early-access banner with a 2-step lead-capture modal, and a bell-icon notification panel.

### 6.2 Gating / monetization model already in place

- Plans: `guest` → `demo` (default, 10 contacts/10 emails-day) → `basic` (₹299, 100 contacts/50 emails-day) → `advanced` (₹599, unlimited contacts/200 emails-day).
- Contact list masks emails and blocks actions past the plan's visible-row limit, with inline upgrade prompts.
- Plans page exists but upgrade buttons are disabled ("Payment coming soon") — **no live payment gateway yet.**
- Separate session-based rate limiter (email sends / job applies) on top of the plan system.
- Admin can directly change any user's plan/role.

### 6.3 Recurring UI patterns already in the codebase (functional reference, not visual reference)

Toasts, gradient stat cards, color-coded status badges (contact status / post status / lead stage / score bands), bulk-select + action bar, GitHub-style contribution heatmap, skill-gap chip comparison (reused in 4 places), split editor/preview toggle, circular score gauges, plan-gated masked rows with upsell CTAs, auth-gated CTAs that open a login modal, multi-step forms with progress indicators, kanban/list view toggle.

### 6.4 Known dead / half-built things (flagging so the redesign makes a deliberate call, not an accidental carry-over)

- `ResumeTemplateModal.jsx` and `StatusBadge.jsx` — unused components, safe to drop.
- Dashboard's "Application Readiness Checklist" — UI exists, state doesn't persist.
- `PlansModal` upgrade path — no real payment integration.
- Reminder email delivery depends on the user's own SMTP setup being correct — easy to enable without it working.
- `ApifySettingsModal` default search queries are hard-coded to Delhi/Noida — narrow leftover default.
- A lot of Dashboard content (salary table, portal list, research links, Prep Hub library) is hard-coded in components rather than data-driven — worth a deliberate decision on whether that continues.

---

## 7. Section-by-section design notes

### 7.1 Dashboard
*Pending — will be shaped by the global requirements in Section 9 and the visual direction in Section 10.*

### 7.2 Contacts
*Pending — will be shaped by the global requirements in Section 9 and the visual direction in Section 10.*

---

## 9. Global UI/UX Requirements (user-specified, apply across the whole redesign)

**Navigation**
- Replace the current top tab bar with a **sidebar nav**.
- Icons for the sidebar/nav will be **selected and supplied by the user** — do not pick generic icon-set substitutes as final.

**Visual style**
- Overall look will be **gradient-based**.
- **Font is to be chosen specifically by the user** — do not finalize a typeface without their pick.
- Colors, exact font, and gradient direction are decided *after* the Dribbble reference pass (Section 10), not before.

**Interaction / flow**
- Where a screen has a lot going on, prefer **multi-step flows** over one long dense screen, so the user doesn't get bored/exhausted. (Applies to things like onboarding, plan upgrade, maybe contact add/import — decide per-screen.)
- **Guided help**: a "helper" popup/tour with Next buttons that walks through what each main button/section does, plus a **`?` icon on individual elements** for on-demand instructions.

**Notifications**
- In-app notifications (e.g. on opening the tool) should appear as a **side toast that auto-dismisses after ~2 seconds**, with a manual close (✕) button available too.

**Monetization**
- This redesign should be **built to sell plans** — upgrade/subscription conversion is a primary design goal, not an afterthought bolted onto the UI (ties back to Section 1's "real SaaS product" goal).

**Bug to fix during rebuild**
- Current app has a scroll bug: opening a modal/popup/form lets scroll events pass through and scroll the page underneath instead of locking to the modal. New implementation must lock body scroll while any modal/popup is open.

---

## 10. Visual Reference Research (Dribbble)

Browsed Dribbble across three searches matching what we need: gradient SaaS dashboards with sidebar nav, gradient pricing/plan pages, and onboarding-tour patterns. Findings below are descriptions + links (not reproduced images) — open them directly to react to the actual visuals.

### 10.1 Dashboard / sidebar direction — dark-canvas + gradient-accent

The strongest, most repeated pattern across results (not one-off): **dark or near-black base canvas**, with a **saturated purple/blue/pink gradient used deliberately** — as a hero banner, a card accent, or a glow/blob background element — rather than washed across the whole screen. Sidebar nav is a **slim, icon-first rail** (icons + optional labels on hover/expand), content area is light-on-dark cards with generous rounded corners.

Specific references:
- [Project Management SaaS Dashboard — Usarion](https://dribbble.com/shots/27543254-Project-Management-SaaS-Dashboard) — icon sidebar, purple gradient hero panel, dark card-based project/task detail view. Closest single match to "gradient + sidebar."
- [Modern SaaS Productivity Platform Landing Page — Vaishali Prajapati](https://dribbble.com/shots/27367807-Modern-SaaS-Productivity-Platform-Landing-Page-Design) — dark purple gradient landing page built around a dashboard mockup (stat cards, kanban board, "Get Started Free" / "Watch Demo" CTAs) — useful for how the marketing/landing layer and the in-app dashboard can share one visual language.
- Full grid for more options: [dribbble.com/search/gradient-saas-dashboard](https://dribbble.com/search/gradient-saas-dashboard)

### 10.2 Pricing / plan-selling direction

Pattern that stood out: **dark background + colorful gradient wave/blob illustration behind the pricing cards**, 3 tiers side by side, one visually "highlighted" (border glow or raised card) as the recommended plan — directly useful since Section 9 says this redesign needs to actively sell plans.

- Reference seen: **"Nixtio"** pricing shot — 3-tier card grid ($18 / $64 / $112 equivalent) on black background with a bright multicolor gradient wave graphic behind the cards, highlighted middle tier.
- Full grid: [dribbble.com/search/pricing-page-gradient](https://dribbble.com/search/pricing-page-gradient)

### 10.3 Onboarding / helper-tour direction

Directly matches the Section 9 requirement for a guided "Next"-button walkthrough:

- [Strapi onboarding time 🚀 — Maeva Lienard](https://dribbble.com/shots/18725750-Strapi-onboarding-time) — numbered "3 Simple Steps" tour widget anchored to the UI, per-step completion state (checkmark + "Step 2: Completed"), single accent color, dismissible (✕). Good structural model for our helper-popup requirement.
- Full grid for more variety (tooltip-style step-through, checklist-style, spotlight-style): [dribbble.com/search/product-onboarding-tour](https://dribbble.com/search/product-onboarding-tour)

### 10.4 Recommendation

Given "exciting to use" + gradient + sidebar + sell-plans, all four things point the same direction: a **dark-canvas UI with deliberate, high-saturation gradient accents** (not a light/pastel gradient wash) reads as more energetic/premium and is the dominant pattern in results that combine sidebar nav with gradients well. This is a starting recommendation, not a decision — react to the linked shots (like/dislike specific ones) and that'll shape Section 11 before we touch colors/fonts.

---

## 11. Open questions / points to resolve

*(To be filled in as we discuss — add points here as they come up.)*
