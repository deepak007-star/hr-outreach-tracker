# Google OAuth Verification — Status & Folder Guide

Goal: get `gmail.send` verified by Google for free (no CASA, no per-user cap), so any real user can connect their Gmail and send outreach mail through HR Outreach Tracker.

## What's already done (in the codebase)

- [x] Full OAuth2 flow implemented — `backend/src/routes/oauth.js` (connect flow + "Sign in with Google" login flow).
- [x] Refresh tokens encrypted at rest — `backend/src/services/tokenCrypto.js` (AES-256-GCM).
- [x] Sending goes through the connected Gmail account for every mail path — `backend/src/services/mailTransport.js`, used by `email.js`, `referrals.js`, `reminder.js`, `scraped-jobs.js`.
- [x] Disconnect/revoke endpoint — `DELETE /api/oauth/google`.
- [x] Rate limiting on sends — `backend/src/middleware/rateLimiter.js`.
- [x] CSRF-safe OAuth `state` (signed, short-lived JWT).
- [x] HTTPS on the current Render deployment.
- [x] `gmail.readonly` dropped from `GOOGLE_SCOPES` in `routes/oauth.js` — scope is now `gmail.send` + `openid`/`email`/`profile` only. Gmail Sync's read calls now fail with a clear "not available" message instead of a raw Google error (`routes/gmail.js`'s `friendlyGmailError`), rather than crashing or leaking a confusing API error.
- [x] Privacy policy and terms of service pages built as real static pages — `frontend/public/privacy.html` and `frontend/public/terms.html`. Confirmed they land in the production build (`npm run build` → `dist/privacy.html`, `dist/terms.html`) and serve correctly in dev. **Not yet deployed** — will go live at `https://hr-outreach-tracker-frontend.onrender.com/privacy.html` / `/terms.html` once you push and Render redeploys.

Details and what's still pending on the security side: see `security-checklist.md`.

## What's ready in this folder (copy/paste/adapt, zero cost)

| File | What it's for |
|---|---|
| `privacy-policy.md` | Full privacy policy, including the Gmail-specific section Google's reviewers read closely. Ready to publish as a page on your domain. |
| `terms-of-service.md` | Full ToS, including the "sending on your behalf" / anti-abuse language Google checks for. |
| `scope-justification.md` | The exact text to paste into the verification form's scope-justification field, plus answers to common follow-up questions. |
| `demo-video-script.md` | Word-for-word script + shot checklist for the required screen-recording demo. |
| `oauth-consent-screen-fields.md` | Field-by-field values for the Google Cloud Console OAuth consent screen form, plus the custom-domain requirement explained below. |
| `security-checklist.md` | What's already implemented vs. what's still open, mapped to actual files in the codebase. |

## What YOU still need to do (can't be done for you)

These require access to accounts/assets only you have:

1. **Buy a custom domain** (~$10-15/yr) — Google's "Authorized domains" field rejects shared subdomains like `onrender.com`. This is the one unavoidable cost in the whole process. See `oauth-consent-screen-fields.md` for the exact reason and steps.
2. **Point the domain at your Render deployment** and verify it in [Google Search Console](https://search.google.com/search-console).
3. **Provide a support email**, **your name/company name**, and **a 120×120px logo PNG** — used to fill the `[SUPPORT EMAIL]` / `[YOUR NAME OR COMPANY NAME]` / `[YOUR JURISDICTION]` placeholders still in `frontend/public/privacy.html`, `frontend/public/terms.html`, and the two `.md` source files.
4. **Deploy** (commit + push) so `privacy.html`/`terms.html` actually go live at the URLs Google needs.
5. **Create the Google Cloud project + fill in the OAuth consent screen** using `oauth-consent-screen-fields.md` — this needs your own Google account logged into Cloud Console.
6. **Record the demo video** using `demo-video-script.md` — needs to be you on camera/screen, can't be automated.
7. **Submit for verification** and respond to any follow-up questions from Google (typically 3-10 business days).

## Reply-detection follow-up (not yet built)

Dropping `gmail.readonly` means Gmail Sync's automatic reply-detection no longer works (it now fails with a clear message instead of a crash — see `security-checklist.md`). Still to decide: replace it with (a) a manual "mark as replied" button in the UI, or (b) an optional, clearly opt-in App Password/IMAP path. Neither is built yet — say which one and I'll implement it.

## Suggested order of operations

1. ~~Confirm the scope-drop decision~~ — done, code changed.
2. Buy + point + verify your custom domain.
3. Fill in the placeholders in `frontend/public/privacy.html` and `frontend/public/terms.html` (and the matching `.md` source files), commit, and deploy.
4. Fill in the OAuth consent screen using `oauth-consent-screen-fields.md`.
5. Record the demo video using `demo-video-script.md`.
6. Submit, using `scope-justification.md` for the form text.
7. Wait 3-10 business days, respond to any Google follow-ups.
8. Decide and build the reply-detection replacement (see above) whenever you're ready.
