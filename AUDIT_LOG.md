# Audit Log — HR Outreach Tracker

---

## 2026-08-01 — LinkedIn Feed scraper crashed: "page.setUserAgent is not a function"

### BUG FIX — Puppeteer API used against a Playwright page

**Symptom:** Admin → Job Scraper (and the CLI `linkedin-feed.js`) died immediately on the first keyword with `Fatal: page.setUserAgent is not a function`.

**Cause:** `newStealthPage()` launches **Playwright** (`chromium.launch`) but configured the page with Puppeteer's `page.setUserAgent(ua)` — a method Playwright's `Page` doesn't have. In Playwright the user-agent is set on the browser **context**, not the page.

**Fix (`backend/src/scrapers/linkedin-feed.js`):** `newStealthPage()` now creates a fresh `browser.newContext({ userAgent, viewport, locale, extraHTTPHeaders })`, adds the stealth init script on the context, and opens the page from it — so each page still rotates its UA/viewport/headers. The context is torn down on `page.close()` (`page.once('close', …)`) so contexts don't accumulate across keywords/phases/retries. Verified: the scraper now runs the full DDG→Google→Bing→Brave→Yahoo cascade; UA rotation + `navigator.webdriver` masking confirmed applied.

- **Files changed:** `backend/src/scrapers/linkedin-feed.js`

---

## 2026-08-01 — Dev login bypass (skip auth, enter as admin)

### FEATURE — Toggle to disable login/signup and enter as admin

Adds a developer bypass so the whole app can be used without logging in, with full admin access and no plan restriction.

**Backend (`routes/auth.js`):**
- `DEV_BYPASS_ENABLED` flag — defaults **on when `NODE_ENV !== 'production'`**, and is forced by `DEV_LOGIN_BYPASS=true|false`. Off by default in production. Documented in `backend/.env.example`.
- `GET /api/auth/dev-status` (public) — reports whether the bypass is available, so the UI only shows the toggle when it's allowed.
- `POST /api/auth/dev-login` — gated by the flag; issues a real 30-day admin JWT (same cookie/token path as normal login). `ensureDevAdmin()` logs into the **oldest existing admin** (so real data shows) and bumps its plan to `advanced`; only creates a dedicated `dev-bypass@local.host` admin when the DB has no admin at all.

**Frontend:**
- `AuthContext` — `devBypass` state (persisted in `localStorage['hr_dev_bypass']`), `bypassAvailable` (from `/auth/dev-status`), and `enableDevBypass()`. On load, if the flag is on and there's no token, it silently calls `/auth/dev-login`. `logout()` also clears the bypass flag so signing out fully exits dev mode (no auto re-login on reload).
- `AuthModal` — amber "Developer mode → Enter" panel (shown only when available) that signs in as admin and closes the modal.
- `Header` — guest view shows a "Dev Login" button; the signed-in view shows a **DEV** pill and relabels Sign Out to **Exit Dev** while bypass is active.

**Security note:** enabling `DEV_LOGIN_BYPASS` on a public/internet-facing server grants anyone full admin access. Keep it off there (production defaults off).

- **Files changed:** `backend/src/routes/auth.js`, `backend/.env.example`, `frontend/src/contexts/AuthContext.jsx`, `frontend/src/components/AuthModal.jsx`, `frontend/src/components/Header.jsx`

---

## 2026-08-01 — Analyzer "Add to Vault" saved plain text; tab switch wiped analyzer state

### BUG FIX — Modified resume saved to vault as text-only

**Symptom:** Modifying a resume in **Resume Analyzer & Maker** (add skills / generalize) and clicking **Add to Vault** saved a text-only version, so the vault preview showed raw text instead of a formatted document. (Direct file upload to the vault already worked.)

**Cause:** `JobAnalyzer.handleSaveVault` posted `{ resumeText }` to the JSON `POST /resume-versions` endpoint with no file, so `file_id` was null → `has_file` false → text fallback.

**Fix:** The analyzer now renders the modified resume to a formatted PDF client-side and uploads it as a real file.
- `resumeUtils.js`: extracted `buildResumePdfDoc()` and added `resumeTextToPdfBlob()` (reuses the existing jsPDF layout used by the PDF download).
- `JobAnalyzer.handleSaveVault` builds the PDF Blob and POSTs it (multipart) to `/resume-versions/upload` with `label`, `targetRole`, and `skills`.
- Backend `/resume-versions/upload` + `saveVaultVersion` now accept an optional `skills` array (JSON) so the analyzer's job+resume skills are preserved for vault match-suggestions (previously the upload path always used the profile's skills).

### BUG FIX — Switching tabs cleared unsaved analyzer work

**Symptom:** Opening the Resume Vault (or any tab) from the Resume Analyzer and returning cleared all analyzer inputs/state.

**Cause:** `App.jsx` conditionally rendered each tab (`{activeTab === 'jobs' && <JobAnalyzer />}`), so leaving a tab unmounted the component and dropped its local `useState`.

**Fix:** Added a `KeepAlive` wrapper that mounts a tab on first visit and then keeps it mounted (hidden via `display:none`). Applied to the **Resume Analyzer** (`jobs`) and **Bulk Apply** (`bulk`) tabs so their unsaved work survives tab switches.

- **Files changed:** `frontend/src/utils/resumeUtils.js`, `frontend/src/components/JobAnalyzer.jsx`, `frontend/src/App.jsx`, `backend/src/routes/resume-versions.js`

**Noted follow-up (not fixed here):** editing resume text in `PostWorkflowModal` / `ResumeTemplateModal` / `TemplatesPage` saves via `PUT /profile { resume_text }` without regenerating the stored profile file, so the Profile's formatted preview can lag behind text edits until a new file is uploaded.

---

## 2026-08-01 — Resume Vault previews showed raw text instead of original file

### BUG FIX — Resume files stored on ephemeral local disk, lost on redeploy

**Symptom:** Every resume in the Resume Vault (and the Profile preview) rendered as raw pdf-parse text instead of the formatted original document.

