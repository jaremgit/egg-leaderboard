# EggInc ID (EID) Privacy Audit

This document lists **every place in this repository** that touches an EggInc ID
(EID / EIID — the long `EI0000...` player identifier), what that code path does
with it, and whether the raw ID is ever transmitted, stored, logged, or
persisted anywhere. It exists so that a reviewer (or the maintainer) can
verify at a glance that there is no path by which a visitor's EID leaks
beyond what's necessary.

**Bottom line up front:** the raw EID is only ever (1) typed by a visitor into
their own browser, (2) optionally saved in *that visitor's own* `localStorage`
(never sent to any server just for saving), and (3) sent over HTTPS to the
Cloudflare Worker for a lookup. The Worker uses it in-memory for a single
request, then discards it. It is never logged, never committed to git, and
never stored in KV — only a **salted SHA-256 hash** of it is stored (for rate
limiting), which cannot be reversed back into the original EID.

---

## 1. Frontend (`app.js`)

### 1.1 The submit form input (`#submit-eid`)
- **Where:** `submitEidInput` (`app.js` ~line 82), used throughout the
  "Submit your score" modal (~lines 1394-1570).
- **What happens:** A visitor types their own EID into this field. It is
  normalized with `.trim().toUpperCase()` before use. This value never
  leaves the browser except in the two `fetch()` calls described in 1.2/1.3.

### 1.2 "Look up" (preview) request
- **Where:** `app.js` ~lines 1520-1570, direct calls to `ei_worker` API in the browser (~lines 1537-1559), then `fetch(SUBMIT_WORKER_URL, ... action: "preview")` (~lines 1561-1580).
- **What happens:** 
  1. First, the **browser directly calls** `https://ei_worker.tylertms.workers.dev/leaderboard?eid=...` and `/player_summary?eid=...` to fetch the player's public rank/score/name. The EID is sent directly from the browser to ei_worker (not via this project's servers).
  2. Then, only the **results** (`{ player, rank, score }`) are sent over HTTPS to the Cloudflare Worker (`SUBMIT_WORKER_URL`, defined at ~line 251) with `action: "preview"`. The Worker responds with `{ player, rank, score, alreadySubmittedToday }` — no EID is echoed back. 
  3. **Nothing is published yet** at this stage.
  4. The results are cached locally in the browser (see 1.5 below) for the confirm step.
- **Privacy benefit:** Since the ei_worker lookup happens directly from the browser, the EID never touches this project's Cloudflare Worker at the lookup stage — only at the confirm stage below.

### 1.3 "Confirm & Submit" request
- **Where:** `app.js` ~lines 1617-1640, `fetch(SUBMIT_WORKER_URL, ... action: "confirm")`.
- **What happens:** Sends `{ eid, action: "confirm", player, rank, score }` to the same Worker.
  The Worker receives the **pre-fetched player data** from the lookup phase (not calling ei_worker again) and commits the public fields (`{ player, rank, score }`) to the public leaderboard data (see §2). The response back to the browser contains only `{ player, rank, score }` — never the EID.
- **Privacy benefit:** The EID is sent to the Worker here, but the Worker doesn't need to call ei_worker to look it up again — the lookup already happened in the browser, so there's no redundant ei_worker call.

### 1.4 Cached player data (browser-side only)
- **Where:** `app.js` ~line 252 (`let cachedSubmitData = null`), and lines 1574-1578 where it's set after successful lookup.
- **What happens:** After a successful "Look up" request, the browser stores the results (`{ player, rank, score }`) in a variable (`cachedSubmitData`) so they can be resent with the "Confirm" request without re-doing the lookup. This data is **never sent anywhere except to the Worker in the next confirm request** — it stays in browser memory only.
- **Privacy benefit:** Avoids calling ei_worker twice for the same lookup.

### 1.5 "Saved EggInc IDs" (local-only convenience feature)
- **Where:** `app.js` ~lines 1267-1392.
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
- **What happens with the data:** This entire feature is **100% local to the
  visitor's own browser.** It is never sent anywhere by these functions
  themselves — it only pre-fills the same `submitEidInput` field, which then
  goes through the normal preview/confirm requests in 1.2/1.3 if the visitor
  chooses to use it again. No other visitor, and no server, ever sees this
  `localStorage` data.
- **Exposure consideration:** Because the raw EID is shown in the pill's
  `title` attribute and used as the saved-IDs object key, anyone with
  physical/remote access to that specific browser's dev tools or
  `localStorage` could see EIDs saved on that device — this is the same
  tradeoff as any "remember this" local storage feature and only exposes the
  device owner's own saved IDs to themselves.

---

## 2. Backend (`worker/index.js`, Cloudflare Worker)

This is the only server-side code that ever receives a raw EID from a
visitor.

### 2.1 Validation
- **Where:** `EID_PATTERN = /^EI\d{16,20}$/` (line 32), checked immediately
  after parsing the POST body (~line 91).
- **What happens:** Malformed input is rejected with a 400 before any
  lookup happens.

