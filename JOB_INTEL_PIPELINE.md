# Job Intelligence Pipeline — Architecture & Roadmap

## 1. Overview

A multi-agent data pipeline that pulls job postings from **official APIs and public ATS boards** into a dedicated `job_postings` table, runs them through extraction, classification, and QA agents, and surfaces the results in a new "Job Intelligence" tab in the app.

This pipeline is **completely separate** from the existing LinkedIn feed scraper. It does not touch `scraped_jobs`, `linkedin_posts`, or any existing scraper code. It can be enabled, disabled, or torn out independently.

**Legal posture:** every source used here is public-by-design — APIs with documented access, RSS feeds, or ATS board endpoints that exist specifically so third parties can embed job listings. No login wall is crossed. No LinkedIn session is used anywhere.

---

## 2. What Was Built

### 2.1 Database (backend/src/db/database.js)

Two new tables added via `CREATE TABLE IF NOT EXISTS` (idempotent, safe to deploy):

```
job_postings         — one row per unique job posting
pipeline_runs        — audit log, one row per pipeline execution
```

`pg_trgm` extension enabled (required for future fuzzy-match dedup).

**job_postings columns:**

| Column | Purpose |
|---|---|
| `id` | UUID primary key |
| `source` | e.g. `arbeitnow`, `greenhouse:stripe`, `lever:airbnb` |
| `external_id` | Source's own ID — used for `UNIQUE(source, external_id)` dedup |
| `title`, `company`, `location`, `description`, `apply_url`, `posted_at` | Core job fields |
| `extracted_emails` | JSON array of emails found by Extraction Agent |
| `extracted_contact_name` | HR name extracted by LLM fallback |
| `extraction_method` | `'regex'` \| `'llm'` \| `null` |
| `is_relevant` | 0/1 from Classification Agent |
| `seniority` | `entry` \| `mid` \| `senior` \| `lead` \| `any` |
| `classification_confidence` | 0.0–1.0 |
| `classification_reason` | Short LLM-generated reason string |
| `fingerprint` | SHA-256 hash for cross-source dedup |
| `needs_review` | 0/1 — set by QA Agent |
| `review_reason` | Why it was flagged |

### 2.2 Agent Modules (backend/src/agents/)

Each agent is a focused Node.js module. LLM is used **only** where judgment is genuinely needed; everything else is deterministic code.

#### Ingestion Agents (backend/src/agents/ingestion/)

| File | Source | Auth | Notes |
|---|---|---|---|
| `arbeitnow.js` | Arbeitnow public job board API | None | ~100–150 jobs/run, EU-heavy but includes remote |
| `remotive.js` | Remotive remote jobs API | None | 100 jobs/run, remote-only tech roles |
| `remoteok.js` | RemoteOK public JSON endpoint | None | ~100 jobs/run, remote-only |
| `wwr.js` | We Work Remotely RSS (3 feeds) | None | ~100–150 jobs/run, parses RSS XML via cheerio |
| `greenhouse.js` | Greenhouse ATS public board API | None | Per-company, `boards-api.greenhouse.io/v1/boards/{slug}/jobs` |
| `lever.js` | Lever ATS public postings API | None | Per-company, `api.lever.co/v0/postings/{slug}` |
| `adzuna.js` | Adzuna job search API | Free API key | India coverage, keyword-driven search |
| `jooble.js` | Jooble aggregator API | Free API key | Broad aggregation, keyword-driven |
| `index.js` | Registry — runs all enabled sources in parallel | — | Returns `{ raw, sourceStats }` |

#### Processing Agents

| File | Role | LLM? |
|---|---|---|
| `normalization.js` | Maps every source's field names to common schema, strips HTML, normalises dates | No |
| `deduplication.js` | SHA-256 fingerprint of (title+company+month), checks DB for prior runs | No |
| `extraction.js` | Regex-first (via shared `contactExtract.js`); Groq LLM fallback when regex finds nothing but outreach intent is present | Only fallback |
| `classification.js` | Groq `llama-3.3-70b-versatile` scores each posting for relevance, seniority, confidence | Yes |
| `qa.js` | Flags rows missing key fields or with confidence < 0.55 | No |
| `storage.js` | `INSERT ... ON CONFLICT (source, external_id) DO UPDATE` into `job_postings` | No |
| `orchestrator.js` | Sequences all agents, owns the `pipeline_runs` record, schedules repeating runs | No |

