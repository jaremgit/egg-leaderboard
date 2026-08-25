# Egg Inc All Time Leaderboard Archive

**Full disclosure, this whole site is vibe-coded, I am NOT a coder/developer. Originally I just wanted to document histroical ATL data but the scope has grown. Please note, this project is unofficial and not affiliated with Auxbrain / Egg, Inc. in any way.**

A static site that archives historical **Egg, Inc. ALL_TIME / Grade AAA (Grade 5)**
leaderboard snapshots over time, so rankings and scores that would otherwise be
overwritten in-game can be searched, graphed, and compared across dates.

Live data comes from two places: a weekly automated pull of the top 100
players, and a "Submit your score" feature that lets any player privately look
up and publish their own rank/score on demand.

## How it fits together

```
┌─────────────────┐      weekly cron       ┌───────────────────────┐
│  ei_worker API   │ ─────────────────────▶ │ GitHub Actions workflow │
│ (public EggInc    │                       │ update-leaderboard.yml │
│  leaderboard data)│                       └───────────┬───────────┘
└─────────────────┘                                     │ commits
														  ▼
┌─────────────────┐   per-player lookup    ┌───────────────────────┐
│  Visitor enters   │ ─────────────────────▶ │  Cloudflare Worker     │
│  their EID on the │                       │  (worker/index.js)     │
│  site             │ ◀───────────────────── │  "submit your score"  │
└─────────────────┘   preview / confirm     └───────────┬───────────┘
														  │ commits + KV cache
														  ▼
												┌───────────────────────┐
												│   data/*.json          │
												│   (this repo)          │
												└───────────┬───────────┘
														  │ fetch()
														  ▼
												┌───────────────────────┐
												│  Static site           │
												│  index.html / app.js / │
												│  styles.css            │
												│  (deployed on Vercel)  │
												└───────────────────────┘
```

## Project structure

| Path | Purpose |
|---|---|
| `index.html` | Page markup only - structure and element ids used by `app.js`. |
| `app.js` | All frontend behavior: loading snapshots, player search, chart rendering, heatmap/gaps modals, and the submit-score popup. Organized into numbered sections (see the banner comment at the top of the file). |
| `styles.css` | All styling for the site. |
| `data/*.json` | One JSON snapshot per archived date (`YYYY-MM-DD.json`), each containing that date's observed leaderboard entries. |
| `data/dates.json` | Ordered list of every date that has a snapshot - drives the date picker. |
| `data/player-aliases.json` | Maps a player's current name to older names they used to go by, so search/history treats them as the same person. |
| `worker/` | Cloudflare Worker source for the "Submit your score" feature (see [worker/README.md](worker/README.md) for setup). |
| `.github/workflows/update-leaderboard.yml` | Scheduled GitHub Action that pulls the current top-100 ALL_TIME AAA leaderboard once a week and commits a new daily snapshot. |
| `vercel.json` | Deployment config - skips triggering a Vercel rebuild for individual player-submission commits (only the weekly archive commit and manual pushes trigger a real deploy). |

## How data gets in

There are three paths that end up writing to `data/<date>.json` - one
historical/manual, and two ongoing/automated:

1. **Historical data (manual, one-time backfill)** - before this site's
   automated pull and submission Worker existed, older snapshots were
   reconstructed entirely by hand from community-submitted screenshots.
   Volunteers in the Egg Inc Discord posted screenshots of their own
   ALL_TIME AAA rank/score on various dates, those were manually transcribed
   into a shared Google Sheet (one row per player per date), and the sheet
   was periodically exported/converted into the `data/<date>.json` files you
   see in this repo (and `dates.json`/`player-aliases.json` updated to
   match). This explains why:
   - Early snapshots are **partial** (`"complete": false` and far fewer than
	 100 entries) - only whatever players happened to screenshot and share
	 got recorded, not a full top-100 pull.
   - Some dates have odd/irregular spacing rather than a clean weekly
	 cadence.
   - `player-aliases.json` exists at all - name changes had to be reconciled
	 by hand across screenshots submitted under different in-game names.
   - There is no script in this repo that performs that Sheet -> JSON
	 conversion - it was a manual/ad-hoc process at the time, not an
	 automated pipeline. A future maintainer wanting to backfill more
	 historical data would need to recreate that process (collect
	 screenshots -> tabulate rank/player/score per date -> hand-write or
	 script a `data/<date>.json` file matching the existing shape, then add
	 the date to `dates.json`).
2. **Weekly automated pull** - every Monday, `update-leaderboard.yml` fetches
   the public top-100 ALL_TIME AAA leaderboard from `ei_worker`, merges in any
   player submissions made earlier that day (so they aren't overwritten), and
   commits the result as the permanent snapshot for that date. This is what
   keeps the archive going forward without further manual work.
3. **Player self-submission** - a visitor can click **Submit Your Score**,
   enter their EggInc ID (EID), preview their own rank/score, and confirm
   publishing it. This is handled by the Cloudflare Worker in `worker/`,
   which:
   - Looks up the player's rank/score via the public `ei_worker` API.
   - Rate-limits to one submission per EID per day (the EID itself is only
	 ever hashed for this check - never logged, stored, or committed).
   - Commits the entry into today's `data/<date>.json` via the GitHub
	 Contents API.
   - Also caches the entry in Cloudflare KV so the site can show it
	 immediately, without waiting for a Vercel rebuild.

All three paths write to the same `data/<date>.json` shape
(`{ date, complete, observed_entries, entries: [{ rank, player, score,
source }] }`), which is why the frontend can treat every snapshot the same
way regardless of how it originated - `source` on each entry (e.g.
`"ei_worker"` vs `"submission"`) is the only trace of where a given row came
from.

## Running the site locally

The frontend has no build step - it's plain HTML/CSS/JS. Serve the repo root
with any static file server, for example:

```powershell
npx serve .
```

Then open the printed local URL in a browser.

## Deploying the submission Worker

The "Submit your score" feature requires deploying the Cloudflare Worker in
`worker/` once. Full step-by-step instructions (Cloudflare login, KV
namespace, GitHub token, secrets) are in [worker/README.md](worker/README.md).

## Privacy note

EggInc IDs submitted through the site are only ever held in memory for the
duration of a single request. They are never logged, stored in KV, or
committed to git - only the resulting public leaderboard fields (name, score,
rank, which are already visible in-game and on this site) are persisted.
