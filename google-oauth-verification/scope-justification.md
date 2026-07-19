# Scope justification (for the Google verification form)

When you submit for verification, Google's form asks you to justify each requested scope. Paste the text below into the field for `gmail.send`. Do not request any scope you don't paste a justification for — remove `gmail.readonly` from your OAuth consent screen's scope list before submitting (see `README.md` — this is a pending code change).

---

## Scope: `https://www.googleapis.com/auth/gmail.send`

**Justification (paste this exactly, or adapt lightly to your own words):**

> Our application allows registered users to send job-application-related emails directly to HR/recruiter contacts, using their own Gmail account as the sender. This scope is requested so users' outreach appears authentically from their own identity rather than a third-party address, which improves trust and deliverability with recipients. We use only the send capability — we do not request or use any read/modify scopes. Every send is manually triggered by the user composing and clicking "Send" within our interface; there is no automated, scheduled, or bulk sending.

## If Google asks a follow-up question

Common follow-ups and how to answer them, based on typical review patterns:

**"Why do you need to send email instead of using a transactional email service (e.g. SendGrid)?"**
> Our core feature is letting users send outreach as *themselves* — from their own real Gmail address — so recipients see a genuine personal email rather than a third-party bulk-sending address. This is essential to the product's purpose (authentic job-search outreach) and cannot be replicated by sending from a shared/transactional sender address.

**"How do you prevent abuse of the sending feature?"**
> Sends are rate-limited per user (see our rate limiter — currently capped per hour/day), require the user to be authenticated, and every send is a single, individually-triggered action initiated by the user composing a message — there is no bulk-import-and-blast capability.

**"Do you store the content of sent emails?"**
> We store metadata for the user's own send history (recipient, subject, timestamp, delivery status) so they can track their own outreach — not for any other purpose. See the Privacy Policy's "Gmail Integration" section.