### 2.3 API Routes (backend/src/routes/job-intelligence.js)

Mounted at `/api/job-intel/`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/postings` | Public | Filterable job list (q, source, location, has_email, is_relevant, seniority, needs_review) |
| `GET` | `/sources` | Public | Distinct source list with counts |
| `GET` | `/stats` | Public | Dashboard numbers (total, with_email, relevant, review_needed, last_run) |
| `GET` | `/runs` | Admin | Last 20 pipeline run records |
| `POST` | `/run` | Admin | Trigger manual pipeline run (fires in background) |
| `GET` | `/config` | Admin | Read current pipeline config from settings table |
| `PUT` | `/config` | Admin | Save pipeline config to settings table |
| `DELETE` | `/postings` | Admin | Purge rows older than N days |
| `PATCH` | `/postings/:id/review` | Admin | Clear `needs_review` flag |

### 2.4 Frontend

**`frontend/src/components/JobIntelPanel.jsx`**
- Filterable list of `job_postings` with keyword search, source filter, relevance filter, email filter, seniority filter
- Per-card: source badge (colour-coded per source), relevance pill with confidence %, extraction method badge (Regex/LLM), extracted email links, Apply button
- Stats bar at top (total, with email, relevant, needs review)
- Last run status line
- Pagination (30 per page)

**`frontend/src/App.jsx`**
- New "Job Intelligence" tab in sidebar nav (icon: `Zap`, route `/job-intel`)
- Renders `JobIntelPanel` inside a `TabErrorBoundary`

**`frontend/src/components/AdminPanel.jsx`**
- New "Job Intel Pipeline" tab with `JobIntelConfigSection`:
  - Enable/disable toggle + run frequency input
  - Keywords textarea (one per line)
  - Target locations textarea
  - Greenhouse company slugs textarea
  - Lever company slugs textarea
  - Adzuna App ID + Key inputs
  - Jooble key input
  - LLM classification toggle
  - Save Config + Run Pipeline Now buttons
  - Last 5 run history with status/stats

### 2.5 Scheduling (backend/src/index.js)

`schedulePipeline()` is called once after DB init:
- Reads `job_intel_config` from settings
- If `enabled: true`, fires an initial run 30s after startup, then repeats every `run_every_hours` hours
- Disabled by default — admin must enable via Admin Panel

---

## 3. How the Pipeline Runs (Step by Step)

```
1. Orchestrator loads config from settings['job_intel_config']
2. Creates a pipeline_runs record (status: 'running')
3. ingestAll(cfg) — runs all enabled ingestion agents in parallel
4. normalizeAll(raw) — maps to common schema, strips HTML
5. deduplicateBatch(normalized) — fingerprints each job, checks DB
6. For each unique job:
   a. extractFromJob(job) — regex contacts; LLM fallback if signals present
   b. classifyJob(job, cfg) — LLM relevance score (throttled: 1 call/10 jobs)
   c. qaCheck(job, classResult) — flag missing fields or low confidence
   d. storeJob(job) — upsert into job_postings
7. Updates pipeline_runs record (status: 'success', stats)
8. Posts a notification to the notifications table
```

**Typical run time:** 30–60 seconds (free sources only, no LLM classification)  
**With LLM classification on 300 jobs:** 2–4 minutes (Groq rate limit throttle)

---

## 4. Configuration Reference

Stored as JSON in `settings` table under key `job_intel_config`.

```json
{
  "enabled": false,
  "run_every_hours": 6,
  "keywords": [
    "Backend Developer",
    "Node.js Developer",
    "Java Developer",
    "React Developer",
    "Frontend Developer"
  ],
  "locations": ["India", "Remote"],
  "greenhouse_companies": [],
  "lever_companies": [],
  "adzuna_app_id": "",
  "adzuna_key": "",
  "adzuna_location": "",
  "jooble_key": "",
  "jooble_location": "India",
  "classify": true,
  "min_confidence": 0.5
}
```

To activate with zero API keys: set `enabled: true`, add your target keywords, save.  
The four free sources (Arbeitnow, RemoteOK, WWR, Remotive) will run immediately.

---

## 5. Source-by-Source Notes

### 5.1 Arbeitnow
- Endpoint: `https://www.arbeitnow.com/api/job-board-api`
- Returns up to ~200 jobs in one call, no pagination needed
- Skews toward EU/remote roles
- No rate limit documented; treat as one call per run

