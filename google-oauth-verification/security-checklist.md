# Security checklist

Not formally graded for sensitive-scope-only verification (no CASA required for `gmail.send` alone), but this is what protects you and your users regardless — and reviewers do sometimes spot-check the basics (working privacy policy, HTTPS, no obvious secrets exposure).

## Already done in this codebase

- [x] **Encrypt refresh tokens at rest** — `backend/src/services/tokenCrypto.js` uses AES-256-GCM, key from `OAUTH_TOKEN_ENCRYPTION_KEY`. Refresh tokens are never stored in plaintext.
- [x] **HTTPS everywhere** — Render serves both the backend and frontend over HTTPS by default.
- [x] **No client-side secrets** — `GOOGLE_CLIENT_SECRET` only exists in `backend/.env` / Render's backend env vars, never sent to the frontend bundle.
- [x] **Rate limiting the send endpoint** — `backend/src/middleware/rateLimiter.js`, applied in `routes/email.js`, keyed per user.
- [x] **Delete-on-request** — `DELETE /api/oauth/google` (`routes/oauth.js`) removes the stored token immediately when a user disconnects.
- [x] **State-param CSRF protection** — the OAuth `state` value is a short-lived (5 min) signed JWT, not a guessable value, and not the user's real session token.

## Still needed

- [ ] **Least privilege — drop `gmail.readonly`** — the current `GOOGLE_SCOPES` list in `routes/oauth.js` includes `gmail.readonly` (added for the Gmail Sync feature). To stay in the free/sensitive-only verification tier, remove it and keep only `gmail.send` + `openid`/`email`/`profile`. **This is a code change — say the word and I'll make it.**
- [ ] **Graceful token-revocation handling** — if a user revokes access from their Google Account settings directly (not through your app), the next send attempt will fail with a Google `invalid_grant` error. Right now this surfaces as a generic 500 with the raw error message. Worth catching this specific case and showing "Your Gmail connection expired — please reconnect" instead of a raw error. Not required for verification, but good UX.
- [ ] **Custom domain + HTTPS on it** — needed for the Authorized Domains requirement (see `oauth-consent-screen-fields.md`) — Render's shared `onrender.com` subdomain won't be accepted.
- [ ] **Rate limiter durability** — current rate limiting is in-memory and resets on server restart (documented as a known limitation in `CLAUDE.md`). Fine for now; worth moving to a persistent store (DB/Redis) before real scale, not a blocker for verification.
