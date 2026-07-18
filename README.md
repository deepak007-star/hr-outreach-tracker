# HR Outreach Tracker

A personal job-search CRM for tracking HR/recruiter contacts, sending templated outreach emails, and syncing everything to a colour-coded Excel file. Includes LinkedIn hiring-post scraping (via Apify) and resume/profile tooling (ATS scoring, resume templates, job analysis).

- **Backend**: Express + sql.js (WASM SQLite), port `3001`
- **Frontend**: React 18 + Vite + Tailwind, port `5173`

For the feature walkthrough (dashboard layout, compose/send flow, status workflow, SMTP setup), see [USER_GUIDE.md](./USER_GUIDE.md). For architecture notes aimed at AI-assisted development in this repo, see [CLAUDE.md](./CLAUDE.md).

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

Copy `backend/.env.example` to `backend/.env` to override defaults:
```
PORT=3001
FRONTEND_URL=http://localhost:5173
```
SMTP credentials and Apify keys are configured at runtime through the app's Settings modals (stored in the SQLite `settings` table), not via env vars. `JWT_SECRET` falls back to a hardcoded local value if unset — set it explicitly in `.env` for anything beyond local use.

## Data

- SQLite DB: `backend/data/contacts.db`
- Excel export (auto-regenerated on every contact change): `backend/data/HR_Outreach_Tracker.xlsx`
- Uploaded files (CSV/Excel imports, resumes): `backend/uploads/`

None of the above are committed to git (see `.gitignore`).
