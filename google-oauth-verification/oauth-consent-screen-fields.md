# OAuth consent screen — exact field values

Go to: [console.cloud.google.com](https://console.cloud.google.com) → your project → **APIs & Services → OAuth consent screen**

User type: **External**

| Field | What to enter |
|---|---|
| App name | `HR Outreach Tracker` |
| User support email | **[SUPPORT EMAIL — a real, monitored inbox, e.g. support@yourdomain.com]** |
| App logo | **[120×120px PNG — you'll need to provide/design this; not something I can generate for you without a design request]** |
| App domain — Homepage | `https://hr-outreach-tracker-frontend.onrender.com` (or your custom domain, if you set one up) |
| App domain — Privacy Policy | `https://hr-outreach-tracker-frontend.onrender.com/privacy.html` — page is built (`frontend/public/privacy.html`), confirmed it lands in the production build output; will go live once you deploy |
| App domain — Terms of Service | `https://hr-outreach-tracker-frontend.onrender.com/terms.html` — page is built (`frontend/public/terms.html`), confirmed it lands in the production build output; will go live once you deploy |
| Authorized domains | `onrender.com` won't work as an authorized domain (it's a shared public suffix) — **you need a custom domain** for this field. See the note below. |
| Developer contact email | **[YOUR REAL EMAIL]** |

## Important: the authorized-domain problem

Google's "Authorized domains" field requires a domain **you own**, verified via [Google Search Console](https://search.google.com/search-console). Shared hosting subdomains like `onrender.com`, `vercel.app`, `netlify.app`, etc. are on Google's public-suffix list and **cannot** be entered here — Render's free `*.onrender.com` subdomain will not pass this field.

**You need a custom domain** (e.g. `hroutreachtracker.com`) pointed at your Render deployment before you can complete verification. This is not optional — it's the one prerequisite in this whole process that costs money (domain registration, typically $10–15/year) and isn't avoidable.

Steps once you have a domain:
1. Buy a domain (Namecheap, Google Domains successor, Cloudflare, etc. — cheapest registrars run $10-15/yr for a `.com`).
2. Point it at your Render frontend service (Render → your static site → Settings → Custom Domain — Render gives you the DNS records to add).
3. Verify domain ownership in [Google Search Console](https://search.google.com/search-console) (Google gives you a TXT record or HTML file to add).
4. Add the verified domain to "Authorized domains" in the OAuth consent screen.
5. Update `GOOGLE_REDIRECT_URI` in your backend `.env` (and Render env vars) to use the new domain, and update the redirect URI registered on the OAuth Client itself (Credentials → your OAuth Client → Authorized redirect URIs).
6. Re-host the privacy policy / terms pages at the new domain's URLs, and update the App domain fields above to match.

## Scopes

In the same OAuth consent screen, **Scopes** section, add only:

```
https://www.googleapis.com/auth/gmail.send
```

Do not add `gmail.readonly` unless you've decided to accept the CASA cost (see README) — reviewers reject apps that request scopes broader than what the justification/demo actually shows being used.

## Test users (while in Testing mode)

Add any Google accounts you want to be able to use the app before verification completes — up to 100. This includes your own testing account and anyone helping you test.
