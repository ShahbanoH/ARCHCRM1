# Arch CRM — PE Outbound Tracker

A lightweight CRM for tracking outbound to **PE Funds → Platforms → Brands**.
Every level has a company info bar (LinkedIn, Website, Location, Revenue) and its own
contacts table (Name, LinkedIn, Email, Phone, Stage 1–5, Response), with Apollo CSV
import and full CSV export. Everything auto-saves to Postgres, so you and your founder
see the same live data at the same URL.

## Deploy to Vercel (one-time setup)

1. **Import the repo** — at [vercel.com/new](https://vercel.com/new), import `ShahbanoH/ARCHCRM1`.
   Framework auto-detects as Next.js; no settings to change. Deploy.
2. **Add the database** — in your Vercel project: **Storage** tab → **Create Database** →
   **Postgres** (Neon, free tier). Vercel sets `DATABASE_URL` automatically.
3. **Create the tables** — Storage tab → **Open in Neon** → **SQL Editor** → paste the
   entire contents of [`schema.sql`](./schema.sql) → **Run**.
4. **Redeploy** — Deployments → ⋯ → **Redeploy** (so the app picks up `DATABASE_URL`).

Until steps 2–4 are done, the app shows a friendly "Not connected yet" message instead
of crashing — that's expected.

## Using it

- **Import structure CSV** (sidebar) bulk-builds the whole tree from a master file with
  `Record` (name), `Type` (PE firm / Platform / Brand), `LinkedIn`, `Domains`, `Sponsor`
  (a platform's PE firm), and `Platform` (a brand's platform) columns. Re-importing the
  same file is safe — existing companies are matched by name, never duplicated
- **Add PE fund** (sidebar) → click a fund to open it
- **+ Add platform** inside a fund, **+ Add brand** inside a platform
- Click any name or field to edit — changes save automatically (indicator bottom-right)
- **Upload Apollo CSV** on any contacts table auto-maps First/Last Name, Email,
  Person Linkedin Url, and Mobile/Work/Corporate Phone columns
- **Export all (CSV)** in the sidebar downloads every contact with its fund/platform/brand path
- Delete anything with the ✕ (deleting a fund/platform removes everything nested inside it)

## Local development

```bash
npm install
echo 'DATABASE_URL=postgres://...' > .env   # any Postgres works locally
npm run dev
```

## Notes

- Anyone with the URL can edit — there's no login yet. If you want it locked down,
  the simplest options are Vercel's deployment protection (password) or adding auth later.
