# Feature Flows — HR Outreach Tracker

End-to-end flow for every feature in the application.

---

## 1. Authentication

### 1.1 Register

```
User fills name / email / password (min 6 chars)
  → POST /api/auth/register
      → authLimiter (10/15min) + authSlowDown (500ms after 5 fails)
      → validate name, email, password
      → check duplicate email (UNIQUE constraint)
      → bcrypt.hash(password, 10)
      → INSERT INTO users (id=uuid, name, email, password_hash, role)
          — if first user in DB → role = 'admin', else 'user'
      → INSERT INTO profiles (user_id, full_name)
      → jwt.sign({ userId, plan='demo', role }, SECRET, { expiresIn:'30d' })
      → Set-Cookie: hr_session (httpOnly, sameSite, 30d)
      → { token, user: { id, name, email, plan, role } }
  → Frontend: localStorage.setItem('hr_token', token), setUser(user)
```

### 1.2 Login (email/password)

```
User fills email + password
  → POST /api/auth/login
      → authLimiter + authSlowDown
      → look up user by email (LOWER), fallback to username
      → bcrypt.compare(password, hash)
      → jwt.sign(...)
      → Set-Cookie: hr_session
      → { token, user }
  → Frontend: same as register
```

### 1.3 "Continue with Google" — Sign-In Flow

```
User clicks "Continue with Google"
  → GET /api/oauth/google/login-start
      → generates state = jwt.sign({ purpose:'google-login' }, SECRET, { expiresIn:'5m' })
      → builds Google consent URL (scopes: gmail.send, gmail.metadata, openid, email, profile)
  → Browser redirected to Google consent screen
  → Google redirects to GOOGLE_REDIRECT_URI (/api/oauth/google/callback)
      → verifies state JWT (purpose = 'google-login')
      → exchanges code for tokens (getToken)
      → verifies id_token (verifyIdToken)
      → finds or creates user by Gmail email
      → stores encrypted refresh_token in oauth_accounts
      → generates 32-byte hex one-time code (60s TTL) → _loginCodes Map
      → redirects to FRONTEND_URL/?google_login_code=<code>
  → AuthContext.jsx detects ?google_login_code
      → strips code from URL immediately
      → POST /api/oauth/exchange { code }
          → validates code, deletes it (single-use)
          → jwt.sign({ userId, plan, role }, SECRET, { expiresIn:'30d' })
          → Set-Cookie: hr_session
          → { token, userId, role, plan }
      → localStorage.setItem('hr_token', token)
      → syncRef.current() → GET /auth/me → setUser()
      → toast.success('Signed in with Google!')
```

### 1.4 Session Persistence

```
Page load:
  → localStorage.getItem('hr_token') present?
    → GET /api/auth/me (Bearer token)
        → requireAuth verifies JWT
        → fetches user row from DB
        → issues fresh 30-day token (_token in response)
        → Frontend updates localStorage + setUser
    → Tab visibility change / window focus → re-runs sync
    → 30s polling interval (while token exists)
    → Cross-tab: storage event on 'hr_token' syncs login/logout
```

### 1.5 Logout

```
User clicks Logout
  → POST /api/auth/logout  (clears hr_session cookie server-side)
  → localStorage.removeItem('hr_token')
  → invalidateCache()
  → setUser(null)
```

### 1.6 Change Password

```
PUT /api/auth/change-password
  → requireAuth
  → bcrypt.compare(currentPassword, hash)
  → bcrypt.hash(newPassword, 10)
  → UPDATE users SET password_hash WHERE id = req.user.userId
```

---

## 2. Contacts (CRM Core)

### 2.1 View Contacts

```
GET /api/contacts?search=&status=&company=&page=1&limit=50&sort=&order=
  → requireAuth
  → builds WHERE clauses: name/email/company ILIKE, status =, company =
  → pagination via LIMIT/OFFSET
  → returns { contacts[], total, page, limit }
Frontend: ContactTable renders rows, StatsBar shows counts
```

### 2.2 Add Contact

