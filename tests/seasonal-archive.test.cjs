const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, stat } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  getSeasonScopes,
  normalizeEntries,
  updateSeasonalArchive
} = require("../scripts/update-seasonal-leaderboards.cjs");

/** @param {unknown} payload @param {number} status */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/** @param {{ failingScope?: string, scoreAdjustment?: number }} options */
function createFetch({ failingScope, scoreAdjustment = 0 } = {}) {
  const seasonsList = [
    { scope: "spring_2025", name: "Spring 2025" },
    { scope: "summer_2025", name: "Summer 2025" },
    { scope: "ALL_TIME", name: "All Time" }
  ];

  /** @param {RequestInfo | URL} input */
  return async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === "/leaderboard_info") {
      return jsonResponse({ seasonsList, allTimeScope: "ALL_TIME" });
    }

    const scope = url.searchParams.get("scope");
    if (scope === failingScope) {
      return jsonResponse({ error: "upstream failure" }, 503);
    }

    return jsonResponse({
      topEntriesList: [
        { rank: "2", alias: `${scope} Player B`, score: 200 + scoreAdjustment },
        { rank: "1", name: `${scope} Player A`, score: 300 + scoreAdjustment }
      ]
    });
  };
}

test("getSeasonScopes excludes All Time and validates season scope values", () => {
  assert.deepEqual(
    getSeasonScopes({
      allTimeScope: "ALL_TIME",
      seasonsList: [
        { scope: "spring_2025", name: "Spring 2025" },
        { scope: "ALL_TIME", name: "All Time" }
      ]
    }),
    [{ scope: "spring_2025", name: "Spring 2025" }]
  );
  assert.throws(
    () => getSeasonScopes({ allTimeScope: "ALL_TIME", seasonsList: [{ scope: "../secret", name: "Bad" }] }),
    /invalid season/
  );
});

test("normalizeEntries returns a rank-sorted validated top list", () => {
  assert.deepEqual(
    normalizeEntries({
      topEntriesList: [
        { rank: "2", alias: "Second", score: 20 },
        { rank: 1, name: "First", score: "30" }
      ]
    }, "spring_2025"),
    [
      { rank: "1", player: "First", score: "30", source: "ei_worker" },
      { rank: "2", player: "Second", score: "20", source: "ei_worker" }
    ]
  );
  assert.throws(() => normalizeEntries({ topEntriesList: [] }, "spring_2025"), /did not contain entries/);
  assert.throws(
    () => normalizeEntries({ topEntriesList: [{ rank: 1, score: 30, secretName: "Private Player" }] }, "spring_2025"),
    error => {
      assert.match(error.message, /entry 1 has invalid player name; available fields: rank, score, secretName/);
      assert.doesNotMatch(error.message, /Private Player/);
      return true;
    }
  );
});

test("archive writes one current snapshot per season and avoids unchanged rewrites", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "seasonal-archive-"));
  try {
    const first = await updateSeasonalArchive({
      rootDir,
      eid: "EI1234567890123456",
      fetchImpl: createFetch(),
      now: new Date("2026-10-31T00:01:00Z")
    });

    assert.deepEqual(first.snapshotsUpdated, ["spring_2025", "summer_2025"]);
    assert.equal(first.currentScope, "summer_2025");
    const springPath = path.join(rootDir, "data", "seasonal", "spring_2025.json");
    const before = await readFile(springPath, "utf8");
    const spring = JSON.parse(before);
    assert.equal(spring.updatedAt, "2026-10-31");
    assert.equal(spring.entries[0].rank, "1");

    const second = await updateSeasonalArchive({
      rootDir,
      eid: "EI1234567890123456",
      fetchImpl: createFetch(),
      now: new Date("2026-11-07T00:01:00Z")
    });

    assert.deepEqual(second.snapshotsUpdated, []);
    assert.equal(second.catalogChanged, false);
    assert.equal(await readFile(springPath, "utf8"), before);

    const changed = await updateSeasonalArchive({
      rootDir,
      eid: "EI1234567890123456",
      fetchImpl: createFetch({ scoreAdjustment: 1 }),
      now: new Date("2026-11-14T00:01:00Z")
    });
    assert.deepEqual(changed.snapshotsUpdated, ["spring_2025", "summer_2025"]);
    assert.equal(JSON.parse(await readFile(springPath, "utf8")).updatedAt, "2026-11-14");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("failed API fetch does not create or partially write seasonal files", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "seasonal-archive-failure-"));
  try {
    await assert.rejects(
      updateSeasonalArchive({
        rootDir,
        eid: "EI1234567890123456",
        fetchImpl: createFetch({ failingScope: "summer_2025" }),
        now: new Date("2026-10-31T00:01:00Z")
      }),
      error => {
        assert.match(error.message, /Request failed \(503\)/);
        assert.doesNotMatch(error.message, /EI1234567890123456/);
        return true;
      }
    );
    await assert.rejects(stat(path.join(rootDir, "data", "seasonal")));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
