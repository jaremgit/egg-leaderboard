# EggInc ID (EID) Privacy Audit

This document lists **every place in this repository** that touches an EggInc ID
(EID / EIID — the long `EI0000...` player identifier), what that code path does
with it, and whether the raw ID is ever transmitted, stored, logged, or
persisted anywhere. It exists so that a reviewer (or the maintainer) can
verify at a glance that there is no path by which a visitor's EID leaks
beyond what's necessary.

**Bottom line up front:** the raw EID is only ever (1) typed by a visitor into
their own browser, (2) optionally saved in *that visitor's own* `localStorage`
(never sent to any server just for saving), and (3) sent over HTTPS to
`ei_worker` directly from the browser for lookups and to this project's
Cloudflare Worker for rate-limit checks and confirmed submissions. The Worker
uses it in-memory for each request, then discards it. It is never logged,
committed to git, or stored raw in KV; only a salted SHA-256 hash is stored for
rate limiting.

---

## 1. Frontend (`app.js`)

### 1.1 The submit form input (`#submit-eid`)
- **Where:** `submitEidInput` and `seasonalSubmitEidInput` in `app.js`, used
  by the All Time and Seasonal submission modals.
- **What happens:** A visitor types their own EID into either field. It is
  normalized with `.trim().toUpperCase()` before use. It leaves the browser
  only in the requests described in 1.2/1.3, or if the visitor opts to save it
  locally.

### 1.2 "Look up" (preview) request
- **Where:** `app.js`, direct calls to `ei_worker` API in the browser and `fetch(SUBMIT_WORKER_URL, ... action: "preview")` for All Time; Seasonal lookup uses `fetchSeasonalEidResults()` and calls `ei_worker` directly without a Worker preview request.
- **What happens:** 
	1. The browser directly calls `ei_worker` for public player data: All Time uses the Grade 5 `ALL_TIME` leaderboard and player summary; Seasonal calls the player summary, seasonal catalog, and each Grade 5 seasonal scope.
  2. For All Time, the EID and prefetched public results are sent over HTTPS to the Cloudflare Worker with `action: "preview"`. The Worker uses a salted hash of the EID to report rate-limit status and responds with public fields; it does not repeat the lookup. Seasonal preview does not call this project's Worker.
  3. **Nothing is published yet** at this stage.
  4. The results are cached locally in the browser (see 1.5 below) for the confirm step.
- **Privacy note:** The EID is sent to this project's Worker for the All Time rate-limit status check and at confirmation; Seasonal sends it to the Worker only at confirmation.

### 1.3 "Confirm & Submit" request
- **Where:** `app.js`, the All Time confirm handler posts to `/submit`; the Seasonal confirm handler posts to `/submit-seasonal`.
- **What happens:** All Time sends `{ eid, action: "confirm", player, rank, score }`. Seasonal sends `{ eid, action: "confirm", player, results }`. The Worker hashes the EID for rate limiting, validates the public result data, and persists only public fields. The EID is not echoed in responses or persisted.

### 1.4 Cached player data (browser-side only)
- **Where:** `cachedSubmitData` and `cachedSeasonalSubmitResults` in `app.js`.
- **What happens:** After a successful All Time lookup, the browser stores `{ player, rank, score }` in `cachedSubmitData`; Seasonal stores `{ eid, player, results }` in `cachedSeasonalSubmitResults`. These values remain in browser memory until used for confirmation or cleared.
- **Privacy note:** The EID is cached only in memory for Seasonal confirmation; All Time caches only the public lookup result.

### 1.5 "Saved EggInc IDs" (local-only convenience feature)
- **Where:** Saved-EID helpers in `app.js`.
  - `SAVED_EIDS_STORAGE_KEY = "savedEids"` — the `localStorage` key used.
  - `getSavedEids()` / `setSavedEids()` — read/write the saved-ID object
	to/from **that browser's own `localStorage`** as JSON.
  - `addSavedEid(eid)` — called after a successful preview/confirm (only if
	the "remember this ID" checkbox is checked) to add the EID as a key in
	the saved object, capped at `SAVED_EIDS_MAX = 10` entries (oldest
	unnamed entry evicted first).
  - `removeSavedEid(eid)` — deletes it from `localStorage` ("Forget this ID" ×
	button).
  - `updateSavedEidUsername(eid, username)` — stores the *publicly-visible*
	player name alongside the EID locally, purely so the pill can show a
	friendly name instead of the raw ID.
  - `renderSavedEids()` — renders each saved EID as a "pill" in the UI. The
	pill displays the nickname/username if set, otherwise falls back to
	showing the raw EID (`savedEidDisplayName`), and puts the raw EID in the
	`title` tooltip attribute (`nameSpan.title = eid`) so a visitor can see
	the full ID on hover.
- **What happens with the data:** Saving itself is **local to the
  visitor's own browser.** It is never sent anywhere by these functions
  themselves — it only pre-fills the same `submitEidInput` field, which then
  goes through the normal preview/confirm requests in 1.2/1.3 if the visitor
  chooses to use it again. The same saved list is shown in both submission
  modals, with selection, rename, and removal actions. No other visitor or
  server can read this browser's `localStorage`.
- **Exposure consideration:** Because the raw EID is shown in the pill's
  `title` attribute and used as the saved-IDs object key, anyone with
  physical/remote access to that specific browser's dev tools or
  `localStorage` could see EIDs saved on that device — this is the same
  tradeoff as any "remember this" local storage feature and only exposes the
  device owner's own saved IDs to themselves.