```
User fills ContactForm (name*, email*, title, company, status, source_url, tags, notes)
  → validate: name required, email format, source_url format
  → POST /api/contacts { name, email, title, company, status, source_url, tags, notes }
      → requireAuth
      → INSERT INTO contacts ... ON CONFLICT (email) → 409
      → syncExcel() — regenerates HR_Outreach_Tracker.xlsx from full contacts table
  → toast.success, reload contacts list
```

### 2.3 Edit Contact

```
PUT /api/contacts/:id { ...fields }
  → requireAuth
  → UPDATE contacts SET ... WHERE id = ?
  → syncExcel()
```

### 2.4 Delete Contact

```
DELETE /api/contacts/:id
  → requireAuth
  → DELETE FROM contacts WHERE id = ?
  → (email_log rows with this contact_id remain — no cascade)
  → syncExcel()
```

### 2.5 Bulk Operations

```
POST /api/contacts/bulk-delete { ids: [id, id, ...] }
POST /api/contacts/bulk-status { ids, status }
  → requireAuth on both
  → array bound in WHERE id = ANY($1::text[])
  → syncExcel()
```

### 2.6 Import CSV/Excel

```
User selects file in ImportModal
  → POST /api/contacts/import (multipart, Authorization header attached)
      → requireAuth
      → multer: file to /uploads/
      → parse CSV (csv-parse) or Excel (exceljs)
      → upsert each row: INSERT ... ON CONFLICT (email) DO UPDATE SET
      → syncExcel()
  → returns { imported, updated, skipped, errors[] }
```

### 2.7 Export Excel

```
GET /api/contacts/export  (window.open with token in query param or via axios client)
  → requireAuth
  → syncExcel() → returns the .xlsx file stream
```

### 2.8 Email Verification (automatic)

```
On startup + every 24h:
  SELECT contacts WHERE email_verified IN ('pending','unverifiable') OR checked > 23h ago
  → checkEmailDomain(email):
      → DNS MX lookup → 'valid' if MX records exist
      → fallback A record lookup → 'valid' or 'unverifiable'
  → UPDATE contacts SET email_verified, email_checked_at
```

---

## 3. Email Sending (Cold Outreach)

### 3.1 Connect Gmail (Settings)

```
Logged-in user clicks "Connect Google" in SmtpSettingsModal
  → GET /api/oauth/google/start (requireAuth)
      → state = jwt.sign({ userId, purpose:'google-oauth' }, SECRET, { expiresIn:'5m' })
      → returns { url } — Google consent URL
  → Frontend opens url in new window
  → Google consent → /api/oauth/google/callback
      → verifies state (purpose='google-oauth', extracts userId)
      → exchanges code → tokens
      → stores encrypted refresh_token in oauth_accounts (user_id, provider='google')
  → Redirects to FRONTEND_URL/?oauth=connected
  → SmtpSettingsModal polls /oauth/status → shows "Connected: user@gmail.com"
```

### 3.2 Compose & Send Single Email

```
User clicks "Compose" on a contact
  → ComposeModal opens (pre-fills to/subject from contact + template)
  → User edits subject (required) + body (required, RichEditor)
  → Optionally attaches file (AttachmentPicker)
  → Click "Send"
  → POST /api/email/send { contactId, subject, body, attachmentPath }
      → requireAuth
      → 14-day duplicate-send guard: check email_log for same contact sent within 14 days
      → daily cap check: SELECT COUNT(*) FROM email_log WHERE LEFT(sent_at,10)=today (currently global)
      → getTransportForUser(userId): OAuth2 Gmail or fallback SMTP
      → nodemailer sendMail
      → INSERT INTO email_log (id, contact_id, user_id, sent_at, subject, body_snapshot, delivery_status='sent')
      → UPDATE contacts SET status='Emailed', date_last_contacted=now
      → syncExcel()
  → toast.success
```

### 3.3 Bulk Email

```
User selects N contacts → "Compose to All"
  → ComposeModal opens in bulk mode
  → POST /api/email/bulk-send { contactIds[], subject, body }
      → per-contact: same flow as 3.2
      → respects daily cap — stops when cap reached
  → returns { sent, skipped, errors }
```