### 2.2 Hashing for rate-limiting (the EID is never stored raw)
- **Where:** `hashEid(eid, salt)` (~lines 218-227), called at line 96.
- **What happens:** `SHA-256(SUBMIT_HASH_SALT + ":" + eid)` is computed and
  used as the KV key `submit:<hash>` (`RATE_LIMIT_KV`) to enforce "one
  submission per EID per day." Because of the secret salt, this hash cannot
  practically be reversed back to the original EID even if `RATE_LIMIT_KV`
  were somehow exposed. **The raw EID is never written to this or any other
  KV namespace.**

### 2.3 Lookup against the public `ei_worker` API (browser-based)
- **Where:** `app.js` ~lines 1537-1559, called directly from the browser during the lookup phase (not by the Worker).
- **What happens:** The browser directly makes two outbound GET requests to `https://ei_worker.tylertms.workers.dev` — `/leaderboard?eid=...` (for rank/score) and `/player_summary?eid=...` (for display name) — passing the EID as a query parameter to that **third-party** service (not one this project controls). This is the same third-party API used by the site's own weekly archive pull (§3) and by tools like wasmegg/carpet. The results are cached locally in the browser and sent with the confirm request (§1.3).
- **Third-party trust note:** since this lookup is delegated to `ei_worker.tylertms.workers.dev`, that service does see the raw EID for the duration of its own request handling. This project has no control over that service's logging/retention; it is the same dependency already disclosed in `README.md`'s "third-party dependency" section. However, unlike the old flow, **the EID does not pass through this project's Cloudflare Worker** — it goes directly from the browser to ei_worker.

### 2.4 Publishing (`confirm` only)
- **Where:** `commitEntryToGitHub(entry, env)` (~line 312) and
  `addPendingEntry(today, entry, env)`.
- **What happens:** Only the **public leaderboard fields** returned from
  §2.3 — `{ player, rank, score, source: "submission" }` — are committed to
  `data/<date>.json` via the GitHub Contents API, and cached in
  `PENDING_SUBMISSIONS_KV` so the site can show it before the next Vercel
  rebuild. **The EID itself is never included in either the GitHub commit or
  the KV cache** — `entry` is built solely from `player`/`rank`/`score`
  (see `lookupPlayerEntry`'s return value, lines 302-306).

### 2.5 Logging
- **Where:** Searched all of `worker/index.js` for `console.log` /
  `console.error`.
- **What happens:** The only `console.*` call is a non-fatal error log if
  `addPendingEntry` fails (after the GitHub commit already succeeded) — it
  logs the *error*, not the EID or any request body. No code path logs the
  raw EID.

---

## 3. GitHub Actions workflow (`.github/workflows/update-leaderboard.yml`)

- **Where:** Line 31 —
  `curl -s "https://ei_worker.tylertms.workers.dev/leaderboard?eid=${{ secrets.EI_EID }}&scope=ALL_TIME&grade=5"`.
- **What happens:** This is the **maintainer's own EID**, stored as a
  GitHub Actions **encrypted secret** (`EI_EID`), used once a week by the
  scheduled job to pull the public top-100 leaderboard snapshot (the same
  publicly-viewable top-100 list, not any individual visitor's private
  data). This is unrelated to visitor-submitted EIDs — it's simply how the
  automation authenticates itself to `ei_worker` to fetch the leaderboard.
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
| `submit-eid` input (browser) | Yes (visitor's own input) | Nowhere until submit | No |
| `localStorage["savedEids"]` | Yes (as object key + `title` tooltip) | Nowhere — local only | Yes, but only in that visitor's own browser |
| Browser ei_worker lookup (~1.2a) | Yes | Third-party `ei_worker.tylertms.workers.dev` (direct from browser, NOT via this project's Worker) | Not by this project; that service's own logging is outside this repo's control |
| `cachedSubmitData` (browser memory) | Yes (locally cached results) | Nowhere — local browser memory only, then in next POST to Worker | No — ephemeral, cleared on modal close |
| POST `/submit` with `action: "confirm"` (~1.3) | Yes + cached player data | Cloudflare Worker (HTTPS) | No — held in memory for one request only |
| `RATE_LIMIT_KV` | No — only a salted SHA-256 hash | N/A | Yes (hash only, auto-expires with normal KV TTL behavior for the rate-limit key) |
| `PENDING_SUBMISSIONS_KV` | No | N/A | Yes, but only `{ rank, player, score, source }` (public fields), 9-day TTL |
| GitHub commit (`data/<date>.json`) | No | N/A | Yes, but only `{ rank, player, score, source }` (public fields) |
| GitHub Actions logs | No (maintainer's own EID is a redacted secret, unrelated to visitors) | N/A | No |
| Worker `console.*` calls | No | N/A | No |

**Conclusion:** the only two places a raw EID persists anywhere are (a) the
visitor's own browser `localStorage`, under their own control, and (b) in
transit over HTTPS to the Worker and onward to the third-party `ei_worker`
API for the lookup itself. No raw EID is ever committed to git, written to
this project's own KV storage, or logged.
