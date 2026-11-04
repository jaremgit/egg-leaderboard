# Submission Worker

The Cloudflare Worker provides separate All Time and Seasonal submission routes.

## Seasonal submission behavior

- The Seasonal modal calls `POST /submit-seasonal` with the visitor's EID for preview and confirmation. The Worker uses the EID only in memory to call `player_summary` and each Grade 5 seasonal `leaderboard` scope; it never logs, stores, or commits the EID.
- Preview (`action: "preview"`) returns the player's name plus each seasonal scope's top-level `rank` and `score`. Those fields represent the requesting EID even when the player is outside `topEntriesList`. A missing rank or score is returned as `null` for that season.
- Confirm (`action: "confirm"`) repeats the lookups, writes only results with a valid rank/score to `data/seasonal-submissions.json`, and rate-limits the EID separately from All Time submissions.
- The seasonal supplemental archive is separate from `data/seasonal/<scope>.json`; weekly top-100 refreshes do not overwrite or mix supplemental entries into the canonical top-100 snapshots.
- The static frontend merges supplemental entries into the seasonal leaderboard and player history, deduplicating players already in the canonical top 100.
- The EID's salted hash is used for an independent once-per-day Seasonal rate limit; the EID itself is not used as the KV key.

## Configuration and deployment

`worker/wrangler.toml` sets `SEASONAL_GITHUB_BRANCH = "experimental"`. The Worker needs the existing `GITHUB_TOKEN` secret to write to that branch and the existing `RATE_LIMIT_KV` binding for rate limits. The token must have repository contents write permission on the configured repository.

From the `worker/` directory, install the Worker dependencies and deploy with Wrangler:

```powershell
npm install
npx wrangler login
npx wrangler deploy
```

Deploy the Worker code before enabling this UI on a deployed site; otherwise `/submit-seasonal` will return 404. The Seasonal site changes and Worker deployment are separate operations.
