# Architecture — HR Outreach Tracker

## 1. System Overview

A personal job-search CRM. Users track HR/recruiter contacts, send templated outreach emails via Gmail OAuth, scrape LinkedIn hiring posts, analyze job descriptions for ATS fit, and store resume versions.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React 18 SPA — port 5173)                             │
│  Vite + Tailwind + react-hot-toast                              │
│  Auth: localStorage hr_token + axios interceptor                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS / CORS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express API (Node 20 — port 3001)                              │
│  helmet + CORS + cookie-parser + express-rate-limit             │
│  JWT (Authorization: Bearer) + httpOnly hr_session cookie       │
│  bodySanitizer (XSS) + safeErrorHandler                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ pg.Pool
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL 16 (Supabase hosted / local / Docker)               │
│  All date cols stored as TEXT 'YYYY-MM-DD HH:MM:SS' UTC         │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Deployment Topology

| Environment | Frontend | Backend | Database |
|---|---|---|---|
| Production | Vercel (SPA) | Render (Node 20) | Supabase PostgreSQL |
| Local dev | `npm run dev` port 5173 | `npm run dev` port 3001 | Local postgres or Docker |
| Docker | nginx on :5173 | node src/index.js | postgres:16-alpine named volume `pgdata` |

**Key env vars** (see `backend/.env.example`):
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — HMAC secret for session tokens (must be set; falls back to insecure hardcoded value)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — Gmail OAuth
- `OAUTH_TOKEN_ENCRYPTION_KEY` — 32-byte hex, AES-256-GCM key for refresh token at-rest encryption
- `FRONTEND_URL` — comma-separated CORS origins
- `APIFY_TOKEN` — Apify cloud actor token (optional)

## 3. Backend Structure

### Entry Point — `src/index.js`

`main()` runs sequentially:
1. Creates `uploads/` directory
2. `await database.initialize()` — DDL, migrations, RBAC seed
3. Wires permission cache to live DB
4. Requires all routers (they must not be required before this)
5. Mounts security middleware: helmet, trust proxy, globalApiLimiter, bodySanitizer
6. Mounts all routes under `/api/*`
7. Attaches `safeErrorHandler`
8. `app.listen()`
9. Registers background intervals (see §6)

### Route Map

| Mount | File | Auth required |
|---|---|---|
| `/api/auth` | `routes/auth.js` | No (login/register); `requireAuth` on `/me`, `/change-password` |
| `/api/oauth` | `routes/oauth.js` | Mixed (`/exchange` — none; `/start` — auth; `/status` — auth) |
| `/api/contacts` | `routes/contacts.js` | `requireAuth` all |
| `/api/email` | `routes/email.js` | `requireAuth` all |
| `/api/email-templates` | `routes/emailTemplates.js` | `requireAuth` all |
| `/api/email-verify` | `routes/emailVerify.js` | `requireAuth` all |
| `/api/settings` | `routes/settings.js` | `requireAuth` all |
| `/api/stats` | `routes/stats.js` | `requireAuth` all |
| `/api/jobs` | `routes/jobs.js` | No auth (job description scrape is public) |
| `/api/profile` | `routes/profile.js` | `requireAuth` all |
| `/api/leads` | `routes/leads.js` | Public POST; `requireAuth + requireAdmin` for all others |
| `/api/apify` | `routes/apify.js` | Mixed (`softAuth` on GET feed; `requireAdmin` on scrape trigger) |
| `/api/notifications` | `routes/notifications.js` | `requireAuth` all |
| `/api/reminder` | `routes/reminder.js` | `requireAuth` all |
| `/api/rate-limit` | `routes/rateLimitStatus.js` | `requireAuth` |
| `/api/vault` | `routes/vault.js` | `requireAuth` all |
| `/api/rbac` | `routes/rbac.js` | `requireAuth + requireAdmin` all |
| `/api/scraper` | `routes/scraper.js` | `requireAuth + requireAdmin` all |
| `/api/scraped-jobs` | `routes/scraped-jobs.js` | `requireAuth` all |
| `/api/gmail` | `routes/gmail.js` | `requireAuth` all |
| `/api/github-backup` | `routes/github-backup.js` | `requireAuth + requireAdmin` all |
| `/api/referrals` | `routes/referrals.js` | `requireAuth` all |
| `/api/resume-versions` | `routes/resume-versions.js` | `requireAuth` all |
| `/api/linkedin-feed` | `routes/linkedin-feed.js` | `requireAuth` all |
| `/api/delivery` | `routes/delivery.js` | `requireAuth` all |
| `/api/admin` | `routes/admin.js` | `requireAuth + requireAdmin` all |
| `/api/health` | inline | None |

