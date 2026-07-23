# Bug History — HR Outreach Tracker

Complete record of all bugs found, when they were fixed, and what the fix was.

---

## Conventions

- **Status**: ✅ Fixed | ⚠️ Deferred (accepted risk) | ❌ Open
- **Severity**: Critical (data loss / auth bypass) | High (major feature broken) | Medium (incorrect behaviour) | Low (cosmetic / polish)

---

## Phase 1 — Initial Audit (2026-07-18)

### Critical Security

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B001 | Critical | Auth | Almost the entire backend API had zero authentication — contacts, email, settings, jobs, emailTemplates, emailVerify all had no `requireAuth` middleware. Anyone could read all 215 contacts, send email, and retrieve SMTP password in plaintext. | ✅ Fixed | Added `router.use(requireAuth)` to contacts.js, email.js, settings.js, emailTemplates.js, emailVerify.js |
| B002 | Critical | Gmail OAuth | Gmail OAuth state was plain base64-encoded JSON `{"userId":"..."}` with no HMAC. An attacker could forge the state and link their Google token to any victim's user ID. | ✅ Fixed | Changed to signed JWT state `jwt.sign({ userId, nonce }, SECRET, { expiresIn:'5m' })` — same pattern as oauth.js |
| B003 | Critical | Auth | `GET /api/auth/whoami` was unauthenticated — leaked id, name, email, role, plan, created_at for any email without logging in. | ✅ Fixed | Added `requireAuth, requireAdmin` middleware to the /whoami route |
| B004 | Critical | Gmail | Gmail reply sent `raw: rawText` (plaintext) instead of `raw: base64url-encoded` — every reply failed with Gmail API error. | ✅ Fixed | Encoded raw message with `Buffer.from(raw).toString('base64url')` |
| B005 | Critical | Email log | Any authenticated user could read all other users' entire email history via `GET /api/email/log`. | ✅ Fixed (partial) | Added `WHERE el.user_id = ?` scoping; daily cap now also checked per-user on send |
| B006 | Critical | Auth | Hardcoded fallback JWT secret `'hr-tracker-local-secret-2026'` — if `JWT_SECRET` env var not set, tokens could be forged. | ⚠️ Deferred | Warning added to startup log. Secret must be set in production. |

---

### High Security

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B007 | High | Email | HTML injection in outgoing emails — `body` from `req.body` injected directly into HTML `<p>` tags. Script/img in body executes in recipient's client. | ❌ Open | Needs `sanitize-html` package on backend email route |
| B008 | High | Email | `/send-feed-emails` (scraped-jobs route) bypasses daily email cap — no call to `getDailyCap()` | ❌ Open | Add cap check before send loop in scraped-jobs.js |
| B009 | High | Email | Daily email cap was global across all users — User A's sends count against User B's limit. | ✅ Fixed (partial) | Cap check now uses `WHERE user_id = ?`; feed-email route still open |
| B010 | High | Email | SMTP test endpoint not rate-limited — authenticated users could probe arbitrary hosts/ports at high speed. | ❌ Open | Add `scrapeLimiter` or a dedicated limiter on SMTP test endpoint |
| B011 | High | Referrals | All users could enumerate all other users' emails via `GET /api/referrals/users`. | ❌ Open | Requires privacy decision: mask emails, require explicit consent, or limit to opt-in users |
| B012 | High | Email | `fromName` not sanitized before email header injection — a DB-stored name with `"` or newline could inject arbitrary email headers. | ❌ Open | Sanitize `fromName`, `target.name` before header use |
| B013 | High | OAuth | Google OAuth callback embedded the full 30-day JWT in the redirect URL (`?google_login_token=JWT`) — exposed in browser history, server logs, Referer headers. | ✅ Fixed | Replaced with one-time exchange code pattern (32-byte hex, 60s TTL, single-use) — 2026-07 |

---

