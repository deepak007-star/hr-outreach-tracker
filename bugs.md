# Bugs & Findings — HR Outreach Tracker

End-to-end review of the app (Dashboard, Contacts, Templates, Job Analyzer, Bulk Apply, Profile, Notifications, Admin, Apify/LinkedIn integration). Findings only — no fixes applied yet.

---

## 🔴 Critical — Security

### 1. Almost the entire backend API has zero authentication
`backend/src/routes/contacts.js`, `email.js`, `settings.js`, `jobs.js`, `emailTemplates.js`, and `emailVerify.js` have no `requireAuth` middleware at all. Confirmed via direct unauthenticated `curl` calls:
- `GET /api/contacts` → returns all 215 real contacts with unmasked emails (the frontend's "sign in to view" gate is purely cosmetic)
- `POST /api/contacts` / `DELETE /api/contacts/:id` → created and deleted a contact with no credentials
- `GET /api/settings` → **leaked the live SMTP password and Apify API key in plaintext**
- `POST /api/email/send` → nothing stops an unauthenticated caller from sending real email through the configured SMTP account to any contact
- `backend/src/routes/apify.js`'s `PUT /settings` and `DELETE /posts` are also unauthenticated (inconsistent — `POST /scrape` correctly requires admin, but the settings it depends on don't)

<span style="color:green">**Change needed:** Add `router.use(requireAuth)` (matching the pattern already used in `profile.js`, `notifications.js`, `reminder.js`) to `contacts.js`, `email.js`, `settings.js`, `jobs.js`, `emailTemplates.js`, `emailVerify.js`, and the unprotected routes in `apify.js`. Rotate the exposed Gmail app password and Apify API key once fixed, since they were retrievable during this test.</span>

### 2. SSRF in `/api/jobs/scrape`
`backend/src/routes/jobs.js` fetches any `http(s)://` URL server-side with no restriction on private/internal addresses (localhost, cloud metadata IPs, LAN hosts), and — per #1 — needs no auth either.

<span style="color:green">**Change needed:** Require auth on this route, and validate/reject URLs that resolve to private/loopback/link-local IP ranges before fetching.</span>

### 3. Broken authorization in `POST /api/notifications`
`backend/src/routes/notifications.js` lets any logged-in user pass an arbitrary `user_id` (or omit it for a broadcast, `user_id: null`) and plant a notification for/at any other user — no ownership check.

<span style="color:green">**Change needed:** Ignore any client-supplied `user_id` and always target `req.user.userId`; gate broadcast (`user_id: null`) creation behind `requireAdmin`.</span>

### 4. No per-user data isolation despite multi-user auth
`contacts` and `email_templates` tables have no `user_id` column — every registered user shares the exact same contact list and templates. Combined with #1, the "multi-user" framing doesn't hold for the core data.

