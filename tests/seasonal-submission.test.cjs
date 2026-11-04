const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");

let workerPromise;
async function loadWorker() {
  if (!workerPromise) {
    workerPromise = readFile(path.join(__dirname, "..", "worker", "index.js"), "utf8")
      .then(source => import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));
  }
  return workerPromise;
}

const seasons = [
  { scope: "spring_2025", name: "Spring 2025" },
  { scope: "summer_2025", name: "Summer 2025" },
  { scope: "ALL_TIME", name: "All Time" }
];

function createEnv() {
  const rateLimits = new Map();
  return {
    GITHUB_OWNER: "owner",
    GITHUB_REPO: "repo",
    GITHUB_TOKEN: "test-token",
    SEASONAL_GITHUB_BRANCH: "experimental",
    EI_WORKER_BASE: "https://ei-worker.test",
    SUBMIT_HASH_SALT: "test-salt",
    DISABLE_RATE_LIMIT: "false",
    RATE_LIMIT_KV: {
      get: async key => rateLimits.get(key) || null,
      put: async (key, value) => rateLimits.set(key, value)
    }
  };
}

function apiFetch({ failScope = null, writes = [] } = {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "ei-worker.test") {
      if (url.pathname === "/player_summary") {
        return Response.json({ user_name: "SeasonTester" });
      }
      if (url.pathname === "/leaderboard_info") {
        return Response.json({ allTimeScope: "ALL_TIME", seasonsList: seasons });
      }
      if (url.pathname === "/leaderboard") {
        const scope = url.searchParams.get("scope");
        if (scope === failScope) return new Response("failed", { status: 503 });
        return Response.json({
          topEntriesList: [{ rank: 1, alias: "SomeoneElse", score: 999999 }],
          count: 39246,
          rank: scope === "spring_2025" ? 134 : 99,
          score: scope === "spring_2025" ? 800000 : 700000
        });
      }
    }

    if (url.hostname === "api.github.com") {
      if (init.method === "PUT") {
        writes.push({ url, body: JSON.parse(init.body) });
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    }

    throw new Error(`Unexpected request: ${url}`);
  };
}

async function callSeasonal(worker, env, body) {
  const request = new Request("https://worker.test/submit-seasonal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return worker.fetch(request, env);
}

test("seasonal preview returns requester top-level ranks, including outside top 100, without publishing", async () => {
  const workerModule = await loadWorker();
  const worker = workerModule.default;
  const env = createEnv();
  const writes = [];
  globalThis.fetch = apiFetch({ writes });

  const response = await callSeasonal(worker, env, { eid: "EI1234567890123456", action: "preview" });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.player, "SeasonTester");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].rank, "134");
  assert.equal(result.results[0].score, "800000");
  assert.equal(result.results[1].rank, "99");
  assert.equal(writes.length, 0);
});

test("seasonal confirm writes public entries only to the experimental supplemental archive", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  const writes = [];
  globalThis.fetch = apiFetch({ writes });

  const response = await callSeasonal(worker, env, { eid: "EI1234567890123456", action: "confirm" });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0].url.pathname, /seasonal-submissions\.json$/);
  assert.equal(writes[0].body.branch, "experimental");
  const archive = JSON.parse(Buffer.from(writes[0].body.content, "base64").toString("utf8"));
  assert.equal(archive.entries.length, 2);
  assert.equal(archive.entries[0].rank, "134");
  assert.equal(archive.entries[0].player, "SeasonTester");
  assert.ok(archive.entries.every(entry => !JSON.stringify(entry).includes("EI1234567890123456")));
});

test("failed seasonal lookup returns an error and does not partially publish", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  const writes = [];
  globalThis.fetch = apiFetch({ failScope: "summer_2025", writes });

  const response = await callSeasonal(worker, env, { eid: "EI1234567890123456", action: "confirm" });
  const result = await response.json();

  assert.equal(response.status, 502);
  assert.equal(result.ok, false);
  assert.match(result.error, /Summer 2025/);
  assert.equal(writes.length, 0);
});

test("seasonal submission rejects malformed EIDs before making API calls", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  globalThis.fetch = async () => {
    throw new Error("Should not call external API for invalid EID");
  };

  const response = await callSeasonal(worker, env, { eid: "not-an-eid", action: "preview" });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.equal(result.ok, false);
});
