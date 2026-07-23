# Security Reference — HR Outreach Tracker

## 1. Authentication Model

### Token Storage
- **Primary**: `localStorage.hr_token` (JWT, readable by JS) — used as `Authorization: Bearer` header on every API call
- **Secondary**: `hr_session` httpOnly cookie — cannot be read by JS, provides defence if localStorage is compromised
- Both are issued on login/register/OAuth exchange and refreshed on every `GET /auth/me` call

### JWT
- Algorithm: HS256 (default jsonwebtoken)
- Payload: `{ userId, plan, role, iat, exp }`
- Secret: `JWT_SECRET` env var (falls back to hardcoded `'hr-tracker-local-secret-2026'` — **must be set in production**)
- Expiry: 30 days, rolled on every `/auth/me` call (sliding session)

### Session Cookie
```js
{
  httpOnly: true,
  secure: isProd,           // HTTPS only in production
  sameSite: isProd ? 'none' : 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/'
}
```

### No Server-Side Revocation
JWTs are stateless — a stolen token remains valid for up to 30 days unless the user changes their password (which does NOT invalidate outstanding tokens). This is a known limitation.

---

## 2. Rate Limiting

All limits are in-memory (via `express-rate-limit`). They reset on server restart and do not work across multiple Node processes. Use Redis adapter for production multi-process deployments.

| Limiter | Routes | Limit | Window |
|---|---|---|---|
| `globalApiLimiter` | All `/api/*` | 300 requests | 15 minutes |
| `authLimiter` | POST `/auth/register`, POST `/auth/login` | 10 requests | 15 minutes |
| `authSlowDown` | Same as above | +500ms delay after 5 fails, max 5s delay | 15 minutes |
| `scrapeLimiter` | POST `/jobs/scrape` | 20 requests | 1 hour |
| `leadLimiter` | POST `/leads` | 5 requests | 1 hour |

Rate limit key: `req.ip` (requires `app.set('trust proxy', 1)` to get accurate IP behind nginx/Docker).

---

## 3. Security Headers (helmet)

```
Content-Security-Policy:
  default-src: 'self'
  script-src: 'self'
  style-src: 'self' 'unsafe-inline'
  img-src: 'self' data: https:
  connect-src: 'self'
  font-src: 'self' https: data:
  object-src: 'none'
  frame-ancestors: 'none'
X-Frame-Options: DENY (from frame-ancestors 'none')
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
HSTS: max-age=15552000 (in production)
crossOriginEmbedderPolicy: disabled (needed for PDF preview iframes)
```

---

## 4. CORS

Only origins in `FRONTEND_URL` (comma-separated env var) are allowed. Credentials (`credentials: true`) is required for the httpOnly cookie.

---

## 5. Body Sanitization (XSS Prevention)

`bodySanitizer` middleware applied globally (before all routes):
- Recursively walks every string field in `req.body`
- Strips: `<script>...</script>` blocks, `on*=` event attributes, `javascript:` protocol
- Does **not** fully HTML-escape — it strips dangerous patterns. For full HTML sanitization (email body), use `sanitize-html` on the backend (pending — see open issues).

---

## 6. Google OAuth Security

### Connect Gmail (Authenticated Users)
- State: signed JWT `{ userId, purpose:'google-oauth' }` with 5-minute expiry
- Validated on callback: `jwt.verify(state, SECRET)`
- Prevents CSRF state forgery

### Sign In With Google
- State: signed JWT `{ purpose:'google-login' }` with 5-minute expiry
- **One-time exchange code pattern** (implemented 2026-07):
  - Callback generates 32-byte cryptographically random hex code
  - Stores in `_loginCodes` Map with 60-second TTL
  - Redirects to `FRONTEND_URL/?google_login_code=<code>` (not JWT!)
  - Frontend strips code from URL immediately, POSTs to `/api/oauth/exchange`
  - Exchange endpoint validates + deletes code (single-use), issues real JWT
  - Real JWT never appears in URL, browser history, server logs, or Referer headers
- TTL cleanup: setInterval every 60s removes expired codes from Map

### Refresh Token Storage
- Refresh tokens encrypted at rest: AES-256-GCM via `services/tokenCrypto.js`
- Key: `OAUTH_TOKEN_ENCRYPTION_KEY` (32-byte hex) — **must be set in production**
- Stored in `oauth_accounts.refresh_token`

### Gmail Scopes
- `gmail.send` — send email (sensitive scope, not restricted; works in Testing mode without CASA)
- `gmail.metadata` — headers/labels only, no body (restricted scope — needs Google CASA for >100 test users)
- `openid`, `email`, `profile` — identity

---

## 7. Password Security

- bcrypt, cost factor 10
- Minimum 6 characters (enforced server-side)
- No password is ever stored for Google-auth-only users (random bcrypt hash is stored to satisfy NOT NULL)

---

## 8. Encryption At Rest

- Gmail/OAuth refresh tokens: AES-256-GCM (tokenCrypto.js)
- Password vault entries: AES-256-GCM client-side (vaultCrypto.js — plaintext never reaches server)

---

## 9. Safe Error Handling

`safeErrorHandler` (last middleware in the chain):
- Logs full error + stack server-side via `console.error`
- Returns only `{ error: 'Internal server error' }` to the client (status 500)
- Prevents stack traces, file paths, SQL errors, and internal messages from leaking

---

## 10. File Upload Security

- Resume upload: multer, max 5MB, extension whitelist (.pdf, .docx, .doc, .txt)
- CSV/Excel import: multer, max 5MB
- Files stored in `/uploads/` directory (bind-mounted in Docker)
- **Known gap**: MIME type is not verified (only file extension) — a renamed .exe passes

---

## 11. Open Security Issues (as of 2026-07)

These are tracked and accepted / deferred:

| Severity | Issue | Status |
|---|---|---|
| High | HTML injection in outgoing email body (body from req.body not sanitized with sanitize-html) | Open — add `sanitize-html` to email route |
| High | Daily email cap is global across all users (not per-user) | Open — needs `WHERE user_id = ?` in cap query |
| High | `/send-feed-emails` bypasses daily email cap entirely | Open |
| High | SMTP test endpoint not rate-limited | Open |
| High | All users can see all other users' emails in referrals | Open |
| High | `fromName` / `name` fields not sanitized before email header injection | Open |
| High | Contacts table has no `user_id` — data shared across all users | Open (major schema change) |
| Medium | No server-side JWT revocation on password change | Open |
| Medium | `JWT_SECRET` env var not set warning on startup | Open |
| Medium | Rate limiting is in-memory only (not Redis — bypassed in multi-process) | Accepted for current scale |
| Low | `window.confirm` still used in some delete flows | Open |
| Low | Avatar crash on single-space display name | Open |
| Low | No accessibility (aria/focus-trap) on modals | Open |
| Low | SMTP password not pre-populated in settings modal (must re-enter) | Open |
