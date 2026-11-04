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
    SEASONAL_GITHUB_BRANCH: "main",
    EI_WORKER_BASE: "https://ei-worker.test",
    SUBMIT_HASH_SALT: "test-salt",
    DISABLE_RATE_LIMIT: "false",
    RATE_LIMIT_KV: {
      get: async key => rateLimits.get(key) || null,
      put: async (key, value) => rateLimits.set(key, value)
    }
  };
}

function apiFetch({ catalog = seasons, writes = [] } = {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.github.com") {
      if (init.method === "PUT") {
        writes.push({ url, body: JSON.parse(init.body) });
        return Response.json({ ok: true });
      }
      if (url.pathname.endsWith("/data/seasonal/index.json")) {
        return Response.json({
          content: Buffer.from(JSON.stringify({ seasons: catalog.filter(season => season.scope !== "ALL_TIME") })).toString("base64")
        });
      }
      return new Response("not found", { status: 404 });
    }

    throw new Error(`Unexpected request: ${url}`);
  };
}

const confirmedResults = [
  { scope: "spring_2025", rank: "134", score: "800000" },
  { scope: "summer_2025", rank: "99", score: "700000" }
];

function confirmation(player = "SeasonTester", results = confirmedResults) {
  return { action: "confirm", eid: "EI1234567890123456", player, results };
}

async function callSeasonal(worker, env, body) {
  const request = new Request("https://worker.test/submit-seasonal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return worker.fetch(request, env);
}

test("seasonal endpoint rejects preview requests and never performs EID lookups", async () => {
  const workerModule = await loadWorker();
  const worker = workerModule.default;
  const env = createEnv();
  const writes = [];
  globalThis.fetch = async () => {
    throw new Error("Worker must not call ei_worker from the seasonal submit route");
  };

  const response = await callSeasonal(worker, env, { eid: "EI1234567890123456", action: "preview" });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0);
});

test("seasonal submission rejects malformed EIDs before API or GitHub calls", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  globalThis.fetch = async () => {
    throw new Error("Should not call external API for invalid EID");
  };

  const response = await callSeasonal(worker, env, {
    ...confirmation(),
    eid: "not-an-eid"
  });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.equal(result.ok, false);
});

test("seasonal confirm writes public entries only to the configured supplemental archive branch", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  const writes = [];
  globalThis.fetch = apiFetch({ writes });

  const response = await callSeasonal(worker, env, confirmation());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0].url.pathname, /seasonal-submissions\.json$/);
  assert.equal(writes[0].body.branch, "main");
  const archive = JSON.parse(Buffer.from(writes[0].body.content, "base64").toString("utf8"));
  assert.equal(archive.entries.length, 2);
  assert.equal(archive.entries[0].rank, "134");
  assert.equal(archive.entries[0].player, "SeasonTester");
  assert.ok(archive.entries.every(entry => !JSON.stringify(entry).includes("EI1234567890123456")));
});

test("seasonal confirm updates an existing player/scope row without duplicating it", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  const writes = [];
  const fetchApi = apiFetch({ writes });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.github.com" && init.method !== "PUT") {
      if (url.pathname.endsWith("/data/seasonal/index.json")) {
        return Response.json({
          content: Buffer.from(JSON.stringify({
            seasons: seasons.filter(season => season.scope !== "ALL_TIME")
          })).toString("base64")
        });
      }
      const content = Buffer.from(JSON.stringify({
        updatedAt: "2025-01-01",
        entries: [{
          scope: "spring_2025",
          seasonName: "Spring 2025",
          rank: "150",
          player: "seasontester",
          score: "750000",
          source: "submission"
        }]
      })).toString("base64");
      return Response.json({ sha: "existing-sha", content });
    }
    return fetchApi(input, init);
  };

  const response = await callSeasonal(worker, env, confirmation());
  const archive = JSON.parse(Buffer.from(writes[0].body.content, "base64").toString("utf8"));
  assert.equal(response.status, 200);
  assert.equal(archive.entries.filter(entry => entry.scope === "spring_2025" && entry.player.toLowerCase() === "seasontester").length, 1);
  assert.equal(archive.entries.find(entry => entry.scope === "spring_2025").rank, "134");
});

test("invalid seasonal results return an error and do not partially publish", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  const writes = [];
  globalThis.fetch = apiFetch({ writes });

  const incompleteResults = [{ scope: "spring_2025", rank: "134", score: "800000" }];
  const response = await callSeasonal(worker, env, confirmation("SeasonTester", incompleteResults));
  const result = await response.json();

  assert.equal(response.status, 502);
  assert.equal(result.ok, false);
  assert.match(result.error, /catalog|season/i);
  assert.equal(writes.length, 0);
});

test("seasonal submission rejects malformed public results before writing", async () => {
  const worker = (await loadWorker()).default;
  const env = createEnv();
  const writes = [];
  globalThis.fetch = apiFetch({ writes });

  const invalidResults = [
    { scope: "spring_2025", rank: "0", score: "800000" },
    { scope: "summer_2025", rank: "99", score: "700000" }
  ];
  const response = await callSeasonal(worker, env, confirmation("SeasonTester", invalidResults));
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0);
});
