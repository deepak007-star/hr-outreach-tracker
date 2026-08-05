# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal job-search CRM: tracks HR/recruiter contacts, imports/exports them to a colour-coded Excel file, sends templated outreach emails over SMTP, scrapes LinkedIn hiring posts via Apify, and includes resume/profile tooling (ATS scoring, resume templates, job analysis). Multi-user with JWT auth; the first registered user is auto-promoted to `admin`.

A fully automated **Job Intel Pipeline** runs on a configurable schedule to actively scrape LinkedIn hiring posts across multiple search engines (DDG, Google, Bing, Brave, Yahoo), extract HR email addresses from job postings, and sync them directly into the admin's Contacts page. The pipeline has a built-in anti-bot layer: UA rotation, viewport randomisation, WebDriver masking, per-engine CAPTCHA detection with automatic engine-skip, and optional proxy/IP rotation configured through the Admin Panel.

Two independently run apps:
- `backend/` — Express API on port 3001
- `frontend/` — React 18 + Vite + Tailwind SPA on port 5173

See `USER_GUIDE.md` for the end-user-facing feature walkthrough (contact table, compose/send flow, SMTP settings, status workflow).

## Commands

Run both together (Windows, opens two terminal windows):
```
start.bat
```

Or individually:
```
cd backend && npm run dev     # nodemon, port 3001
cd frontend && npm run dev    # vite, port 5173
```

Frontend build/preview:
```
cd frontend && npm run build
cd frontend && npm run preview
```

There is no test suite and no lint script configured in either package.json — don't assume `npm test` or `npm run lint` exist.

### Docker

`docker-compose.yml` at the repo root runs three services: `postgres` (postgres:16-alpine, named volume `pgdata`), `backend` (node:20-alpine running `node src/index.js`), and `frontend` (multi-stage build served by nginx on 5173). Backend `data/` and `uploads/` are bind-mounted from the host so the Excel export and uploaded files persist across container rebuilds; the database itself persists in the `pgdata` volume.

```
docker compose up --build -d
docker compose down
docker logs hr-outreach-backend -f
```

## Architecture

### Database: Postgres via `pg`

`backend/src/db/database.js` uses **node-postgres** (`pg.Pool`), wrapped in a thin proxy exposing an async version of the better-sqlite3-style API: `db.prepare(sql).run()/.get()/.all()` all return Promises — **every call site must `await` them**. The wrapper auto-translates `?` placeholders to Postgres's `$1, $2, …` positional syntax, so query text in route files still uses `?`. `db.exec(sql)` runs raw (unparameterized) SQL, including multi-statement DDL. `require('../db/database')` returns a Proxy that throws `'Database not initialised yet'` if accessed before `database.initialize()` resolves in `index.js`'s `main()`. All routes are required *after* `await database.initialize()` for this reason — keep new routes' requires inside `main()` too, not at module top-level.

Connection comes from `DATABASE_URL` (see `backend/.env.example`), falling back to `postgres://postgres:postgres@localhost:5432/hr_outreach_tracker` for local dev. `docker-compose.yml` runs a `postgres:16-alpine` service and wires `DATABASE_URL` for the `backend` container automatically.

Schema lives entirely in `database.js` as `CREATE TABLE IF NOT EXISTS` + a growing list of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations (no migration framework, no try/catch needed since Postgres supports `IF NOT EXISTS` natively). To add a column, append another `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` there rather than editing the `CREATE TABLE`.

Date/time columns (`date_added`, `sent_at`, `created_at`, etc.) stay `TEXT` in the `'YYYY-MM-DD HH:MM:SS'` UTC format SQLite's `datetime('now')` used to produce — table defaults use `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`, and route code that needs "now" or a relative cutoff computes it in JS (`new Date().toISOString().replace('T',' ').slice(0,19)`) and passes it as a bound parameter, rather than relying on Postgres-side date functions. This was a deliberate choice to avoid `pg` handing back `Date` objects (which would break the string slicing/comparison several routes and `excelSync.js` do on these columns) — don't switch these columns to `TIMESTAMPTZ` without checking every consumer first.