**Root cause:** Original resume files were saved to the backend container's **local disk** (`/app/uploads/resumes/...`) while their paths were stored in the remote Supabase DB. On ephemeral/redeployed hosting the container filesystem is wiped on restart, so the bytes vanished while the DB rows survived with dangling absolute paths. `fs.existsSync(file_path)` was therefore false everywhere → `has_file: false` → the preview modal and email attachment resolvers silently fell back to extracted text. Confirmed: all 6 existing vault rows pointed at `/app/uploads/...` paths whose files no longer exist on any reachable disk.

**Fix:** Store the original bytes in Postgres so they persist with the DB.

- New `resume_files` table (`BYTEA`) + `backend/src/services/resumeFiles.js` (`putResumeFile` / `getResumeFile` / `copyResumeFile` / `deleteResumeFile`).
- New FK columns `profiles.resume_file_id` and `resume_versions.file_id`.
- All write paths (profile upload + auto-save-to-vault, vault upload, Google-Drive import, save-from-profile) now persist bytes to the DB. Save-from-profile makes an independent copy so lifecycles don't entangle.
- All read paths (`profile.js` `GET /resume/file`, `resume-versions.js` `GET /:id/file`, and the email attachment resolvers in `email.js` + `scraped-jobs.js`) prefer DB bytes → legacy disk path → `.txt` text fallback. `has_file` is now true when either DB bytes or a disk file exist. `POST /resume-versions` now returns `has_file` so freshly-saved cards preview correctly without a reload.
- Deleting/pruning a vault version and replacing the profile resume now free the old `resume_files` row; `resume_files.user_id` is `ON DELETE CASCADE`.
- **Legacy rows:** bytes were already lost with the wiped disk — those versions can only preview as text until re-uploaded.

- **Files changed:** `backend/src/db/database.js`, `backend/src/services/resumeFiles.js` (new), `backend/src/routes/profile.js`, `backend/src/routes/resume-versions.js`, `backend/src/routes/email.js`, `backend/src/routes/scraped-jobs.js`, `CLAUDE.md`

---

## 2026-07-30 — Test suite bug fixes (Commit: d576a1e)

### BUG FIX — 3 test assumption errors discovered when running against Supabase

Three bugs in the initial test suite were caught on first real run:

1. **Duplicate-register test sent no `name` field** → hit the 400 "Name is required" guard before reaching the 409 duplicate-email check. Fixed by including `name` in the second registration payload.

2. **`afterAll` / `beforeAll` cleanup violated `profiles_user_id_fkey`** — `DELETE FROM users WHERE email = ?` failed because the register route automatically creates a `profiles` row. Fixed: replaced the direct DELETE with a `cleanupTestUser()` helper that deletes `profiles`, `oauth_accounts`, `email_log`, `notifications` in dependency order before deleting the user.

3. **Contacts cleanup used wrong column name `added_by`** (does not exist; column is `user_id`). Also, `status: 'new'` was rejected by `VALID_STATUSES` which requires title-case `'New'`. Also, test contact name `'Jest Test HR'` was cleaned to `'Jest'` by `cleanContactName` (expected first-token extraction). Fixed: use `user_id`, `'New'`, and name `'Priya'`.

Additionally, `tests/setup.js` and `tests/globalSetup.js` were updated to load `backend/.env` via `dotenv` so `DATABASE_URL` falls back to Supabase when `TEST_DATABASE_URL` is not set — no local postgres installation needed for development; CI still uses the `TEST_DATABASE_URL` env var pointing to the postgres service container.

**Result: 17/17 backend tests passing against Supabase.**

- **Files changed:** `backend/tests/auth.test.js`, `backend/tests/contacts.test.js`, `backend/tests/setup.js`, `backend/tests/globalSetup.js`

---

## 2026-07-30 — Centralized logging, automated tests (Jest/Vitest), CI/CD, n8n automation (Commit: 4e7f01f)

### FEATURE — Three new systems added in a single commit

---

#### 1. Centralized Logging System

**Problem:** All server activity was `console.log`/`console.error` scattered across route files. No way to see API activity, errors, or audit what happened from the Admin Panel.

**Fix:**

- **`backend/src/lib/logger.js`** — Lightweight structured logger with zero extra npm dependencies. Writes to three sinks simultaneously:
  1. **Console** (colored, human-readable): `[ERROR]` red, `[WARN]` yellow, `[INFO]` cyan, `[DEBUG]` gray. Skipped in `NODE_ENV=test`.
  2. **Files**: `backend/logs/app.log` (all levels, JSON-lines) and `backend/logs/error.log` (errors only). Skipped in `NODE_ENV=test`.
  3. **DB `activity_logs` table** (info/warn/error, fire-and-forget — never blocks, never throws). DB sink is disabled until `logger.setDb(db)` is called after `database.initialize()`.
  - Exports: `logger.setDb(db)`, `logger.info/warn/error/debug(message, meta)`.

- **`backend/src/db/database.js`** — Added `activity_logs` table:
  ```sql
  CREATE TABLE IF NOT EXISTS activity_logs (
    id         SERIAL PRIMARY KEY,
    level      TEXT NOT NULL DEFAULT 'info',
    message    TEXT NOT NULL DEFAULT '',
    meta       TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (NOW_EXPR)
  );
  CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_logs_level      ON activity_logs (level);
  ```

- **`backend/src/middleware/requestLogger.js`** — Logs every HTTP request on `res.finish`. Skips `/api/health`. Level is `error` for 5xx, `warn` for 4xx, `info` for 2xx/3xx. Meta includes `method`, `path`, `status`, `ms`, `userId`, `ip`.

- **`backend/src/routes/logs.js`** — Admin-only log API:
  - `GET /api/admin/logs?level=error&search=auth&since=24h&limit=100&offset=0` — returns `{logs, total, limit, offset}`. `since` values: `1h`, `6h`, `24h`, `7d`. Supports `ILIKE` search on `message` and `meta`.
  - `DELETE /api/admin/logs?days=7` — purges logs older than N days.

- **`backend/src/index.js`** changes:
  - Requires `logsRouter` and `requestLogger` inside `main()`.
  - `logger.setDb(database)` called immediately after `await database.initialize()`.
  - `app.use(requestLogger)` mounted before all route middleware.
  - `app.use('/api/admin/logs', logsRouter)` mounted after all other routes.

