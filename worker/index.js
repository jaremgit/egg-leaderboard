/* =========================================================================
   egg-leaderboard-preview - submission Worker
   =========================================================================
   Handles POST /submit { eid: "EI...", action: "preview" | "confirm" } from
   the static site's "Submit your score" popup. Two actions are supported:

     "preview" (default) - looks up the player's ALL_TIME / Grade 5 (AAA)
        name/rank/score via ei_worker and returns it WITHOUT publishing
        anything or consuming the once-per-day rate limit. This lets a
        visitor see their result before deciding whether to submit it.

     "confirm" - repeats the same lookup (so the published data is fresh),
        enforces the one-submission-per-EID-per-day rate limit, and commits
        the result into today's data/<date>.json snapshot in this GitHub
        repo, using a GitHub personal access token stored as a Worker secret.
        It also writes the same entry into PENDING_SUBMISSIONS_KV so the
        site can display it immediately (see GET /pending below) without
        waiting for Vercel to notice/rebuild from the GitHub commit. GitHub
        remains the permanent source of truth either way - this KV entry is
        purely a "show it instantly" cache and expires on its own.

   Also handles GET /pending?date=YYYY-MM-DD - returns any submissions made
   today (or another date) that are cached in PENDING_SUBMISSIONS_KV, so the
   frontend can merge them into the table live. This is public/read-only
   data (the same name/rank/score already visible in-game and on the site).

   PRIVACY NOTE: The EID a visitor submits is only ever held in memory for
   the duration of a single request. It is never logged (no console.log of
   the eid), never stored in KV or in git, and is discarded as soon as the
   ei_worker lookup completes. Only the resulting public leaderboard fields
   (name, score, rank) - the same information already visible in-game and on
   this site - are persisted, and only for "confirm" requests.
   ========================================================================= */

const EID_PATTERN = /^EI\d{16,20}$/;

// How long a "pending" (not-yet-archived) submission stays in KV before it
// naturally expires. The weekly GitHub Action archives same-day submissions
// straight from the git commit (not from this cache), so this is just a
// generous safety margin in case a date is looked at again after that.
const PENDING_TTL_SECONDS = 60 * 60 * 24 * 9; // 9 days

