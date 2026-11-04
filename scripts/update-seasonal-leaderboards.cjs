const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_API_BASE_URL = "https://ei_worker.tylertms.workers.dev";
const SCOPE_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_CONCURRENT_SEASON_REQUESTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/** @typedef {{ scope: string, name: string }} Season */
/** @typedef {{ rank: string, player: string, score: string, source: string }} LeaderboardEntry */
/** @typedef {{ scope: string, name: string, updatedAt: string, entries: LeaderboardEntry[] }} SeasonSnapshot */
/** @typedef {{ currentScope: string | null, seasons: Season[] }} SeasonalCatalog */

/**
 * @param {{ allTimeScope: string, seasonsList: Array<{ scope: string, name: string }> }} info
 * @returns {Season[]}
 */
function getSeasonScopes(info) {
  if (!info || typeof info.allTimeScope !== "string" || !Array.isArray(info.seasonsList)) {
    throw new Error("leaderboard_info returned an invalid season catalog.");
  }

  const allTimeScope = info.allTimeScope.trim().toLowerCase();
  const seen = new Set();
  const seasons = info.seasonsList
    .filter(season => {
      const scope = typeof season?.scope === "string" ? season.scope.trim().toLowerCase() : "";
      return scope !== allTimeScope && scope !== "all_time";
    })
    .map(season => {
      const scope = typeof season?.scope === "string" ? season.scope.trim() : "";
      const name = typeof season?.name === "string" ? season.name.trim() : "";

      if (!scope || !SCOPE_PATTERN.test(scope) || !name) {
        throw new Error("leaderboard_info contained an invalid season.");
      }
      if (seen.has(scope)) {
        throw new Error(`leaderboard_info returned duplicate scope '${scope}'.`);
      }
      seen.add(scope);

      return { scope, name };
    });

  if (seasons.length === 0) {
    throw new Error("leaderboard_info did not return any seasonal scopes.");
  }

  return seasons;
}

/**
 * @param {{ topEntriesList: Array<{ rank: unknown, alias?: unknown, name?: unknown, player_name?: unknown, score: unknown }> }} payload
 * @param {string} scope
 * @returns {LeaderboardEntry[]}
 */
function normalizeEntries(payload, scope) {
  if (!Array.isArray(payload?.topEntriesList) || payload.topEntriesList.length === 0) {
    throw new Error(`Leaderboard response for '${scope}' did not contain entries.`);
  }

  const entries = payload.topEntriesList.map((entry, index) => {
    const rank = Number(entry?.rank);
    const playerName = [
      entry?.alias,
      entry?.name,
      entry?.player_name,
      entry?.playerName,
      entry?.user_name,
      entry?.userName,
      entry?.username,
      entry?.player
    ].find(value => typeof value === "string" && value.trim())?.trim() || "";
    const player = playerName || `Unknown (${scope} rank ${rank})`;
    const score = entry?.score;
    const invalidFields = [];

    if (!Number.isInteger(rank) || rank < 1) {
      invalidFields.push("rank");
    }
    if (score === undefined || score === null || !["string", "number"].includes(typeof score)) {
      invalidFields.push("score");
    }

    if (invalidFields.length > 0) {
      const availableFields = entry && typeof entry === "object"
        ? Object.keys(entry).sort().join(", ") || "none"
        : `non-object (${typeof entry})`;
      throw new Error(
        `Leaderboard response for '${scope}' entry ${index + 1} has invalid ${invalidFields.join(", ")}; available fields: ${availableFields}.`
      );
    }

    return {
      rank: String(rank),
      player,
      score: String(score),
      source: "ei_worker"
    };
  });

  return entries.sort((a, b) => Number(a.rank) - Number(b.rank));
}

/** @param {Array<{ rank: unknown, player: unknown, score: unknown }>} entries */
function entriesSignature(entries) {
  return JSON.stringify(entries.map(({ rank, player, score }) => ({
    rank: String(rank),
    player: String(player),
    score: String(score)
  })));
}

/**
 * @param {{ scope: string, name: string, entries: LeaderboardEntry[], existing?: SeasonSnapshot | null, updatedAt: string }} options
 * @returns {{ snapshot: SeasonSnapshot, changed: boolean }}
 */
function createSeasonSnapshot({ scope, name, entries, existing, updatedAt }) {
  const entriesChanged = !existing || !Array.isArray(existing.entries) ||
    entriesSignature(existing.entries) !== entriesSignature(entries);
  const snapshot = {
    scope,
    name,
    updatedAt: entriesChanged ? updatedAt : (existing.updatedAt || updatedAt),
    entries
  };

  return {
    snapshot,
    changed: entriesChanged || existing?.name !== name || existing?.scope !== scope
  };
}

