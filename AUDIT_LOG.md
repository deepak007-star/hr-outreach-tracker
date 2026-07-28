# Audit Log — HR Outreach Tracker

All significant changes, security fixes, and bug resolutions are recorded here for auditing purposes.
Each entry includes the date, severity, file(s) changed, root cause, and fix applied.

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