`INSERT OR REPLACE` / `INSERT OR IGNORE` (SQLite-only) are gone — use `INSERT ... ON CONFLICT (col) DO UPDATE SET ...` / `ON CONFLICT DO NOTHING` instead. Unique-constraint violations surface as `err.code === '23505'` (Postgres), not the old `err.message.includes('UNIQUE constraint failed')` check. `LIKE` in user-facing search filters was changed to `ILIKE` to preserve SQLite's case-insensitive-by-default matching.

Tables: `contacts`, `email_log`, `settings` (key/value store — see **Settings keys** below), `users`, `notifications`, `linkedin_posts`, `email_templates`, `leads` (early-access/waitlist signups), `profiles` (resume/profile data, one row per user), `scraped_jobs` (raw output from all scrapers, keyed by SHA-256 of title+company), `job_postings` (normalised/deduped records fed into the pipeline, owned by the orchestrator), `pipeline_runs` (one row per pipeline execution with status + counters), `oauth_accounts` (one row per user+provider, stores encrypted refresh tokens for per-user Gmail OAuth2), `resume_versions` (vault of uploaded resume files per user), `resume_files` (original uploaded resume **bytes** stored as `BYTEA`, referenced by `profiles.resume_file_id` and `resume_versions.file_id` — see **Resume file storage** below).

**Settings keys** (stored in the `settings` key/value table, written and read by backend routes):

| Key | Who writes it | What it holds |
|---|---|---|
| `smtp_config` | Settings modal | JSON: SMTP host/port/user/pass/name + daily cap |
| `daily_send_cap` | Settings modal | Integer string |
| `apify_api_key` / `apify_queries` / `apify_last_scrape` | Apify modal | Apify credentials + last-run timestamp |
| `groq_api_key` / `groq_model` | VartaBot config | Groq API key + model ID |
| `reminder_<userId>` | Reminder scheduler | JSON: send time, days, template |
| `reminder_email_sent_<userId>_<YYYY-MM-DD>` | Reminder scheduler | Dedup sentinel; deleted when user deleted |
| `job_intel_config` | Job Intel config panel | Full pipeline config JSON (see `DEFAULT_CONFIG` in orchestrator.js) |
| `proxy_list` | Job Intel proxy panel | Newline-separated proxy URLs (`http://` or `socks5://`) — the **manual** pool |
| `proxy_auto_config` | Admin auto-proxy panel | JSON: `{enabled, sources, webshareApiKey, maxCandidates, concurrency, refreshIntervalMin}` for the auto proxy fetcher (`services/proxyFetcher.js`) |
| `proxy_auto_cache` | `proxyFetcher.refresh` (auto) | JSON: `{ts, proxies: [validated urls], stats}` — free proxies fetched from providers + validated; merged with `proxy_list` by the orchestrator |
| `antibot_status` | Orchestrator (auto) | JSON: `{ts, status: 'ok'\|'low_yield'\|'proxy_pool_dead', freshlyScraped, …}` — written after every scrape |
| `purge_config` | Admin panel | JSON: auto-purge rules |
| `unsubscribe_footer_text` | Settings modal | Plain text appended to every outbound email |