### 3.4 Daily Send Cap

- Default: 20 emails/day (configurable in Settings)
- Stored in `settings.daily_send_cap`
- Currently **global** across all users (known issue — see bug tracker)

### 3.5 Bounce / Do-Not-Contact Logic

```
Incoming bounce webhook or /api/email/bounce:
  → UPDATE contacts SET status='Do Not Contact', email_deliverable='bounced'
  → UPDATE contacts SET bounce_count++, last_bounce_at, bounce_reason
  → UPDATE email_log SET delivery_status='bounced', bounced_at, bounce_reason
  → INSERT INTO email_delivery_events (event_type='bounce', ...)
```

---

## 4. Email Templates

```
GET  /api/email-templates         → list all templates (requireAuth)
POST /api/email-templates         → create (name*, subject*, body*) — validates before save
PUT  /api/email-templates/:id     → update
DELETE /api/email-templates/:id   → delete
POST /api/email-templates/:id/default → set as default template
```

Templates have `category`, `tags[]`, and optional `attachment_json` (pre-wired attachment).
Validation (frontend): name required, subject required, body text (stripping HTML) required.

---

## 5. LinkedIn Feed (HR Hiring Posts)

### 5.1 View Feed

```
GET /api/linkedin-feed?since=24h&limit=500&location=India
  → requireAuth
  → returns merged posts from:
      - scraped_jobs WHERE scraper_type='linkedin-feed' (date-filtered)
      - linkedin_posts (Apify — if toggle enabled)
  → Frontend: LinkedInPosts renders cards with filter tabs (all/email/phone)
```

### 5.2 Scrape LinkedIn Feed (Manual)

```
Admin clicks "Scrape Now" in Admin Panel (Apify section)
  → POST /api/apify/scrape (requireAdmin)
      → calls Apify actor with configured search queries + maxPosts
      → stores results in linkedin_posts table
```

### 5.3 Auto-Scrape (Daily)

```
7 AM IST daily (5-min check interval):
  → runScraperHeadless('linkedin-feed', { titles, limit:40 })
      → scrapers/linkedin-feed.js: searches LinkedIn + Twitter + Telegram
      → stores in scraped_jobs (scraper_type='linkedin-feed')
      → dedupes on post URL
  → notification inserted for all users
```

### 5.4 Feed → Contact (Extract HR Contact)

```
User clicks "Add to Contacts" on a post
  → POST /api/contacts (author email, name, title, company from post)
  → Contact appears in Contacts tab for outreach
```

---

## 6. Job Scraper

### 6.1 Run Scraper (Manual)

```
Admin/User in Job Scraper section selects scraper + keywords + params
  → POST /api/scraper/run { scraper, titles, limit, since, category }
      → requireAuth
      → runScraperHeadless(scraper, body) — spawns scraper module
      → streams progress via SSE (EventSource) to frontend
      → stores results in scraped_jobs
  → Frontend: JobScraperSection shows live log lines
```

### 6.2 View Scraped Jobs (with per-user profile filtering)

```
GET /api/scraped-jobs?category=general&since=7d&search=&page=1&limit=20
  → requireAuth
  → date filter on scraped_at (TEXT comparison — same format as all date cols)
  → returns paginated job cards
Frontend: Jobs tab, filter by category (general/remote/international)

Per-user auto-filter (2026-07):
  → On mount, JobScraperSection loads /api/profile
  → If user has job_title_1/2/3 or current_title set AND search box is empty:
      → passes profile's first title as ?search= to /api/scraped-jobs
      → shows blue banner: "Showing jobs for your profile: [title]  |  Show all jobs →"
  → User can click "Show all jobs →" to pause profile filter (suppressProfileFilter state)
      → shows amber banner: "Showing all jobs (profile filter paused). ← Filter by profile"
  → Typing in search box overrides profile filter entirely
  → Profile filter resets to active whenever a new profile is loaded
```

### 6.3 Job Description Analyzer

