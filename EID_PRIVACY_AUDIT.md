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
- **Where:** `app.js` ~lines 1456-1513, `fetch(SUBMIT_WORKER_URL, ... action: "preview")`.
- **What happens:** Sends `{ eid, action: "preview" }` over HTTPS to the
  Cloudflare Worker (`SUBMIT_WORKER_URL`, defined at ~line 244). The Worker
  responds with only `{ player, rank, score, alreadySubmittedToday }` — no
  EID is echoed back. **Nothing is published yet** at this stage.

### 1.3 "Confirm & Submit" request
- **Where:** `app.js` ~lines 1515-1563, `fetch(SUBMIT_WORKER_URL, ... action: "confirm")`.
- **What happens:** Sends `{ eid, action: "confirm" }` to the same Worker.
  This time the Worker actually commits the looked-up `{ player, rank, score }`
  to the public leaderboard data (see §2). The response back to the browser
  again contains only `{ player, rank, score }` — never the EID.

### 1.4 "Saved EggInc IDs" (local-only convenience feature)
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

### 2.3 Lookup against the public `ei_worker` API
- **Where:** `lookupPlayerEntry(eid, env)` (~lines 241-307).
- **What happens:** Makes two outbound GET requests to
  `https://ei_worker.tylertms.workers.dev` — `/leaderboard?eid=...` (for
  rank/score) and `/player_summary?eid=...` (for display name) — passing the
  EID as a query parameter to that **third-party** service (not one this
  project controls). This is the same third-party API used by the site's
  own weekly archive pull (§3) and by tools like wasmegg/carpet. The EID
  local variable is discarded once this function returns; it is not
  referenced again anywhere later in the request (explicitly called out in a
  comment at line ~171 in `index.js`).
- **Third-party trust note:** since this lookup is delegated to
  `ei_worker.tylertms.workers.dev`, that service technically does see the
  raw EID for the duration of its own request handling. This project has no
  control over that service's logging/retention; it is the same dependency
  already disclosed in `README.md`'s "third-party dependency" section.

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
| POST `/submit` body (preview/confirm) | Yes | Cloudflare Worker (HTTPS) | No — held in memory for one request only |
| `RATE_LIMIT_KV` | No — only a salted SHA-256 hash | N/A | Yes (hash only, auto-expires with normal KV TTL behavior for the rate-limit key) |
| `ei_worker` lookup (`/leaderboard`, `/player_summary`) | Yes | Third-party `ei_worker.tylertms.workers.dev` | Not by this project; that service's own logging is outside this repo's control |
| `PENDING_SUBMISSIONS_KV` | No | N/A | Yes, but only `{ rank, player, score, source }` (public fields), 9-day TTL |
| GitHub commit (`data/<date>.json`) | No | N/A | Yes, but only `{ rank, player, score, source }` (public fields) |
| GitHub Actions logs | No (maintainer's own EID is a redacted secret, unrelated to visitors) | N/A | No |
| Worker `console.*` calls | No | N/A | No |

**Conclusion:** the only two places a raw EID persists anywhere are (a) the
visitor's own browser `localStorage`, under their own control, and (b) in
transit over HTTPS to the Worker and onward to the third-party `ei_worker`
API for the lookup itself. No raw EID is ever committed to git, written to
this project's own KV storage, or logged.
