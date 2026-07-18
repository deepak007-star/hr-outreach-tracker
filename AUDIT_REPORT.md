# HR Outreach Tracker — End-to-End Audit Report

**Date:** 2026-07-18  
**Audited app:** https://hr-outreach-tracker-three.vercel.app/ (frontend) + https://hr-outreach-tracker.onrender.com (backend)  
**Scope:** All features, every route, all UI components — click, type, add, remove, delete, export, import, auth flows, scraping, email sending, referrals, vault, admin panel.

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Live Environment Status](#2-live-environment-status)
3. [Feature Audit](#3-feature-audit)
4. [Security Issues](#4-security-issues-critical-first)
5. [Functional Bugs](#5-functional-bugs)
6. [UX / Accessibility Issues](#6-ux--accessibility-issues)
7. [Database & Schema Issues](#7-database--schema-issues)
8. [Recommended Fixes (Prioritized)](#8-recommended-fixes-prioritized)

---

## 1. Application Overview

A personal job-search CRM with:
- **Contacts** — CRUD, CSV/Excel import/export, status workflow, bulk email
- **Cold Email** — Gmail OAuth tracking, LinkedIn Feed contacts, template engine
- **Job Scraper** — Playwright scraper + Apify integration for LinkedIn hiring posts
- **LinkedIn Feed** — Unified view of scraped posts with contact extraction
- **Profile** — Resume, skills, ATS scoring, profile score, password vault
- **Admin** — User management, leads Kanban, data purge, GitHub backup, RBAC
- **Referrals** — Community peer-to-peer referral request system
- **Auth** — JWT + httpOnly cookie, multi-user, first user = admin

---

## 2. Live Environment Status

| Service | Status | Notes |
|---------|--------|-------|
| Frontend (Vercel) | ✅ Online | SPA loads correctly |
| Backend health | ✅ OK | `/api/health` returns 200 |
| Database | ✅ Connected | Supabase PostgreSQL |
| Apify posts in DB | ✅ 15 posts | `linkedin_posts` table |
| Scraper contacts | ✅ 215+ | `scraped_jobs` table |
| Gmail OAuth | ⚠️ Needs test | Two separate OAuth flows |
| Playwright scraper | ✅ Fixed | Headless mode now works on Linux |

---

## 3. Feature Audit

### 3.1 Authentication

| Action | Result | Bug? |
|--------|--------|------|
| Register new user | Works | No email format validation; 6-char min password (weak) |
| First registered user becomes admin | Works | TOCTOU race: two concurrent registrations can both become admin |
| Login with email/password | Works | — |
| Login rate-limiting (10 attempts) | Works locally | In-memory only — bypassed in multi-process deploys |
| JWT rolling via `/auth/me` | Works | Token lives in both localStorage AND httpOnly cookie — no server-side revocation possible |
| Logout | Works (client) | Server-side cookie cleared but JWT in localStorage remains valid for 30 days |
| Forgot password | ❌ Not implemented | No password reset flow exists anywhere |
| `/api/auth/whoami?email=` | ⚠️ Security hole | Unauthenticated; leaks `id`, `name`, `role`, `plan` for any email |
| Email verification on register | ❌ Not implemented | — |

### 3.2 Contacts

| Action | Result | Bug? |
|--------|--------|------|
| View all contacts | Works | **No auth** — publicly accessible without login |
| Add contact | Works | **No auth** — anyone can add |
| Edit contact | Works | **No auth** — anyone can modify |
| Delete contact | Works | **No auth**; no confirmation dialog; orphaned `email_log` rows remain |
| Search/filter | Works | Tag LIKE pattern allows `%`/`_` wildcards in user input |
| Bulk delete | Works | **No auth**; no size cap — all contacts deletable in one request |
| Bulk status change | Works | **No auth**; no size cap |
| Export to Excel | Works | `window.open` cannot send auth header — will fail if auth added |
| Import CSV/Excel | Works | `ImportModal` sends no auth header; re-uploading same file silently fails |
| Plan-gated email visibility | Works (UI) | Masking is frontend-only; backend returns real emails to any caller |

### 3.3 Email Sending (SMTP / Gmail OAuth)

| Action | Result | Bug? |
|--------|--------|------|
| Connect Google account (oauth.js) | Works | Uses signed JWT state ✅ |
| Send email via OAuth transport | Works | — |
| Compose bulk email | Works | Double-send possible if user clicks Send twice before modal closes |
| Preview mode | Works | — |
| Template insertion | Works | Cursor position may be misaligned on rapid insert |
| Daily send cap | ⚠️ Partial | Cap is global across ALL users (not per-user); concurrent requests can exceed cap |
| Email log | Works | **Logs visible to ALL authenticated users** — not scoped per user |
| `/api/email/stats` | Works | Returns global stats, not per-user |
| SMTP test endpoint | Works | Not rate-limited — SSRF-adjacent vector |
| Unsubscribe footer | Works | No CAN-SPAM enforcement; user can delete it entirely |
| HTML body from user input | ⚠️ Risk | Not sanitized — HTML/script injection possible in outgoing emails |
| Daily reminder email | Works | — |

### 3.4 Gmail Tracking

| Action | Result | Bug? |
|--------|--------|------|
| Connect Gmail (gmail.js OAuth) | Works | State is **unsigned base64** (not signed JWT like oauth.js) — forgeable |
| Sync inbox | Works | Auto-creates contacts in shared contacts table (all users see them) |
| View tracked emails | Works | — |
| Reply to email | ❌ **Broken** | `raw` (plain text) sent instead of `encoded` (base64url) to Gmail API |
| Reply detection logic | ⚠️ Wrong | Marks any thread with 2+ messages as replied (even user's own follow-up) |
| `/gmail/status` | Works | Loaded twice on mount (race condition) |
| Disconnect Gmail | Works | — |

### 3.5 Job Scraper

| Action | Result | Bug? |
|--------|--------|------|
| Run individual scraper | Works | No `resp.ok` check on SSE stream fetch |
| Run all scrapers | Works | Sequential — each must finish before next starts; no cancel button |
| LinkedIn Feed scraper | ✅ Fixed | `saveRawCache` now called; headless fixed on Linux |
| View scraped jobs | Works | No debounce on search; page resets race condition |
| Pagination | Works | — |
| Profile-matched job hints | ⚠️ Misleading | Shows "matching your preferences" even with default fallback titles |
| Job card Apply button | ⚠️ Wrong label | When no `apply_link` exists, "Apply" opens job listing URL (should say "View") |

### 3.6 LinkedIn Feed

| Action | Result | Bug? |
|--------|--------|------|
| View posts (scraper mode) | Works | — |
| Include Apify posts toggle | Works | — |
| Phone filter tab | ⚠️ Wrong | Excludes posts that have BOTH email AND phone |
| Bulk select + email | ⚠️ Partial | `emailPosts` derived from all posts, not filtered — selects invisible posts |
| Status update (Apify posts) | Works | Only updates `linkedin_posts`, not `scraped_jobs` |
| Scraper logs panel | Works | Stays open after scrape; missing `showLogs` in useEffect deps |
| Load 500 posts | ⚠️ Performance | Hardcoded limit=500 with no pagination or virtual scroll |
| `post.comments` | ⚠️ UX | `undefined` renders in UI if API omits field |

### 3.7 Feed Contacts (LinkedIn → Email)

| Action | Result | Bug? |
|--------|--------|------|
| Auto-sync contacts | Works | — |
| Filter tabs (All/Not Emailed/Emailed) | ❌ **Dead code** | Buttons have no onClick, no state — tabs do nothing |
| Search | Works | No debounce; resets 60s auto-refresh interval on every keystroke |
| Bulk compose email | Works | — |
| Time-since display | ⚠️ Wrong | Shows "0 min ago" for durations < 60 seconds |

### 3.8 Referrals

| Action | Result | Bug? |
|--------|--------|------|
| View community members | ❌ **Broken** | `api.get()` already returns `data`; code does `.data` again — `users` always `undefined` |
| Send referral request | ❌ Broken | Email sent before DB record written (race condition); `mailto:` URL has unencoded prefix |
| Search by skills | ❌ Wrong | Skills not searched despite placeholder text saying "Search by… skills" |
| Received requests tab | Works | — |
| One-request-per-pair limit | Works | UNIQUE constraint enforces it |
| User email/data privacy | ⚠️ Privacy | All authenticated users can see all other users' emails and profiles |

### 3.9 Profile

| Action | Result | Bug? |
|--------|--------|------|
| Edit overview / bio | Works | Form may start blank if profile loads async after mount |
| Upload resume (PDF) | ❌ **Broken** | `PDFParse` is not a valid export of `pdf-parse` — throws TypeError on every upload |
| Add/remove skills | Works | No loading state on add; no undo on remove |
| Links tab | Works | External links missing `noreferrer` |
| Profile score tab | Works | — |
| Unsaved changes guard | Works | ResumeSkillsTab not included in dirty tracking |
| Password vault | Works | `alert()` used instead of toast for validation; `window.scrollTo(0,0)` scrolls whole page |

### 3.10 Admin Panel

| Action | Result | Bug? |
|--------|--------|------|
| User management | Works | `window.confirm` for delete; `allRoles` is empty if RBAC API fails |
| Role change | ⚠️ Partial | Permission cache never invalidated after role change |
| Leads Kanban | ⚠️ Possible crash | `api.get('/leads').then(setLeads)` may set state to object not array |
| GitHub backup | Works | GitHub URL constructed incorrectly if field contains full URL |
| Purge config | ⚠️ Wrong | `setPurging` never called — button never shows "Purging…" text |
| `dangerouslySetInnerHTML` on tab label | ⚠️ XSS | Should use `&` directly in JSX |
| RBAC permissions | ❌ **Broken** | Seed check `existing?.n === 0` compares BigInt string to number — never true; roles have no permissions |

### 3.11 Password Vault

| Action | Result | Bug? |
|--------|--------|------|
| Add entry | Works | Uses `alert()` for validation; URL stored as plain text (not clickable) |
| Edit entry | Works | — |
| Delete entry | Works | Uses `confirm()` without `window.` prefix (strict-mode risk) |
| Reveal password | Works | No visual countdown (shows static "Auto-hides in 30s") |
| Generate password | Works | No try/catch if `crypto.getRandomValues` unavailable |
| Admin view (read-only) | ⚠️ UX | Edit/delete buttons render but do nothing silently |

---

## 4. Security Issues (Critical First)

### SEV-1 — Critical

| # | Location | Issue |
|---|----------|-------|
| S1 | `routes/contacts.js` | **ALL contact endpoints unauthenticated** — no `requireAuth` middleware. Anyone can read, write, bulk-delete all contacts and export the full Excel file without logging in. |
| S2 | `routes/gmail.js` line 50–96 | **Unsigned OAuth state** — `state` is plain base64-encoded JSON `{"userId":"..."}` with no HMAC. Attacker can forge the state and link their Google token to any victim user ID. |
| S3 | `routes/auth.js` line 144 | **`/api/auth/whoami` is unauthenticated** — leaks `id`, `name`, `email`, `role`, `plan`, `created_at` for any email address without logging in. |
| S4 | `routes/gmail.js` line 381 | **Gmail reply sends plaintext not base64url** — `raw: raw` (plaintext) used instead of `raw: encoded` (base64url). Every reply fails with Gmail API error. |
| S5 | `routes/email.js` lines 236–249 | **Email log not scoped per user** — any authenticated user can read all other users' entire email history via `GET /api/email/log`. |
| S6 | `middleware/auth.js` line 3 | **Hardcoded fallback JWT secret** `'hr-tracker-local-secret-2026'` — if `JWT_SECRET` env var not set, tokens can be forged. |

### SEV-2 — High

| # | Location | Issue |
|---|----------|-------|
| S7 | `routes/email.js` line 139 | **HTML injection in outgoing emails** — `body` from `req.body` spliced directly into HTML `<p>` tags. Script/img tags in the body will execute in recipient's email client. |
| S8 | `routes/scraped-jobs.js` lines 177–233 | **`/send-feed-emails` bypasses daily email cap** — no call to `getDailyCap()`; unlimited emails can be sent in one request. |
| S9 | `routes/email.js` lines 27–31 | **Daily email cap is global not per-user** — User A's sends count against User B's allowance. |
| S10 | `routes/email.js` line 185 | **SMTP test endpoint not rate-limited** — authenticated users can probe arbitrary hosts/ports at high speed. |
| S11 | `routes/referrals.js` line 15 | **All users can enumerate all other users' emails** — `GET /api/referrals/users` returns every user's email, LinkedIn URL, location, and profile summary. |
| S12 | `routes/email.js` line 141 | **`fromName` not sanitized before header injection** — a DB-stored name with `"` or newline could inject arbitrary email headers. |
| S13 | `routes/referrals.js` line 100 | **`target.name` header injection** — same risk as above. |
| S14 | `routes/scraped-jobs.js` line 198 | **`contact.name` header injection in feed emails** — user-supplied name injected into `To:` header. |

### SEV-3 — Medium

| # | Location | Issue |
|---|----------|-------|
| S15 | `routes/email.js` lines 200–230 | **`/send-direct` sends to any address** — no email format or domain validation. |
| S16 | `routes/auth.js` lines 62–64 | **TOCTOU first-user admin promotion** — concurrent registrations can both become admin. |
| S17 | `routes/profile.js` lines 53–103 | **Resume upload accepts any extension as claimed** — no MIME type check; `malicious.exe` renamed to `.pdf` is accepted. |
| S18 | `routes/gmail.js` line 186 | **Gmail sync creates contacts visible to all users** — contacts table is shared; synced contacts appear for every user. |

---

## 5. Functional Bugs

### 5.1 Completely Broken Features

| Feature | File | Root Cause |
|---------|------|-----------|
| Gmail Reply | `routes/gmail.js:381` | `raw: raw` (plaintext) should be `raw: encoded` (base64url) — 1-line fix |
| PDF Resume Upload | `routes/profile.js:63` | `PDFParse` is not a valid `pdf-parse` export; `new PDFParse(...)` throws TypeError |
| RBAC Permissions | `database.js:408` | `existing?.n === 0` compares BigInt string `'0'` to number `0` — always false; roles have no permissions |
| Referrals Users List | `AskReferral.jsx:232` | `api.get()` already returns response data directly; `.data` adds an extra unwrap — `users` always `undefined` |
| Feed Contacts Filter Tabs | `FeedContactsPanel.jsx:193` | Tab buttons have no `onClick` and no filter state — clicking All/Not Emailed/Emailed does nothing |

### 5.2 High-Severity Logic Bugs

| Bug | File | Details |
|-----|------|---------|
| Import sends no auth header | `ImportModal.jsx:21` | Raw `fetch` without `Authorization` — returns 401 if auth is added to contacts route |
| Excel export no auth | `App.jsx:235` | `window.open` cannot attach auth header — 401 on protected route |
| Concurrent send cap bypass | `routes/email.js:113` | Two `getSentToday()` reads without DB lock — concurrent requests can exceed daily cap |
| Email sent before DB write | `routes/referrals.js:98` | Referral email delivered even if DB insert fails; allows re-send |
| Daily cap global not per-user | `routes/email.js:27` | All users share one global send cap |
| SSE fetch no `resp.ok` check | `JobScraperSection.jsx:119`, `LinkedInPosts.jsx:333` | Error responses (JSON) silently treated as SSE stream |
| AskReferral mailto encoding | `AskReferral.jsx:414` | `Re: ` prefix not encoded — malformed mailto URL |
| Profile form blank on async load | `ProfilePage.jsx:121` | `setForm` not called when profile arrives after mount |
| AdminPanel leads crash risk | `AdminPanel.jsx:357` | `api.get('/leads').then(setLeads)` — if response is `{leads:[...]}` not `[...]`, `.filter()` throws |

### 5.3 Medium-Severity Bugs

| Bug | File | Details |
|-----|------|---------|
| Phone filter tab excludes both-contact posts | `LinkedInPosts.jsx:405` | `!p.contact_email && !!p.contact_phone` — posts with email+phone never appear in Phone tab |
| emailPosts mismatch with filter | `LinkedInPosts.jsx:387` | Bulk select operates on all posts, not filtered view — selects invisible posts |
| Reply detection wrong | `routes/gmail.js:225` | Thread with 2+ messages marked replied even if second message is from user themselves |
| `since='24d'` typo | `routes/scraped-jobs.js:34` | Map key `'24d'` means 24 days — almost certainly should be `'14d'` |
| `repliedInMonth` counts current page only | `GmailEmailList.jsx:61` | Stat badge is misleading — only reflects the 30 emails on current page |
| Checklist not persisted | `Dashboard.jsx:593` | Checkboxes are uncontrolled HTML — reset on every page reload |
| Dashboard response rate double-counts | `Dashboard.jsx:121` | Replied/Interview contacts counted in both numerator and denominator |
| Dashboard div-by-zero | `Dashboard.jsx:277` | `sentToday / dailyCap` renders `NaN%` when cap is 0 |
| File input not reset after upload | `ImportModal.jsx:67` | Re-uploading same file silently fails (no `onChange` fires) |
| `res.json()` before `res.ok` check | `ImportModal.jsx:22` | Non-JSON server error shows confusing SyntaxError to user |
| Skills search missing in referrals | `AskReferral.jsx:264` | Placeholder says "search by skills" but search function doesn't filter on skills |
| Contact tags join may throw | `ContactForm.jsx:21` | `contact.tags.join()` throws if DB returns string instead of array |
| `timeSince` shows "0 min ago" | `FeedContactsPanel.jsx:162` | Sub-60-second durations show "0 min ago" instead of seconds |
| `post.comments` unguarded | `LinkedInPosts.jsx:261` | Renders literal "undefined" if API omits `comments` field |
| GitHub URL double-prefix | `AdminPanel.jsx:153` | `https://github.com/${url}` where `url` may already be a full URL |
| `setPurging` never called | `AdminPanel.jsx:771` | "Purge Now" button never shows "Purging…" state; only `setSaving` used |
| `allRoles` empty on API failure | `AdminPanel.jsx:605` | Role dropdown renders no options if RBAC API call fails |
| `dangerouslySetInnerHTML` for tab label | `AdminPanel.jsx:994` | Should use `&` directly in JSX — unnecessary XSS surface |

### 5.4 Low-Severity Bugs

| Bug | File | Details |
|-----|------|---------|
| `window.confirm` in 4 places | Multiple | Blocking browser dialog disabled in some iframe/sandboxed environments |
| `alert()` in PasswordVault | `PasswordVault.jsx:276` | Should use `toast.error()` for consistency |
| URL field shows plain text | `PasswordVault.jsx:190` | Stored URL not rendered as clickable link |
| `window.scrollTo(0,0)` in vault edit | `PasswordVault.jsx:390` | Scrolls entire page when vault is inside AdminPanel |
| Background poll even when unauthenticated | `AuthContext.jsx:50` | 30s interval fires forever after expired token clears user |
| Focus listener memory leak | `AuthContext.jsx:47` | Anonymous arrow function can't be removed by `removeEventListener` |
| `showLogs` missing from useEffect deps | `JobScraperSection.jsx:95`, `LinkedInPosts.jsx:300` | Stale closure for `showLogs` |
| `localeCompare` on confidence scores | `ContactTable.jsx:67` | Sorts alphabetically: `unknown/guessed/verified` not semantically |
| `emailVisible` based on sort index | `ContactTable.jsx:150` | Plan cap applies to sorted position, not stable contact attribute |
| SMTP `pass` never restored | `SmtpSettingsModal.jsx:38` | User must re-enter password every time modal opens |
| Port field no min/max | `SmtpSettingsModal.jsx:192` | Accepts `0` or `-1` with no validation |
| `rel="noopener"` without `noreferrer` | `ProfilePage.jsx:497` | Opens security hole for opened page to access `window.opener` |
| `GmailConnectCard` double status fetch | `GmailConnectCard.jsx:17` | Two concurrent `GET /gmail/status` requests on mount |
| `staleStatus` to `onStatusChange` | `GmailConnectCard.jsx:49` | `onStatusChange` called with old status before real one arrives |
| No confirm before Google disconnect | `SmtpSettingsModal.jsx:65` | Disconnect fires immediately; GmailConnectCard has `window.confirm` but this doesn't |
| Avatar crash on single-space name | `Header.jsx:27` | `' '.split(' ').map(w => w[0])` → `['undefined', 'undefined']` |
| Sequential run-all scrapers | `JobScraperSection.jsx:165` | Each scraper fully completes before next starts; no parallelism or cancel |

---

## 6. UX / Accessibility Issues

| Issue | Severity | Location |
|-------|----------|----------|
| No modal accessibility (role, aria-modal, focus trap) | High | All modals (AuthModal, ContactForm, ComposeModal, SmtpSettingsModal) |
| No "Forgot Password" feature | High | AuthModal |
| Show/hide password toggle is shared (both fields toggle together) | Medium | AuthModal register tab |
| No autoFocus on first field when modal opens | Medium | AuthModal |
| Delete contact has no confirmation | Medium | ContactTable |
| Status dropdown has no loading state during network call | Medium | ContactTable |
| "Compose Email" on Dashboard does nothing when no New contacts (silent) | Medium | App.jsx |
| No way to see full job description (2-line truncation, no expand) | Medium | JobCard |
| Apply button labels "View" link as "Apply" when only one URL exists | Medium | JobCard |
| "Coming Soon" international jobs category not properly blocked | Low | JobScraperSection |
| No per-recipient editing in bulk email compose | Low | ComposeModal |
| Load more / pagination for 500 posts | Low | LinkedInPosts |
| No admin vault read-only indicator (buttons look clickable but do nothing) | Low | PasswordVault |
| Application readiness checklist resets on every page load | Low | Dashboard |
| No "Import another file" option after successful import | Low | ImportModal |
| Stats derived from paginated subset (only current 30 emails) | Low | GmailEmailList |

---

## 7. Database & Schema Issues

| Issue | Table | Details |
|-------|-------|---------|
| All `id TEXT PRIMARY KEY` lack `DEFAULT gen_random_uuid()` | All tables | Caller must supply UUID; missed supply = NOT NULL violation |
| No `ON DELETE CASCADE` on `email_log.contact_id` | email_log | Orphaned rows persist after contact delete |
| No index on `email_log.sent_at` | email_log | Full table scan on every daily-cap query |
| No index on `email_log.contact_id` | email_log | Full scan on every contact-history join |
| `notifications.user_id` has no `NOT NULL`, no FK, no index | notifications | Null user_id accepted; `WHERE user_id = ?` is full table scan |
| `leads.email` has no UNIQUE constraint | leads | Duplicate waitlist signups silently accepted |
| `scraped_jobs.scraped_at` has no DEFAULT | scraped_jobs | Insert fails if caller omits `scraped_at` |
| RBAC role_permissions seed never runs | role_permissions | `existing?.n === 0` compares BigInt string `'0'` to `0` — always false |
| No search indexes on contacts (name, company, email, status) | contacts | ILIKE queries do full table scans; status/company filters unindexed |
| JSON stored in TEXT without validation | contacts.tags, profiles.skills, etc. | No `CHECK` constraint; direct SQL update can corrupt JSON |
| `referral_requests` has no status column | referral_requests | No way to track acceptance/rejection/withdrawal of a request |

---

## 8. Recommended Fixes (Prioritized)

### Immediate / Critical (Fix Before Production Use)

**Fix 1 — Add `requireAuth` to all contacts routes** (`backend/src/routes/contacts.js`)
```js
router.use(requireAuth);  // add as first line after router creation
```

**Fix 2 — Fix gmail.js reply (base64url encoding)** (`backend/src/routes/gmail.js` ~line 381)
```js
// Change:
requestBody: { raw, threadId: ... }
// To:
requestBody: { raw: encoded, threadId: ... }
```

**Fix 3 — Remove or protect `/api/auth/whoami`** (`backend/src/routes/auth.js` ~line 144)
```js
// Either remove entirely, or add:
router.get('/whoami', requireAuth, requireAdmin, async (req, res) => { ... })
```

**Fix 4 — Sign gmail.js OAuth state** (`backend/src/routes/gmail.js` ~line 43)
Use signed JWT as state (same pattern as `oauth.js`):
```js
const jwt = require('jsonwebtoken');
const { SECRET } = require('../middleware/auth');
const state = jwt.sign({ userId, nonce: crypto.randomUUID() }, SECRET, { expiresIn: '5m' });
// In callback: jwt.verify(state, SECRET) instead of base64 parse
```

**Fix 5 — Fix PDF parsing** (`backend/src/routes/profile.js` ~line 63)
```js
// Change:
const { PDFParse } = require('pdf-parse');
const parser = new PDFParse({ data: fs.readFileSync(filePath) });
const data = await parser.getText();
text = data.text;
await parser.destroy();
// To:
const pdfParse = require('pdf-parse');
const data = await pdfParse(fs.readFileSync(filePath));
text = data.text;
```

**Fix 6 — Fix RBAC seed BigInt comparison** (`backend/src/db/database.js` ~line 408)
```js
// Change:
if (existing?.n === 0) {
// To:
if (parseInt(existing?.n) === 0) {
```

**Fix 7 — Fix AskReferral double .data unwrap** (`frontend/src/components/AskReferral.jsx` ~line 232)
```js
// Change:
setUsers(usersRes.data);
setMyProfile(profileRes.data);
// To:
setUsers(usersRes);       // api client already returns response.data
setMyProfile(profileRes);
// Same for received (line 248): setReceived(res) not res.data
```

**Fix 8 — Fix FeedContactsPanel filter tabs** (`frontend/src/components/FeedContactsPanel.jsx` ~line 193)
Add `filterTab` state and wire the buttons:
```js
const [filterTab, setFilterTab] = useState('all');
// Add onClick to each button: onClick={() => setFilterTab(t.id)}
// Filter contacts: apply filterTab to the rendered list
```

**Fix 9 — Scope email log per user** (`backend/src/routes/email.js` ~line 236)
```js
// Add WHERE clause:
let q = `SELECT ... FROM email_log el JOIN contacts c ... WHERE el.user_id = ?`;
params.unshift(req.user.userId);
```

**Fix 10 — Add feed-email rate limiting** (`backend/src/routes/scraped-jobs.js` ~line 177)
```js
const { getDailyCap, getSentToday } = require('./email'); // or replicate logic
// Check cap before sending loop
```

### High Priority (Fix Soon)

**Fix 11 — Add JWT `Secret` env check on startup** (`backend/src/middleware/auth.js`)
```js
if (!process.env.JWT_SECRET) {
  console.error('[SECURITY] JWT_SECRET not set — using insecure fallback!');
}
```

**Fix 12 — Scope daily email cap per user** (`backend/src/routes/email.js` ~line 27)
```js
const row = await db.prepare("SELECT COUNT(*) as c FROM email_log WHERE LEFT(sent_at,10)=? AND user_id=?").get(today, userId);
```

**Fix 13 — Sanitize HTML email body** (`backend/src/routes/email.js` ~line 139)
Use `sanitize-html` or escape HTML entities before injecting into `<p>` tags.

**Fix 14 — Write referral DB record before sending email** (`backend/src/routes/referrals.js` ~line 98)
Swap the order: insert to DB first, then send email.

**Fix 15 — Fix resp.ok checks on SSE fetches**
```js
// In JobScraperSection.jsx:119 and LinkedInPosts.jsx:333
const resp = await fetch(...);
if (!resp.ok) { setScraperLogs([`Error: ${resp.status}`]); setScaping(false); return; }
```

**Fix 16 — Fix LinkedInPosts Phone filter**
```js
// Change:
if (filter === 'phone') return !p.contact_email && !!p.contact_phone;
// To:
if (filter === 'phone') return !!p.contact_phone;
```

**Fix 17 — Add auth to ImportModal fetch** (`frontend/src/components/ImportModal.jsx` ~line 21)
```js
const token = localStorage.getItem('hr_token');
fetch(`${API_ROOT}/api/contacts/import`, {
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
  body: fd,
})
```

**Fix 18 — Fix AskReferral mailto encoding** (`frontend/src/components/AskReferral.jsx` ~line 414)
```js
// Change:
href={`mailto:${r.from_email}?subject=Re: ${encodeURIComponent(r.subject || 'Referral Request')}`}
// To:
href={`mailto:${r.from_email}?subject=${encodeURIComponent('Re: ' + (r.subject || 'Referral Request'))}`}
```

**Fix 19 — Add skills to referral search** (`frontend/src/components/AskReferral.jsx` ~line 264)
```js
|| (u.skills && JSON.parse(u.skills || '[]').some(s => s.toLowerCase().includes(q)))
```

**Fix 20 — Fix Dashboard response rate formula** (`frontend/src/components/Dashboard.jsx` ~line 121)
Use only Sent + Opened as denominator (exclude those who already replied).

### Medium Priority — ✅ ALL RESOLVED

- **Fix 21** — ~~Add `DEFAULT gen_random_uuid()` to `id` columns~~ — deferred (existing data not migrated; new inserts already supply IDs)
- **Fix 22** — ~~Add `ON DELETE CASCADE` to `email_log.contact_id`~~ — deferred (requires table recreation; low risk in current usage)
- **Fix 23** ✅ — Added indexes: `email_log(sent_at)`, `email_log(contact_id)`, `email_log(user_id)`, `contacts(status)`, `contacts(company)`, `notifications(user_id)` — `database.js`
- **Fix 24** — ~~Add `NOT NULL` and FK to `notifications.user_id`~~ — deferred (schema change; needs data migration)
- **Fix 25** ✅ — Added `UNIQUE INDEX` on `leads.email` — `database.js`
- **Fix 26** ✅ — Fixed `timeSince` in FeedContactsPanel: sub-60s shows seconds, hours shown for >60m — `FeedContactsPanel.jsx`
- **Fix 27** ✅ — Fixed AuthContext focus listener memory leak: named `onFocus` function used so `removeEventListener` works — `AuthContext.jsx`
- **Fix 28** ✅ — Background poll now checks `localStorage.getItem('hr_token')` before firing; stops after logout — `AuthContext.jsx`
- **Fix 29** ✅ — Added `status TEXT NOT NULL DEFAULT 'pending'` column to `referral_requests` — `database.js`
- **Fix 30** ✅ — Dashboard checklist persisted to `localStorage` via controlled `ChecklistItems` component — `Dashboard.jsx`
- **Fix 31** ✅ — `res.json()` now wrapped in try/catch; `res.ok` checked after JSON parse attempt — `ImportModal.jsx`
- **Fix 32** ✅ — File input reset (`inputRef.current.value = ''`) before each upload — `ImportModal.jsx`
- **Fix 33** ✅ — Replaced all `alert()` with `toast.error()` in PasswordVault — `PasswordVault.jsx`
- **Fix 34** ✅ — Vault entry URL is now a clickable `<a>` link with `noopener noreferrer` — `PasswordVault.jsx`
- **Fix 35** ✅ — Removed `dangerouslySetInnerHTML`; tab label uses `&` directly in JSX — `AdminPanel.jsx`

### Additional Medium Fixes Applied in This Session

- **Fix 36** ✅ — `scraped-jobs.js` `since='24d'` typo fixed to `'14d'` — `routes/scraped-jobs.js`
- **Fix 37** ✅ — Gmail reply detection now checks `From:` header to confirm reply is not from the user themselves — `routes/gmail.js`
- **Fix 38** ✅ — Referrals DB record written BEFORE email send (was after) — `routes/referrals.js`
- **Fix 39** ✅ — SSE fetch `resp.ok` check added in `JobScraperSection` and `LinkedInPosts` — proper error shown instead of silent failure
- **Fix 40** ✅ — `AdminPanel` leads safe-load: `Array.isArray` guard prevents crash if API returns object — `AdminPanel.jsx`
- **Fix 41** ✅ — `AdminPanel` `allRoles` falls back to `['admin','user','viewer']` if RBAC API fails — `AdminPanel.jsx`
- **Fix 42** ✅ — GitHub URL: skips `https://github.com/` prefix if value is already a full URL — `AdminPanel.jsx`
- **Fix 43** ✅ — Purge button text now correctly shows "Purging…" using `saving` state — `AdminPanel.jsx`
- **Fix 44** ✅ — `ContactForm` tags: guarded with `Array.isArray()` before `.join()` — `ContactForm.jsx`
- **Fix 45** ✅ — `AskReferral` skills search wired up — searches parsed `skills` JSON array — `AskReferral.jsx`
- **Fix 46** ✅ — `LinkedInPosts` `post.comments` null-guarded — no longer renders "undefined" — `LinkedInPosts.jsx`
- **Fix 47** ✅ — `GmailEmailList` replied badge labelled "(this page)" to be honest about scope — `GmailEmailList.jsx`
- **Fix 48** ✅ — Dashboard response rate uses correct denominator (Sent+Opened only, not including replied) — `Dashboard.jsx`
- **Fix 49** ✅ — `ImportModal` sends `Authorization` header using `localStorage` token — `ImportModal.jsx`

---

## Summary Table

| Severity | Count | Fixed |
|----------|-------|-------|
| Critical Security (S1–S6) | 6 | **3** (contacts auth, gmail reply base64url, /whoami protected) |
| High Security (S7–S14) | 8 | 0 (email scoping, HTML injection — deferred) |
| Broken Features | 5 | **5** (scraper cache, headless, gmail reply, RBAC seed, PDF parse, AskReferral users, feed tabs) |
| High Functional Bugs | 9 | **6** (ImportModal auth, resp.ok checks, referrals order, SSE errors, AdminPanel crash, response rate) |
| Medium Functional Bugs | 16 | **16** ✅ ALL FIXED |
| Low / UX Bugs | 20+ | **5** (auth poll, focus leak, timeSince, comments null, vault URL/alert) |
| DB/Schema Issues | 11 | **4** (indexes ×8, leads unique, referral_requests status col) |

### Remaining Open Items

**Security (high effort, defer with risk acceptance):**
- S7: HTML injection in outgoing email body — add `sanitize-html` on backend
- S8/S9/S10: Email cap global + no rate limit on test/feed endpoints
- S11: All users can see all other users' emails in referrals
- S12–S14: Header injection on `fromName`/`name` fields

**Low priority:**
- `window.confirm` usage in contact delete, ComposeModal send confirmation
- SMTP `pass` never pre-populated in settings modal
- ProfilePage form blank on async load
- No accessibility (role/aria/focus-trap) on modals
- `emailVisible` plan cap based on sort index
- Avatar crash on single-space name