```
User pastes URL or job text in JobAnalyzer
URL path:
  → POST /api/jobs/scrape { url }
      → scrapeLimiter (20/hr)
      → server-side fetch with 12s timeout + cheerio HTML parsing
      → returns { title, content, url }
ATS analysis (client-side, atsUtils.js):
  → extracts keywords from job description
  → compares against user's profile skills
  → scores resume match (0–100)
  → returns missing keywords + suggestions
```

### 6.4 Bulk Job Analyzer

```
User pastes N URLs (one per line) in BulkJobAnalyzer
  → validates each URL format (new URL() check)
  → POST /api/jobs/scrape for each URL (sequential)
  → analyzeATS() for each
  → table view: job title, match score, missing keywords
```

---

## 7. Profile & Resume

### 7.1 Overview Tab

```
GET /api/profile (requireAuth) → returns profiles row for req.user.userId
User edits: full_name, current_title, current_company, location, phone (validated format)
  → PUT /api/profile { ...fields }
      → UPDATE profiles SET ... WHERE user_id = ?
```

### 7.2 Skills Tab

```
GET /api/profile/skills → profiles.skills (JSON array)
User adds skill (autocomplete from techSkills.js + skillSuggestions.js)
  → PUT /api/profile/skills { skills: [...] }
User uploads resume:
  → POST /api/profile/resume (multipart)
      → multer: 5MB max, whitelist: pdf/docx/doc/txt
      → pdf-parse / mammoth for text extraction
      → UPDATE profiles SET resume_text, resume_filename, resume_file_path
```

### 7.3 Links Tab

```
User edits linkedin_url, github_url, portfolio_url
  → validated with new URL() before save
  → PUT /api/profile/links
```

### 7.4 Profile Score Tab

```
ProfileAnalyzer.jsx computes score from profiles row:
  - photo, headline, summary, skills count, links, resume
  → Shows score out of 100 + action items with "detect from resume" suggestions
detectFromResume(field, resumeText):
  → current_title: regex for title patterns (Senior/Full-Stack/Developer etc.)
  → current_company: regex for "at/@ <Company>"
  → summary: section-boundary search for PROFESSIONAL SUMMARY heading
```

### 7.5 Resume Versions

```
GET /api/resume-versions → list for req.user.userId
POST /api/resume-versions { label, resume_text, target_role, skills, is_ats_template }
PUT /api/resume-versions/:id
DELETE /api/resume-versions/:id
Frontend: ResumePreview renders selected version with ATS template styling
```

---

## 8. Gmail Tracking (Inbox Sync)

```
Connect Gmail:
  → GET /api/gmail/connect-start (requireAuth)
      → state = jwt.sign({ userId, nonce }, SECRET, { expiresIn:'5m' })
      → Google consent URL (gmail.metadata, gmail.send scopes)
  → Callback: stores Gmail tokens in gmail_tokens table
Sync inbox:
  → GET /api/gmail/sync (requireAuth)
      → Gmail API list messages (inbox, from user, last 30 days)
      → for each message: fetch headers (to, subject, date)
      → match contact by email
      → upsert into gmail_tracked_emails
      → check for replies: thread message count > 1 AND last message From is not user
      → UPDATE email_status = 'replied' / 'opened'
View:
  → GET /api/gmail/emails → gmail_tracked_emails for req.user.userId
  → GmailEmailList renders with status badges
Reply detection:
  → Thread has multiple messages AND last message From: header doesn't match user's Gmail email
```

---

## 9. Password Vault

```
GET    /api/vault      → SELECT from password_vault WHERE user_id = req.user.userId
POST   /api/vault      → INSERT { title, username, password_enc(AES-GCM), iv, tag, url, category, notes }
PUT    /api/vault/:id  → UPDATE WHERE id=? AND user_id=? (ownership enforced)
DELETE /api/vault/:id  → DELETE WHERE id=? AND user_id=?
```

Password encryption: AES-256-GCM client-side (`vaultCrypto.js`) using a key derived from the user's master passphrase. The encrypted blob + IV + auth tag are stored. The plaintext password never hits the server.

Password reveal: 30-second auto-hide timer in frontend (`PasswordVault.jsx`).

---

## 10. Referrals (Community)