### 5.2 Remotive
- Endpoint: `https://remotive.com/api/remote-jobs?limit=100`
- Remote-only, tech-heavy
- SSL issues observed on some networks (proxy/corporate firewall) — works fine on cloud servers

### 5.3 RemoteOK
- Endpoint: `https://remoteok.com/api`
- Returns an array where index 0 is a legal notice object — filtered out
- Needs a `User-Agent` header or returns 403
- Remote-only

### 5.4 We Work Remotely (RSS)
- Three feeds: programming, devops, back-end programming
- Parsed with cheerio (already a dependency)
- `<region>` element used for location; title format is `Company: Job Title`

### 5.5 Greenhouse ATS
- Pattern: `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
- `{slug}` is the company's Greenhouse board token, visible in their careers page URL
- Some companies worth adding: stripe, airbnb, shopify, notion, figma, vercel, cloudflare, mongodb
- Returns full HTML job description in `content` field; stripped by normalization agent

### 5.6 Lever ATS
- Pattern: `https://api.lever.co/v0/postings/{slug}?mode=json`
- Some companies worth adding: netflix, discord, scale-ai, anthropic, openai, twitch
- Returns `descriptionPlain` (text) and `description` (HTML); prefers plain text

### 5.7 Adzuna
- Free tier: 250 calls/month at developer.adzuna.com
- India country code: `in`; endpoint uses `what` (keyword) and `where` (city/region)
- Best for India-specific keyword coverage (e.g. "Java Developer Pune")
- Currently limited to 5 keywords per run to respect rate limits

### 5.8 Jooble
- Free key available at jooble.org/api/contacts
- POST request with keywords + location
- Good breadth across many Indian job boards in one call
- Currently limited to 5 keywords per run

---

## 6. What Can Be Improved

### 6.1 Deduplication — Fuzzy Match

**Current state:** exact fingerprint (SHA-256 of title+company+month).  
**Problem:** the same job reposted with slightly different title ("Java Developer" vs "Java Backend Developer") creates duplicates.

**Improvement:**
- Use the `pg_trgm` extension (already enabled) for fuzzy similarity check:
  ```sql
  SELECT id FROM job_postings
  WHERE similarity(title, $1) > 0.7
    AND similarity(company, $2) > 0.8
    AND posted_at BETWEEN $3 AND $4
  LIMIT 1;
  ```
- Run this as a secondary check after fingerprint miss
- Or use embedding similarity (see 6.6)

### 6.2 Classification Quality

**Current state:** single Groq call with `llama-3.3-70b-versatile`, structured JSON output.  
**Problem:** JSON parsing can fail for malformed LLM output; model occasionally hallucinates confidence values.

**Improvements:**
- Add retry on JSON parse failure with a simpler fallback prompt
- Use `response_format: { type: 'json_object' }` if/when Groq supports it for this model
- Build a small labeled dataset from admin review actions and fine-tune the classification prompt

### 6.3 Extraction — LLM Fallback Accuracy

**Current state:** LLM fallback fires when `hasOutreachIntent()` is true but regex finds no email.  
**Problem:** LLM sometimes invents plausible-looking but fake emails when none exist in the text.

**Improvements:**
- Add a post-LLM validation step: run extracted emails through `extractContacts()` regex on the original text to confirm they actually appear there
- Only trust LLM-extracted emails if they pass the regex existence check

### 6.4 Rate Limiting + Resilience

**Current state:** `setInterval(1000)` delay every 10 LLM calls; no retry on network failures.

**Improvements:**
- Add exponential backoff + retry (2–3 attempts) for ingestion HTTP calls
- Track per-source failure rate in `pipeline_runs.errors`; auto-disable a source after N consecutive failures
- Respect `Retry-After` headers from APIs that return 429

### 6.5 Pagination for Large Sources

**Current state:** single API call per source (most cap at 100–200 results).  
**Problem:** Greenhouse/Lever companies with many openings (Google, Meta) may have thousands of jobs.

**Improvement:** add pagination loop in `greenhouse.js` and `lever.js`:
```js
let page = 1;
while (true) {
  const data = await fetchPage(slug, page++);
  if (!data.jobs?.length) break;
  results.push(...data.jobs);
  if (results.length >= limit) break;
}
```

### 6.6 Embedding-Based Semantic Dedup

**Current state:** string fingerprint dedup only.