### Broken Features (Complete Failures)

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B014 | High | Job Scraper | LinkedIn feed scraper: `saveRawCache` not called; headless mode failed on Linux | ✅ Fixed | Called `saveRawCache` in scraper; fixed Playwright headless config for Linux |
| B015 | High | Gmail | Reply always failed — see B004 above | ✅ Fixed | See B004 |
| B016 | High | Profile | PDF resume upload failed: `PDFParse` is not a valid export of `pdf-parse` — `new PDFParse(...)` threw TypeError on every upload | ✅ Fixed | Changed to `const pdfParse = require('pdf-parse'); const data = await pdfParse(buffer); text = data.text;` |
| B017 | High | RBAC | RBAC seed never ran: `existing?.n === 0` compared BigInt string `'0'` to number `0` — always false → roles had no permissions | ✅ Fixed | Changed to `parseInt(existing?.n) === 0` |
| B018 | High | Referrals | Referrals users list: `api.get()` already returns `data`; code did `.data` again — `users` always `undefined` | ✅ Fixed | Removed double `.data` unwrap: `setUsers(usersRes)` not `setUsers(usersRes.data)` |
| B019 | High | LinkedIn Feed | Feed contacts filter tabs (All / Not Emailed / Emailed) had no onClick and no filter state — clicking did nothing | ✅ Fixed | Added `filterTab` state and wired `onClick={() => setFilterTab(t.id)}` + applied filter to contact list |

---

### High-Severity Logic Bugs

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B020 | High | Import | CSV/Excel import sent no auth header — would return 401 once auth was added to contacts route | ✅ Fixed | `ImportModal` now sends `Authorization: Bearer <hr_token>` in fetch headers |
| B021 | High | Email send | Double-send possible if user clicks Send twice before modal closes | ⚠️ Deferred | UI debounce in place; full fix needs idempotency token |
| B022 | High | Email cap | Concurrent requests could exceed daily send cap — two `getSentToday()` reads without DB lock | ⚠️ Deferred | Accepted for current single-user scale; fix requires DB-level advisory lock or atomic increment |
| B023 | High | Referrals | Referral email sent before DB record written (race) — allowed re-send if DB insert failed | ✅ Fixed | Swapped order: INSERT INTO referral_requests first, then send email |
| B024 | High | Scraper | SSE fetch in JobScraperSection and LinkedInPosts had no `resp.ok` check — error responses treated as SSE stream | ✅ Fixed | Added `if (!resp.ok) { setScraperLogs([...]); return; }` before consuming SSE stream |
| B025 | High | Referrals | `AskReferral` mailto URL: `Re: ` prefix was not encoded — malformed mailto URL opened by browser | ✅ Fixed | Changed to `encodeURIComponent('Re: ' + subject)` |

---

### Medium-Severity Bugs

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B026 | Medium | LinkedIn Feed | Phone filter tab excluded posts that had BOTH email AND phone: `!p.contact_email && !!p.contact_phone` | ✅ Fixed | Changed to `!!p.contact_phone` |
| B027 | Medium | LinkedIn Feed | Bulk select operated on all posts (all 500), not just the filtered view — invisible posts selected | ⚠️ Deferred | Needs filtered list passed to bulk selection logic |
| B028 | Medium | Gmail | Reply detection wrong: marked any thread with 2+ messages as replied even if second message was from user themselves | ✅ Fixed | Check `From:` header on last message — skip if it matches user's own Gmail address |
| B029 | Medium | Scraped Jobs | `since='24d'` map key — 24 days is almost certainly wrong; meant to be `'14d'` (2 weeks) | ✅ Fixed | Changed to `'14d'` in scraped-jobs.js |
| B030 | Medium | Gmail | `repliedInMonth` stat counted only the 30 emails on current page — showed misleading stat | ✅ Fixed | Added `"(this page)"` qualifier to badge label in GmailEmailList |
| B031 | Medium | Dashboard | Application readiness checklist reset on every page load — stored in uncontrolled HTML | ✅ Fixed | Moved to controlled state persisted in `localStorage` via `ChecklistItems` component |
| B032 | Medium | Dashboard | Response rate double-counted: Replied/Interview contacts in both numerator and denominator | ✅ Fixed | Changed denominator to Sent+Opened only (excluding those who already replied) |
| B033 | Medium | Dashboard | `sentToday / dailyCap` showed `NaN%` when cap was 0 | ✅ Fixed | Added guard: `dailyCap > 0 ? Math.round(sentToday / dailyCap * 100) : 0` |
| B034 | Medium | Import | Re-uploading same file silently failed — file input `onChange` didn't fire for same file | ✅ Fixed | Added `inputRef.current.value = ''` before each upload to reset file input |
| B035 | Medium | Import | Non-JSON server error showed confusing SyntaxError — `res.json()` called before `resp.ok` check | ✅ Fixed | Added `if (!resp.ok)` before `.json()` parse with fallback error message |
| B036 | Medium | Referrals | Skills search not implemented despite placeholder text — search function didn't filter on skills | ✅ Fixed | Added skills filter: parsed `u.skills` JSON, checked each skill against search query |
| B037 | Medium | Contacts | `contact.tags.join()` threw if DB returned a string instead of array | ✅ Fixed | Added `Array.isArray(contact.tags) ? contact.tags.join(', ') : contact.tags` guard |
| B038 | Medium | Feed Contacts | `timeSince` showed "0 min ago" for durations < 60 seconds | ✅ Fixed | Changed to show seconds for sub-60s: `${Math.floor(diff/1000)}s ago` |
| B039 | Medium | LinkedIn Feed | `post.comments` rendered literal "undefined" when API omitted the field | ✅ Fixed | Added nullish coalescing: `post.comments ?? 0` |
| B040 | Medium | Admin | GitHub URL construction: `https://github.com/${url}` where `url` might already be a full URL | ✅ Fixed | Skip prefix if value already starts with `https://` |
| B041 | Medium | Admin | `setPurging` never called — "Purge Now" button never showed "Purging…" state | ✅ Fixed | Changed to use correct state setter |
| B042 | Medium | Admin | `allRoles` was empty if RBAC API failed — role dropdown showed nothing | ✅ Fixed | Added fallback: `['admin','user','viewer']` if RBAC endpoint errors |
| B043 | Medium | Admin | `dangerouslySetInnerHTML` used for tab label just to render `&` — unnecessary XSS surface | ✅ Fixed | Replaced with `&amp;` literal / JSX `&` character directly |
| B044 | Medium | Admin | Leads list could crash: `api.get('/leads').then(setLeads)` — if response was `{leads:[...]}` not `[...]`, `.filter()` threw | ✅ Fixed | Added `Array.isArray` guard: `setLeads(Array.isArray(data) ? data : data.leads || [])` |