---

## 2. Backend (`worker/index.js`, Cloudflare Worker)

This is the only project server-side code that receives a raw visitor EID.

### 2.1 Validation
- **Where:** `EID_PATTERN = /^EI\d{16,20}$/`, checked after parsing the POST body on both submission routes.
- **What happens:** Malformed input is rejected with a 400 before any
  lookup happens.

### 2.2 Hashing for rate-limiting (the EID is never stored raw)
- **Where:** `hashEid(eid, salt)`, called on All Time preview/confirm and Seasonal confirm requests.
- **What happens:** `SHA-256(SUBMIT_HASH_SALT + ":" + eid)` is computed and
	used as the KV key `submit:<hash>` for All Time or `seasonal-submit:<hash>`
  for Seasonal (`RATE_LIMIT_KV`) to enforce one submission per EID per day.
  Because of the secret salt, this hash cannot
  practically be reversed back to the original EID even if `RATE_LIMIT_KV`
  were somehow exposed. **The raw EID is never written to this or any other
  KV namespace.**

### 2.3 Lookup against the public `ei_worker` API (browser-based)
- **Where:** All Time and Seasonal lookup handlers in `app.js`; calls go directly from the browser, not through this Worker.
- **What happens:** The browser sends the EID to the third-party `ei_worker` API for player summary and leaderboard data. Seasonal lookup additionally fetches the catalog and each seasonal scope. This project cannot verify or control that service's logging/retention.

### 2.4 Publishing (`confirm` only)
- **Where:** `commitEntryToGitHub()` and `addPendingEntry()` for All Time; `commitSeasonalEntriesToGitHub()` for Seasonal.
- **What happens:** Only public player/rank/score fields are written. All Time results go to `data/<date>.json` and `PENDING_SUBMISSIONS_KV`; Seasonal ranked results go to `data/seasonal-submissions.json` on the configured seasonal branch. Neither archive nor KV pending entries contain the raw EID.

### 2.5 Logging
- **Where:** Searched all of `worker/index.js` for `console.log` /
  `console.error`.
- **What happens:** The only `console.*` call is a non-fatal error log if
  `addPendingEntry` fails (after the GitHub commit already succeeded) — it
  logs the *error*, not the EID or any request body. No code path logs the
  raw EID.

---

## 3. GitHub Actions workflows

- **Where:** `.github/workflows/update-leaderboard.yml` —
  `curl -s "https://ei_worker.tylertms.workers.dev/leaderboard?eid=${{ secrets.EI_EID }}&scope=ALL_TIME&grade=5"`.
- **What happens:** This is the **maintainer's own EID**, stored as a
  GitHub Actions **encrypted secret** (`EI_EID`), used once a week by the
	scheduled job to pull the public top-100 leaderboard snapshot. This is
  unrelated to visitor-submitted EIDs; it is the maintainer's own configured
  identifier for the scheduled API request.
  GitHub redacts secret values from all workflow logs automatically, and the
  value is never written to any file that gets committed.
- **Visitor EIDs are never involved in this workflow at all** — visitor
  submissions go through the Worker (§2) and get merged in via the "same-day
  submission" preservation logic elsewhere in this file, working only with
  the already-public `{ rank, player, score, source }` fields.

---

## 4. Documentation mentioning EIDs

- **`README.md`** — "Privacy" / "third-party dependency" sections already
  describe this same flow at a high level for end users.
- **`worker/README.md`** (lines 1-14) — States the same privacy guarantee
  described in detail above, as setup-time documentation for anyone
  deploying their own copy of the Worker.

---

## 5. Summary table

| Location | Raw EID present? | Sent to? | Persisted? |
|---|---|---|---|
| Submission EID input (browser) | Yes (visitor's own input) | `ei_worker`; All Time also sends to Worker for preview rate-limit status | No |
| `localStorage["savedEids"]` | Yes (as object key + `title` tooltip) | Nowhere — local only | Yes, but only in that visitor's own browser |
| Browser ei_worker lookup (~1.2a) | Yes | Third-party `ei_worker.tylertms.workers.dev` (direct from browser, NOT via this project's Worker) | Not by this project; that service's own logging is outside this repo's control |
| Cached lookup data (browser memory) | Seasonal cache includes EID; All Time cache contains public result only | Worker on confirm | No — ephemeral |
| POST `/submit` or `/submit-seasonal` confirm | Yes + public results | Cloudflare Worker (HTTPS) | No — EID held only in memory for hashing |
| `RATE_LIMIT_KV` | No — only a salted SHA-256 hash | N/A | Yes (hash only, auto-expires with normal KV TTL behavior for the rate-limit key) |
| `PENDING_SUBMISSIONS_KV` | No | N/A | Yes, but only `{ rank, player, score, source }` (public fields), 9-day TTL |
| GitHub commits (`data/<date>.json`, `data/seasonal-submissions.json`) | No | N/A | Yes, public fields only |
| GitHub Actions logs | No (maintainer's own EID is a redacted secret, unrelated to visitors) | N/A | No |
| Worker `console.*` calls | No | N/A | No |

**Conclusion:** Raw EIDs persist only in the visitor's own browser `localStorage`
when they opt into remembering an ID. During lookups and submissions, EIDs are
transmitted over HTTPS to `ei_worker` and to this project's Worker as described
above, but are not logged, committed to git, or stored in this project's KV.
