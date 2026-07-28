# Audit Log — HR Outreach Tracker

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