### Middleware Stack (per request)

```
Request
  → helmet (security headers)
  → cors (origin whitelist)
  → cookieParser
  → express.json / urlencoded (2MB limit)
  → globalApiLimiter (300 req/15min per IP)
  → bodySanitizer (strip <script>, on*=, javascript:)
  → [route-specific limiters: authLimiter, scrapeLimiter, leadLimiter]
  → [requireAuth → requireAdmin] (route-dependent)
  → route handler
  → safeErrorHandler (never leaks stack/internal messages)
```

### Auth Middleware — `middleware/auth.js`

- **`requireAuth`**: Checks `Authorization: Bearer <jwt>` header first, falls back to `hr_session` httpOnly cookie. Decodes JWT, verifies `userId` exists in DB, attaches `req.user = { userId, role, plan }`.
- **`requireAdmin`**: Checks `req.user.role === 'admin'` after `requireAuth`.
- **`setPermCacheDb(db)`**: Wires DB for permission cache lookups.
- Permission cache is an in-memory Map (TTL 5 min) keyed by `userId`, holds the user's resolved permissions set.

### Security Middleware — `middleware/security.js`

| Export | Config |
|---|---|
| `globalApiLimiter` | 300 req / 15 min per IP on all `/api` routes |
| `authLimiter` | 10 req / 15 min per IP (login + register) |
| `authSlowDown` | +500ms delay after 5 attempts, max 5s (express-slow-down) |
| `scrapeLimiter` | 20 req / hr per IP (job description scrape) |
| `leadLimiter` | 5 req / hr per IP (public early-access form) |
| `bodySanitizer` | Strips `<script>`, `on*=` attributes, `javascript:` from all string fields in `req.body` |
| `safeErrorHandler` | Logs full error server-side; sends only `{ error: 'Internal server error' }` to client |

## 4. Frontend Structure

### Entry — `main.jsx`

Wraps `<App />` in `<AuthProvider>` (JWT validation on load) and `<Toaster>` (react-hot-toast).

### `App.jsx` (~20KB)

Single-file state machine for the SPA. Holds:
- Active tab state (Contacts, LinkedIn Feed, Jobs, Profile, Referrals, Admin…)
- Contact list, pagination, filter state
- Modal open/close state for Compose, Import, SMTP Settings, Apify, Templates, Reminder, Plans
- `handleSend`, `handleDelete`, `handleBulkSend` functions passed down as props

No React Router — view switching is purely conditional rendering of feature components.

### `api/client.js`

Exports:
- `API_ROOT` = `VITE_API_URL` env var || `http://localhost:3001`
- Default axios instance: `baseURL: ${API_ROOT}/api`, request interceptor attaches `Authorization: Bearer ${localStorage.hr_token}`
- `invalidateCache()` — clears any stale cached responses on logout

### `contexts/AuthContext.jsx`

Manages the session lifecycle:
- On mount: validates `hr_token` via `GET /auth/me`; rolls a fresh token if server returns `_token`
- Detects `?google_login_code=CODE` in URL (Google OAuth redirect), strips it from URL, POSTs to `/api/oauth/exchange` to get a real JWT
- Cross-tab sync via `window.addEventListener('storage')`
- Background poll (30s) refreshes token while user is active
- `hr-session-expired` custom event triggers logout on any 401

### Component Map (flat `components/` directory)