```
View community:
  → GET /api/referrals/users → users with name, profile skills, location, LinkedIn
  → AskReferral renders cards, searchable by name/skills/company
Send referral request:
  → POST /api/referrals/request { to_user_id, subject, message }
      → requireAuth
      → INSERT INTO referral_requests (from_user_id, to_user_id, subject, message, status='pending')
      → Sends email to target user via getTransportForUser
  → limit per configured settings.referral_request_limit
View received requests:
  → GET /api/referrals/received → WHERE to_user_id = req.user.userId
Update status:
  → PUT /api/referrals/:id/status { status: 'accepted'|'rejected' }
```

---

## 11. Admin Panel

### 11.1 User Management

```
GET /api/admin/users  → all users with role, plan, created_at (requireAdmin)
PUT /api/admin/users/:id/role { role }  → change role
PUT /api/admin/users/:id/plan { plan }  → change plan
DELETE /api/admin/users/:id  → delete user
```

### 11.2 Leads Kanban

```
GET /api/leads (requireAdmin) → all waitlist signups
PUT /api/leads/:id { status, notes } → move through Kanban (new → contacted → qualified → converted)
DELETE /api/leads/:id → remove lead
```

### 11.3 RBAC (Roles & Permissions)

```
GET  /api/rbac/roles              → all roles + their permissions
POST /api/rbac/roles              → create custom role
PUT  /api/rbac/roles/:id/permissions { permissionIds[] } → assign permissions
DELETE /api/rbac/roles/:id        → delete (non-system only)

Permissions are resolved from role_permissions JOIN.
Permission cache: in-memory Map, 5-min TTL, keyed by userId.
```

### 11.4 Data Purge

```
PUT /api/admin/purge-config { enabled, retention_days }
  → saves to settings.purge_config JSON
  → daily background job deletes scraped_jobs WHERE created_at < cutoff
POST /api/admin/purge-now
  → immediate purge (admin-triggered)
```

### 11.5 GitHub Backup

```
PUT /api/github-backup/config { enabled, token, owner, repo }
  → saves to settings.github_backup_config
Daily automatic:
  → loads last 30 days of scraped_jobs + last 500 contacts
  → JSON.stringify → base64 → Octokit.repos.createOrUpdateFileContents
  → path: snapshots/YYYY-MM-DD.json
```

### 11.6 Apify Scraper Config

```
GET /api/apify/settings  → { searchQueries, maxPosts } from settings table
PUT /api/apify/settings  → update queries + maxPosts (requireAdmin)
POST /api/apify/scrape   → trigger manual Apify scrape (requireAdmin)
DELETE /api/apify/posts  → clear linkedin_posts table (requireAdmin)
```

---

## 12. Reminder Emails

```
User opens ReminderModal:
  → sets time (HH:MM), days (Mon/Tue/...Sun), delivery methods (email + optional in-app)
  → validates: time required, at least 1 day, at least 1 method
  → PUT /api/reminder/config { time, days, deliveryEmail, enabled }
      → stored as settings row: key = 'reminder_<userId>', value = JSON config

Background scheduler (every 1 min, index.js):
  → reads all reminder_* settings rows
  → for each config: check time match (HH:MM) + day match
  → check dedup key reminder_email_sent_<userId>_<date>
  → if match + not yet sent: sendReminderEmail(userId, email, name, config)
      → getTransportForUser(userId) → sends via user's Gmail or SMTP fallback
      → marks sent (dedup key stored in settings)

POST /api/reminder/test  → sends immediate test reminder email
```

---

## 13. Notifications

```
GET  /api/notifications?unread=true  → notifications for req.user.userId + broadcast (user_id IS NULL)
POST /api/notifications { type, title, body, user_id }
  → user_id is always overridden to req.user.userId (broadcast only allowed for admin)
PUT  /api/notifications/:id/read    → mark single read
PUT  /api/notifications/read-all    → mark all read for user
DELETE /api/notifications/:id       → delete
```

System automatically inserts notifications after daily scrape completes.

---

## 14. Plans Page