export default {
  async fetch(request, env) {
    // Basic CORS handling so the static site (any origin) can call this.
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/pending") {
      const date = url.searchParams.get("date");

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return withCors(
          jsonError("Query param 'date' must be YYYY-MM-DD.", 400)
        );
      }

      const entries = await getPendingEntries(date, env);

      return withCors(
        new Response(JSON.stringify({ ok: true, entries }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (request.method !== "POST") {
      return withCors(jsonError("Only POST requests are supported.", 405));
    }

    if (url.pathname !== "/submit") {
      return withCors(jsonError("Unknown endpoint.", 404));
    }

    let eid;
    let action;
    try {
      const body = await request.json();
      eid = typeof body.eid === "string" ? body.eid.trim() : "";
      action = body.action === "confirm" ? "confirm" : "preview";
    } catch {
      return withCors(jsonError("Request body must be JSON.", 400));
    }

    if (!EID_PATTERN.test(eid)) {
      return withCors(
        jsonError("That doesn't look like a valid EggInc ID.", 400)
      );
    }

    const hashedEid = await hashEid(eid, env.SUBMIT_HASH_SALT);
    const rateLimitKey = `submit:${hashedEid}`;

    if (action === "preview") {
      // Preview only looks up and returns the result - no rate limit is
      // consumed and nothing is published yet. We still tell the visitor
      // up front if they've already used today's submission, so they don't
      // go through the lookup expecting to be able to publish it.
      //
      // TESTING: set DISABLE_RATE_LIMIT = "true" in wrangler.toml [vars] (or
      // via `wrangler secret put DISABLE_RATE_LIMIT`) to bypass the once-per-
      // day limit entirely. Remove/set back to "false" before going live.
      const rateLimitDisabled = env.DISABLE_RATE_LIMIT === "true";
      const alreadySubmittedToday =
        !rateLimitDisabled && (await env.RATE_LIMIT_KV.get(rateLimitKey));

      let entry;
      try {
        entry = await lookupPlayerEntry(eid, env);
      } catch (error) {
        return withCors(jsonError(error.message, 502));
      }

      return withCors(
        new Response(
          JSON.stringify({
            ok: true,
            player: entry.player,
            rank: entry.rank,
            score: entry.score,
            alreadySubmittedToday: Boolean(alreadySubmittedToday)
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // ---- action === "confirm" ---------------------------------------------

    // ---- Rate limit: one submission per EID per day ----------------------
    const rateLimitDisabled = env.DISABLE_RATE_LIMIT === "true";
    const alreadySubmittedToday =
      !rateLimitDisabled && (await env.RATE_LIMIT_KV.get(rateLimitKey));
    if (alreadySubmittedToday) {
      return withCors(
        jsonError(
          "You've already submitted today. Please try again tomorrow.",
          429
        )
      );
    }

    // ---- Look up the player's ALL_TIME / AAA entry via ei_worker ---------
    let entry;
    try {
      entry = await lookupPlayerEntry(eid, env);
    } catch (error) {
      return withCors(jsonError(error.message, 502));
    }
    // "eid" is not referenced again below - it is intentionally discarded
    // here now that the lookup is complete.

    // ---- Commit the result into today's data/<date>.json snapshot --------
    try {
      await commitEntryToGitHub(entry, env);
    } catch (error) {
      return withCors(jsonError(error.message, 502));
    }

    // ---- Cache it in KV so the site can show it instantly ----------------
    // (GitHub above is still the permanent record; this just avoids making
    // visitors wait for a Vercel rebuild to see their own submission.)
    const today = new Date().toISOString().split("T")[0];
    try {
      await addPendingEntry(today, entry, env);
    } catch (error) {
      // Non-fatal - the submission is already safely committed to GitHub.
      console.error("Failed to cache pending submission in KV:", error.message);
    }

    // Mark this EID as having submitted today (expires after 24 hours).
    // Skipped while DISABLE_RATE_LIMIT="true" so testing doesn't leave
    // stale rate-limit entries behind in KV.
    if (!rateLimitDisabled) {
      await env.RATE_LIMIT_KV.put(rateLimitKey, "1", { expirationTtl: 86400 });
    }

    return withCors(
      new Response(
        JSON.stringify({
          ok: true,
          player: entry.player,
          rank: entry.rank,
          score: entry.score
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  }
};

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

function jsonError(message, status) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

// Hashes the EID with a secret salt (SUBMIT_HASH_SALT, set via
// `wrangler secret put`) so the rate-limit key can never be reversed back
// into the original EID even if the KV store were exposed.
async function hashEid(eid, salt) {
  const data = new TextEncoder().encode(`${salt || ""}:${eid}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Calls the public ei_worker API and extracts this player's own
// name/score/rank from the ALL_TIME / Grade 5 (AAA) leaderboard.
//
// IMPORTANT: /leaderboard's response includes top-level "rank" and "score"
// fields alongside "topEntriesList" - those top-level fields are the
// REQUESTING PLAYER'S OWN position (confirmed against a real account: the
// values matched that player's actual in-game ALL_TIME AAA rank/score
// exactly), even when their rank is far outside the visible top-100 list in
// topEntriesList. We use ONLY those top-level fields for this player's
// entry - we never fall back to guessing from topEntriesList (e.g. "just
// use the first entry"), since that would silently attribute someone else's
// score to the wrong account.
async function lookupPlayerEntry(eid, env) {
  const base = env.EI_WORKER_BASE || "https://ei_worker.tylertms.workers.dev";
  const scope = env.EI_SCOPE || "ALL_TIME";
  const grade = env.EI_GRADE || "5";

  // 1. Get this player's own rank/score directly from /leaderboard.
  const leaderboardResponse = await fetch(
    `${base}/leaderboard?eid=${encodeURIComponent(eid)}&scope=${scope}&grade=${grade}`
  );

  if (!leaderboardResponse.ok) {
    throw new Error(
      "Couldn't reach the Egg, Inc. leaderboard service. Please try again later."
    );
  }

  const leaderboardData = await leaderboardResponse.json();

  if (leaderboardData && leaderboardData.error) {
    throw new Error(
      "That EggInc ID couldn't be looked up. Double check it and try again."
    );
  }

  const rank = leaderboardData.rank;
  const score = leaderboardData.score;

  if (rank === undefined || rank === null || score === undefined || score === null) {
    throw new Error(
      "You're not currently ranked on the ALL_TIME AAA leaderboard, so there's nothing to add yet."
    );
  }

  // 2. Get this player's display name via /player_summary (the leaderboard
  //    response itself doesn't include the requester's own name).
  const summaryResponse = await fetch(
    `${base}/player_summary?eid=${encodeURIComponent(eid)}`
  );

  if (!summaryResponse.ok) {
    throw new Error(
      "Couldn't reach the Egg, Inc. player service. Please try again later."
    );
  }

  const summary = await summaryResponse.json();

  if (summary && summary.error) {
    throw new Error(
      "That EggInc ID couldn't be looked up. Double check it and try again."
    );
  }

  const player = summary.user_name;

  if (!player) {
    throw new Error(
      "The player service returned an unexpected response shape."
    );
  }

  return {
    player: String(player),
    rank: String(rank),
    score: String(score)
  };
}

// Upserts { rank, player, score, source: "submission" } into today's
// data/<date>.json snapshot (creating the file and/or adding today to
// dates.json if needed), committing directly to GitHub via the Contents API.
async function commitEntryToGitHub(entry, env) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const token = env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("Server is misconfigured (missing GitHub token).");
  }

  const today = new Date().toISOString().split("T")[0];
  const snapshotPath = `data/${today}.json`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "egg-leaderboard-submit-worker"
  };

  // 1. Read (or create) today's snapshot file.
  const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${snapshotPath}?ref=${branch}`;
  const getResponse = await fetch(getUrl, { headers });

  let snapshot;
  let sha;

  if (getResponse.status === 200) {
    const fileData = await getResponse.json();
    sha = fileData.sha;
    const decoded = atob(fileData.content.replace(/\n/g, ""));
    snapshot = JSON.parse(decoded);
  } else if (getResponse.status === 404) {
    snapshot = {
      date: today,
      complete: false,
      observed_entries: 0,
      entries: []
    };
  } else {
    throw new Error("Couldn't read the current leaderboard snapshot.");
  }

  // 2. Upsert this player's entry (replace any existing row for them).
  const existingIndex = snapshot.entries.findIndex(
    row => row.player && row.player.toLowerCase() === entry.player.toLowerCase()
  );

  const newRow = {
    rank: entry.rank,
    player: entry.player,
    score: entry.score,
    source: "submission"
  };

  if (existingIndex >= 0) {
    snapshot.entries[existingIndex] = newRow;
  } else {
    snapshot.entries.push(newRow);
  }

  snapshot.observed_entries = snapshot.entries.length;

  // 3. Write the updated snapshot back.
  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${snapshotPath}`;
  const putBody = {
    message: `chore: player submission for ${today}`,
    content: btoa(JSON.stringify(snapshot, null, 2)),
    branch
  };
  if (sha) {
    putBody.sha = sha;
  }

  const putResponse = await fetch(putUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(putBody)
  });

  if (!putResponse.ok) {
    throw new Error("Couldn't save your submission. Please try again later.");
  }

  // 4. Make sure today is listed in dates.json.
  await ensureDateListed(today, env, headers);
}

async function ensureDateListed(today, env, headers) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const datesPath = "data/dates.json";

  const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${datesPath}?ref=${branch}`;
  const getResponse = await fetch(getUrl, { headers });

  if (getResponse.status !== 200) {
    // If dates.json can't be read, skip silently - the snapshot itself
    // was already saved successfully.
    return;
  }

  const fileData = await getResponse.json();
  const decoded = atob(fileData.content.replace(/\n/g, ""));
  const dates = JSON.parse(decoded);

  if (dates.includes(today)) {
    return;
  }

  dates.push(today);
  dates.sort();

  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${datesPath}`;
  await fetch(putUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `chore: add ${today} to dates.json (player submission)`,
      content: btoa(JSON.stringify(dates, null, 2)),
      sha: fileData.sha,
      branch
    })
  });
}

// ---- "Pending" submissions cache (PENDING_SUBMISSIONS_KV) -----------------
// Lets the frontend show a confirmed submission immediately, without
// waiting for Vercel to rebuild from the GitHub commit made above. Each KV
// key is "pending:<date>" and stores a JSON array of { rank, player, score,
// source: "submission" } rows for that date. GitHub is still the permanent
// record - this is purely a short-lived "not yet rebuilt" cache.

async function getPendingEntries(date, env) {
  const raw = await env.PENDING_SUBMISSIONS_KV.get(`pending:${date}`);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function addPendingEntry(date, entry, env) {
  const existing = await getPendingEntries(date, env);

  const newRow = {
    rank: entry.rank,
    player: entry.player,
    score: entry.score,
    source: "submission"
  };

  const existingIndex = existing.findIndex(
    row => row.player && row.player.toLowerCase() === entry.player.toLowerCase()
  );

  if (existingIndex >= 0) {
    existing[existingIndex] = newRow;
  } else {
    existing.push(newRow);
  }

  await env.PENDING_SUBMISSIONS_KV.put(`pending:${date}`, JSON.stringify(existing), {
    expirationTtl: PENDING_TTL_SECONDS
  });
}
