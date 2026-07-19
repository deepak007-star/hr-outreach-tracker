# Demo video — script & checklist

Google requires a screen recording (not a written description) showing the OAuth consent flow and the scope actually being used. This is the step most submissions fail on — follow the requirements exactly.

## Requirements

- [ ] Record against your **real production URL** (`https://hr-outreach-tracker-frontend.onrender.com`), not localhost.
- [ ] Show the actual Google OAuth consent screen appearing and being approved.
- [ ] Show the feature working end-to-end: composing an email, clicking send, and the email genuinely arriving.
- [ ] **Narrate** what's happening — voice-over or burned-in captions. A silent recording gets rejected.
- [ ] Keep it 2–5 minutes, clear and complete — it doesn't need to be polished.
- [ ] Upload to YouTube as **Unlisted** (not Private — reviewers need the link to work without logging into your account).
- [ ] Paste the Unlisted link into the verification form.

## Free tools to record with

- **OBS Studio** (free, Windows/Mac/Linux) — screen + mic recording.
- **Loom** (free tier) — records and uploads in one step, gives you a shareable link directly (you'd still also upload to YouTube for the form, or check if Google accepts a Loom link — YouTube Unlisted is the safest bet).

## Script — read this while recording

> **1. Intro**
> "This is HR Outreach Tracker. I'm going to show how a user connects their Gmail account and sends an outreach email to a recruiter."

> **2. Start the connection**
> [Click "Connect Google Account" / "Continue with Google"]
> "Here the user is redirected to Google's own consent screen, where they explicitly approve the `gmail.send` permission — you can see it lists only 'Send email on your behalf,' nothing else."

> **3. Complete the OAuth flow**
> [Sign in with a real test Google account, approve consent]
> "The user has now connected their Gmail account. This happens through Google's own secure sign-in — we never see their password."

> **4. Use the feature**
> [Navigate to compose/send, or the referral request flow]
> "Now the user composes a message to send to an HR contact — filling in the recipient, subject, and message."

> **5. Send it**
> [Click Send]
> "When they click Send, the email goes out through their own connected Gmail account."

> **6. Prove it**
> [Show the app's send confirmation AND/OR the user's real Gmail "Sent" folder with the email visible]
> "This confirms the email was sent directly from the user's own Gmail account — you can see it here in their Sent folder — with no bulk or automated sending involved. Every send requires this manual, explicit action."

> **7. Close**
> "That's the complete flow — connect once, then send as yourself, one email at a time, always user-initiated."

## Before you record

- [ ] Use a real (or dedicated test) Google account you're comfortable showing on camera — the recipient address and your own test Gmail inbox will be visible.
- [ ] Make sure the app is deployed and the OAuth flow actually completes end-to-end against production before recording (test it yourself first, once — see README for what's still pending on the code side).
- [ ] Clear your browser's saved Google session first if you want the *full* consent screen to show (an already-authorized Google account may skip straight through).