```
Frontend: PlansModal renders plan cards (Guest / Basic / Advanced)
Triggered by:
  - "Crown Upgrade" button in Header (top-right, for non-Advanced logged-in users)
  - "Plans" button in Header (for Advanced users and guests)
  - Crown + "Upgrade" / "Plans" in main nav tab bar (always visible, pinned right)
  - "Pricing" link in LandingPage top nav (for logged-out visitors)
Backend: plan stored in users.plan column (values: 'guest', 'demo', 'basic', 'advanced')
Plan gates: enforced client-side (contact visibility cap) + RBAC permission checks
Payment: Razorpay inline checkout (see feature 18 for full setup)
```

Plan limits:
| Plan | Contacts visible | Emails/day |
|------|-----------------|------------|
| Guest | 5 | — |
| Demo | 10 | 10 |
| Basic | 100 | 50 |
| Advanced | Unlimited | 200 |

---

## 15. Early Access / Waitlist

```
EarlyAccessBanner (public, unauthenticated):
  Step 1: validate email format + mobile format
  Step 2: validate LinkedIn URL
  → POST /api/leads { name, email, mobile, linkedin_url, plan_interest, ... }
      → leadLimiter (5/hr per IP)
      → upsert by email (UPDATE existing or INSERT new)
  → Leads appear in Admin → Leads Kanban
```

---

## 16. Delivery Tracking

```
Email delivery events stored in email_delivery_events table.
Per-user monthly stats in delivery_billing_stats table.
GET /api/delivery/stats   → delivery stats for req.user.userId
GET /api/delivery/events  → event log (bounce, sent, delivered)
Bounce webhook: POST /api/delivery/bounce
  → updates email_log.delivery_status + contacts.email_deliverable
```

---

## 17. VartaBot (Groq AI Chatbot) — Added 2026-07

### 17.1 Overview

VartaBot is an in-app AI assistant powered by Groq's `llama-3.3-70b-versatile` model. It helps users navigate the app, answers questions about plans/pricing/features, and collects feedback.

Visible to everyone — guests get a "sign in to chat" prompt instead of a real API call.

### 17.2 Architecture

```
User sends message
  → if !user (guest):
      → appends __LOGIN_PROMPT__ sentinel to messages
      → renders sign-in card instead of API call
  → if user (authenticated):
      → POST /api/chatbot/message { message, sessionId }
          → requireAuth
          → get or create chat_sessions row (UUID PK, user_id FK)
          → fetch last 12 messages from chat_messages for context
          → buildSystemPrompt():
              → BASE_SYSTEM_PROMPT (app navigation guide, plans, troubleshooting)
              → + chatbot_knowledge rows (admin-editable Q&A pairs)
              → + last 8 low-rating feedback summaries (avoids repeating bad answers)
          → Groq.chat.completions.create({ model, messages, max_tokens:1024, temperature:0.65 })
          → INSERT INTO chat_messages for user + assistant
          → returns { reply, sessionId, messageId }
  → User rates reply 1–5 stars (MessageBubble StarRating component)
      → POST /api/chatbot/feedback { sessionId, messageId, rating, summary? }
      → rating ≤ 2 prompts optional feedback textarea
      → low-rating summaries feed back into buildSystemPrompt() to improve future answers
```

### 17.3 Required Env Var

```
GROQ_API_KEY=gsk_...     # Get from console.groq.com — free tier available
GROQ_MODEL=llama-3.3-70b-versatile  # Optional; this is the default
```

### 17.4 DB Tables

| Table | Purpose |
|---|---|
| `chat_sessions` | One session per active conversation (UUID PK, user_id, ended_at) |
| `chat_messages` | All messages in a session (role: user/assistant, content TEXT) |
| `chat_feedback` | Star ratings + optional text summary per assistant message |
| `chatbot_knowledge` | Admin-editable Q&A pairs injected into every system prompt |

### 17.5 Admin Knowledge Base

```
POST /api/chatbot/knowledge { category, question, answer }  → requireAdmin
GET  /api/chatbot/knowledge                                 → requireAdmin
DELETE /api/chatbot/knowledge/:id                           → requireAdmin
GET  /api/chatbot/stats                                     → requireAdmin (session/message/avg-rating counts)
GET  /api/chatbot/feedback                                  → requireAdmin (all feedback with user email)
```

