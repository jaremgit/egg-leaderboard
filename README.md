# Egg, Inc. Leaderboard Archive

An unofficial, community-oriented archive of Egg, Inc. All Time and seasonal leaderboard data. Browse snapshots, search player histories, and view rank and score trends.

> **Hobby project:** This is a vibe-coded project built with substantial help from AI coding assistants. I am not a professional developer, so there may be rough edges or design decisions that could be improved. Feedback is welcome.
>
> This project is unofficial, fan-made, and **not affiliated with or endorsed by Auxbrain or Egg, Inc.**

## Features

- **All Time archive:** Browse dated leaderboard snapshots, navigate between dates, and inspect data coverage and gaps.
- **Seasonal archive:** Browse the available seasonal leaderboards. The catalog currently covers Spring 2023 through Fall 2026; Winter 2023 is shown as unavailable because no archive exists for it.
- **Player history:** Search archived player names and view recorded ranks, scores, and charts. Seasonal history compares recorded seasons, not every weekly change within a season.
- **Optional score submissions:** Look up public leaderboard results and explicitly confirm a submission. Seasonal submissions can include ranked results outside the top 100.
- **Saved EIDs:** Visitors may save up to 10 Egg, Inc. IDs in their own browser. The saved list is shared between the All Time and Seasonal submission dialogs on that browser.

## Data sources and limitations

Leaderboard lookups and automated pulls use the community-maintained [`ei_worker` API](https://ei_worker.tylertms.workers.dev/). This project does not operate or control that service. If it is unavailable, rate-limited, or changes its response format, live lookups and scheduled updates may fail.

Older All Time snapshots were manually reconstructed from community-submitted screenshots and may be partial or contain transcription errors. Ongoing All Time snapshots are automated top-100 pulls. Seasonal data consists of one latest top-100 snapshot per season, plus separately stored, confirmed player submissions. The seasonal pull updates a snapshot only when its entries change.

## How data flows

1. **All Time archive updates:** GitHub Actions fetches the Grade 5 `ALL_TIME` leaderboard on Mondays and Fridays at 14:00 UTC. The workflow writes a dated JSON snapshot, preserves same-day player submissions, updates the date index, and triggers the configured Vercel deploy hook.
2. **Seasonal archive updates:** A separate workflow runs Mondays at 00:01 UTC. It discovers seasonal scopes, fetches each Grade 5 top-100 leaderboard, and updates `data/seasonal/` on `main` only when data changes. It can also be started manually on `main`.
3. **All Time submissions:** The browser obtains the public lookup result and sends it to the Cloudflare Worker for explicit confirmation. The Worker writes confirmed public fields to the current date's snapshot on GitHub and temporarily caches the entry in Cloudflare KV so the site can show it before the next static deployment.
4. **Seasonal submissions:** Seasonal lookup is performed by the browser. After explicit confirmation, the Worker validates results against the seasonal catalog and writes ranked public results to `data/seasonal-submissions.json` on `main`. The frontend combines those results with canonical season snapshots and avoids duplicating players already in the top 100.
5. **Static site deployment:** The frontend is plain HTML, CSS, and JavaScript. Vercel serves it and redeploys when the archive workflows trigger deployment. The Cloudflare Worker is deployed separately.

## EID privacy

An EID is sent over HTTPS to `ei_worker` for public leaderboard lookups. When a visitor confirms a submission, the EID is also sent to this project's Cloudflare Worker for rate limiting. The Worker stores a salted hash for the rate-limit key; it does not log or persist the raw EID. Confirmed public fields (such as player name, rank, score, and seasonal scope) are written to the relevant archive.

If a visitor opts to remember an EID, it is stored in that visitor's browser `localStorage`; it is not uploaded just by being saved. Anyone with access to that browser or its developer tools may be able to view it. See [EID_PRIVACY_AUDIT.md](EID_PRIVACY_AUDIT.md) for a detailed code-path review.

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page structure and UI elements. |
| `app.js` | All Time and Seasonal views, search, history, charts, and submission flows. |
| `styles.css` | Site styling. |
| `data/<date>.json` | Dated All Time snapshots. |
| `data/dates.json` | Ordered list of dates available in the All Time archive. |
| `data/seasonal/` | Per-season top-100 snapshots and `index.json` catalog. |
| `data/seasonal-submissions.json` | Confirmed supplemental Seasonal player results. |
| `data/player-aliases.json` | Historical player-name aliases used by search and history. |
| `scripts/update-seasonal-leaderboards.cjs` | Seasonal archive updater. |
| `.github/workflows/update-leaderboard.yml` | Scheduled All Time archive workflow. |
| `.github/workflows/update-seasonal-leaderboards.yml` | Scheduled and manually triggerable Seasonal archive workflow. |
| `worker/` | Cloudflare submission Worker and its deployment documentation. |
| `EID_PRIVACY_AUDIT.md` | Detailed EID data-flow and privacy audit. |
| `vercel.json` | Vercel deployment behavior configuration. |

## Run the site locally

The frontend has no build step. From the repository root, start a static file server, for example:

```powershell
npx serve .
```

Open the local URL printed by the server. Some submission features require the deployed Cloudflare Worker and its configured GitHub and KV resources.

## Cloudflare Worker

The Worker handles All Time and Seasonal submissions and the temporary All Time pending-submission endpoint. Production configuration is in [`worker/wrangler.toml`](worker/wrangler.toml); it targets the `main` branch and uses existing KV namespaces and secrets. Do not create replacement namespaces when updating an existing deployment.

For setup, required secrets, bindings, and deployment commands, see [`worker/README.md`](worker/README.md). GitHub Actions configuration and secrets are managed in repository settings. The archive workflows require the configured `EI_EID` secret; the All Time workflow also uses the configured Vercel deploy hook secret.

## Acknowledgments

The browser-local saved-EID convenience pattern was inspired by the approach used in [wasmegg / egg (carpet's tools)](https://github.com/wasmegg-carpet/egg). If you recognize another pattern that should be credited, please open an issue; any omission is unintentional.

The project relies on community-maintained tools and community contributions. To contribute leaderboard data or report an archive error, contact `@jarem` in the [Egg, Inc. Discord](https://discord.gg/egginc). Historical data should include the date, player name, rank, and score.

## Contributing and feedback

Feedback on functionality, accessibility, privacy, code quality, or architecture is welcome. Please open a GitHub issue or contact the maintainer in the Egg, Inc. Discord.