| Component | Purpose |
|---|---|
| `AuthModal` | Login / register form |
| `ContactTable` | Main contacts CRUD table |
| `ContactForm` | Add/edit contact modal (with inline validation) |
| `ComposeModal` | Single + bulk email compose (with subject/body validation) |
| `SmtpSettingsModal` | SMTP config + Google OAuth connect card |
| `ApifySettingsModal` | Apify API key + search queries + max posts |
| `TemplatesPage` | Email template CRUD |
| `LinkedInPosts` | LinkedIn / Apify post feed with filter, bulk email |
| `FeedContactsPanel` | HR contacts extracted from LinkedIn feed |
| `JobScraperSection` | Job scraper (multi-source) with SSE progress stream |
| `JobAnalyzer` | Single job URL → ATS keyword analysis |
| `BulkJobAnalyzer` | Multi-URL batch job analysis |
| `ProfilePage` | 5-tab profile editor (Overview, Skills, Links, Resume, Score) |
| `ResumePreview` | Resume template renderer |
| `ResumeTemplateModal` | Select and apply ATS resume templates |
| `AdminPanel` | User management, leads Kanban, backup, purge, RBAC |
| `ReminderModal` | Daily reminder email scheduler |
| `PlansModal` | Subscription plan cards |
| `PasswordVault` | AES-256 encrypted credential store |
| `RolesPermissions` | RBAC role/permission editor |
| `GmailConnectCard` | Gmail OAuth connect status |
| `GmailEmailList` | Sent email tracking from Gmail |
| `AskReferral` | Community peer referral request flow |
| `Dashboard` | Stats, activity calendar, checklist |
| `NotificationPanel` | In-app notification drawer |
| `EarlyAccessBanner` | Public waitlist / early-access sign-up |

## 5. Database Layer

### `db/database.js` — SQLite-compatible API over `pg`

Exposes a Proxy with `prepare(sql).run/.get/.all` and `exec(sql)` — all async/Promise-based. Auto-translates `?` placeholders to Postgres `$1, $2, …`. All route files use `await` on every DB call.

**Important:** All date/time columns are `TEXT` in `'YYYY-MM-DD HH:MM:SS'` UTC format (not `TIMESTAMPTZ`), matching what SQLite's `datetime('now')` produced. Postgres column defaults use `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`. Route code computes "now" in JS: `new Date().toISOString().replace('T',' ').slice(0,19)`.

### Schema — 20 Tables

See `03_DATABASE.md` for full schema details.

### Migration Pattern

All migrations are append-only in `database.js::initialize()` as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (checked via `information_schema.columns` to skip if present). There is no migration framework. To add a column: append an `addCol(table, col, definition)` call.

## 6. Background Jobs (in `src/index.js`)

| Job | Interval | Description |
|---|---|---|
| Daily scrape prefetch | Every 5min (fires at 7 AM IST) | Runs linkedin-jobs, naukri, foundit, internshala, instahyre, remote boards, jora, linkedin-feed scrapers sequentially. Marks done with a `scrape_done_YYYY-MM-DD` settings key to prevent re-runs. |
| Reminder email scheduler | Every 1 min | Reads `reminder_*` settings rows, checks configured time/day against wall-clock time, sends via per-user Gmail transport. Dedupes via `reminder_email_sent_<userId>_<date>` key. |
| Email domain verification | Startup +15s, then every 24h | Verifies `pending`/`unverifiable`/stale contact emails via MX/A record DNS lookup. Updates `contacts.email_verified`. |
| Data purge + GitHub backup | Startup +30s, then every 24h | Deletes `scraped_jobs` older than retention window. Pushes daily JSON snapshot to configured GitHub repo. |

## 7. Email Transport — `services/mailTransport.js`

`getTransportForUser(userId)` is the single decision point for how mail is sent:

1. Checks `oauth_accounts` for a connected Gmail (provider = `'google'`)
2. If found: decrypts refresh token (AES-256-GCM via `tokenCrypto.js`), creates nodemailer transport with OAuth2
3. Falls back to global `settings.smtp_config` row (legacy SMTP — App Password etc.)

Both `routes/email.js` and `routes/reminder.js` call this function — never build their own transport.

## 8. Scraper Architecture

Scrapers live in `src/scrapers/`. They are invoked headlessly from `routes/scraper.js::runScraperHeadless()`.

| Scraper | Tech | Category |
|---|---|---|
| `linkedin-jobs.js` | Playwright (headless) | general |
| `naukri.js` | Playwright (headless) | general |
| `foundit.js` | Playwright (headless, Akamai bypass) | general |
| `internshala.js` | Plain HTTP (SSR HTML) | general |
| `instahyre.js` | Public API | general |
| `general.js` | Axios / RSS | remote (arbeitnow, remoteok, weworkremotely, remotive) |
| `jora.js` | Playwright (headless) | international (6 countries) |
| `linkedin-feed.js` | Multi-source (LinkedIn/Twitter/Telegram) | linkedin-feed |

Job data is stored in `scraped_jobs` with `job_category` tagging. Old records are purged after the configured retention period (default 30 days).
