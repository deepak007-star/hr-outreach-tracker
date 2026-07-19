# Privacy Policy — HR Outreach Tracker

**Last updated:** [DATE — fill in the day you publish this]

This Privacy Policy explains what information HR Outreach Tracker ("we", "our", "the app") collects, how we use it, and your rights — including our use of Google/Gmail data, which Google requires us to document in detail.

This content is already live at `frontend/public/privacy.html` (`https://hr-outreach-tracker-frontend.onrender.com/privacy.html` once deployed). This `.md` file is the source of truth — edit here, then copy the corresponding sections into `frontend/public/privacy.html` to keep both in sync. Replace every `[BRACKETED]` placeholder in both places before publishing.

---

## 1. Who we are

HR Outreach Tracker is a job-search CRM that helps users track outreach to recruiters and HR contacts, send templated emails, and manage their job search.

Contact: **[SUPPORT EMAIL — e.g. support@yourdomain.com]**
Operator: **[YOUR NAME OR COMPANY NAME]**

## 2. Information we collect

- **Account information**: name, email address, and a hashed password (or, if you sign in with Google, no password is stored).
- **Contact/CRM data you enter**: names, emails, companies, notes, and statuses of recruiters/HR contacts you add.
- **Resume/profile data**: if you use the resume tools, the resume content and profile fields you provide.
- **Usage data**: standard server logs (IP address, timestamps, request paths) for security and debugging.

## 3. Gmail Integration

HR Outreach Tracker allows users to connect their Google Gmail account to send outreach emails to third parties (such as recruiters and HR contacts) directly from the user's own Gmail account, through their explicit action.

### What we access

We request the following Gmail API scope:

- **`gmail.send`** — allows our application to send emails on your behalf, using your Gmail account. We cannot read, view, or modify any of your existing emails with this permission.

### How we use this data

- We use this permission solely to send emails that you compose and explicitly trigger within HR Outreach Tracker.
- We do not read your inbox, sent folder, drafts, or any other Gmail content with this scope.
- We do not use this access for any automated, bulk, or unsolicited sending. Every email sent requires your direct action (clicking "Send").

### Data storage

- We store an **encrypted** OAuth refresh token associated with your account (AES-256-GCM), used solely to authenticate future send requests you initiate.
- We do not store the content of emails you send through this feature beyond what is necessary to show you your own send history (subject, recipient, timestamp, delivery status).
- You may revoke this access at any time via your Google Account settings ([myaccount.google.com/permissions](https://myaccount.google.com/permissions)) or by disconnecting Gmail within HR Outreach Tracker's Settings page.

### Compliance

Our use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## 4. How we use your information

- To provide and operate the CRM features you use (contact tracking, email sending, reminders, resume tools).
- To send emails you explicitly request, from your own connected account.
- To improve the reliability and security of the service.

We do **not** sell your personal information, and we do not use your Gmail data for advertising.

## 5. Data sharing

We do not share your Gmail data, contact list, or resume data with third parties, except:

- Service providers strictly necessary to operate the app (e.g. our hosting provider, database provider), bound by confidentiality.
- If required by law.

## 6. Data retention & deletion

- You can delete individual contacts, templates, or your resume data at any time within the app.
- You can disconnect your Google account at any time, which deletes your stored OAuth token immediately.
- To request full account deletion, contact **[SUPPORT EMAIL]**.

## 7. Security

- OAuth refresh tokens are encrypted at rest (AES-256-GCM).
- Passwords (for non-Google accounts) are hashed with bcrypt and never stored in plain text.
- All traffic is served over HTTPS.

## 8. Children's privacy

HR Outreach Tracker is not directed at children under 16, and we do not knowingly collect data from them.

## 9. Changes to this policy

We may update this policy from time to time. Material changes will be reflected by updating the "Last updated" date above.

## 10. Contact us

Questions about this policy or your data: **[SUPPORT EMAIL]**
