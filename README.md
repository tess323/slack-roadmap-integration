# Roadmap Reports — Slack App Home control panel

A Slack App Home tab where people subscribe to CodeAI roadmap updates by
**category**, each at a **detail level** (1 / 2 / 3, plus an **LT** leadership
level for allowlisted people). Preferences are stored in a Google Sheet that the
existing weekly Apps Script report reads at send time.

## Architecture

```
Slack App Home  ──(app_home_opened)──►  /api/slack/events      ──► render tab
   │                                                              (reads Sheet)
   └──(button click)────────────────►   /api/slack/interactions ──► write Sheet
                                                                     + re-render
Vercel Cron ────(daily)───────────►     /api/cron/sync-projects ──► refresh
                                                                     Projects tab
                                                                     from Notion
Apps Script (existing, weekly) ───────────────────────────────► reads Subscriptions,
                                                                  DMs each person
```

Nothing here sends the weekly report — that stays in your Apps Script. This app
only powers the subscription UI and keeps the project list current.

## Files

- `api/slack/events.js` — handles `url_verification` + `app_home_opened`
- `api/slack/interactions.js` — handles button clicks (set level), re-renders tab
- `api/cron/sync-projects.js` — pulls current projects from Notion into the Sheet
- `lib/sheets.js` — Google Sheets read/write
- `lib/slack.js` — signature verification + Home view builder
- `lib/publishHome.js` — shared "render this user's tab" routine
- `vercel.json` — Cron schedule (daily 12:00 UTC)
- `.env.example` — the env vars to set in Vercel

## Environment variables (set in Vercel, not in code)

See `.env.example`. All secrets live in Vercel's Environment Variables.

## Google Sheet tabs (must match exactly)

- **Subscriptions**: Slack user ID · Name · Email · Category · Level
- **Projects**: Category · Project name · Status · Last synced  (auto-refreshed)
- **LT members**: Slack user ID · Name · Email

Share the Sheet with the service account email (Editor).

## Deploy

1. Push this repo to GitHub.
2. Import it into Vercel (framework preset: **Other**).
3. Add all env vars from `.env.example`.
4. Deploy. Note your deployment URL, e.g. `https://roadmap-reports.vercel.app`.
5. In the Slack app config:
   - **Event Subscriptions** → Request URL: `https://<your-url>/api/slack/events`
     (Slack will call it once to verify; the handler echoes the challenge.)
   - Subscribe to bot event: `app_home_opened`
   - **Interactivity & Shortcuts** → on → Request URL: `https://<your-url>/api/slack/interactions`
   - **App Home** → enable the Home tab
   - **OAuth & Permissions** → bot scopes: `chat:write`, `users:read`, `users:read.email`
   - Reinstall the app to the workspace if scopes changed.
6. Open the app's Home tab in Slack — you should see the panel.

## Local notes

- Node.js runtime (not Edge) — needed for `crypto` + googleapis.
- Body parsing is disabled on the Slack endpoints so raw body is available for
  signature verification. Don't re-enable it.