---

## 18. Razorpay Payment Gateway — Added 2026-07

### 18.1 Overview

Razorpay replaces Stripe. Uses the Razorpay **Subscriptions** API with an inline JavaScript checkout modal (no redirect). Payment verification uses HMAC-SHA256.

### 18.2 Setup — What You Need to Configure

**Step 1 — Create a Razorpay account**
1. Go to https://dashboard.razorpay.com
2. Sign up (or log in) and complete KYC
3. Switch to "Test Mode" for development

**Step 2 — Get API keys**
1. Dashboard → Settings → API Keys
2. Click "Generate Test Key"
3. Copy **Key ID** and **Key Secret**
4. Add to `backend/.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXX
   RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXXXXXXX
   ```
5. Add the **Key ID** (only, never the secret) to `frontend/.env`:
   ```
   VITE_RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXX
   ```

**Step 3 — Create subscription plans in Razorpay dashboard**
1. Dashboard → Products → Plans → Create Plan
2. Create two plans:
   - **Basic**: ₹299/month, interval=monthly
   - **Advanced**: ₹599/month, interval=monthly
3. Copy each plan's Plan ID (format: `plan_XXXXXXXXXXXX`)
4. Add to `backend/.env`:
   ```
   RAZORPAY_PLAN_BASIC=plan_XXXXXXXXXXXX
   RAZORPAY_PLAN_ADVANCED=plan_XXXXXXXXXXXX
   ```

**Step 4 — Set up webhook (for automatic plan updates)**
1. Dashboard → Settings → Webhooks → Add New Webhook
2. Webhook URL: `https://your-backend-domain.com/api/payments/webhook`
   - For local dev use ngrok: `ngrok http 3001` → copy the HTTPS URL
3. Select events: `subscription.activated`, `subscription.completed`, `subscription.halted`, `payment.captured`
4. Set a webhook secret and add to `backend/.env`:
   ```
   RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
   ```

**Step 5 — Add Razorpay checkout script to frontend**

In `frontend/index.html`, add before `</head>`:
```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

### 18.3 Full Payment Flow

```
User clicks "Upgrade" → selects plan → clicks "Subscribe"
  → POST /api/payments/create-subscription { plan: 'basic'|'advanced' }
      → requireAuth
      → getRazorpay() (lazy init with RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET)
      → razorpay.subscriptions.create({ plan_id, total_count:12, quantity:1, customer_notify:1 })
      → returns { subscriptionId, keyId, amount, currency, name, description, prefill }
  → Frontend: new window.Razorpay({ key, subscription_id, ...prefill, handler })
  → User completes payment in Razorpay modal (UPI / card / net banking / wallet)
  → Razorpay calls handler({ razorpay_payment_id, razorpay_subscription_id, razorpay_signature })
  → POST /api/payments/verify { paymentId, subscriptionId, signature }
      → HMAC verify: crypto.createHmac('sha256', KEY_SECRET).update(paymentId + '|' + subscriptionId)
      → if valid: UPDATE users SET plan = targetPlan
      → if valid: UPSERT subscriptions (user_id, razorpay_subscription_id, razorpay_payment_id, plan, status='active')
      → returns { success: true, plan }
  → Frontend: re-fetches user via /auth/me, updates plan badge in Header
```

### 18.4 Webhook Flow (automatic plan enforcement)

```
Razorpay → POST /api/payments/webhook (raw body, no JSON parser)
  → HMAC-SHA256 verify: Razorpay-Signature header vs. crypto.createHmac(webhook_secret).update(rawBody)
  → if invalid: 400
  → parse JSON event
  → subscription.activated  → UPDATE users SET plan = activePlan
  → subscription.completed  → UPDATE users SET plan = 'demo' (subscription ended)
  → subscription.halted     → UPDATE users SET plan = 'demo' (payment failed)
  → payment.captured        → (no action; already handled by /verify)