**Future improvement:** generate a vector embedding for each posting's description (using Groq's or OpenAI's embedding endpoint), store in a `pgvector` column, and query for cosine similarity > 0.92 at dedup time. This catches the same job reworded differently across sources.

Cost: ~$0.002 per 1000 embeddings with OpenAI `text-embedding-3-small`.

### 6.7 Admin QA Review Loop

**Current state:** `needs_review` rows are flagged but there is no UI to action them inline.

**Improvement:** add a dedicated review queue view in the Admin Panel that shows flagged rows with:
- Quick "Mark as Relevant / Not Relevant" buttons
- "Merge with existing" button for detected near-duplicates
- Feedback loop: corrections update a `corrections` table that is periodically summarised into a revised classification prompt

### 6.8 Purge Policy for job_postings

**Current state:** no automatic purge — rows accumulate indefinitely.

**Improvement:** add job_intel purge to the existing daily purge job in `index.js`:
```js
const cutoff = new Date(Date.now() - 60 * 86_400_000)...; // 60-day default
await db.prepare('DELETE FROM job_postings WHERE fetched_at < ?').run(cutoff);
```
Also expose the retention period in the Admin Panel → Job Intel config.

---

## 7. What Can Be Integrated

### 7.1 "Add to Contacts" Flow

**What it would do:** when a job posting has `extracted_emails`, show an "Add to Contacts" button that pre-fills the Contact form with the extracted email and company name.

**Integration point:**  
- `JobIntelPanel.jsx` → Add a button on each card with an email
- On click, call `POST /api/contacts` with the extracted data
- The existing contacts table and email outreach flow takes over from there

**Effort:** small — 1 day front-end + 10 lines of route reuse.

### 7.2 Relevance Scoring → Contact Priority

**What it would do:** when a job is both `is_relevant = 1` and has an extracted email, automatically queue it into the contacts table at a higher priority than manually-added contacts.

**Integration point:**  
- Storage agent (`storage.js`) could call `POST /api/contacts` for relevant + has-email rows
- Alternatively, expose a "Import relevant contacts" button in JobIntelPanel

### 7.3 Daily Summary Notification

**What it would do:** after each pipeline run, send a notification (or email) summarising "X new relevant jobs found, Y with direct email contact".

**Integration point:**
- Orchestrator already writes to `notifications` table after each run
- Extend to also trigger the reminder email system (`routes/reminder.js`) for users who opt in

### 7.4 User-Level Relevance Profile

**Current state:** one global classification profile (keywords from `job_intel_config`).  
**Improvement:** per-user classification based on their `profiles` table data (`job_title_1/2/3`, `preferred_city`, `skills`).

**Integration point:**
- `GET /api/job-intel/postings?user_id=me` — re-classify for the requesting user's profile on the fly (or pre-classify per user if the user count is small)
- Use the existing `profiles` table — no new schema needed

### 7.5 BullMQ / Redis Queue

**Current state:** in-process async pipeline; a server restart mid-run loses the current batch.

