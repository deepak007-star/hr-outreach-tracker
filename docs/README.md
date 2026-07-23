# docs/ — HR Outreach Tracker Documentation

| File | Contents |
|---|---|
| [01_ARCHITECTURE.md](01_ARCHITECTURE.md) | System overview, deployment topology, backend route map, middleware stack, auth model, email transport, scraper architecture, background jobs |
| [02_FEATURES.md](02_FEATURES.md) | End-to-end feature flows: Auth, Contacts, Email, Templates, LinkedIn Feed, Job Scraper, Profile/Resume, Gmail Tracking, Password Vault, Referrals, Admin, Reminders, Notifications, Plans, Early Access, Delivery Tracking |
| [03_DATABASE.md](03_DATABASE.md) | All 20 tables with column definitions, constraints, indexes, date/time convention, migration pattern |
| [04_SECURITY.md](04_SECURITY.md) | Auth model, rate limiting, security headers, CORS, body sanitization, Google OAuth security (one-time code pattern), encryption at rest, open security issues |
| [05_BUG_HISTORY.md](05_BUG_HISTORY.md) | Complete bug history: 63 bugs across 3 audit phases, with description, root cause, and fix for each |
| [06_ISSUE_TRACKER.md](06_ISSUE_TRACKER.md) | Active issue tracker: open bugs, deferred items, planned features, recently resolved |

## Quick Reference

**To add a database column:** append `addCol(table, col, definition)` in `backend/src/db/database.js::initialize()` — never edit the CREATE TABLE blocks.

**To add a new route:** require it inside `main()` in `backend/src/index.js` (after `await database.initialize()`), then `app.use('/api/yourroute', yourRouter)`.

**To send email:** use `getTransportForUser(userId)` from `backend/src/services/mailTransport.js` — never build a transport directly in a route.

**To understand a bug ID:** look it up in `05_BUG_HISTORY.md` by the B### reference.
