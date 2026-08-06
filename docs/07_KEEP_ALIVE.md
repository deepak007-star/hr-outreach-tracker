# Keeping the app awake (anti cold-start)

Free tiers (Render, Vercel) **spin the backend down after ~15 min of inactivity**.
The next request then pays a cold start (slow first load), and while it's asleep
the in-process schedulers (Job Intel pipeline, reminder emails, daily scrapers)
don't run. Fix = keep the **backend** receiving a request more often than every
15 minutes. Two layers, use both:

## 1. Self keep-alive (in-app) — primary

The backend pings its own `/api/health` every 10 min, which resets the host's
inactivity timer so it never sleeps while running.

- Set **`PUBLIC_URL`** to your deployed **backend** URL, e.g.
  `PUBLIC_URL=https://hr-outreach-backend.onrender.com`
- On Render, `RENDER_EXTERNAL_URL` is auto-provided and used automatically — you
  can leave `PUBLIC_URL` blank there.
- Optional cadence: `KEEP_ALIVE_MINUTES=10` (must stay **< 15**).
- On boot you'll see: `[keep-alive] enabled — pinging …/api/health every 10 min`.

## 2. External monitor (UptimeRobot) — wakes it after a deploy/restart

The self-ping only runs while the process is up; after a deploy/crash something
external must wake it. Point UptimeRobot at the **backend health URL** (not the
frontend — the Vercel frontend is static and never wakes the backend):

- **Monitor type:** HTTP(s)
- **URL:** `https://<your-backend-host>/api/health`  ← the Render backend, **not** the Vercel site
- **Interval:** every **5 minutes**
- **Expected:** HTTP 200 with `{"status":"ok", …}`

> ⚠️ A monitor on the logged-out **frontend** URL keeps Vercel warm but does
> **not** wake the Render backend — which is the part that sleeps. Always monitor
> the backend `/api/health`.

## Endpoints

- `GET /api/health` and `GET /health` → `{ status:'ok', timestamp, uptimeSec, bootedAt }`
  (no DB work, always fast — safe to hit frequently).

## Why this fixes the scrapers too

The daily scrape prefetch, Job Intel pipeline, reminder scheduler, auto-proxy
refresh, and email verification all run via `setInterval`/`setTimeout` inside the
backend process. If the host sleeps, those timers pause; keeping the instance
warm keeps them firing on schedule.