/** @param {URL} url @param {typeof fetch} fetchImpl */
async function getJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds for ${url.pathname}.`);
    }
    throw new Error(`Network request failed for ${url.pathname}.`);
  }
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url.pathname}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`Response from ${url.pathname} was not valid JSON.`);
  }
}

/** @param {string} filePath @returns {Promise<unknown | null>} */
async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** @param {SeasonalCatalog | null} existing @param {Season[]} liveSeasons @returns {SeasonalCatalog} */
function mergeCatalog(existing, liveSeasons) {
  const seasonsByScope = new Map();
  for (const season of existing?.seasons || []) {
    if (season && typeof season.scope === "string" && typeof season.name === "string") {
      seasonsByScope.set(season.scope, { scope: season.scope, name: season.name });
    }
  }
  for (const season of liveSeasons) {
    seasonsByScope.set(season.scope, season);
  }

  return {
    currentScope: liveSeasons[liveSeasons.length - 1].scope,
    seasons: [...seasonsByScope.values()]
  };
}

/** @param {unknown} value */
function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** @param {string} filePath @param {unknown} value */
async function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, formatJson(value), "utf8");
  await rename(temporaryPath, filePath);
}

/**
 * @param {{ rootDir?: string, eid?: string, fetchImpl?: typeof fetch, apiBaseUrl?: string, now?: Date }} options
 * @returns {Promise<{ currentScope: string, snapshotsUpdated: string[], catalogChanged: boolean }>}
 */
async function updateSeasonalArchive({
  rootDir = process.cwd(),
  eid = process.env.EI_EID,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  now = new Date()
} = {}) {
  if (!eid) {
    throw new Error("Missing EI_EID environment variable.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const seasonalDir = path.join(rootDir, "data", "seasonal");
  const indexPath = path.join(seasonalDir, "index.json");
  const existingCatalog = await readJsonIfPresent(indexPath);
  if (existingCatalog && !Array.isArray(existingCatalog.seasons)) {
    throw new Error("Existing seasonal index.json is invalid.");
  }

  const infoUrl = new URL("/leaderboard_info", apiBaseUrl);
  const info = await getJson(infoUrl, fetchImpl);
  const liveSeasons = getSeasonScopes(info);
  const updatedAt = now.toISOString().slice(0, 10);
  const pendingWrites = [];
  const concurrency = Math.min(MAX_CONCURRENT_SEASON_REQUESTS, liveSeasons.length);
  let nextSeasonIndex = 0;
  let firstFailure = null;

  console.log(`[Seasonal] Found ${liveSeasons.length} scopes; fetching up to ${concurrency} at a time.`);

  async function processNextSeason() {
    while (nextSeasonIndex < liveSeasons.length && !firstFailure) {
      const index = nextSeasonIndex++;
      const season = liveSeasons[index];
      const startedAt = Date.now();
      console.log(`[Seasonal] [${index + 1}/${liveSeasons.length}] Fetching ${season.scope} (${season.name}).`);

      try {
        const leaderboardUrl = new URL("/leaderboard", apiBaseUrl);
        leaderboardUrl.searchParams.set("eid", eid);
        leaderboardUrl.searchParams.set("scope", season.scope);
        leaderboardUrl.searchParams.set("grade", "5");

        const payload = await getJson(leaderboardUrl, fetchImpl);
        const entries = normalizeEntries(payload, season.scope);
        const filePath = path.join(seasonalDir, `${season.scope}.json`);
        const existingSnapshot = await readJsonIfPresent(filePath);
        const result = createSeasonSnapshot({
          ...season,
          entries,
          existing: existingSnapshot,
          updatedAt
        });

        if (result.changed) {
          pendingWrites.push({ filePath, snapshot: result.snapshot, scope: season.scope });
        }

        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(
          `[Seasonal] [${index + 1}/${liveSeasons.length}] ${season.scope}: ${entries.length} entries in ${elapsedSeconds}s; ${result.changed ? "changed" : "unchanged"}.`
        );
      } catch (error) {
        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        firstFailure = { scope: season.scope, error };
        console.error(
          `[Seasonal] [${index + 1}/${liveSeasons.length}] ${season.scope} failed after ${elapsedSeconds}s: ${error.message}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => processNextSeason()));
  if (firstFailure) {
    throw new Error(`Seasonal update stopped at '${firstFailure.scope}': ${firstFailure.error.message}`);
  }

  const catalog = mergeCatalog(existingCatalog, liveSeasons);
  const catalogChanged = JSON.stringify(existingCatalog) !== JSON.stringify(catalog);

  await mkdir(seasonalDir, { recursive: true });
  for (const { filePath, snapshot } of pendingWrites) {
    await writeJson(filePath, snapshot);
  }
  if (catalogChanged) {
    await writeJson(indexPath, catalog);
  }

  return {
    currentScope: catalog.currentScope,
    snapshotsUpdated: pendingWrites.map(({ scope }) => scope),
    catalogChanged
  };
}

async function main() {
  const result = await updateSeasonalArchive();
  console.log(`Seasonal catalog current scope: ${result.currentScope}`);
  console.log(`Updated seasonal snapshots: ${result.snapshotsUpdated.length}`);
  console.log(`Updated season catalog: ${result.catalogChanged ? "yes" : "no"}`);
}

module.exports = {
  getSeasonScopes,
  normalizeEntries,
  createSeasonSnapshot,
  updateSeasonalArchive
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