---

### Low-Severity Bugs

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B045 | Low | Auth | Background poll (30s interval) fired forever after expired token cleared user — no check for token presence | ✅ Fixed | Interval now checks `localStorage.getItem('hr_token')` before calling sync |
| B046 | Low | Auth | `window.addEventListener('focus', onFocus)` used anonymous arrow — `removeEventListener` couldn't remove it → memory leak | ✅ Fixed | Extracted to named `onFocus` function so removeEventListener matches |
| B047 | Low | Vault | `alert()` used for validation errors in PasswordVault — inconsistent with rest of app | ✅ Fixed | Replaced all `alert()` with `toast.error()` |
| B048 | Low | Vault | Vault entry URL stored as plain text — not clickable | ✅ Fixed | Rendered as `<a href={url} target="_blank" rel="noopener noreferrer">` |
| B049 | Low | Vault | `window.scrollTo(0,0)` in vault edit scrolled entire page when vault is inside AdminPanel | ⚠️ Deferred | Minor UX; requires ref-scoped scroll |
| B050 | Low | Vault | Password reveal had no visual countdown (showed static "Auto-hides in 30s") | ⚠️ Deferred | UX improvement — needs countdown timer state |
| B051 | Low | Scraper | `showLogs` missing from useEffect deps in JobScraperSection and LinkedInPosts — stale closure | ⚠️ Deferred | Low practical impact; ESLint rule would catch it |
| B052 | Low | Contacts | `localeCompare` used for confidence score sort — sorted alphabetically (unknown/guessed/verified) not semantically | ⚠️ Deferred | Needs explicit sort order mapping |
| B053 | Low | Contacts | Email visibility plan cap applied to sorted position (not stable contact attribute) | ⚠️ Deferred | Requires per-contact plan-gating on backend |
| B054 | Low | SMTP | SMTP `pass` field never pre-populated in SmtpSettingsModal — user must re-enter every time | ⚠️ Deferred | Security concern vs. UX tradeoff |
| B055 | Low | Profile | External links missing `rel="noreferrer"` — opens window.opener access hole | ✅ Fixed (partial) | Added `noreferrer` where found |
| B056 | Low | Gmail | `GmailConnectCard` fired two concurrent `GET /gmail/status` requests on mount | ⚠️ Deferred | Caused by double effect; extract to custom hook |
| B057 | Low | Header | Avatar crashed on single-space display name: `' '.split(' ').map(w => w[0])` → `['undefined','undefined']` | ⚠️ Deferred | Guard: `filter(w => w)` before map |
| B058 | Low | Admin | Permission cache not invalidated after role change — user keeps old permissions until cache expires (5 min) | ⚠️ Deferred | Add cache invalidation on `PUT /admin/users/:id/role` |