- **`frontend/src/components/AdminPanel.jsx`** — New **System Logs** tab (10th tab, `ScrollText` icon):
  - **LogsSection** component: level filter dropdown (all/error/warn/info), time-range filter (1h/6h/24h/7d), keyword search, Refresh button, auto-refresh checkbox (10-second interval).
  - Color-coded log rows: red for error, amber for warn, blue for info.
  - HTTP request logs show inline `METHOD STATUS ms` summary without needing to expand.
  - Click to expand non-HTTP logs and show full `meta` JSON.
  - Pagination (100 per page).
  - "Clear >1d" and "Clear >7d" buttons (with confirmation prompt) call `DELETE /api/admin/logs`.

---

#### 2. Automated Testing (Jest + Vitest + GitHub Actions CI)

**Problem:** No tests existed. Every new feature risked silently breaking existing functionality (auth, contacts CRUD, resume utils) with no automated check before push.

**Fix:**

**Backend — Jest + supertest (`npm test` in `backend/`):**

- `backend/jest.config.js` — `testEnvironment: node`, `setupFiles: ['./tests/setup.js']`, `globalSetup` + `globalTeardown`, `testTimeout: 30000`.
- `backend/tests/setup.js` — Sets env vars (`NODE_ENV=test`, `DATABASE_URL` with Supabase fallback, `JWT_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY`) before any module loads. Loads `backend/.env` via dotenv so no local postgres is required.
- `backend/tests/globalSetup.js` — Calls `database.initialize()` once before all tests (creates tables if they don't exist).
- `backend/tests/helpers.js` — `buildApp(routeSetup)` builds a minimal Express app for supertest, `generateToken(payload)` and `generateAdminToken(payload)` mint signed JWTs without DB access.
- `backend/tests/health.test.js` — `GET /api/health` smoke test (1 test).
- `backend/tests/auth.test.js` — register (create + reject duplicate + reject missing password), login (valid + wrong password + unknown email), me endpoint (valid + no token + tampered token). 9 tests.
- `backend/tests/contacts.test.js` — create (with required fields + reject missing email + reject unauthenticated), list (returns array + reject unauthenticated), update status, delete. 7 tests.

**Frontend — Vitest (`npm test` in `frontend/`):**

- `frontend/vite.config.js` — Added `test: { environment: 'node', globals: true, include: ['src/**/*.test.{js,jsx}'] }`.
- `frontend/src/__tests__/resumeUtils.test.js` — Mocks `jspdf` and `docx` (browser-only deps), then tests `normalizeResumeText` (empty input, consecutive blank lines, lowercase continuation join, ALL-CAPS header not joined, page-number stripping, CRLF normalization) and `modifyResume` (no-op with empty arrays, no-op with empty text, adds to existing SKILLS section, appends new SKILLS section when none exists, marks added skills with `[ADDED]`). **11 tests**.

**CI — GitHub Actions (`.github/workflows/ci.yml`):**

Triggers on `push` to `main`/`dev` and `pull_request` to `main`. Two parallel jobs:
- `backend-tests`: `ubuntu-latest` + `postgres:16-alpine` service container with health-check. Sets `TEST_DATABASE_URL` pointing to the container. Runs `cd backend && npm ci && npm test`.
- `frontend-tests`: `ubuntu-latest`. Runs `cd frontend && npm ci && npm test`.

**Pre-push hook (`.githooks/pre-push` + `scripts/setup-hooks.js`):**

- Runs `backend/npm test` then `frontend/npm test` before every `git push`. If either fails, push is aborted with a clear message.
- `SKIP_BACKEND_TESTS=1` env var bypasses the DB-dependent backend tests (useful when pushing from a machine without network access to Supabase).
- One-time setup: `node scripts/setup-hooks.js` (sets `core.hooksPath = .githooks`).

---

#### 3. n8n Workflow Automation

**Problem:** The Job Intel pipeline, daily scraper, and health monitoring all relied on internal `setInterval` timers that restart with the server, have no dashboard, and produce no alerts on failure.

**Fix:**

- **`docker-compose.yml`** — Added `n8n` as a 4th service:
  - Image: `n8nio/n8n:latest`
  - Port: `5678` (web UI — `http://localhost:5678`)
  - Auth: HTTP Basic Auth (`admin` / `change-me-in-production`)
  - Timezone: `Asia/Kolkata` (IST, matching the existing scrape schedule)
  - Volume: `n8n_data` (persistent workflow/credential storage)
  - Read-only bind-mount: `./n8n-workflows:/opt/workflows:ro`
  - Depends on `backend`

- **`n8n-workflows/01-job-intel-pipeline.json`** — Triggers `POST /api/job-intel/run` every 6 hours. On success logs result; on failure logs error. Requires `Backend Admin Token` HTTP Header credential.

- **`n8n-workflows/02-health-monitor.json`** — Polls `GET /api/health` every 5 minutes. If response is not `{status: "ok"}`, routes to an Alert node (wire to email/Slack/Telegram for notifications).

- **`n8n-workflows/03-daily-scrape.json`** — Cron `30 1 * * *` (1:30 UTC = 7 AM IST). Triggers LinkedIn Feed scraper (`POST /api/scraper/run`), then runs the Job Intel pipeline. Logs combined result.

- **`n8n-workflows/04-log-alert.json`** — Polls `GET /api/admin/logs?level=error&since=1h` every hour. If `total > 0`, formats an error summary and routes to an Alert node. Wire to email/Slack to get hourly error digests.

**Setup:** Import each JSON from n8n UI → Workflows → Import. Create credential "Backend Admin Token" (HTTP Header Auth: `Authorization: Bearer <admin-jwt>`). Activate workflows.

---

#### Known Remaining Gaps

| Gap | Description | Status |
|---|---|---|
| G | n8n workflows need real admin JWT to function; credential setup is manual | OPEN |
| H | Backend tests run against Supabase dev DB (no isolated test DB in local dev) | OPEN — acceptable; tests clean up after themselves |
| I | `--forceExit` in Jest is a workaround for pg.Pool keeping connections alive; pool should be explicitly ended in globalTeardown | OPEN |

---

## 2026-07-30 — Proxy list UI + anti-bot status badge (Commit: 1e37f66)

### FEATURE — Admin Panel → Job Intel Pipeline: Proxy / IP Rotation card

- **Problem:** The `proxy_list` settings key was not in `ALLOWED_SETTINGS_KEYS`, so `PUT /api/settings` silently ignored proxy writes. There was no UI for entering or saving proxies, and no visibility into whether the scraper was hitting bot blocks.
- **Fix:**
  - `backend/src/routes/settings.js`: Added `'proxy_list'` to `ALLOWED_SETTINGS_KEYS`.
  - `frontend/src/components/AdminPanel.jsx` (`JobIntelConfigSection`):
    - Loads `proxy_list` and `antibot_status` from `GET /api/settings` on mount.
    - New **Proxy / IP Rotation** card with a `font-mono` textarea (one URL per line, `http://` or `socks5://`) and a **Save Proxy List** button.
    - **Anti-bot status badge** (top-right of the card): green "Scraper OK" / amber "Low yield — possible IP block" / red "All proxies dead" — pulled from `antibot_status` settings key written by the pipeline after each run.
    - Inline warning text shown when status is `low_yield` (displays the pipeline's exact message).
- **Files changed:** `backend/src/routes/settings.js`, `frontend/src/components/AdminPanel.jsx`

---

## 2026-07-30 — Anti-bot pipeline: proxy rotation, 7-engine search, CAPTCHA detection (Commit: f191888)

### FEATURE — Multi-layer anti-bot system for the Job Intel LinkedIn scraper

**New files:**

- `backend/src/lib/proxyRotator.js` — Singleton proxy pool with TCP health-checks (`net.createConnection`), round-robin selection, per-proxy failure tracking (dead after 3 failures, auto-reset when all dead), `toCsvEnv()` for child-process env injection, and `loadFromEnv()` for reconstructing the pool in the scraper child process from `PROXY_URLS`.

- `backend/src/lib/captchaDetector.js` — Unified bot-challenge detection:
  - `detectBotChallenge(page)`: three-tier check — URL patterns (7), DOM selectors (16: Google, DDG, Cloudflare, LinkedIn, Bing, Brave, generic), body text patterns (16: "unusual traffic", "checking your browser", "access denied", LinkedIn authwall, etc.). Returns `{detected, type, engine, message}`.
  - `EngineState` class: per-run tracker with `markBlocked(engine, cooldownMs)` / `markSuccess(engine)` / `isBlocked(engine)` (auto-unblocks on cooldown expiry) / `summary()`.

**Modified files:**

- `backend/src/scrapers/linkedin-feed.js` — Major enhancement:
  - 14-entry UA pool + 6 viewport sizes, randomised per browser launch.
  - Playwright init script: masks `navigator.webdriver`, `window.chrome`, `navigator.plugins`, `navigator.languages`, `navigator.platform`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`, `Notification.requestPermission`.
  - Extra HTTP headers: `Accept-Language`, `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`.
  - `PROXY_URL` env var wired to `--proxy-server` Chromium arg.
  - `detectBotChallenge(page)` called after every `page.goto()` with engine-skip on detection.
  - 7-phase engine cascade: DDG LinkedIn → Google LinkedIn → Bing LinkedIn → Brave LinkedIn → Yahoo LinkedIn → DDG Twitter/Telegram → Broad pass (DDG + Bing + Brave without `site:` filter).
  - New engine functions: `searchBing`, `searchBrave`, `searchYahoo`, `mergeResults` (cross-engine URL dedup).
  - Engine state summary printed at end of run.

- `backend/src/agents/orchestrator.js`:
  - **Stage 0a**: Reads `proxy_list` from settings, calls `proxyRotator.loadFromString()` + `proxyRotator.healthCheckAll(8000)`, injects `PROXY_URL` + `PROXY_URLS` into `scraperExtraEnv`. Writes `antibot_status = proxy_pool_dead` to settings if all proxies are dead.
  - **Stage 0b**: Passes `scraperExtraEnv` as 4th arg to `runScraperHeadless`.
  - **Stage 0c**: Post-scrape quality audit — compares `freshlyScraped` to `min(keywords×2, 10)`. Writes `antibot_status = low_yield` (with details) or `antibot_status = ok` to settings.
  - `require('../lib/proxyRotator')` added at top.

- `backend/src/routes/scraper.js`:
  - `runScraperHeadless(scraper, body, onLog = () => {}, extraEnv = {})` — added optional `extraEnv` 4th parameter, merged into `spawn` env: `env: { ...process.env, SCRAPER_NO_OPEN: '1', FORCE_COLOR: '0', ...extraEnv }`.

---

## 2026-07-30 — Resume PDF normalization + skill placement fix + ResumePreview rewrite (Commit: 67e964d)

### BUG FIX — Resume Analyzer & Maker / Generalize Resume destroyed PDF formatting

Three root causes identified and fixed:

**Root cause 1 — PDF continuation lines:** `pdf-parse` extracts PDF text with artificial line breaks at visual column boundaries. A single skill entry like `"Languages & Backend: Java 8/21, …WebFlux /"` became 3 separate text lines. `modifyResume` appended skills to only the fragment, leaving the rest untouched.
- **Fix:** `normalizeResumeText(raw)` — rejoins continuation lines where the previous line ends with `,` / `/` / `|` / `&`, or the current line starts with lowercase. Also drops page-number-only lines and collapses blank-line runs. Called at the top of `modifyResume` and in all file-upload / profile-load paths in `JobAnalyzer`, `BulkJobAnalyzer`, `PostWorkflowModal`.

**Root cause 2 — Compound label domain blocking:** `getLineDomain("Languages & Backend:")` returned only `'backend'` (first match in iteration order), giving Python/TypeScript (domain `'language'`) a score of `-1` — blocked instead of appended.
- **Fix:** `getLineDomains(line)` returns a `Set` of ALL matching domains. `scoreLineForSkill` only blocks a skill when ALL line domains conflict with the skill's domain (`allConflict` check).

**Root cause 3 — Monospace gray box preview:** `ResumePreview.jsx` was a `font-mono whitespace-pre-wrap` gray box — no visual structure.
- **Fix:** Complete rewrite. `classifyLine(rawLine)` maps each line to `{type: 'blank'|'section'|'subcategory'|'bullet'|'body', …}`. White paper background (`bg-white border border-gray-200 rounded-lg shadow-sm`). First non-blank → bold centered name. ALL-CAPS → section header with `uppercase tracking-widest border-b`. `Label: rest` → bold label + normal rest. Bullet → indented paragraph. `[ADDED-LINE]` → green left border + `bg-green-50`. `[ADDED]` inline → green `+skill` chip.

- **Files changed:** `frontend/src/utils/resumeUtils.js`, `frontend/src/components/ResumePreview.jsx`, `frontend/src/components/JobAnalyzer.jsx`, `frontend/src/components/BulkJobAnalyzer.jsx`, `frontend/src/components/PostWorkflowModal.jsx`

---

## 2026-07-28 — Overleaf-style split resume editor (ResumeTemplateModal)

### FEATURE — ATS Resume Templates: Overleaf-style split editor replacing flat dark-only editor

- **Problem:** `ResumeTemplateModal.jsx` had a template sidebar + dark textarea but no visual preview, no formatting toolbar, no resizable divider, and no live rendering of the resume structure.
- **Fix:** Complete rewrite as a proper split-pane Overleaf-style editor with:
  - **Dark code editor pane (left):** green-on-gray-900 monospace textarea, line numbers scrolling in sync, cursor position status bar (Ln X, Col Y), char/line count in status bar
  - **Formatting toolbar:** H1 (ALL CAPS section header), H2 (Sub-label), • (Bullet toggle), ↵ (Blank line), ✦ Clear (strips [ADDED]/[ADDED-LINE] markers), ↺ Reset (for built-in templates), ↓ PDF, ↓ DOCX downloads
  - **Keyboard shortcuts:** Ctrl+S (save to profile), Ctrl+Shift+H (section header), Tab (4-space indent)
  - **Live A4 visual preview pane (right):** white paper on gray-200 background; line classifier mirrors `resumeUtils.js classifyLine` — name (large bold centered), subtitle (medium gray centered), contact (small centered), section header (bold + bottom border), subcategory (bold label + rest), bullet (indented •), blank (5px gap); [ADDED-LINE] lines get green left border; [ADDED] tokens render as green chip highlights
  - **Resizable divider:** drag handle between editor and preview, clamped 25–75% editor width
  - **View mode toggle:** Split / Editor / Preview in top bar, green active indicator
  - **Traffic-light window controls** (aesthetic, close button functional)
  - **Profile resume loader:** "Load Profile Resume" button in sidebar if user has a profile resume
  - **Save to Profile:** Ctrl+S or button writes `resume_text` to `/api/profile`
- **Files changed:** `frontend/src/components/ResumeTemplateModal.jsx` (complete rewrite)
- **New imports:** `downloadAsPdf`, `downloadAsWord`, `cleanResumeText` from `resumeUtils.js`
- **No backend changes**

---

## 2026-07-28 — Manual resume text editor in Profile page (ATS resume input)

### FEATURE — Profile → Resume & Skills tab: Edit Text tab with monospace editor

- **Problem:** The Resume & Skills tab had file upload only — no way to manually paste or type resume text. Users who wanted to input their resume as plain text had no entry point in the profile page.
- **Fix:** Added a two-tab layout inside the "Your Resume" section:
  - **File Upload tab** — existing upload card, unchanged
  - **Edit Text tab** — shows `profile.resume_text` in a monospace (`Courier New`) textarea with `white-space: pre-wrap` so all line breaks, indentation, and spacing are preserved exactly as typed or extracted
- **View / Edit mode toggle:**
  - View mode: textarea is `readOnly`, light gray background, shows exact stored text with no auto-modification
  - Edit mode: textarea is editable (white background, brand focus ring) with Save / Cancel buttons
  - "Unsaved changes" warning when draft differs from saved text
  - Separate Save call updates only `resume_text` — does not affect `resume_filename` or other fields
- **Copy button:** in view mode, copies full resume text to clipboard
- **After file upload:** automatically switches to Edit Text tab so user sees and can review the extracted text
- **Cross-linking:** Edit Text tab links to File Upload tab and vice versa via underlined buttons
- **ATS compatibility:** `resume_text` (plain string) is what all ATS analyzers (JobAnalyzer, BulkJobAnalyzer, PostWorkflowModal) consume — manual text entry goes through the same field
- **File:** `frontend/src/components/ProfilePage.jsx` — `ResumeSkillsTab` function

---

## 2026-07-28 — Resume skill injection: group-by-domain, smart placement, expanded dictionary

### BUG FIX — `resumeUtils.js` `modifyResume()` created one "Others:" row per unclassified skill

- **Root cause 1 (main bug):** The inner loop processed each skill individually. When no matching line was found (`bestScore = 0`), it called `result.splice(…)` for **each** skill — so 3 unclassified skills produced 3 separate `"Others: skill"` rows instead of one.
- **Root cause 2:** The `[ADDED-LINE]` prefix on freshly-inserted rows was not stripped before `scoreLineForSkill` / `getLineDomain` ran on them. The label regex `^([a-z][a-z…]+?)\s*[:|-]` requires the line to start with `[a-z]`, but `[ADDED-LINE]` starts with `[` — so already-inserted domain rows were invisible to subsequent iterations, causing duplicate domain rows.
- **Root cause 3:** ~80 common skills (Node.js, REST, JWT, Microservices, Agile, Webpack, Vite, Tailwind, OAuth, etc.) were missing from `SKILL_DOMAIN`, falling through to "Others" even though they have a clear category.
- **Root cause 4:** `getLineDomain` had no fallback when the line label didn't match any keyword (e.g. "Frameworks & Libraries:"). Now falls back to counting sibling skills already on the line and returning the dominant domain.

- **Fix:**
  - `modifyResume()` now groups `skillsToAdd` by domain **before** touching any lines (`byDomain` Map). One loop iteration per domain group, not per skill.
  - For each domain group: append ALL skills to the best matching line (joined with detected separator), or insert ONE new domain-labeled line with all skills at once.
  - For `'unclassified'` group: checks for an existing `Others/Misc/General` line first; if not found, inserts ONE `"Others: skill1, skill2, skill3"` line.
  - `stripAddedMarker()` strips `[ADDED-LINE]` prefix before passing to scoring functions, so newly-inserted rows are found in subsequent domain-group iterations.
  - `getSkillDomain()` exported (was private) for consumers that need to query domains.
  - `inferDomainFromSiblings()` added — scans skills already present on a line to infer domain when label keywords don't match.
  - `SKILL_DOMAIN` expanded from ~80 → ~160 entries (Node.js, Express, NestJS, REST, JWT, OAuth, Microservices, Agile, Scrum, Webpack, Vite, Tailwind (shorthand), Material UI, Ant Design, Swagger, Jira, Confluence, Liquibase, Flyway, Playwright, Vitest, etc.).
  - `DOMAIN_LABEL_KEYWORDS` expanded with: scripting, coding, server-side, api, microservice, version control, automation, platform, metrics, alerting, tracing.
- **File:** `frontend/src/utils/resumeUtils.js`

---

## 2026-07-28 — Preferred Cities: multi-city picker (up to 5) + default cities

### FEATURE — Profile preferred city expanded to up to 5 cities

- **What:** `preferred_city` in the `profiles` table now stores a JSON array string (`'["Delhi","Bangalore","Pune"]'`). Old single-string values auto-migrate on read via `parsePreferredCities()` helper (tries JSON parse, falls back to wrapping plain string in array — no data loss).
- **Default cities:** If a user has not set any preferred cities, all job search, scraping, and email template substitution defaults to: **Delhi, Bangalore, Pune, Noida, Gurugram**.
- **ProfilePage.jsx:** Replaced single `<select>` with a multi-city chip picker:
  - Selected cities shown as green removable chips (✕ button removes)
  - Dropdown to add from INDIA_CITIES list (only shows unselected cities)
  - "Max 5 cities selected" message when limit reached
  - View mode: each city shown as separate chip; defaults shown with `*` suffix when not explicitly set
- **Job search sync (JobScraperSection.jsx):** All preferred cities joined comma-separated as `location`; also passes `cities` array to scraper. Profile banner shows all cities.
- **LinkedIn Posts scraper (LinkedInPosts.jsx):** Uses joined cities for `location`.
- **Email templates (EmailTemplatesModal.jsx):** `{{preferred_location}}` now expands to all cities joined by `, `.
- **Backend auto-scrape (scraper.js):** Parses JSON city array for the auto-triggered LinkedIn feed scrape (non-admin path). Falls back to default 5 cities if not set.
- **No schema migration needed:** Column stays `TEXT`, stores JSON string.

---

## 2026-07-28 — Job Intel auto-sync to Contacts page

### FEATURE — Automatic sync of extracted HR emails into Contacts

- **What:** Every HR email extracted by the Job Intelligence pipeline is now automatically added to the admin user's Contacts page with `email_source = 'job-intel'`.
- **Trigger 1 (pipeline run):** `syncJobIntelContacts()` is called at the end of every successful `runPipeline()` execution — so any new HR emails found in a pipeline run appear in Contacts immediately.
- **Trigger 2 (startup + daily):** A standalone daily scheduler in `index.js` runs `syncJobIntelContacts()` at startup (45s delay) then every 24 hours — ensures contacts stay in sync even when the pipeline is disabled.
- **Trigger 3 (manual):** `POST /api/job-intel/sync-contacts` (admin only) lets an admin force-sync on demand.
- **Upsert safety:** Uses `ON CONFLICT (email, user_id) DO UPDATE SET … CASE WHEN email_source = 'job-intel' THEN … ELSE contacts.x END` — manually-edited contacts (sourced as `'manual'`, `'gmail'`, etc.) are never overwritten, only job-intel-sourced contacts get updated.
- **Fields mapped:** `name` ← `extracted_contact_name`, `company` ← `posting.company`, `email` ← extracted email, `notes` ← `[Job Intel] <posting title> · <company> (<source>)`, `source_url` ← `posting.apply_url`, `email_source` = `'job-intel'`, `status` = `'New'`.
- **UI highlight:** Contacts with `email_source = 'job-intel'` now render with a gray row (`bg-gray-100/80` + left border `border-gray-300`) and a "Job Intel" badge in the Source column.
- **Files changed:**
  - `backend/src/agents/orchestrator.js` — added `syncJobIntelContacts()` function; called after step 5 in `runPipeline()`; exported
  - `backend/src/routes/job-intelligence.js` — added `POST /sync-contacts` endpoint; imports `syncJobIntelContacts`
  - `backend/src/index.js` — added startup + daily `syncJobIntelContacts` scheduler
  - `frontend/src/components/ContactTable.jsx` — `isJobIntel` flag; gray row class; "Job Intel" badge in Source column

All significant changes, security fixes, and bug resolutions are recorded here for auditing purposes.
Each entry includes the date, severity, file(s) changed, root cause, and fix applied.

---

## 2026-07-28 — Bulk selection UX for Contacts page (`App.jsx`)

### UX — Quick-select and clear for main Contacts table

- **Feature:** Added **Select 5**, **Select 10**, **All (N)** quick-select buttons to the Contacts toolbar. Previously only manual per-row checkbox selection was available.
- **Behaviour:**
  - Select 5 / Select 10 appear when at least that many contacts are currently visible (respects active search/status filter).
  - `All (N)` always shown when any contacts are loaded — selects every contact in the current filtered view.
  - `✕ Clear (N)` appears (red, dismissible) as soon as any row is selected.
  - When items are selected, a bulk-action inline bar appears in the same row: **Change status**, **Compose**, **Delete**.
- **File:** `frontend/src/App.jsx` — replaced the separate `selected.length > 0` bulk bar block with a unified single-row toolbar that combines Select buttons + bulk actions.
- **Note:** LinkedIn Feed Contacts panel already had Select 5 / Select 10 / Clear (added in Task 9 on 2026-07-26).

---

## 2026-07-28 — Comprehensive Security & Bug Audit (Branch: fix/comprehensive-audit-jul28)

### CRITICAL — Security Fixes

#### 1. `settings.js` — Unauthenticated access to SMTP credentials and API keys
- **Symptom:** `GET /api/settings` and `PUT /api/settings` had no auth — anyone on the internet could read SMTP passwords, Apify API key, or overwrite the daily send cap.
- **Root cause:** Missing `router.use(requireAuth, requireAdmin)`.
- **Fix:** Added `requireAuth, requireAdmin` at the router level. Also added an `ALLOWED_SETTINGS_KEYS` allowlist on `PUT` to prevent writes to internal scheduler deduplication keys (e.g., `reminder_email_sent_<userId>_<date>`).

#### 2. `emailVerify.js` — `/batch` endpoint fully unauthenticated
- **Symptom:** `POST /api/email-verify/batch` triggered DNS lookups across all contacts with no auth — DoS vector and information leak (reveals which emails have valid MX records).
- **Fix:** Added `requireAuth, requireAdmin` guard.

#### 3. `emailTemplates.js` — All CRUD endpoints unauthenticated
- **Symptom:** `GET/POST/PUT/DELETE /api/email-templates` had zero auth. Any internet caller could list all templates, create, edit, or delete them.
- **Fix:** Added `router.use(requireAuth)`.

#### 4. `notifications.js` — Cross-user notification injection
- **Symptom:** `POST /api/notifications` accepted a `user_id` body field and used it as the target. Any authenticated user could spam notifications into any other user's (including admin's) notification feed.
- **Fix:** Removed `user_id` from accepted body params. Always uses `req.user.userId` as target.

#### 5. `notifications.js` — PATCH/DELETE blast broadcast notifications for all users
- **Symptom:** `PATCH /read-all` and `DELETE /` included `OR user_id IS NULL` in WHERE clause. One user marking all-read or clearing notifications wiped broadcast notifications for every other user simultaneously.
- **Fix:** Removed `OR user_id IS NULL` from both queries. Broadcast notifications are now only cleared/read for the requesting user's own rows.

#### 6. `scraped-jobs.js` — `/purge` missing `requireAuth`
- **Symptom:** `requireAdmin` was the only guard, which checks `req.user?.role` — without auth middleware setting `req.user`, unauthenticated callers got 403 instead of 401 (wrong error code; behavior was blocked but semantics were wrong).
- **Fix:** Added `requireAuth` before `requireAdmin`.

#### 7. `apify.js` — PATCH post status used `softAuth` (allowed unauthenticated writes)
- **Symptom:** Any unauthenticated caller could change any LinkedIn post's status to an arbitrary string value.
- **Fix:** Replaced `softAuth` with `requireAuth`. Added `VALID_POST_STATUSES` allowlist validation.

#### 8. `jobs.js` — `POST /parse-resume` unauthenticated file upload
- **Symptom:** Anyone could POST files up to 5 MB to trigger PDF/DOCX parsing (CPU/memory cost) — trivial DoS.
- **Fix:** Added `requireAuth` middleware.

---

### MEDIUM — Bug Fixes

#### 9. `jobs.js` — Broken `pdf-parse` import crashes ATS PDF analysis
- **Symptom:** `const { PDFParse } = require('pdf-parse')` uses a named export that doesn't exist. `pdf-parse` exports a function as its default. Every `.pdf` upload to `/api/jobs/parse-resume` threw `TypeError: PDFParse is not a constructor`, silently breaking ATS PDF resume scoring.
- **Fix:** Changed to `const pdfParse = require('pdf-parse'); const data = await pdfParse(buffer);`

#### 10. `email.js` `/send` — `syncExcel()` without args wrote all users' contacts to one shared file
- **Symptom:** After any email send, `syncExcel()` fetched all contacts from all users and overwrote the shared Excel file — in a multi-user setup, one user's send would overwrite other users' export data.
- **Fix:** Fetch only the current user's contacts and pass them: `syncExcel(userContacts)`.

#### 11. `contacts.js` `GET /:id` — Missing try/catch caused unhandled promise rejection
- **Symptom:** Any database error on the single-contact fetch propagated as an unhandled rejection, potentially crashing the Express process.
- **Fix:** Wrapped in try/catch with `res.status(500).json({ error: err.message })`.

#### 12. `admin.js` user deletion — Reminder scheduler settings leaked for deleted users
- **Symptom:** Deleting a user cleaned up all their data but left `reminder_<userId>` and `reminder_email_sent_<userId>_*` entries in the `settings` table. The background reminder scheduler continued attempting to process these (failing at transport resolution), accumulating stale keys indefinitely.
- **Fix:** Added `DELETE FROM settings WHERE key LIKE 'reminder_<uid>%'` to the deletion sequence.

#### 13. `scraped-jobs.js` `send-feed-emails` — Contact status not updated, no Excel sync, O(n²) delay
- **Symptom 1:** Successfully emailed feed contacts were never updated to `status = 'Sent'` in the contacts table, even when the contact existed there.
- **Symptom 2:** `syncExcel()` was never called, leaving the downloadable Excel stale.
- **Symptom 3:** `contacts.indexOf(contact)` for the 2-second inter-send delay was O(n²) and could return -1 for reconstructed objects, causing back-to-back rapid sends.
- **Fix:** Added contact status update to `'Sent'` on success; call `syncExcel(userContacts)` after the loop; replaced `indexOf` with the for-loop index `i`.

---

### MINOR — UX & Frontend Fixes

#### 14. `FeedContactsPanel.jsx` + `ComposeModal.jsx` — Template attachment silently not applied
- **Symptom:** `applyTemplate(t)` referenced `t.attachment` which never exists on template objects from the API. The correct field is `t.attachment_json` (already parsed to an object by the backend GET route). Applying a template always silently discarded its saved attachment.
- **Fix:** Changed `t.attachment` → `t.attachment_json` in both components.

#### 15. `ComposeModal.jsx` — Stale preview screen after send failure
- **Symptom:** If `POST /email/send` threw (network error, 429, etc.), the modal stayed on the preview step with old previews. The user couldn't re-compose without closing and reopening the modal.
- **Fix:** Added `setStep('compose')` in the catch block so the user is returned to the compose step to adjust and re-preview.

#### 16. `GmailEmailList.jsx` — `canShowMore` hid "Show More" button incorrectly
- **Symptom:** `canShowMore = visibleCount < total` used the server-side total. When the local buffer was exhausted but `allEmails.length < total` (more pages exist server-side), clicking "Show 10 more" did nothing (no new fetch). The button still appeared but was effectively broken.
- **Fix:** `canShowMore = visibleCount < allEmails.length || loadedPage < pages` — correctly shows button when either local rows remain or server pages exist.

#### 17. `App.jsx` — Email stats fetched on every search keystroke
- **Symptom:** `useEffect(() => api.get('/email/stats'), [contacts])` fired on every `contacts` array change, including every character typed in the search box — one API call per keystroke.
- **Fix:** Changed dependency to `[activityKey]`, which only increments after explicit user actions (send, delete, compose close).

---

## 2026-07-27 — Attachment System Fixes (Commit: cb5add7)

### Vault upload non-fatal on text extraction failure
- `POST /resume-versions/upload`: Scanned/image PDFs that fail `pdf-parse` text extraction now store the file anyway (with empty `resume_text`) instead of returning 400. Previously, any un-parseable PDF caused the vault upload to fail, preventing users from saving resumes to vault for template use.

### Vault versions visible in AttachmentPicker
- `AttachmentPicker.jsx`: Removed `has_file` filter — ALL resume_versions now shown (not just file-backed ones). Text-only versions show an amber "Text only — will attach as .txt" badge.
- Auto-tabs to Vault if any versions exist (previously required `has_file: true`).

### resolveAttachment text fallback for vault entries
- `email.js` and `scraped-jobs.js`: When a vault version has no file on disk but has `resume_text`, the backend now generates a `.txt` buffer attachment instead of silently sending with no attachment. Also adds `resume_text` to the SELECT query.

---

## 2026-07-26 — Tasks 7–11 (Multi-commit)

### Task 7 — User-wise data isolation
- Added `user_id` column to `contacts` table via migration; dropped `UNIQUE(email)`, created `UNIQUE(email, user_id)`.
- All routes in `contacts.js`, `email.js`, `stats.js`, `admin.js`, `gmail.js`, `emailVerify.js`, `scraped-jobs.js` scoped to `req.user.userId`.
- Existing contacts assigned to first admin on migration.

### Task 8 — Gmail tracking pagination
- `GmailEmailList.jsx`: Shows 5 emails initially, "Show 10 more" button accumulates in-memory; auto-fetches next server page when buffer runs low.

### Task 9 — Feed contacts bulk send UX
- `FeedContactsPanel.jsx` + `scraped-jobs.js /send-feed-emails`: Partial failure toasts with per-contact counts; modal always closes after send (success or error); selection clears on close; Select 5 / Select 10 quick-select buttons.

### Task 10 — Admin unlimited email cap
- `email.js`, `scraped-jobs.js`, `rateLimiter.js`: Admin users bypass all daily send cap checks and rate limiter middleware. Non-admin behavior unchanged.

---

## 2026-07-20 — Security Hardening (Commit group)

### Defense-in-depth security layer
- `backend/src/middleware/security.js`: globalApiLimiter, authLimiter, authSlowDown, scrapeLimiter, leadLimiter, bodySanitizer, safeErrorHandler.
- `backend/src/index.js`: helmet with CSP, trust proxy, global rate limiting.

### OAuth one-time exchange code
- Google OAuth callback no longer embeds 30-day JWT in `?google_login_token=` URL param (exposed in browser history, server logs, Referer headers).
- Backend generates a 32-byte hex one-time code (60s TTL), stored in memory. `POST /api/oauth/exchange` validates and deletes the code (single-use) before returning the real JWT.

### Frontend validations
- 13+ components: ContactForm, SmtpSettingsModal, ApifySettingsModal, TemplatesPage, JobAnalyzer, BulkJobAnalyzer, ProfilePage, ReminderModal, ComposeModal, AskReferral, EarlyAccessBanner.

---

## Known Remaining Gaps (not yet fixed)

| # | Area | Issue | Priority |
|---|------|--------|----------|
| A | `notifications.js` | Broadcast (`user_id IS NULL`) notifications cannot be marked read per-user without a junction table schema change | Medium |
| B | `auth.js` register | Race condition: two simultaneous first-registration requests can both become admin | Low |
| C | `scraped-jobs.js` feed-contacts | `total` shown in pagination reflects in-memory merge cap (2000 rows), not true DB total | Low |
| D | `FeedContactsPanel.jsx` + `EmailTemplatesModal.jsx` | Template preview rendered via `dangerouslySetInnerHTML` without DOMPurify — self-XSS risk in own browser | Low |
| E | `scraped-jobs.js` | `already_emailed` flag checks `gmail_tracked_emails` not `email_log` — contacts emailed via ComposeModal aren't marked in feed | Medium |
| F | ~~`linkedin-feed.js`~~ | ~~PROXY_URLS env var is passed to the child process but the scraper only reads `PROXY_URL` (single). In-scraper proxy rotation not implemented.~~ **FIXED** — `proxyRotator.loadFromEnv()` called at startup; `launchBrowser(proxyUrl)` takes proxy as parameter; `tryRotateProxy()` helper closes browser, marks proxy failed, relaunches with next alive proxy; rotation triggered at start of each keyword iteration (if any engine was blocked in previous iteration) and before the broad pass (if ≥2 engines blocked) | Low |
| G | `captchaDetector.js` | CAPTCHA solving (2Captcha, CapSolver, hCaptcha API) is not implemented — detection triggers engine-skip, not solve-and-continue. High-resistance sites that block all 7 engines cannot be unblocked without proxies | Medium |
| H | `orchestrator.js` | `antibot_status` is a single settings key — only the most recent run's status is stored. No time-series history of block events; the Admin Panel shows only the latest status, not a trend | Low |
| I | `resumeUtils.js` `normalizeResumeText` | Join heuristic (lowercase start) can incorrectly merge separate bullet points when bullet text happens to start with lowercase. Edge case — only affects PDFs where bullets aren't prefixed with `•` or `-` | Low |
| J | ~~`ProfilePage.jsx` `detectFromResume`~~ | ~~"Professional summary" detection still splits on blank-line paragraph breaks which are absent in most PDF-extracted text.~~ **FIXED** (`ProfileAnalyzer.jsx`) — fallback now scans lines individually: skips first 5 lines (name/contact block), skips ALL-CAPS section headers and contact/URL lines, collects the first block of prose lines (length >45 with a space), stops at blank line or next section. Eliminates the "giant first paragraph = entire document" failure. Primary section-header path also extended to match "About Me" and headers with trailing colon. | Medium |