```

### 18.5 Env Vars Summary

| Var | Where | Purpose |
|---|---|---|
| `RAZORPAY_KEY_ID` | `backend/.env` | API key ID (used in API calls + sent to frontend) |
| `RAZORPAY_KEY_SECRET` | `backend/.env` | API key secret (never sent to frontend) |
| `RAZORPAY_PLAN_BASIC` | `backend/.env` | Plan ID for Basic ₹299/mo (from Razorpay dashboard) |
| `RAZORPAY_PLAN_ADVANCED` | `backend/.env` | Plan ID for Advanced ₹599/mo (from Razorpay dashboard) |
| `RAZORPAY_WEBHOOK_SECRET` | `backend/.env` | Webhook signing secret (from dashboard Webhooks page) |
| `VITE_RAZORPAY_KEY_ID` | `frontend/.env` | Same Key ID as above — passed to `new window.Razorpay()` |

### 18.6 Backend API Routes

```
GET  /api/payments/config          → { keyId } — public, no auth (for frontend init)
GET  /api/payments/subscription    → current subscription details (requireAuth)
POST /api/payments/create-subscription { plan } → returns subscriptionId (requireAuth)
POST /api/payments/verify { paymentId, subscriptionId, signature } → verifies + upgrades (requireAuth)
POST /api/payments/cancel          → cancel current subscription (requireAuth)
POST /api/payments/webhook         → Razorpay webhook (no auth, HMAC verified)
GET  /api/payments/all             → all subscriptions (requireAdmin)
PUT  /api/payments/admin/plan/:userId { plan } → manual plan override (requireAdmin)
```

### 18.7 Test Cards (Razorpay Test Mode)

| Card | Number | Expiry | CVV |
|---|---|---|---|
| Success | 4111 1111 1111 1111 | Any future date | Any 3 digits |
| Failure | 4000 0000 0000 0002 | Any future date | Any 3 digits |

UPI Test ID: `success@razorpay` (always succeeds)

---

## 19. URL Routing (SPA) — Added 2026-07

Tab navigation now updates the browser URL. Direct links, bookmarks, browser back/forward all work.

### Tab → URL mapping

| Tab ID | URL path |
|---|---|
| home | `/` |
| contacts | `/contacts` |
| job-scraper | `/jobs` |
| templates | `/templates` |
| jobs | `/analyzer` |
| bulk | `/bulk-apply` |
| resume-vault | `/vault` |
| referrals | `/referrals` |
| profile | `/profile` |
| admin | `/admin` |

### Implementation

```
App.jsx:
  const [activeTab, setActiveTab] = useState(() => getTabFromPath(window.location.pathname))
  
  goTo(tabId):
    → setActiveTab(tabId)
    → window.history.pushState({ tabId }, '', TAB_PATHS[tabId])

  navigateTo(tabId, requiresAuth):
    → if requiresAuth && !user: show auth modal
    → if profile dirty & leaving profile tab: show unsaved changes modal
    → else: goTo(tabId)

  popstate listener:
    → window.addEventListener('popstate', e => setActiveTab(e.state?.tabId || getTabFromPath(pathname)))

  All direct setActiveTab() calls replaced with goTo() to keep URL in sync.
```

---

## 20. Landing Page Social Links — Added 2026-07

The LandingPage footer now includes social media icons and a "Connect" column.

```
Footer layout (flex-row on desktop, stacked on mobile):
  [Brand + tagline + social icons]  |  [Product links]  |  [Connect links]

Social icons (circular buttons, hover effect):
  LinkedIn → https://linkedin.com  (update to actual profile URL)
  GitHub   → https://github.com    (update to actual repo URL)
  Twitter/X → https://twitter.com  (update to actual handle URL)
  Email    → mailto:support@hroutreach.app

Connect column (text links with brand icon):
  LinkedIn, GitHub, Twitter/X, Contact Us (mailto)

Copyright bar:
  "© 2026 HR Outreach Tracker. All rights reserved."  |  "Made with ❤️ in India"
```

To update social URLs: edit `frontend/src/components/LandingPage.jsx` footer section, replace `href` values on the `<a>` tags.
