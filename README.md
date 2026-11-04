# Egg, Inc. ALL_TIME Leaderboard Archive Experimental

**This is a vibe-coded hobby project.** I am not a professional developer — I
built this with heavy help from AI coding assistants, by describing what I
wanted and iterating on the result rather than writing the code
myself. If you're a developer reading this, please review it with that in
mind: there may be rough edges, non-idiomatic patterns, or things a more
experienced dev would structure differently. Feedback is very welcomed.

This project is unofficial, fan-made, and **not affiliated with or endorsed
by Auxbrain / Egg, Inc.** in any way.

---

## What this actually is (plain English)

Egg, Inc.'s in-game leaderboard only ever shows you the *current* top
players — once a player updates their score, the old data is overwritten. This
site is a scrapbook of those leaderboards over time: I started by manually
uploading saved historical data from the community, and now the site archives
weekly top-100 ALL_TIME and seasonal leaderboard snapshots. You can search for
players, compare their history, and view rank/score graphs.

There are separate "Submit Your Score" and "Submit Your Seasonal Score"
flows. They look up the player's public rank and score and, after explicit
confirmation, add results to the relevant archive, including seasonal ranks
outside the top 100.

None of this is officially sanctioned by the game's developers — it works by
piggybacking on a community-made API (more on that below), the same way
several other unofficial Egg, Inc. tools do.

If you'd prefer to update your score without providing your in-game ID OR you have your own historical data to contribute, you can ping me in the Egg, Inc. Discord (username `@jarem`) and I can add it manually. (I do need it to have a Date, Score(s), Rank(s) and Player name(s))

## What this is, for people who can actually read code

A static frontend (`index.html` / `app.js` / `styles.css`, no build step, no
framework) reads pre-generated JSON snapshots and renders search, history,
charts, and leaderboard views client-side. All Time snapshots are produced by
a scheduled GitHub Action and player self-submissions are handled by a
Cloudflare Worker. Seasonal snapshots are maintained separately by a second
GitHub Action, with one latest top-100 JSON file per season. Data updates are
committed to this repo and trigger a Vercel redeploy of the static site.

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

## Third-party dependency: I don't run my own leaderboard scraper

**Important for transparency:** all leaderboard data (both the weekly bulk
pull and individual player lookups) comes from a public API called
`ei_worker`, hosted by a third party (`tylertms`) at
`ei_worker.tylertms.workers.dev`. This is **not code I wrote, host, or
control** — the scheduled GitHub Actions and browser lookup flows make HTTP
requests to this existing service and store or display the results.

Practically, this means:
- If `ei_worker` goes down, gets rate-limited, or changes its response
  format, the snapshot jobs and live player lookups break, and there is
  nothing I can do about it except wait or find
  an alternative.
- I have no SLA, uptime guarantee, or say over that service.
- This is common practice in the Egg, Inc. fan-tool community — several
  unofficial tools rely on shared community APIs like this rather than each
  reimplementing their own scraper — but it's worth being upfront that this
  project is not self-contained.

## Borrowed ideas from other community tools

Some parts of this project's design are directly inspired by, or adapted
from, other open-source Egg, Inc. community tools, rather than being
original ideas:

- **Local/browser-only EID storage** (the "saved IDs" pill buttons in the
  Submit Your Score modal, so you don't have to retype your ID every time)
  is modeled directly on how [wasmegg / egg (carpet's
  tools)](https://github.com/wasmegg-carpet/egg) handles caching a player's
  EID in browser storage. I read through that project's implementation and
  adapted the same general pattern (store locally, never send anywhere
  except when actively submitting, allow renaming/removing saved entries).

If you recognize other patterns here that came from your project and I've
failed to credit it, please open an issue — that's an oversight, not
intentional. I am immensely grateful to those that share their work and make the community better, and I want to give credit where it's due.

## Project structure

| Path | Purpose |
|---|---|
| `index.html` | Page markup only - structure and element ids used by `app.js`. |
| `app.js` | All frontend behavior: All Time and Seasonal tables/search/history/charts, saved EIDs, and submission modals. |
| `styles.css` | All styling for the site. |
| `data/*.json` | One JSON snapshot per archived date (`YYYY-MM-DD.json`), each containing that date's observed leaderboard entries. |
| `data/dates.json` | Ordered list of every date that has a snapshot - drives the date picker. |
| `data/seasonal/` | One latest top-100 snapshot per seasonal scope plus `index.json`, which provides the season picker and current-season scope. |
| `data/player-aliases.json` | Maps a player's current name to older names they used to go by, so search/history treats them as the same person. |
| `worker/` | Cloudflare Worker source for the "Submit your score" feature (see [worker/README.md](worker/README.md) for setup). |
| `scripts/update-seasonal-leaderboards.cjs` | Fetches and validates seasonal scope top-100 results, updating only changed seasonal snapshots. |
| `.github/workflows/update-leaderboard.yml` | Scheduled GitHub Action that pulls the current top-100 ALL_TIME AAA leaderboard on Monday and Friday and commits a daily snapshot. |
| `.github/workflows/update-seasonal-leaderboards.yml` | Separate seasonal archive workflow; runs Monday at 00:01 UTC and updates only `data/seasonal/`. |
| `vercel.json` | Deployment config - skips triggering a Vercel rebuild for individual player-submission commits. |

## How data gets in

There are four ways leaderboard data enters the archive: historical/manual
All Time data, ongoing All Time and seasonal pulls, and player self-submissions:

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
   - Due to the manual nature of this process, some early snapshots may have transcription errors or missing entries. If you notice any, please let me know and I can correct them.

2. **All Time automated pull** - `update-leaderboard.yml` fetches
   the public top-100 ALL_TIME AAA leaderboard from `ei_worker`, merges in any
	 player submissions made earlier that day (so they aren't overwritten), and
   commits the result as the permanent snapshot for that date on its Monday and
   Friday schedule.
3. **Seasonal automated pull** - `update-seasonal-leaderboards.yml` reads the
   valid seasonal scopes from `leaderboard_info`, excludes the All Time scope,
   and fetches each season's Grade 5 top-100 leaderboard once a week on Monday
   at 00:01 UTC. It stores one `data/seasonal/<scope>.json` snapshot per season
	 and rewrites a snapshot only when its entries change. Seasonal player
   history compares recorded ranks across seasons, including confirmed
	  out-of-top-100 submissions; its rank chart defaults to each player's full
   recorded range and offers Top 100/50/25/10 zoom presets. The archive does
   not retain weekly changes within a season.
   Winter 2023 is shown as a disabled placeholder because no leaderboard archive
   exists for it.
	  Confirmed Seasonal player submissions are stored separately in
   `data/seasonal-submissions.json` so the weekly top-100 updater never
   overwrites or mislabels them. The Seasonal table and player history merge
	  these public, opt-in results with the canonical snapshots. Partial-name
   searches can reveal other matching players, and the rank history chart
   scales to include each player's recorded ranks.
4. **Player self-submission** - a visitor can click **Submit Your Score**,
	  enter their EggInc ID (EID), preview their own rank/score, and confirm
	  publishing it. Both All Time and Seasonal previews call `ei_worker` from
   the browser; Seasonal lookups check every Grade 5 seasonal scope. The All
   Time preview sends its EID to the Worker for the rate-limit status check.
   On confirmation, each route sends the EID for salted rate-limit hashing;
   the raw EID is not logged or persisted. The Worker:
   - Rate-limits to one submission per EID per day using its hash; the EID
	  itself is never logged, stored, or committed.
   - Commits the entry into today's `data/<date>.json` via the GitHub
	  Contents API for All Time, or to `data/seasonal-submissions.json` on
	 the configured seasonal branch for Seasonal.
   - Caches All Time entries in Cloudflare KV for immediate display.

The All Time pull and All Time self-submission write to the same `data/<date>.json` shape
(`{ date, complete, observed_entries, entries: [{ rank, player, score,
source }] }`), which is why the frontend can treat every snapshot the same
way regardless of how it originated - `source` on each entry (e.g.
`"ei_worker"` vs `"submission"`) is the only trace of where a given row came
from. Seasonal snapshots have a separate per-scope shape and are not written
to the All Time date archive.

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
The Seasonal submission modal uses the same Worker at `/submit-seasonal` and
stores confirmed public results in `data/seasonal-submissions.json`. Its
`SEASONAL_GITHUB_BRANCH` variable currently targets `experimental`; deploy the
Worker configuration/code before enabling seasonal submissions on a live site.

## Privacy note

Both preview flows call `ei_worker` directly from the browser. On confirmation,
the Worker uses a salted hash of the EID for rate limiting; the raw EID is not
logged or persisted in Worker KV or GitHub. Confirmed public results (player
name, rank, score, and, for Seasonal, scope) are written to the appropriate
archive. All Time submissions also use KV for the rate-limit key and an
immediate-display cache. The optional "Remember this ID" feature stores up to
10 EIDs and their usernames/nicknames in browser local storage, shared between
the All Time and Seasonal modals on that browser/device.

## Contributing / feedback

Since this was pretty much entirely built by AI and I'm not an experienced developer,
feedback on code quality, security, or architecture is especially welcome —
please let me know on discord rather than assuming something was done a
particular way for a good reason.