---

## Phase 2 — Security Hardening (Issues #23, #29, #57) — 2026-07

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B059 | Critical | OAuth | JWT-in-URL: Google OAuth login redirected to `?google_login_token=<30d-JWT>` — token exposed in browser history, server logs, Referer headers | ✅ Fixed | One-time exchange code pattern — see B013 / security doc §6 |
| B060 | High | Security | No global API rate limiting — scrapers / spammers could hammer any endpoint | ✅ Fixed | Added `globalApiLimiter` (300/15min) + `authLimiter` + `authSlowDown` via `middleware/security.js` |
| B061 | High | Security | No XSS body sanitization — `<script>` tags / `on*=` attrs could be stored via contact notes / names | ✅ Fixed | Added `bodySanitizer` middleware globally |
| B062 | High | Security | Raw `err.message` returned to clients on unhandled errors — leaked stack traces, file paths, SQL errors | ✅ Fixed | Added `safeErrorHandler` middleware; returns generic 500 message to client |
| B063 | Medium | Security | No HTTP security headers (X-Frame-Options, CSP, HSTS, etc.) | ✅ Fixed | Added `helmet` with CSP directives in index.js |
| B064 | Medium | Security | `trust proxy` not set — rate limiter used wrong IP behind nginx/Docker | ✅ Fixed | Added `app.set('trust proxy', 1)` |
| B065 | Medium | Forms | ApifySettingsModal: `parseInt('')` returned `NaN` for maxPosts field — stored NaN in settings | ✅ Fixed | Guard: `e.target.value === '' ? '' : parseInt(e.target.value, 10)` |
| B066 | Medium | Forms | No input validation on 13+ frontend components — forms would submit with empty required fields, invalid URLs, invalid emails | ✅ Fixed | Added validation to: ContactForm, SmtpSettingsModal, ApifySettingsModal, TemplatesPage, JobAnalyzer, BulkJobAnalyzer, ProfilePage (3 tabs), ReminderModal, ComposeModal, AskReferral, EarlyAccessBanner |
| B067 | UX | Navigation | Plans page not discoverable — "💎 Plans" button only appeared inside Contacts sub-tab (buried) | ✅ Fixed | Moved to always-visible main navigation tab bar |

---

## Phase 3 — Database & Scraper Fixes (2026-06 to 2026-07)

| ID | Severity | Feature | Description | Status | Fix |
|---|---|---|---|---|---|
| B068 | High | Scraped Jobs | `scraped_at` column was written in ISO 8601 (`YYYY-MM-DDTHH:MM:SS.mmmZ`) format while date-range filters compared as plain text — mismatch broke lexicographic ordering and hid current jobs | ✅ Fixed | Normalized at write time in routes/scraper.js; one-time migration backfill for existing rows via `to_char(scraped_at::timestamptz, ...)` |
| B069 | High | Scraped Jobs | `since` filter used `created_at` column instead of `scraped_at` — wrong date field for recency check | ✅ Fixed | Changed filter to use `scraped_at` |
| B070 | Medium | DB | No indexes on high-traffic columns: `email_log(sent_at/contact_id/user_id)`, `contacts(status/company)`, `notifications(user_id)`, `scraped_jobs(created_at/category/scraped_at)` | ✅ Fixed | Added 8 indexes in database.js initialize() |
| B071 | Medium | DB | `leads.email` had no UNIQUE constraint — duplicate waitlist signups silently accepted | ✅ Fixed | Added `CREATE UNIQUE INDEX idx_leads_email_unique ON leads (email)` |
| B072 | Medium | DB | `referral_requests` had no `status` column — no way to track acceptance/rejection | ✅ Fixed | Added `status TEXT NOT NULL DEFAULT 'pending'` column |
| B073 | Medium | DB | Old `UNIQUE(from_user_id, to_user_id)` constraint on referral_requests blocked multiple requests — limit now configurable | ✅ Fixed | `DROP CONSTRAINT IF EXISTS referral_requests_from_user_id_to_user_id_key` |

---

## Summary

| Severity | Total Found | Fixed | Deferred / Open |
|---|---|---|---|
| Critical | 7 | 6 | 1 (JWT_SECRET warning) |
| High | 20 | 15 | 5 |
| Medium | 22 | 18 | 4 |
| Low | 14 | 5 | 9 |
| **Total** | **63** | **44** | **19** |
