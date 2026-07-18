# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal job-search CRM: tracks HR/recruiter contacts, imports/exports them to a colour-coded Excel file, sends templated outreach emails over SMTP, scrapes LinkedIn hiring posts via Apify, and includes resume/profile tooling (ATS scoring, resume templates, job analysis). Multi-user with JWT auth; the first registered user is auto-promoted to `admin`.

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

Tables: `contacts`, `email_log`, `settings` (key/value store for SMTP config, daily send cap, Apify config, per-user reminder configs as `reminder_<userId>` JSON), `users`, `notifications`, `linkedin_posts`, `email_templates`, `leads` (early-access/waitlist signups), `profiles` (resume/profile data, one row per user).

The Excel file at `backend/data/HR_Outreach_Tracker.xlsx` is a derived artifact, not a data source — `backend/src/services/excelSync.js` regenerates it wholesale from the `contacts` table (via ExcelJS, with per-status row fills matching the UI's status colours) after every mutating contacts endpoint. Call `syncExcel()` after any contacts write path.

### Backend structure

`backend/src/index.js` is the composition root: creates the uploads dir, awaits DB init, then requires and mounts all routers under `/api/*`. It also owns three `setInterval` background jobs started at the bottom of `main()`:
- Hourly: auto-scrape LinkedIn via Apify if `apify_last_scrape` setting is >23h old and Apify credentials/queries are configured (`routes/apify.js`'s `performScrape`).
- Every minute: reminder-email scheduler — reads all `reminder_*` settings rows, compares configured send time/days against "now," dedupes via a `reminder_email_sent_<userId>_<date>` settings key.
- Startup (+15s) then every 24h: re-verifies `pending`/`unverifiable`/stale contact emails via `checkEmailDomain` (`routes/emailVerify.js`).

Auth (`middleware/auth.js`): JWT-based, `requireAuth`/`requireAdmin` middleware; secret is `process.env.JWT_SECRET` with a hardcoded local fallback — set `JWT_SECRET` for anything beyond local use. `routes/apify.js` also has its own `softAuth` (validates token if present, never blocks) for endpoints that vary behavior by auth without requiring it.

Rate limiting (`middleware/rateLimiter.js`): in-memory sliding-window limiter (email sends, job applications), keyed by `userId` (or IP if unauthenticated), resets on server restart by design — not for cross-process/production use.

Routes map roughly 1:1 to concerns: `contacts` (CRUD + CSV/Excel import/export), `email` (compose/preview/send with the 14-day duplicate-send guard and bounce → Do-Not-Contact logic described in USER_GUIDE.md), `settings` (SMTP config), `stats`, `jobs`/`leads` (job-posting analysis, waitlist leads), `auth`/`profile` (user account + resume/profile data), `apify` (LinkedIn scrape config + trigger), `notifications`, `reminder`, `rateLimitStatus`, `emailTemplates`, `emailVerify` (domain-level email validity checks), `admin` (admin-only views, gated by `requireAdmin`).

### Frontend structure

Single-page app, no router — `App.jsx` (~20KB) holds most of the dashboard state and view-switching logic directly; `AuthProvider` (`contexts/AuthContext.jsx`) wraps the whole app in `main.jsx` and validates the stored JWT (`localStorage['hr_token']`) against `GET /auth/me` on load.

`api/client.js` is a single axios instance with **`baseURL` hardcoded to `http://localhost:3001/api`** (not env-driven) and a request interceptor that attaches `Authorization: Bearer <hr_token>`. A couple of components (`App.jsx`, `ImportModal.jsx`) also hit `http://localhost:3001` directly via `window.open`/`fetch` for file export/import rather than going through the axios client — keep these three call sites in sync if the backend URL/port ever changes.

`components/` is a flat directory of feature components (no nesting by domain) — dashboard/table/modals alongside resume/ATS tooling (`ResumePreview`, `ResumeTemplateModal`, `atsUtils.js`, `resumeUtils.js`) and LinkedIn/job-post features (`LinkedInPosts`, `JobAnalyzer`, `BulkJobAnalyzer`).
