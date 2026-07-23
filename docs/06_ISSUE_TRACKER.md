# Issue Tracker — HR Outreach Tracker

Active tracking of all open issues, planned features, and improvements.
Reference the bug IDs in `05_BUG_HISTORY.md` for full context on any B### item.

Last updated: 2026-07-22 (post-roundtrip audit)

---

## Status Legend

| Symbol | Meaning |
|---|---|
| ❌ Open | Not started |
| 🔄 In Progress | Being worked on |
| ⚠️ Deferred | Accepted for now; low risk or high effort |
| ✅ Done | Resolved and verified |

---

## Critical / High Priority — Must Fix Before Production Scale

| # | Issue | Ref | Effort | Status |
|---|---|---|---|---|
| 1 | HTML injection in outgoing email body — `body` from req.body injected directly into HTML; add `sanitize-html` on backend | B007 | Small | ✅ Done |
| 2 | `/send-feed-emails` (scraped-jobs route) bypasses daily email cap entirely | B008 | Small | ✅ Done |
| 3 | SMTP test endpoint not rate-limited — authenticated users can probe arbitrary hosts/ports | B010 | Small | ✅ Done |
| 4 | All users can see all other users' emails in `GET /api/referrals/users` — privacy issue | B011 | Medium | ✅ Done |
| 5 | `fromName` / `name` / `contact.name` fields not sanitized before email header injection | B012 | Small | ✅ Done |
| 6 | Contacts table has no `user_id` column — all users share one contact list | B001 (audit #4) | Large | ⚠️ Deferred |
| 7 | JWT_SECRET env var has no hard-fail on startup — insecure fallback used silently | B006 | Tiny | ✅ Done |

---

## Medium Priority — Fix Soon

| # | Issue | Ref | Effort | Status |
|---|---|---|---|---|
| 8 | LinkedIn Feed: bulk select operates on all 500 posts, not filtered view — selects invisible posts | B027 | Small | ⚠️ Deferred |
| 9 | No server-side JWT revocation on password change | — | Medium | ✅ Done |
| 10 | `window.confirm` still used in contact delete and ComposeModal — inconsistent; breaks in sandboxed environments | B053 | Medium | ✅ Done |
| 11 | Vault password reveal has no countdown timer — shows static "Auto-hides in 30s" text | B050 | Small | ✅ Done |
| 12 | Permission cache not invalidated when admin changes a user's role — user keeps old permissions up to 5 min | B058 | Small | ✅ Done |
| 13 | Rate limiting is in-memory only — doesn't survive restart, doesn't work across multiple Node processes | — | Large (Redis) | ⚠️ Deferred |
| 14 | Email log not fully scoped per user — feed-email sends still not checking per-user cap | B009 | Small | ✅ Done (R41) |
| 15 | Profile analyzer: "Current title" detection fails on short-form titles like "Full-stack developer" (`{4,60}` → `{0,60}`) | Audit #12 | Tiny | ✅ Done |
| 16 | Profile analyzer: "Professional summary" grabs wrong text from PDF (first huge paragraph vs. section header) | Audit #13 | Small | ✅ Done |
| 17 | Profile analyzer: "Current company" false-positives on tech names like "BullMQ and Redis" | Audit #14 | Small | ✅ Done |
| 18 | Dashboard "Companies" KPI capped at 12 (reuses sliced array) | Audit #5 | Tiny | ✅ Done |
| 19 | Timestamps UTC vs IST mismatch: contacts added at 11:26 PM UTC show previous day in India | Audit #6 | Medium | ⚠️ Deferred |
| 20 | Reminder emails fire ~5.5h late (scheduler uses server UTC, not IST) — same root fix as #19 | Audit #7 | Medium (TZ env) | ✅ Done |
| 21 | "Replied" metric inconsistent: Dashboard counts only `Replied`, StatsBar counts `Replied + Interview` | Audit #8 | Tiny | ✅ Done |
| 22 | Missing React key on ContactTable list fragments — `<>` shorthand can't take key prop | Audit #9 | Tiny | ✅ Done |
| 23 | Email templates still have hardcoded personal identity ("Vishal", "4.5 years of Java/Spring Boot") | Audit #11 | Small | ✅ Done |
| 24 | `GmailConnectCard` fires two concurrent `GET /gmail/status` requests on mount | B056 | Small | ⚠️ Deferred |

---

## Low Priority / Polish

| # | Issue | Ref | Effort | Status |
|---|---|---|---|---|
| 25 | Avatar crashes on single-space display name | B057 | Tiny | ✅ Done |
| 26 | SMTP password not pre-populated in settings modal (must re-enter every open) | B054 | Small | ⚠️ Deferred |
| 27 | Vault `window.scrollTo(0,0)` scrolls entire page when vault is inside AdminPanel | B049 | Small | ⚠️ Deferred |
| 28 | Confidence score column sorts alphabetically not semantically | B052 | Small | ⚠️ Deferred |
| 29 | `emailVisible` plan cap applied to sort position, not stable contact attribute | B053 | Medium | ⚠️ Deferred |
| 30 | No accessibility (role/aria-modal/focus-trap) on any modal | Audit UX | Large | ❌ Open |
| 31 | No "Forgot Password" feature — no email-based reset flow | Audit UX | Large | ❌ Open |
| 32 | Email format not validated on register (only length check) | Audit auth | Small | ✅ Done |
| 33 | `showLogs` missing from useEffect deps in JobScraperSection and LinkedInPosts | B051 | Tiny | ⚠️ Deferred |
| 34 | `staleStatus` passed to `onStatusChange` before real status arrives in GmailConnectCard | Audit | Small | ⚠️ Deferred |
| 35 | Sequential run-all scrapers — each must finish before next starts, no cancel button | Audit | Large | ❌ Open |
| 36 | No way to expand full job description on job cards (2-line truncation only) | Audit UX | Small | ✅ Done |
| 37 | Apply button labels "View" links as "Apply" when only one URL exists and it's the listing | Audit UX | Tiny | ✅ Done |
| 38 | "Profile score" tab: missing external profile photo means always 0% on that item | — | Small | ⚠️ Deferred — no photo check exists in current CHECKS array; adding one would always score 0% since external photos can't be fetched |

---

---

## End-to-End Roundtrip Audit — 2026-07-22

Full API roundtrip performed against the live backend. All endpoints below verified working:

**Auth & User**
- `POST /auth/register` — email validation, duplicate rejection ✅
- `POST /auth/login` — user + tokenVersion in JWT ✅
- `GET /auth/me` — fresh token issued; `token_version` stripped from response ✅
- `PUT /auth/change-password` — bumps tokenVersion; old token rejected; new token usable ✅
- `POST /auth/logout` — clears cookie ✅

**Contacts**
- `GET /contacts` — returns flat array (no pagination; frontend handles it) ✅
- `POST /contacts` — creates contact, triggers `syncExcel()` ✅
- `PUT /contacts/:id` — updates, triggers `syncExcel()` ✅
- `DELETE /contacts/:id` — deletes, triggers `syncExcel()` ✅
- `GET /contacts/export` — returns Excel file (200) ✅
- `POST /contacts/import` — CSV/Excel import via multipart ✅ (route exists)

**Email**
- `POST /email/preview` — `contactIds[]` body param ✅
- `GET /email/log` — scoped to `req.user.userId` ✅
- `GET /email/stats` — per-user delivery breakdown ✅

**Email Templates**
- `GET /email-templates` — 16 templates returned ✅
- `POST /email-templates` — create ✅
- `PUT /email-templates/:id` — update ✅
- `DELETE /email-templates/:id` — delete ✅

**Profile & Resume**
- `GET /profile` — returns user profile ✅
- `PUT /profile` — updates profile ✅
- `GET /resume-versions` — returns array (empty for new user) ✅

**Vault (Password Manager)**
- `GET /vault` — list entries ✅
- `POST /vault` — create (requires `title` field, not `service`) ✅
- `GET /vault/:id/reveal` — decrypt and return password ✅
- `PUT /vault/:id` — update ✅
- `DELETE /vault/:id` — delete ✅

**Notifications**
- `GET /notifications` — list with `is_read` field ✅
- `PATCH /notifications/:id/read` — mark single read ✅
- `PATCH /notifications/read-all` — mark all read ✅
- `DELETE /notifications` — clear all ✅

**Scraped Jobs**
- `GET /scraped-jobs` — paginated with `search`/`category`/`since`/`scraper` filters ✅
- `GET /scraped-jobs/stats` — aggregate counts by category ✅
- `GET /scraped-jobs/feed-contacts` — LinkedIn feed contacts with `already_emailed` flag ✅
- `POST /scraped-jobs/send-feed-emails` — per-user cap now enforced (R41) ✅

**LinkedIn Feed / Apify**
- `GET /linkedin-feed` — paginated posts ✅
- `GET /apify/settings` — admin-only config ✅
- `PUT /apify/settings` — save Apify token + queries ✅
- `POST /apify/scrape` — manual trigger (admin); returned 500 imported posts ✅
- `GET /apify/posts` — list stored LinkedIn posts ✅

**Stats**
- `GET /stats/activity` — daily activity array ✅

**Rate Limit**
- `GET /rate-limit/status` — per-user cap usage ✅

**Settings**
- `GET /settings` — global key/value store ✅
- `PUT /settings` — save one or more keys; returns updated settings ✅

**Reminder**
- `GET /reminder/` — current config ✅
- `PUT /reminder/` — save reminder config ✅

**Admin**
- `GET /admin/users` — user list with role/plan ✅
- `PUT /admin/users/:id/role` — change role; "can't change own role" guard works ✅
- `PUT /admin/users/:id/plan` — change plan ✅
- `GET /admin/referral-settings` — referral program config ✅
- `GET /admin/referrals` — referral list ✅
- `GET /admin/vault` — admin vault audit ✅

**RBAC**
- `GET /rbac/roles` — 4 roles: admin, demo, guest, user ✅
- `GET /rbac/permissions` — `{permissions, grouped}` ✅
- `PUT /rbac/roles/:id/permissions` — update role permissions ✅

**Email Verify**
- `POST /email-verify/batch` — domain-level verification ✅
- `POST /email-verify/:id` — verify single contact ✅

**OAuth / Gmail**
- `GET /oauth/google/start` — returns Google consent URL ✅
- `GET /gmail/status` — returns `{connected, gmailEmail, ...}` ✅

**GitHub Backup**
- `GET /github-backup/config` — config with enabled/token/repo/last_backup ✅

**Findings / Bugs Fixed During Audit**
- R41: `getSentToday()` in `scraped-jobs.js` lacked `userId` filter — global cap counted all users' emails

---

## Planned Features (Not Yet Built)

| # | Feature | Priority | Notes |
|---|---|---|---|
| F01 | Forgot Password / Email Reset | High | No reset flow at all |
| F02 | Email verification on register | Medium | No email confirmation step |
| F03 | Outlook / Microsoft OAuth provider | Medium | `oauth_accounts` table is provider-agnostic; add routes/oauth-outlook.js |
| F04 | Per-user contact isolation | High | See open issue #6 — requires `user_id` column on contacts + email_templates |
| F05 | CSRF double-submit token | Medium | SameSite cookie is set; CSRF token would add defence-in-depth for state-changing cookie-auth requests |
| F06 | OAuth refresh token rotation | Medium | When refresh token used, store new refresh token returned by Google |
| F07 | Redis-backed rate limiting | Medium | Required for multi-process production deployments |
| F08 | Custom confirmation modal (replace window.confirm) | Medium | Applies to contact delete, bulk delete, template delete |
| F09 | Job card full-description expand | Low | Modal or inline expand |
| F10 | LinkedIn Feed virtual scroll / pagination | Medium | Currently loads all 500 posts flat |
| F11 | Referrals: opt-in email visibility | Medium | Privacy: users should choose whether their email is visible to peers |
| F12 | Scraper cancel button | Low | Stop a running sequential scrape |
| F13 | Accessibility pass (aria, focus-trap, keyboard nav) | Medium | All modals, table interactions |
| F14 | Referral request accept/decline flow (UI) | Medium | DB column exists; UI for updating status |
| F15 | Job match score in scraped jobs feed | Low | Show ATS score badge on each job card in profile-matched view |

---

## Recently Resolved (2026-07)

| # | Issue | Resolution |
|---|---|---|
| R01 | Plans page not visible / discoverable | Added permanent "💎 Plans" tab to main navigation bar |
| R02 | JWT-in-URL OAuth security flaw | One-time exchange code pattern |
| R03 | No global rate limiting / DDoS protection | `middleware/security.js` — globalApiLimiter, authLimiter, authSlowDown |
| R04 | XSS via stored contact fields | `bodySanitizer` global middleware |
| R05 | Internal error messages leaked to clients | `safeErrorHandler` middleware |
| R06 | No HTTP security headers | `helmet` with CSP in index.js |
| R07 | 13 frontend forms had no validation | Added inline validation + toast errors to all major forms |
| R08 | RBAC permissions never seeded | Fixed BigInt string comparison |
| R09 | ApifySettingsModal NaN bug | Empty string guard before parseInt |
| R10 | LinkedIn feed scraper contacts filter tabs dead | Wired filterTab state to tab buttons and list |
| R11 | Referrals double .data unwrap | Removed extra `.data` from api client response |
| R12 | SSE stream no error check | Added `resp.ok` guard in JobScraperSection + LinkedInPosts |
| R13 | Referral email before DB write | Swapped order: DB insert first |
| R14 | Gmail reply detection wrong | Checks From: header on last thread message |
| R15 | `since='24d'` typo in scraped-jobs | Fixed to `'14d'` |
| R16 | HTML injection in outgoing email body | `sanitize-html` installed; whitelist-based sanitization applied before send |
| R17 | `/send-feed-emails` daily cap bypass | Cap check + per-send counter + `email_log` insert added to `scraped-jobs.js` |
| R18 | SMTP test endpoint not rate-limited | `scrapeLimiter` applied to `POST /email/test` |
| R19 | Referrals user email list exposes emails | Removed `u.email` from `GET /api/referrals/users` SELECT |
| R20 | Email header injection (`fromName`, contact name) | `sanitizeHeaderValue()` applied in `email.js`, `scraped-jobs.js`, `referrals.js` |
| R21 | JWT_SECRET startup — silent insecure fallback | `console.error` warning on startup if `JWT_SECRET` not set |
| R22 | Dashboard Companies KPI wrong count | Separated display slice from count; `companyCount` now uses full Set size |
| R23 | StatsBar "Replied" metric inconsistency | Fixed to count only `Replied` status (not `Replied + Interview`) |
| R24 | React key on ContactTable fragments | `<>` → `<Fragment key={c.id}>` to fix reconciliation on sort/filter |
| R25 | Profile analyzer title regex | `{4,60}` → `{0,60}` catches "Full-stack developer" and other short titles |
| R26 | Profile analyzer summary detection | Searches for section header first; falls back to paragraph heuristic |
| R27 | Profile analyzer company false-positives | Removed `with` trigger; only `at` / `@` used to find company names |
| R28 | Email templates hardcoded personal identity | Renamed, replaced hardcoded body with `{{placeholders}}`; one-time migration for existing installs |
| R29 | Avatar crash on single-space name | Filter empty words before mapping to initials |
| R30 | IPv6 ValidationError in `globalApiLimiter` | Removed custom `keyGenerator: req => req.ip` — defaults to express-rate-limit's safe keying |
| R31 | Email log / daily cap global not per-user | `getSentToday(userId)` now filters by `user_id`; `/email/log` and `/email/stats` scoped to current user |
| R32 | No server-side JWT revocation on password change | `token_version` column added to `users`; included in JWT; bumped on password change; checked in `requireAuth` |
| R33 | Permission cache not invalidated after role change | `invalidatePermCache(role)` called in `PUT /admin/users/:id/role` |
| R34 | Email format not validated on register | RFC-lite regex added to `POST /auth/register` |
| R35 | Vault password reveal static "30s" text | Live countdown with `setInterval` replaces static label |
| R36 | `window.confirm` across 13 call sites in 10 files | `ConfirmDialog` component + `confirm()` singleton utility; mounted at App root |
| R37 | Email log endpoint exposed all users' logs | `GET /api/email/log` now filters by `user_id` |
| R38 | Reminder emails fire 5.5h late in Docker | Scheduler uses explicit IST offset (`UTC+5:30`); `TZ=Asia/Kolkata` added to docker-compose backend |
| R39 | Apply button mislabelled "Apply →" for listing-only links | `JobCard` now shows "View →" when `apply_link` is absent |
| R40 | Job description truncated with no expand option | "Show more / Show less" toggle added to `JobCard` (>200 char descriptions) |
| R41 | `getSentToday()` in `scraped-jobs.js` counted emails from ALL users — per-user cap not enforced on `/send-feed-emails` | Fixed: added `userId` param and `AND user_id = ?` filter, matching the fix in `email.js` |
| R42 | LinkedIn feed showed 0 posts — API defaulted to `source=scraper` (DDG Playwright scraper finds ~3 posts); Apify has 831 | Changed API default from `source=scraper` to `source=all`; frontend was already sending `source=all` |
| R43 | `since=today` returned 0 when morning scrape found nothing; feed was completely empty | Auto-fallback: if `since=today` returns 0, silently extend to 7 days; response adds `since_fallback: true` / `since_used: '7d'` |
| R44 | LinkedIn feed tab showed white page on component crash (no ErrorBoundary) | Wrapped `ColdEmailSection` and `JobScraperSection` in `TabErrorBoundary` in App.jsx |
| R45 | `useState(sinceFallback)` added after two `useEffect` calls — React hooks ordering violation | Moved to top of state block with all other `useState` declarations |
| R46 | Feed did not auto-refresh when user returned to the tab after being away | Added `visibilitychange` event listener in `LinkedInPosts.jsx` → calls `fetchPosts()` on tab focus |
| R47 | No feedback when feed fell back from today to 7-day range | Added amber banner: "No new posts scraped today — showing posts from the last 7 days" with Refresh button |
| R48 | "Add target roles" hint banner was subtle gray; users missed it | Changed to amber warning color; message now points to "Profile → Overview → Target Role 1/2/3" |
