# Submission Worker

The Cloudflare Worker provides separate All Time and Seasonal submission routes.

## Seasonal submission behavior

- The browser calls `player_summary`, `leaderboard_info`, and each Grade 5 seasonal `leaderboard` scope directly for preview. `/submit-seasonal` accepts only `action: "confirm"`, the EID for salted rate-limit hashing, and the public player name and seasonal results; it does not query ei_worker server-to-server.
- The browser uses each seasonal leaderboard response's top-level `rank` and `score`, which represent the requesting EID even when it is outside `topEntriesList`. Missing rank/score values are shown as unranked and are not published.
- On confirmation, the browser sends the EID and public results. The Worker hashes the EID with `SUBMIT_HASH_SALT` for the one-per-day rate limit, validates every result against the configured seasonal branch's scope catalog, then writes valid ranked results to `data/seasonal-submissions.json`. The raw EID is not logged, stored in KV, or written to GitHub.
- The seasonal supplemental archive is separate from `data/seasonal/<scope>.json`; weekly top-100 refreshes do not overwrite or mix supplemental entries into the canonical top-100 snapshots.
- The static frontend merges supplemental entries into the seasonal leaderboard and player history, deduplicating players already in the canonical top 100.
- The EID is sent directly to ei_worker during preview and to this project's Worker at confirmation only for the rate-limit hash. It is not persisted in this project's archive.
- All Time and Seasonal submission modals share the same browser-local saved EID list, including names/nicknames, selection, and removal.

## Configuration and deployment

`worker/wrangler.toml` sets `SEASONAL_GITHUB_BRANCH = "experimental"`. The Worker needs the existing `GITHUB_TOKEN` secret to write to that branch and the existing `RATE_LIMIT_KV` binding for rate limits. The token must have repository contents write permission on the configured repository.

From the `worker/` directory, install the Worker dependencies and deploy with Wrangler:

```powershell
npm install
npx wrangler login
npx wrangler deploy
```

Deploy the Worker code before enabling this UI on a deployed site; otherwise `/submit-seasonal` will return 404. The Seasonal site changes and Worker deployment are separate operations.