**Future integration:** replace the in-process queue with [BullMQ](https://docs.bullmq.io/) backed by Redis:
- Each ingestion source becomes an independent job in a `raw-postings` queue
- Processing agents (normalize → dedup → extract → classify → store) each become workers on a `processed-postings` queue
- Survives server restarts; enables distributed workers
- Redis is the only new infrastructure dependency; can be hosted on Render or Upstash (free tier)

### 7.6 n8n / Temporal Orchestration

**What it would replace:** the in-process `setInterval` scheduler in `orchestrator.js`.

**When to do it:** when the pipeline needs to:
- Run on multiple servers
- Retry individual agent failures without restarting the full run
- Trigger on external events (e.g., a new company added to Greenhouse list → immediately fetch their jobs)

**Integration:** `orchestrator.js` is already structured as a set of composable async functions; wiring them into n8n's HTTP Request nodes or a Temporal workflow is a mechanical translation.

### 7.7 Google Jobs via JSearch (RapidAPI)

**What it adds:** structured Google for Jobs results — the broadest single-source coverage.

**Integration point:** add `backend/src/agents/ingestion/jsearch.js`:
```js
// GET https://jsearch.p.rapidapi.com/search?query={kw}&page=1&num_pages=1
// Headers: X-RapidAPI-Key: {key}, X-RapidAPI-Host: jsearch.p.rapidapi.com
```
Requires a RapidAPI account. Free tier gives 200 requests/month.

### 7.8 Apify Logged-Out Company Pages (Tier 5 from architecture doc)

**What it adds:** public company career pages and LinkedIn public job listings (logged-out only).

**Integration point:** add `backend/src/agents/ingestion/apify-public.js`:
```js
const run = await apifyClient.actor(actorId).call({
  startUrls: [{ url: companyPageUrl }],
  loggedIn: false,
  proxyConfiguration: { useApifyProxy: true },
});
```
This is a **logged-out only** tier — same Apify client already used elsewhere in the app (`routes/apify.js`). Tag these as `source: 'apify-public'` so they can be audited and disabled separately.

**Not included in the current build** because it adds Apify cost per run and the free-API sources (Tiers 1–3) are sufficient to validate the pipeline first.

### 7.9 Email Tracking Integration

**What it would do:** when an extracted email from `job_postings` is later contacted via the existing email outreach flow, link the `job_postings.id` to the resulting `email_log` row so you can track which pipeline source produced a successful contact.

**Integration point:**
- Add a `job_intel_posting_id TEXT REFERENCES job_postings(id)` column to `email_log`
- When composing an email to an address that was extracted from a posting, pre-populate this FK

---

## 8. Known Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| Remotive returns SSL error on some networks (corporate proxy) | 0 Remotive jobs on affected machines | Works on cloud servers (Render/Railway); not a bug |
| No emails in Arbeitnow/RemoteOK/WWR jobs | extraction_emails = '[]' for most | These sources are "Apply" flows, not contact-direct — use for job discovery, not email extraction |
| LLM classification adds 2–4 min to a 300-job run | Slow on large batches | Disable `classify` in config if speed matters more than relevance scoring |
| Greenhouse/Lever job descriptions are HTML-heavy | Description field can be noisy after HTML strip | A more aggressive sanitize-html pass (library already installed) could help |
| Pipeline disabled by default on startup | Nothing runs until admin enables it | By design — prevents surprise API calls on first deploy |

---

## 9. File Index

```
backend/src/agents/
├── ingestion/
│   ├── index.js          — Registry, runs sources in parallel
│   ├── arbeitnow.js      — Arbeitnow API
│   ├── remotive.js       — Remotive API
│   ├── remoteok.js       — RemoteOK API
│   ├── wwr.js            — We Work Remotely RSS
│   ├── greenhouse.js     — Greenhouse ATS public boards
│   ├── lever.js          — Lever ATS public boards
│   ├── adzuna.js         — Adzuna API (key optional)
│   └── jooble.js         — Jooble API (key optional)
├── normalization.js      — Common schema mapper
├── deduplication.js      — Fingerprint + DB dedup
├── extraction.js         — Contact extraction (regex + LLM fallback)
├── classification.js     — LLM relevance scoring
├── qa.js                 — QA flag logic
├── storage.js            — DB write with upsert
└── orchestrator.js       — Full pipeline, scheduling, config

backend/src/routes/
└── job-intelligence.js   — REST API (/api/job-intel/*)

backend/src/db/database.js
  → job_postings table (CREATE TABLE IF NOT EXISTS)
  → pipeline_runs table (CREATE TABLE IF NOT EXISTS)
  → pg_trgm extension

backend/src/index.js
  → mounts /api/job-intel router
  → calls schedulePipeline() on startup

frontend/src/components/
└── JobIntelPanel.jsx     — Filterable job list with source/relevance/email badges

frontend/src/App.jsx
  → 'job-intel' tab in NAV_ITEMS
  → /job-intel URL route
  → renders JobIntelPanel

frontend/src/components/AdminPanel.jsx
  → 'Job Intel Pipeline' tab with JobIntelConfigSection
```

---

## 10. Quick Start for a New Developer

1. **Enable the pipeline** in Admin Panel → Job Intel Pipeline → tick "Enable pipeline" → Save Config
2. **Click "Run Pipeline Now"** — first run takes 30–60s for free sources
3. **View results** in the "Job Intelligence" tab (Zap icon in the sidebar)
4. **Add company ATS boards** in the Greenhouse / Lever slug textareas (e.g. `stripe`, `shopify` for Greenhouse)
5. **Optional:** get a free Adzuna key at developer.adzuna.com and add it for India job coverage
6. **Optional:** set the Groq key in Admin Panel → VartaBot AI to enable LLM classification + extraction fallback
7. **Adjust keywords** to match your target roles — these drive both Adzuna/Jooble searches and LLM classification
