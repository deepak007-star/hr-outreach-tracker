# HR Outreach Tracker

A personal job-search CRM for tracking HR/recruiter contacts, sending templated outreach emails, and syncing everything to a colour-coded Excel file. Includes an automated **Job Intel Pipeline** that scrapes LinkedIn hiring posts across 5 search engines (with anti-bot protection, proxy rotation, and CAPTCHA detection), extracts HR emails, and syncs them to your contacts list. Also includes resume/profile tooling (ATS scoring, resume templates, job analysis).

- **Backend**: Express + Postgres 16 (via `pg`), port `3001`
- **Frontend**: React 18 + Vite + Tailwind, port `5173`

For the feature walkthrough (dashboard, compose/send, status workflow, SMTP setup, Job Intel Pipeline, proxy config), see [USER_GUIDE.md](./USER_GUIDE.md). For architecture notes aimed at AI-assisted development, see [CLAUDE.md](./CLAUDE.md).

## Quick start

### Local (Windows)

```
start.bat
```
Opens two terminal windows — backend on `http://localhost:3001`, frontend on `http://localhost:5173`.

Or run each manually:
```
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

### Docker

```
docker compose up --build -d
```
Same two ports. The backend's `data/` (SQLite DB + Excel export) and `uploads/` directories are bind-mounted from the host, so data persists across container rebuilds. Stop with `docker compose down`.

## Environment

Copy `backend/.env.example` to `backend/.env`. Key variables:

```env
# Database (required for production; falls back to localhost postgres for local dev)
DATABASE_URL=postgres://user:pass@host:5432/hr_outreach_tracker

# Auth — set in production, hardcoded fallback for local dev only
JWT_SECRET=your-secret-here

# Per-user Gmail OAuth2 (required to use Google OAuth email sending)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/api/oauth/google/callback
OAUTH_TOKEN_ENCRYPTION_KEY=<64 hex chars — generate with: openssl rand -hex 32>

# Optional: single proxy for manual scraper testing (orchestrator manages the pool via Admin Panel)
PROXY_URL=http://user:pass@host:port
```

SMTP credentials, Apify keys, Groq API key, and the proxy list are all configured at runtime through the Admin Panel (stored in the Postgres `settings` table), not via env vars.

## Data

- **Database**: Postgres 16 — connection via `DATABASE_URL`. Schema auto-created on first start via `CREATE TABLE IF NOT EXISTS` in `database.js`.
- **Excel export** (auto-regenerated on every contact change): `backend/data/HR_Outreach_Tracker.xlsx`
- **Scraper output cache** (JSON files written by each scraper run): `backend/src/output/<scraper-name>/`
- **Uploaded files** (CSV/Excel imports, resumes): `backend/uploads/`

The `data/` and `uploads/` directories are bind-mounted in Docker so they survive container rebuilds. None of the above are committed to git (see `.gitignore`).