The Excel file at `backend/data/HR_Outreach_Tracker.xlsx` is a derived artifact, not a data source — `backend/src/services/excelSync.js` regenerates it wholesale from the `contacts` table (via ExcelJS, with per-status row fills matching the UI's status colours) after every mutating contacts endpoint. Call `syncExcel()` after any contacts write path.

### Backend structure

`backend/src/index.js` is the composition root: creates the uploads dir, awaits DB init, then requires and mounts all routers under `/api/*`. It also owns four `setInterval` background jobs started at the bottom of `main()`:
- Hourly: auto-scrape LinkedIn via Apify if `apify_last_scrape` setting is >23h old and Apify credentials/queries are configured (`routes/apify.js`'s `performScrape`).
- Every minute: reminder-email scheduler — reads all `reminder_*` settings rows, compares configured send time/days against "now," dedupes via a `reminder_email_sent_<userId>_<date>` settings key.
- Startup (+15s) then every 24h: re-verifies `pending`/`unverifiable`/stale contact emails via `checkEmailDomain` (`routes/emailVerify.js`).
- Startup (+45s) then every 24h: `syncJobIntelContacts()` — ensures any HR contacts already in `job_postings` (from previous pipeline runs) are reflected in the admin's Contacts page even when the pipeline is disabled or between scheduled runs.

Auth (`middleware/auth.js`): JWT-based, `requireAuth`/`requireAdmin` middleware; secret is `process.env.JWT_SECRET` with a hardcoded local fallback — set `JWT_SECRET` for anything beyond local use. `routes/apify.js` also has its own `softAuth` (validates token if present, never blocks) for endpoints that vary behavior by auth without requiring it.

Rate limiting (`middleware/rateLimiter.js`): in-memory sliding-window limiter (email sends, job applications), keyed by `userId` (or IP if unauthenticated), resets on server restart by design — not for cross-process/production use.

Routes map roughly 1:1 to concerns: `contacts` (CRUD + CSV/Excel import/export), `email` (compose/preview/send with the 14-day duplicate-send guard and bounce → Do-Not-Contact logic; every route requires auth), `settings` (global SMTP config + proxy list — see ALLOWED_SETTINGS_KEYS allowlist), `oauth` (per-user Google OAuth2 connect/disconnect, see below), `stats`, `jobs`/`leads` (job-posting analysis, waitlist leads), `auth`/`profile` (user account + resume/profile data), `apify` (LinkedIn scrape config + trigger), `notifications`, `reminder`, `rateLimitStatus`, `emailTemplates`, `emailVerify` (domain-level email validity checks), `admin` (admin-only views, gated by `requireAdmin`), `scraper` (runs any configured scraper as a child process via SSE or headlessly; exports `runScraperHeadless(scraper, body, onLog, extraEnv)`), `scraped-jobs` (browse/search/purge the `scraped_jobs` table; feed-contacts panel + bulk email sending), `job-intelligence` (Job Intel pipeline config + manual trigger endpoints).

### Job Intel Pipeline

The pipeline lives in `backend/src/agents/` and runs on a configurable schedule (default: every 6 hours, controlled via Admin Panel → Job Intel Pipeline). `runPipeline()` in `orchestrator.js` is the single entry point; it is safe to call concurrently (no-ops if already running). Each run writes a row to `pipeline_runs`.

**Pipeline stages (in order):**

**Stage 0a — Proxy pool setup** (`orchestrator.js`)
Reads the `proxy_list` settings key (newline-separated `http://` or `socks5://` proxy URLs). Calls `proxyRotator.loadFromString()` then `proxyRotator.healthCheckAll()` (TCP health check, 8s timeout) to mark dead proxies. If any proxies are alive, sets `PROXY_URL` (next round-robin pick) and `PROXY_URLS` (full comma-separated pool) in `scraperExtraEnv` to be passed to the scraper child process. On all-dead, writes `antibot_status = proxy_pool_dead` to settings. No proxies configured = scrapes direct (all stealth features still active).

**Stage 0b — Live LinkedIn Feed scrape** (`scrapers/linkedin-feed.js` via `runScraperHeadless`)
Spawns `linkedin-feed.js` as a child process with the configured keywords (merged from pipeline config + Apify search queries, capped at 15) and `limit: 100`. The child receives `PROXY_URL`/`PROXY_URLS` in its env. The scraper itself has a 7-phase engine cascade:

```
Phase 1: DuckDuckGo  — site:linkedin.com/posts "hiring" queries (primary; most bot-tolerant)
Phase 2: Google      — same queries (blocks by IP; skipped if already blocked)
Phase 3: Bing        — bing.com/search?q=... count=50 (good fallback)
Phase 4: Brave       — search.brave.com (privacy-first; rarely blocks scrapers)
Phase 5: Yahoo       — search.yahoo.com (last resort; handles redirect URL format)
Phase 6: DDG Twitter/Telegram — site:twitter.com OR site:t.me hiring queries
Phase 7: Broad pass  — DDG + Bing + Brave without site: filter, catches indirect mentions
```

Each phase:
1. Navigates to the search engine with a randomised User-Agent (pool of 14) and viewport (pool of 6)
2. Calls `detectBotChallenge(page)` — checks URL patterns, DOM selectors (16), and body text (16 patterns) for block indicators
3. On detection: calls `engineState.markBlocked(engine, cooldownMs)` and skips to the next phase
4. On success: extracts LinkedIn post URLs, calls `engineState.markSuccess(engine)`

Anti-bot hardening applied to every browser launch:
- `--proxy-server=$PROXY_URL` when a proxy is configured
- `page.setUserAgent(randomUA())` — rotated from a pool of 14 real desktop UAs
- `page.setViewportSize(randomVP())` — 6 realistic desktop/laptop resolutions
- Init script executed before page JS: masks `navigator.webdriver`, `window.chrome`, `navigator.plugins`, `navigator.languages`, `navigator.platform`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`, and `Notification.requestPermission`
- Extra HTTP headers: `Accept-Language`, `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`
- Tries real installed browsers (`msedge`, `chrome`) before falling back to bundled Chromium
- Exponential back-off + jitter between retries on block detection

**Stage 0c — Anti-bot quality audit** (`orchestrator.js`)
After the scrape returns, compares `freshlyScraped` against `min(keywords × 2, 10)` as a conservative expected-minimum. Low yield writes `antibot_status = low_yield` to settings (visible as an amber badge in the Admin Panel). A healthy run writes `antibot_status = ok` (green badge) and clears any prior warning.

**Stage 1 — Ingestion** (`agents/ingestion/index.js`)
Pulls from all configured sources in parallel: internal `scraped_jobs` table (filtered to posts after `pipeline_scrape_start`), Arbeitnow, RemoteOK, We Work Remotely, Remotive, Greenhouse per-company boards, Lever per-company boards, Adzuna (if key configured), Jooble (if key configured). Returns a flat array of raw job objects + per-source stats.

**Stage 2 — Normalization** (`agents/normalization.js`)
Standardises field names, trims whitespace, normalises date formats, generates a stable `external_id` per posting.

**Stage 3 — Deduplication** (`agents/deduplication.js`)
Checks `job_postings` table for existing `external_id`s; splits into `unique` (never seen) and duplicates. Returns `{ unique, duplicateCount }`.

**Stage 4 — Extract → Store** (loop in `orchestrator.js`)
For each unique posting: calls `extractFromJob(job)` (`agents/extraction.js`) which regex-scans title, company, description, and apply URL for email addresses and contact names. If no email is found, the posting is skipped (not stored). Optional LLM classification via Groq (`agents/classification.js`) is off by default (`cfg.classify = false`) — enable via Admin Panel. Passes QA check (`agents/qa.js`) then `storeJob(job)` (`agents/storage.js`) upserts into `job_postings`.

**Stage 5 — Pipeline run record update** (`orchestrator.js`)
Updates `pipeline_runs` row with `status = 'success'`, counters, and error map.

**Stage 6 — Contact sync** (`syncJobIntelContacts()` in `orchestrator.js`)
For every `job_postings` row with a non-empty `extracted_emails`, upserts into the admin user's `contacts` table. Uses `ON CONFLICT (email, user_id) DO UPDATE … CASE WHEN email_source = 'job-intel'` — manually-added contacts are never overwritten. Returns count of truly new rows. Writes a notification to the `notifications` table.

**Supporting library files:**

`backend/src/lib/proxyRotator.js` — Singleton proxy pool (exported as `module.exports = new ProxyRotator()`). Round-robin selection over alive proxies. TCP health-check via `net.createConnection`. Tracks per-proxy failure count; marks dead after 3 failures; auto-resets all when all are dead. `toCsvEnv()` serialises the pool for child process env injection. `loadFromEnv()` reconstructs the pool from `PROXY_URLS` env var (used by the scraper child process itself, not the orchestrator).

`backend/src/lib/captchaDetector.js` — Exports `detectBotChallenge(page)` and `EngineState` class.
- `detectBotChallenge`: Three-tier check — (1) URL pattern match (7 patterns: Google sorry, Bing redirect, LinkedIn authwall/checkpoint/login, DDoS-Guard), (2) DOM selector match (16 selectors across Google, DDG, Cloudflare, LinkedIn, Bing, Brave), (3) body text pattern match (16 regexes). Returns `{detected, type, engine, message}`.
- `EngineState`: Per-run tracker of which search engines are blocked and their cooldown expiry. `markBlocked(engine, cooldownMs)` / `markSuccess(engine)` / `isBlocked(engine)` (auto-unblocks on expiry) / `summary()` (logged at end of scrape run).

### Outreach email sending: per-user Google OAuth2, with legacy SMTP fallback

Each user connects their own Gmail via OAuth2 instead of pasting a Gmail App Password. `backend/src/services/mailTransport.js`'s `getTransportForUser(userId)` is the single place that decides how to send: it checks `oauth_accounts` (one row per `user_id` + `provider`, currently only `'google'`) for a connected Gmail account first, and falls back to the old global `settings.smtp_config` row if the user hasn't connected one — `email.js` and `reminder.js` both go through this helper rather than building their own transport. Refresh tokens are encrypted at rest (`backend/src/services/tokenCrypto.js`, AES-256-GCM, key from `OAUTH_TOKEN_ENCRYPTION_KEY`) since they're long-lived credentials capable of sending mail indefinitely.

`backend/src/routes/oauth.js` implements the flow: `GET /google/start` (authenticated) returns a Google consent URL built with a short-lived (5 min) signed JWT as `state` — deliberately not the user's real session token, to avoid a 30-day credential ever touching a URL/redirect chain/server log. `GET /google/callback` (no auth — Google redirects the browser here directly) verifies `state`, exchanges the code, and upserts into `oauth_accounts`. Requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (from a Google Cloud Console OAuth Client) and `OAUTH_TOKEN_ENCRYPTION_KEY` (32-byte hex). The `gmail.send` scope is a Google "restricted" scope — works immediately for up to 100 test users added in the OAuth consent screen's Testing mode; going fully public requires Google's verification/CASA review.

Outlook/Microsoft isn't implemented yet but the `oauth_accounts` table and `mailTransport.js` pattern are provider-agnostic — a second provider would add its own `routes/oauth.js` start/callback pair and a branch in `getTransportForUser`.

### Frontend structure

Single-page app, no router — `App.jsx` (~20KB) holds most of the dashboard state and view-switching logic directly; `AuthProvider` (`contexts/AuthContext.jsx`) wraps the whole app in `main.jsx` and validates the stored JWT (`localStorage['hr_token']`) against `GET /auth/me` on load.

`api/client.js` exports `API_ROOT` (`import.meta.env.VITE_API_URL`, falling back to `http://localhost:3001` for local dev) and a single axios instance with `baseURL: ${API_ROOT}/api`, plus a request interceptor that attaches `Authorization: Bearer <hr_token>`. A couple of components (`App.jsx`, `ImportModal.jsx`) also hit the backend directly via `window.open`/`fetch` for file export/import rather than going through the axios client — they import `API_ROOT` from `api/client.js` rather than hardcoding a URL, so set `VITE_API_URL` (a build-time env var) rather than editing source when deploying against a different backend host.

`components/` is a flat directory of feature components (no nesting by domain) — dashboard/table/modals alongside resume/ATS tooling (`ResumePreview`, `ResumeTemplateModal`, `atsUtils.js`, `resumeUtils.js`) and LinkedIn/job-post features (`LinkedInPosts`, `JobAnalyzer`, `BulkJobAnalyzer`).

### Resume file storage

Original uploaded resume **bytes** live in the `resume_files` table (Postgres `BYTEA`), not on the container's local disk. This is deliberate: earlier the file path (`profiles.resume_file_path` / `resume_versions.file_path`, pointing at `/app/uploads/resumes/...`) was stored while the bytes sat on the backend's local disk — which gets wiped on every redeploy/ephemeral-host restart. The DB row survived with a dangling path, so `fs.existsSync()` was false everywhere and every preview/attachment silently fell back to the raw pdf-parse text. Storing the bytes in the DB (which is remote/persistent) makes previews and email attachments show the original file wherever the DB is reachable.

`backend/src/services/resumeFiles.js` is the single interface: `putResumeFile(userId, buffer, mime, filename)` → new `file_id`, `getResumeFile(fileId, userId)` → `{data: Buffer, mime_type, filename}`, `copyResumeFile` (used when saving the profile resume into the vault so each version owns an independent copy), `deleteResumeFile`. `profiles.resume_file_id` and `resume_versions.file_id` reference `resume_files.id`; `resume_files.user_id` is `ON DELETE CASCADE` so user deletion frees the bytes, and vault-version delete/prune frees them explicitly. All read paths (`profile.js` `GET /resume/file`, `resume-versions.js` `GET /:id/file`, and the email attachment resolvers in `email.js` + `scraped-jobs.js`) **prefer DB bytes, then fall back to the legacy disk path, then to `.txt` from `resume_text`.** Legacy rows uploaded before this change (bytes already lost on a wiped disk) have no `file_id` and can only ever preview as text until re-uploaded. The local-disk copy is still written as a best-effort cache but is no longer the source of truth.

### Resume tooling

`frontend/src/utils/resumeUtils.js` is the single source of truth for resume text manipulation:

- `normalizeResumeText(raw)` — Call this on any PDF-extracted text before passing to `modifyResume` or rendering. `pdf-parse` inserts artificial line breaks at visual PDF column boundaries, splitting single skill entries like `"Languages & Backend: Java 8/21, WebFlux /"` across 3 lines. `normalizeResumeText` rejoins continuation lines heuristically: if the previous line ends with `,` / `/` / `|` / `&`, or the current line starts with a lowercase letter, the lines are merged. Also drops page-number-only lines and collapses runs of blank lines to one. **Every component that loads a PDF resume must call this before storing or displaying the text** — `JobAnalyzer`, `BulkJobAnalyzer`, and `PostWorkflowModal` all do this on profile load and file upload.

- `getLineDomains(line)` — Returns a `Set` of all skill domains that apply to a resume line label (e.g. `"Languages & Backend:"` returns `{'language', 'backend'}`). Compound labels correctly map to multiple domains. Falls back to `inferDomainFromSiblings()` when the label doesn't match any keyword.

- `modifyResume(rawText, skillsToAdd)` — Calls `normalizeResumeText` internally at the top. Groups `skillsToAdd` by domain before touching any lines (one pass per domain group, not per skill). Appends skills to the best matching existing line or inserts a new labeled line. A skill is blocked from a line only when ALL of the line's domains conflict with the skill's domain.

- `scoreLineForSkill(line, skillDomain)` — Used by `modifyResume`. Returns `-1` (wrong domain), `0` (neutral/unknown), or `>0` (best match). Calls `getLineDomains` internally.

`frontend/src/components/ResumePreview.jsx` — Visual document renderer (white paper, not a monospace gray box). Classifies each line into one of: `blank`, `section` (ALL-CAPS → border + tracking), `subcategory` (`Label: rest` → bold label), `bullet`, `body`. The first non-blank line is rendered as a bold centered name. Lines carrying `[ADDED-LINE]` get a green left border; inline `[ADDED]` tokens render as green `+skill` chips.