<span style="color:green">**Change needed:** Add a `user_id` column to `contacts` and `email_templates` (via guarded `ALTER TABLE`, per the project's migration convention), backfill existing rows to the current owning user, and scope every query in these route files by `req.user.userId`. Decide this before fixing #1, since it changes how auth gets wired in.</span>

---

## 🟠 High — Data correctness

### 5. Dashboard "Companies" stat is capped at 12
`frontend/src/components/Dashboard.jsx` reuses a `useMemo`'d array that's `.slice(0, 12)` (meant for the quick-pick buttons) as the source for the KPI count. Actual unique companies in the data: **129** (confirmed via DB query and live UI, which showed "12").

<span style="color:green">**Change needed:** Compute the KPI count from the full `Set` of companies before slicing; keep a separate sliced copy (or slice inline in the JSX) for the quick-pick button list.</span>

### 6. Timestamps are UTC but the app is entirely India-localized
The backend container has no `TZ` set (confirmed via `date -u`). `date_added` uses SQLite's `datetime('now')` (UTC) but is displayed via `toLocaleDateString('en-IN')` with no conversion — a contact added seconds ago showed "17/7/2026" instead of "18/7/2026" because it was ~11:26 PM UTC / ~4:56 AM IST. The same root cause likely affects the activity-calendar day buckets, streak count, and the daily-email-cap "today" boundary (all use UTC `date('now')`).

<span style="color:green">**Change needed:** Set `TZ=Asia/Kolkata` on the backend container (docker-compose environment) so all server-side "today"/date-bucket logic aligns with the app's India-only audience, or store/compare using explicit UTC and convert consistently on display.</span>

### 7. Reminder emails fire ~5.5 hours late
`backend/src/index.js`'s reminder scheduler compares the user's configured time against `new Date().getHours()` on the server — UTC, not IST. A reminder set for "9:00 AM" actually emails at 2:30 PM IST. (In-app toast/browser-notification delivery is unaffected since those run client-side in the browser's own timezone.)

<span style="color:green">**Change needed:** Same root fix as #6 (`TZ=Asia/Kolkata` on the container) resolves this too, since the scheduler already uses local server time — it just needs the container's "local" to be IST.</span>

### 8. Inconsistent "Replied" metric between Dashboard and Contacts page
Dashboard's Response Rate panel counts only `status === 'Replied'` (shows "1 replied"). `frontend/src/components/StatsBar.jsx` on the Contacts page counts `Replied` **and** `Interview` together (shows "2 (1%)"). Same account, same data, two different numbers for a metric labeled the same way.

<span style="color:green">**Change needed:** Pick one definition of "Replied" and use it in both places — likely extract a shared helper (e.g. `getRepliedCount(contacts)`) so Dashboard.jsx and StatsBar.jsx can't drift again.</span>

---

## 🟡 Medium — Correctness / UX

### 9. Missing `key` on list fragments in `ContactTable.jsx`
Each row is returned as a shorthand `<>...</>` fragment from `.map()` with no `key` prop (shorthand fragments can't take one). Can cause React reconciliation glitches when the list is sorted/filtered.

<span style="color:green">**Change needed:** Replace the shorthand `<>` with `<React.Fragment key={c.id}>` for the wrapping fragment inside the `.map()` callback.</span>

### 10. Native `window.confirm()` for deletes
Used for single and bulk contact delete (`App.jsx`), and template delete (`TemplatesPage.jsx`). Inconsistent with the app's custom-styled modals, and directly observed to hang the browser tab during automated testing (blocks the render thread until dismissed).

<span style="color:green">**Change needed:** Replace `window.confirm(...)` calls with a small custom confirmation modal component, consistent with the rest of the app's UI.</span>

### 11. Hardcoded personal identity baked into defaults
The default compose email body (`ComposeModal.jsx`) and all 4 seeded default email templates (`backend/src/routes/emailTemplates.js`) hardcode "Vishal," "4.5 years of experience in Java/Spring Boot, Kafka, Redis," etc. Every new user who signs up gets these as their starting point.

<span style="color:green">**Change needed:** Replace the hardcoded name/experience with generic placeholders (e.g. `[Your Name]`, `[X years of experience in ...]`), or pull from the signed-in user's own Profile data where available.</span>

---

## 🟠 High — Profile Score resume auto-detection (found in button/form testing pass)

Tested live against the account's real uploaded PDF resume (`Deepak_Pal_Resume.pdf`, 34 skills, score 48/100). Each "Action Item" on the Profile Score tab opens an editor that tries to auto-fill the field from `resume_text` via regex in `frontend/src/components/ProfileAnalyzer.jsx`'s `detectFromResume()`. Three of these are broken — verified by opening each, confirming the wrong value appeared, then canceling without saving so no bad data was persisted.

### 12. "Current title" never detects common phrasing like "Full-stack developer"
The resume text contains "Full-stack developer with 1.5+ years..." but the editor showed no "Detected from resume" suggestion at all. The regex `(Senior|...|Full[- ]?Stack|...)[^\n]{4,60}(Engineer|Developer|...)` requires **4–60 characters** between the seniority/type word and the role word — designed for titles like "Senior Backend Software Engineer," but it fails on the single space in "Full-stack **d**eveloper," which is one of the most common title phrasings there is.

<span style="color:green">**Change needed:** Change `{4,60}` to `{0,60}` (or `\s*` for a tighter match) in the `current_title` case of `detectFromResume()` so a seniority/type word immediately followed by the role word still matches.</span>

### 13. "Professional summary" detection grabs the wrong text entirely
Opening the editor pre-filled the textarea with the resume's name/address/contact-links/skills block (the first ~600 characters of the whole document) instead of the actual "PROFESSIONAL SUMMARY" paragraph, which exists further down in the same resume. Root cause: `detectFromResume()`'s `summary` case splits on `\n{2,}` (blank-line paragraph breaks) and takes the first long paragraph — but PDF-extracted text (via `pdf-parse`) has only **one** double-newline in this 4,376-character resume, so `paras[0]` is almost the entire document, which happens to start with "Deepak Pal" (not an excluded keyword like SKILLS/EDUCATION), so it passes the filter and gets returned as "the summary." If a user trusts the suggestion and clicks "Use this" → "Save," their profile summary field gets overwritten with garbage.

<span style="color:green">**Change needed:** Don't rely on blank-line paragraph splitting for PDF-sourced text. Instead, locate the summary by finding the line matching `/^(PROFESSIONAL SUMMARY|SUMMARY|OBJECTIVE)/i` and taking the non-empty lines immediately after it, stopping at the next ALL-CAPS section header — the same section-boundary logic `resumeUtils.js`'s `modifyResume()` already uses.</span>

### 14. "Current company" false-positives on non-company phrases
Opening the editor pre-filled it with **"BullMQ and Redis"** — these are technologies, not an employer. The resume contains "...background job processing with BullMQ and Redis..."; the regex `(?:at|@|with)\s+([A-Z][A-Za-z0-9& ]{2,30}(?:Inc|Ltd|...)?)\b` matches any capitalized phrase after "at/@/with" with no verification it's actually a company name. This is the highest-risk of the three: a short, plausible-looking (if you don't know better) string that a user could easily click "Save" on without noticing it's wrong.

<span style="color:green">**Change needed:** Either drop the generic `with` trigger word (keep only `at`/`@`, which are much more reliably company-introducing in resume text), or cross-check the matched phrase against the same `techSkills.js` skill list used elsewhere in the app and reject a match if it's a known technology.</span>

---

## ✅ Verified working — no bugs found

Tested with sample data this pass; listed so it's clear what's already solid, not just what's broken.

- **Add Contact form** — required-field validation (native HTML5), invalid-email format rejection, and duplicate-email handling (backend correctly returns 409 "A contact with this email already exists," shown to the user) all work correctly.
- **Edit Contact / status change** — saves and reflects immediately in the table.
- **Job Analyzer keyword insertion** (`modifyResume()` in `resumeUtils.js`) — tested against a real job description and the account's real resume: skills were correctly routed to matching existing lines (e.g. "Java" → Languages, "GraphQL"/"Spring Boot" → Backend, "Ansible"/"Jenkins"/"Kubernetes"/"Terraform" → DevOps), and a skill with no matching section ("Apache Kafka," domain "messaging") correctly created a new "Messaging:" line rather than being misplaced. Both "Add All Missing" and "Add Selected" (partial selection) produced correct, non-duplicated results. PDF and Word export of the modified resume both completed without errors.
- **Email Templates** — create, save, and delete all work correctly (delete via native `confirm()`, see #10).
- **SMTP Settings → Test Connection** — correctly validated the live Gmail credentials ("✓ Connected to smtp.gmail.com:587 — credentials valid").
- **Reminder → Test now** — correctly fires the in-app toast preview.
- **Bulk Apply page** — loads correctly, resume pre-fills from Profile, "Analyze All" is correctly disabled with 0 URLs entered.
