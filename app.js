/* =========================================================================
   EGG INC LEADERBOARD - app.js
   =========================================================================
   This is the ONLY JavaScript file for the site. It is organized into the
   following sections (search for the "====" banners to jump around):

     1. DOM ELEMENT REFERENCES   - grabs elements from index.html
     2. PLAYER ALIASES           - handles players who changed their name
     3. STATE (SHARED VARIABLES) - values that change while the app runs
     4. DATE / LEADERBOARD LOADING - fetching data/*.json files
     5. PLAYER SEARCH             - the "Search player history" box
     6. CHART RENDERING           - the score/rank line chart (Chart.js)
     7. DATA FILTERING (weekly/monthly averages + peaks)
     8. HEATMAP MODAL             - the "Data Coverage" popup
     9. GAPS MODAL                - the "Data Gaps" popup
    10. EVENT LISTENERS           - wires up buttons/inputs to functions above
    11. FORMATTING / UTILITY HELPERS - small reusable functions

   HOW TO MAKE COMMON CHANGES:
     - To change what data is shown per leaderboard row, edit
       loadLeaderboard() in section 4.
     - To change how search matches players, edit searchPlayers() and
       chooseFocusedPlayer() in section 5.
     - To change chart colors/behavior, edit renderScoreChart() in section 6.
     - To change date/number formatting (e.g. DD/MM/YYYY), edit the helpers
       in section 11 (formatDate, formatRank, formatScore).
   ========================================================================= */

/* -------------------------------------------------------------------------
   1. DOM ELEMENT REFERENCES
   Every constant below just grabs an existing HTML element by its id so the
   rest of the code can read/update it. If you rename an id in index.html,
   you must update the matching line here too.
   ------------------------------------------------------------------------- */
const dateSelect = document.getElementById("date-select");
const dateFormatSelect = document.getElementById("date-format-select");
const previousButton = document.getElementById("previous-date");
const nextButton = document.getElementById("next-date");
const selectedDateHeading = document.getElementById("selected-date");
const statusText = document.getElementById("status");
const leaderboardBody = document.getElementById("leaderboard-body");

const playerSearch = document.getElementById("player-search");
const clearSearchButton = document.getElementById("clear-search");
const searchStatus = document.getElementById("search-status");
const searchResultsTable = document.getElementById("search-results-table");
const searchResultsBody = document.getElementById("search-results-body");
const playerSummary = document.getElementById("player-summary");
const historyToggleButton = document.getElementById("history-toggle-button");
const historyTableWrapper = document.getElementById("history-table-wrapper");
const historyHeader = document.getElementById("history-header");

const scoreChartContainer =
  document.getElementById("score-chart-container");

const scoreChartCanvas =
  document.getElementById("score-chart");

const chartStatus =
  document.getElementById("chart-status");

const chartTitle =
  document.getElementById("chart-title");

const scoreChartButton =
  document.getElementById("score-chart-button");

const rankChartButton =
  document.getElementById("rank-chart-button");

const rankScaleZoomSelect =
  document.getElementById("rank-scale-zoom");

const dataFilterSelect =
  document.getElementById("data-filter-select");

const submitScoreButton = document.getElementById("submit-score-button");
const submitModal = document.getElementById("submit-modal");
const closeSubmitModalButton = document.getElementById("close-submit-modal");
const submitLookupForm = document.getElementById("submit-lookup-form");
const submitEidInput = document.getElementById("submit-eid");
const submitLookupButton = document.getElementById("submit-lookup-button");
const submitStatus = document.getElementById("submit-status");
const submitPreview = document.getElementById("submit-preview");
const submitPreviewPlayer = document.getElementById("submit-preview-player");
const submitPreviewRank = document.getElementById("submit-preview-rank");
const submitPreviewScore = document.getElementById("submit-preview-score");
const submitConfirmButton = document.getElementById("submit-confirm-button");
const submitCancelButton = document.getElementById("submit-cancel-button");
const savedEidsWrapper = document.getElementById("saved-eids-wrapper");
const savedEidsList = document.getElementById("saved-eids-list");
const saveEidCheckbox = document.getElementById("save-eid-checkbox");

/* -------------------------------------------------------------------------
   8. HEATMAP MODAL - lazy getters
   These use functions instead of constants because the heatmap modal
   elements are looked up only when the modal is opened, not on page load.
   ------------------------------------------------------------------------- */
// Lazy getters for heatmap elements (query on demand)
function getHeatmapButton() {
  return document.getElementById("heatmap-button");
}

function getHeatmapModal() {
  return document.getElementById("heatmap-modal");
}

function getCloseHeatmapModal() {
  return document.getElementById("close-heatmap-modal");
}

function getHeatmapGrid() {
  return document.getElementById("heatmap-grid");
}

function getHeatmapLegend() {
  return document.getElementById("heatmap-legend");
}

function getHeatmapStatus() {
  return document.getElementById("heatmap-status");
}

/* -------------------------------------------------------------------------
   9. GAPS MODAL - lazy getters (same idea as the heatmap getters above)
   ------------------------------------------------------------------------- */
// Lazy getters for gaps elements (query on demand)
function getGapsButton() {
  return document.getElementById("gaps-button");
}

function getGapsModal() {
  return document.getElementById("gaps-modal");
}

function getCloseGapsModal() {
  return document.getElementById("close-gaps-modal");
}

function getGapsList() {
  return document.getElementById("gaps-list");
}

function getGapsStatus() {
  return document.getElementById("gaps-status");
}

/* -------------------------------------------------------------------------
   2. PLAYER ALIASES
   Some players change their in-game name over time. data/player-aliases.json
   maps a "canonical" (current/preferred) name to a list of older names they
   used to go by. This lets search and history lookups treat all of a
   player's past names as the same person.

   To add/update aliases, edit data/player-aliases.json directly - no code
   changes needed here.
   ------------------------------------------------------------------------- */
// Player alias mapping - resolves name changes
let playerAliasMap = {};

async function loadPlayerAliases() {
  try {
    const response = await fetch("data/player-aliases.json");
    if (!response.ok) {
      console.error("Could not load player-aliases.json");
      return;
    }

    const aliases = await response.json();
    // Remove comment fields and build reverse lookup
    playerAliasMap = {};

    for (const [canonicalName, aliasList] of Object.entries(aliases)) {
      if (!canonicalName.startsWith("_")) {
        // Store canonical name for each alias
        if (Array.isArray(aliasList)) {
          aliasList.forEach(alias => {
            playerAliasMap[alias.toLowerCase()] = canonicalName;
          });
        }
      }
    }

    } catch (error) {
    console.error("Failed to load player aliases:", error);
  }
}

// Resolve a player name to its canonical form using the alias map
function resolvePlayerName(playerName) {
  if (playerName === null || playerName === undefined) return playerName;
  const lowerName = playerName.toLowerCase();
  return playerAliasMap[lowerName] || playerName;
}

// Normalize player name for display (converts aliases to canonical names)
function normalizePlayerName(playerName) {
  return resolvePlayerName(playerName);
}

/* -------------------------------------------------------------------------
   3. STATE (SHARED VARIABLES)
   These variables are updated as the user interacts with the page (picking
   dates, searching, changing chart mode, etc.) and are read by functions
   throughout the rest of the file.
   ------------------------------------------------------------------------- */
let availableDates = [];       // every ISO date (YYYY-MM-DD) that has data
let currentDateIndex = -1;     // index into availableDates for the shown date
let allLeaderboards = [];      // every leaderboard, preloaded for search
let scoreChart = null;         // the active Chart.js instance (or null)
let chartMode = "score";       // "score" or "rank" - which chart is shown
let rankScaleZoom = "default"; // y-axis zoom preset for the rank chart
let dateEntryCountMap = {};    // date -> number of entries (used by heatmap)
let dataFilterMode = "raw";    // "raw" | "weekly" | "weekly-peak" | "monthly" | "monthly-peak"

// URL of the Cloudflare Worker that privately looks up a submitted EggInc ID
// and publishes just the resulting name/rank/score (see worker/README.md
// for how to deploy your own and get this URL). Leave as-is if you haven't
// deployed the Worker yet - the submission form will just show an error.
const SUBMIT_WORKER_URL = "https://egg-leaderboard-submit.jarem.workers.dev/submit";

// Same Worker, but the read-only endpoint that returns today's (or another
// date's) submissions that have been confirmed but not yet folded into the
// permanent data/<date>.json file by the weekly GitHub Action / rebuilt by
// Vercel. Letting the site check this on load means a submission shows up
// immediately instead of visitors having to wait for the next deploy.
const PENDING_WORKER_URL = "https://egg-leaderboard-submit.jarem.workers.dev/pending";

// "dmy" (DD/MM/YYYY) | "mdy" (MM/DD/YYYY) | "iso" (YYYY-MM-DD)
// Restored from localStorage so the choice persists across visits.
let dateFormatMode = localStorage.getItem("dateFormatMode") || "dmy";

// Whether the "Full snapshot history" list below the chart is expanded.
// Restored from localStorage so the choice persists across visits.
let historyListExpanded = localStorage.getItem("historyListExpanded") !== "false";

/* -------------------------------------------------------------------------
   4. DATE / LEADERBOARD LOADING
   loadDates() runs once on page load: it fetches the list of available
   dates, fills the date dropdown, and loads the most recent leaderboard.
   loadLeaderboard(date) fetches and displays a single day's leaderboard.
   loadAllLeaderboards() preloads every day's data so the search box can
   look across all history without extra network requests per search.
   ------------------------------------------------------------------------- */
// Quick check used by loadDates(): does the Worker have any pending
// (not-yet-archived) submissions cached for the given date? Used only to
// decide whether to add "today" to the date dropdown before Vercel has
// rebuilt the static data/dates.json file.
async function checkForPendingEntriesToday(date) {
  try {
    const response = await fetch(`${PENDING_WORKER_URL}?date=${date}`);

    if (!response.ok) {
      return false;
    }

    const result = await response.json();
    return Array.isArray(result.entries) && result.entries.length > 0;
  } catch {
    return false;
  }
}

async function loadDates() {
  try {
    const response = await fetch("data/dates.json");

    if (!response.ok) {
      throw new Error("Could not load dates.json");
    }

    availableDates = await response.json();

    // If today isn't listed yet (the static data/dates.json hasn't been
    // rebuilt by Vercel since someone submitted a score today), but the
    // Worker has pending submissions cached for today, add today to the
    // list anyway so visitors can actually navigate to it and see them.
    const todayString = new Date().toISOString().split("T")[0];

    if (!availableDates.includes(todayString)) {
      const hasPendingToday = await checkForPendingEntriesToday(todayString);

      if (hasPendingToday) {
        availableDates.push(todayString);
      }
    }

    availableDates.sort();

    dateSelect.innerHTML = "";

    availableDates.forEach(date => {
      const option = document.createElement("option");
      option.value = date;
      option.textContent = formatDate(date);
      dateSelect.appendChild(option);
    });

    if (availableDates.length === 0) {
      selectedDateHeading.textContent = "No dates available";
      statusText.textContent = "No leaderboard data found.";
      updateNavigationButtons();
      return;
    }

    currentDateIndex = availableDates.length - 1;
    dateSelect.value = availableDates[currentDateIndex];

    await loadLeaderboard(availableDates[currentDateIndex]);
  } catch (error) {
    selectedDateHeading.textContent = "Error";
    statusText.textContent = error.message;
    previousButton.disabled = true;
    nextButton.disabled = true;
  }
}

// Jumps the main snapshot view to a specific date - used when a row in the
// "Full snapshot history" list is clicked so visitors can inspect that
// snapshot directly instead of manually stepping through with the dropdown.
function goToSnapshotDate(date) {
  if (!availableDates.includes(date)) {
    return;
  }

  currentDateIndex = availableDates.indexOf(date);
  dateSelect.value = date;
  loadLeaderboard(date);

  const leaderboardSection = document.querySelector(".leaderboard-card");
  if (leaderboardSection) {
    leaderboardSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function loadLeaderboard(date) {
  try {
    selectedDateHeading.textContent = formatDate(date);
    statusText.textContent = "Loading leaderboard...";
    leaderboardBody.innerHTML = "";

    const todayString = new Date().toISOString().split("T")[0];
    const isToday = date === todayString;

    const response = await fetch(`data/${date}.json`);

    let leaderboard;

    if (response.ok) {
      leaderboard = await response.json();
    } else if (isToday) {
      // Today's file may not exist in the static build yet (a submission
      // was confirmed, but Vercel hasn't rebuilt from that GitHub commit).
      // Fall back to an empty snapshot - any pending submissions fetched
      // below will still show up live.
      leaderboard = { date, complete: false, observed_entries: 0, entries: [] };
    } else {
      throw new Error(`Could not load leaderboard for ${date}`);
    }

    // If we're looking at today, ask the Worker for any submissions that
    // were confirmed today but haven't made it into the static file yet
    // (Vercel rebuilds can lag behind), and merge them in so they show up
    // immediately instead of only after the next deploy.
    let mergedEntries = leaderboard.entries;

    if (isToday) {
      try {
        const pendingResponse = await fetch(`${PENDING_WORKER_URL}?date=${date}`);

        if (pendingResponse.ok) {
          const pendingResult = await pendingResponse.json();
          const pendingEntries = pendingResult.entries || [];

          if (pendingEntries.length > 0) {
            const byPlayer = new Map(
              mergedEntries.map(row => [row.player.toLowerCase(), row])
            );

            pendingEntries.forEach(row => {
              byPlayer.set(row.player.toLowerCase(), row);
            });

            mergedEntries = [...byPlayer.values()];
          }
        }
      } catch {
        // Non-fatal - just show whatever's already in the static file.
      }
    }

    // Entries aren't guaranteed to be stored in rank order (e.g. player
    // submissions get appended to the end of the file) - sort by rank here
    // so the table always displays best-to-worst regardless of file order.
    const sortedEntries = [...mergedEntries].sort(
      (a, b) => Number(a.rank) - Number(b.rank)
    );

    sortedEntries.forEach(entry => {
      const row = document.createElement("tr");
      const displayName = normalizePlayerName(entry.player);

      row.innerHTML = `
        <td>${formatRank(entry.rank)}</td>
        <td class="player-name-cell" tabindex="0" role="button">${escapeHtml(displayName)}</td>
        <td>${formatScore(entry.score)}</td>
      `;

      // Clicking (or pressing Enter/Space on) a player's name jumps to the
      // search box and searches for that player automatically.
      const nameCell = row.querySelector(".player-name-cell");
      nameCell.addEventListener("click", () => {
        searchForPlayer(displayName);
      });
      nameCell.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          searchForPlayer(displayName);
        }
      });

      leaderboardBody.appendChild(row);
    });

    if (sortedEntries.length === 0) {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td colspan="3">No entries recorded for this date.</td>
      `;

      leaderboardBody.appendChild(row);
    }

    statusText.textContent =
      `${sortedEntries.length} observed entries — partial snapshot`;

    updateNavigationButtons();
  } catch (error) {
    statusText.textContent = error.message;
    leaderboardBody.innerHTML = "";
    updateNavigationButtons();
  }
}

async function loadAllLeaderboards() {
  const results = await Promise.all(
    availableDates.map(async date => {
      const response = await fetch(`data/${date}.json`);

      if (!response.ok) {
        throw new Error(`Could not load leaderboard for ${date}`);
      }

      const leaderboard = await response.json();

      // Normalize player names to canonical form when loading
      const normalizedEntries = leaderboard.entries.map(entry => ({
        ...entry,
        player: normalizePlayerName(entry.player)
      }));

      return {
        date,
        entries: normalizedEntries
      };
    })
  );

  allLeaderboards = results;
}

/* -------------------------------------------------------------------------
   5. PLAYER SEARCH
   searchPlayers() runs every time the user types in the search box. It:
     1. Finds every leaderboard entry whose name (or known alias) matches.
     2. Picks one "focused" player to show in detail (chooseFocusedPlayer).
     3. Renders the summary card, the results table, and the trend chart.
   ------------------------------------------------------------------------- */

// Fills the search box with a specific player's name, runs the search, and
// scrolls the search card into view. Used when clicking a player's name in
// a leaderboard snapshot (see loadLeaderboard).
function searchForPlayer(playerName) {
  playerSearch.value = playerName;
  searchPlayers();
  playerSearch.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Applies historyListExpanded to the "Full snapshot history" list and
// updates the header's label/aria-expanded state to match.
function applyHistoryListExpandedState() {
  if (!historyTableWrapper || !historyToggleButton || !historyHeader) {
    return;
  }

  historyTableWrapper.classList.toggle("collapsed", !historyListExpanded);
  historyHeader.classList.toggle("expanded", historyListExpanded);
  historyToggleButton.textContent = historyListExpanded ? "Hide list ▲" : "Show list ▼";
  historyHeader.setAttribute("aria-expanded", String(historyListExpanded));
}

// The whole title bar is clickable (not just the small label on the right),
// so both a mouse click and Enter/Space (for keyboard users) toggle it.
if (historyHeader) {
  historyHeader.addEventListener("click", () => {
    historyListExpanded = !historyListExpanded;
    localStorage.setItem("historyListExpanded", String(historyListExpanded));
    applyHistoryListExpandedState();
  });

  historyHeader.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      historyHeader.click();
    }
  });
}

async function searchPlayers() {
  const searchTerm = playerSearch.value.trim().toLowerCase();

  searchResultsBody.innerHTML = "";
  searchResultsTable.classList.add("hidden");
  if (historyHeader) {
    historyHeader.classList.add("hidden");
  }
  if (historyTableWrapper) {
    historyTableWrapper.classList.add("hidden");
  }
  playerSummary.innerHTML = "";
  playerSummary.classList.add("hidden");
  hideScoreChart();

  if (searchTerm.length === 0) {
    searchStatus.textContent = "";
    return;
  }

  if (allLeaderboards.length === 0) {
    searchStatus.textContent = "No leaderboard data is loaded yet.";
    return;
  }

  const allEntries = [];

  allLeaderboards.forEach(leaderboard => {
    leaderboard.entries.forEach(entry => {
      allEntries.push({
        date: leaderboard.date,
        rank: entry.rank,
        player: entry.player,
        score: entry.score
      });
    });
  });

  // Find matches by checking both current name and aliases
  const matchingNames = [
    ...new Set(
      allEntries
        .filter(entry => {
          const currentNameMatch = entry.player.toLowerCase().includes(searchTerm);
          const canonicalName = resolvePlayerName(entry.player);
          const aliasMatch = canonicalName.toLowerCase().includes(searchTerm);
          return currentNameMatch || aliasMatch;
        })
        .map(entry => resolvePlayerName(entry.player))
    )
  ];

  if (matchingNames.length === 0) {
    searchStatus.textContent = "No matching players found.";
    return;
  }

  const focusedPlayer = chooseFocusedPlayer(
    matchingNames,
    searchTerm
  );

  // Find all entries for the canonical player name
  const matches = allEntries
    .filter(entry => resolvePlayerName(entry.player) === focusedPlayer)
    .sort((a, b) => a.date.localeCompare(b.date));

  const numericRanks = matches
    .map(match => Number(match.rank))
    .filter(rank => Number.isFinite(rank));

  const bestRank = numericRanks.length > 0
    ? Math.min(...numericRanks)
    : "Unknown";

  const firstSeenDate = matches[0].date;
  const latestDate = matches[matches.length - 1].date;

  const daysSinceFirstSeen = daysBetween(
    firstSeenDate,
    getTodayIsoDate()
  );

  playerSummary.innerHTML = `
    <div class="summary-item">
      <div class="summary-label">Player</div>
      <div class="summary-value">${escapeHtml(focusedPlayer)}</div>
    </div>

    <div class="summary-item">
      <div class="summary-label">Snapshots</div>
      <div class="summary-value">${matches.length}</div>
    </div>

    <div class="summary-item">
      <div class="summary-label">Best Known Rank</div>
      <div class="summary-value">${formatRank(bestRank)}${typeof bestRank === "number" ? " " + getRankMedal(bestRank) : ""}</div>
    </div>

    <div class="summary-item">
      <div class="summary-label">Days since first seen</div>
      <div class="summary-value">
        ${daysSinceFirstSeen.toLocaleString()}
      </div>
    </div>

    <div class="summary-item">
      <div class="summary-label">Date range</div>
      <div class="summary-value">
        ${formatDate(firstSeenDate)} – ${formatDate(latestDate)}
      </div>
    </div>
  `;

  playerSummary.classList.remove("hidden");

  matches.forEach(match => {
    const row = document.createElement("tr");
    row.classList.add("history-row-clickable");
    row.title = `View the ${formatDate(match.date)} snapshot`;

    row.innerHTML = `
      <td>${formatDate(match.date)}</td>
      <td>${formatRank(match.rank)}</td>
      <td>${escapeHtml(match.player)}</td>
      <td>${formatScore(match.score)}</td>
    `;

    row.addEventListener("click", () => {
      goToSnapshotDate(match.date);
    });

    searchResultsBody.appendChild(row);
  });

  const extraPlayers = matchingNames.length - 1;

  searchStatus.textContent =
    `${matches.length} snapshot${matches.length === 1 ? "" : "s"} found for ${focusedPlayer}` +
    (extraPlayers > 0
      ? ` · ${extraPlayers} other matching player${extraPlayers === 1 ? "" : "s"}`
      : "");

     searchResultsTable.classList.remove("hidden");
     if (historyHeader) {
       historyHeader.classList.remove("hidden");
     }
     if (historyTableWrapper) {
       historyTableWrapper.classList.remove("hidden");
     }
     applyHistoryListExpandedState();

     // Reset zoom scaling to default when a new player is searched
     rankScaleZoom = "default";
     if (rankScaleZoomSelect) {
       rankScaleZoomSelect.value = "default";
     }

     renderScoreChart(focusedPlayer, matches);
  }

function chooseFocusedPlayer(names, searchTerm) {
  const exactMatches = names.filter(name =>
    name.toLowerCase() === searchTerm
  );

  if (exactMatches.length > 0) {
    return exactMatches.sort()[0];
  }

  const startsWithMatches = names.filter(name =>
    name.toLowerCase().startsWith(searchTerm)
  );

  if (startsWithMatches.length > 0) {
    return startsWithMatches.sort((a, b) => {
      const lengthDifference = a.length - b.length;

      if (lengthDifference !== 0) {
        return lengthDifference;
      }

      return a.localeCompare(b);
    })[0];
  }

  return names.sort((a, b) => {
    const aPosition = a.toLowerCase().indexOf(searchTerm);
    const bPosition = b.toLowerCase().indexOf(searchTerm);

    if (aPosition !== bPosition) {
      return aPosition - bPosition;
    }

    return a.localeCompare(b);
  })[0];
}

function getRankColor(rank) {
  // Return color based on rank: 1=gold, 2=silver, 3=bronze
  if (rank === 1) {
    return "#ffd700"; // Gold
  }
  if (rank === 2) {
    return "#c0c0c0"; // Silver
  }
  if (rank === 3) {
    return "#cd7f32"; // Bronze
  }
  return "#4d9cff"; // Default blue for other ranks
}

function getRankMedal(rank) {
  // Return medal emoji based on rank
  if (rank === 1) {
    return "🥇";
  }
  if (rank === 2) {
    return "🥈";
  }
  if (rank === 3) {
    return "🥉";
  }
  return "";
}

/* -------------------------------------------------------------------------
   6. CHART RENDERING
   renderScoreChart() draws the "Progression" line chart using Chart.js.
   It supports two modes (score/rank, see chartMode) and can show raw data
   or filtered/averaged data (see section 7) depending on dataFilterMode.
   ------------------------------------------------------------------------- */
function renderScoreChart(playerName, matches) {
  if (!scoreChartContainer || !scoreChartCanvas) {
    console.warn("Chart containers not found");
    return;
  }

  // Apply filter based on selected mode (raw / weekly / monthly, see section 7)
  const filteredMatches = filterMatchesByMode(matches, dataFilterMode);

  if (filteredMatches.length < 2) {
    hideScoreChart();

    if (chartStatus) {
      chartStatus.textContent =
        "A trend needs at least two recorded snapshots.";
    }

    return;
  }

  const labels = filteredMatches.map(match => formatDate(match.date));

  const scores = filteredMatches.map(match => {
    return Number(
      String(match.score).replaceAll(",", "").trim()
    );
  });

  const ranks = filteredMatches.map(match => Number(match.rank));

  const isScoreMode = chartMode === "score";
  const values = isScoreMode ? scores : ranks;

  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const valueRange = maximumValue - minimumValue;

  const padding = valueRange === 0
    ? Math.max(minimumValue * 0.1, 1)
    : valueRange * 0.12;

  let chartMinimum;
  let chartMaximum;
  let stepSize;

  if (isScoreMode) {
    chartMinimum = Math.max(0, Math.floor(minimumValue - padding));
    chartMaximum = Math.ceil(maximumValue + padding);
    stepSize = undefined;
  } else if (rankScaleZoom === "default") {
    // Default rank scaling with dynamic step size (10% of max value, whole numbers only)
    chartMinimum = Math.max(1, Math.floor(minimumValue - padding));
    chartMaximum = Math.ceil(maximumValue + padding);
    // Calculate step size as 10% of the max (highest rank), rounded to nearest whole number
    stepSize = Math.max(1, Math.round(chartMaximum * 0.1));
  } else {
    // Constrained zoom levels with specific step sizes
    const zoomRanges = {
      "0-10": { min: 0, max: 10, step: 1 },
      "0-25": { min: 0, max: 25, step: 5 },
      "0-50": { min: 0, max: 50, step: 10 },
      "0-100": { min: 0, max: 100, step: 10 }
    };

    const range = zoomRanges[rankScaleZoom];
    chartMinimum = range.min;
    chartMaximum = range.max;
    stepSize = range.step;
  }

  if (scoreChart) {
    scoreChart.destroy();
  }

  scoreChart = new Chart(scoreChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: isScoreMode
            ? `${playerName} score`
            : `${playerName} rank`,
          data: values,
          borderColor: "#4d9cff",
          backgroundColor: "rgba(77, 156, 255, 0.16)",
          pointBackgroundColor: ranks.map(rank => getRankColor(rank)),
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 3,
          tension: 0.25,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index"
      },
      plugins: {
        legend: {
          labels: {
            color: "#c1ccdb"
          }
        },
        tooltip: {
          callbacks: {
            label: context => {
              const index = context.dataIndex;

              if (isScoreMode) {
                return `Score: ${formatScore(scores[index])} · Rank: ${formatRank(ranks[index])}`;
              }

              return `Rank: ${formatRank(ranks[index])} · Score: ${formatScore(scores[index])}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#8e9db2"
          },
          grid: {
            color: "rgba(142, 157, 178, 0.14)"
          }
        },
        y: {
          min: chartMinimum,
          max: chartMaximum,
          reverse: !isScoreMode,
          ticks: {
            color: "#8e9db2",
            stepSize: isScoreMode ? undefined : stepSize,
            precision: isScoreMode ? undefined : 0,
            callback: value => {
              if (!Number.isInteger(value)) {
                return "";
              }

              return isScoreMode
                ? formatScore(value)
                : formatRank(value);
            }
          },
          grid: {
            color: "rgba(142, 157, 178, 0.14)"
          }
        }
      }
    }
  });

  scoreChartContainer.classList.remove("hidden");

  if (chartTitle) {
    chartTitle.textContent = isScoreMode
      ? "Score over time"
      : "Rank over time";
  }

  if (chartStatus) {
    chartStatus.textContent =
      `${matches.length} recorded points`;
  }

  updateChartToggleButtons();
}

function hideScoreChart() {
  if (scoreChart) {
    scoreChart.destroy();
    scoreChart = null;
  }

  if (scoreChartContainer) {
    scoreChartContainer.classList.add("hidden");
  }

  if (chartStatus) {
    chartStatus.textContent = "";
  }
}

function refreshFocusedChart() {
  const searchTerm = playerSearch.value.trim().toLowerCase();

  if (searchTerm.length === 0 || allLeaderboards.length === 0) {
    return;
  }

  const allEntries = [];

  allLeaderboards.forEach(leaderboard => {
    leaderboard.entries.forEach(entry => {
      allEntries.push({
        date: leaderboard.date,
        rank: entry.rank,
        player: entry.player,
        score: entry.score
      });
    });
  });

  const matchingNames = [
    ...new Set(
      allEntries
        .filter(entry =>
          entry.player.toLowerCase().includes(searchTerm)
        )
        .map(entry => entry.player)
    )
  ];

  if (matchingNames.length === 0) {
    return;
  }

  const focusedPlayer = chooseFocusedPlayer(
    matchingNames,
    searchTerm
  );

  const matches = allEntries
    .filter(entry => entry.player === focusedPlayer)
    .sort((a, b) => a.date.localeCompare(b.date));

  renderScoreChart(focusedPlayer, matches);
}

function updateChartToggleButtons() {
  if (!scoreChartButton || !rankChartButton) {
    return;
  }

  scoreChartButton.classList.toggle(
    "active",
    chartMode === "score"
  );

  rankChartButton.classList.toggle(
    "active",
    chartMode === "rank"
  );

  // Show/hide the rank scale zoom dropdown based on chart mode
  if (rankScaleZoomSelect) {
    if (chartMode === "rank") {
      rankScaleZoomSelect.classList.remove("hidden");
      rankScaleZoomSelect.value = rankScaleZoom;
    } else {
      rankScaleZoomSelect.classList.add("hidden");
    }
  }
}

scoreChartButton.addEventListener("click", () => {
  chartMode = "score";
  refreshFocusedChart();
});

rankChartButton.addEventListener("click", () => {
  chartMode = "rank";
  rankScaleZoom = "default";
  refreshFocusedChart();
});

rankScaleZoomSelect.addEventListener("change", (event) => {
  rankScaleZoom = event.target.value;
  refreshFocusedChart();
});

/* -------------------------------------------------------------------------
   10. EVENT LISTENERS
   Everything below wires up clicks/changes on the page to the functions
   defined above. If a button/dropdown seems "dead", check here first to
   confirm it has a listener attached to it.
   ------------------------------------------------------------------------- */
if (dataFilterSelect) {
  dataFilterSelect.addEventListener("change", (event) => {
    dataFilterMode = event.target.value;
    refreshFocusedChart();
  });
} else {
  console.warn("dataFilterSelect element not found in DOM");
}

dateSelect.addEventListener("change", event => {
  const selectedDate = event.target.value;
  currentDateIndex = availableDates.indexOf(selectedDate);
  loadLeaderboard(selectedDate);
});

if (dateFormatSelect) {
  // Reflect the restored preference in the dropdown as soon as the page loads.
  dateFormatSelect.value = dateFormatMode;

  dateFormatSelect.addEventListener("change", event => {
    dateFormatMode = event.target.value;
    localStorage.setItem("dateFormatMode", dateFormatMode);
    refreshDateFormatting();
  });
}

previousButton.addEventListener("click", () => {
  if (currentDateIndex > 0) {
    currentDateIndex -= 1;

    const date = availableDates[currentDateIndex];
    dateSelect.value = date;
    loadLeaderboard(date);
  }
});

nextButton.addEventListener("click", () => {
  if (currentDateIndex < availableDates.length - 1) {
    currentDateIndex += 1;

    const date = availableDates[currentDateIndex];
    dateSelect.value = date;
    loadLeaderboard(date);
  }
});

playerSearch.addEventListener("input", searchPlayers);

/* -------------------------------------------------------------------------
   "Saved EggInc IDs" - lets a visitor remember one or more EIDs on their own
   device (localStorage only, never sent anywhere except the existing
   lookup/confirm calls) so they can quickly re-submit for multiple accounts
   without retyping the ID each time. Loosely modeled after the "recent IDs"
   pill list used by wasmegg-carpet/egg.
   ------------------------------------------------------------------------- */
const SAVED_EIDS_STORAGE_KEY = "savedEids";
const SAVED_EIDS_MAX = 10;

function getSavedEids() {
  try {
    const raw = localStorage.getItem(SAVED_EIDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setSavedEids(eids) {
  localStorage.setItem(SAVED_EIDS_STORAGE_KEY, JSON.stringify(eids));
}

function addSavedEid(eid) {
  const eids = getSavedEids();

  if (!eids[eid]) {
    eids[eid] = {};

    const keys = Object.keys(eids);
    if (keys.length > SAVED_EIDS_MAX) {
      // Evict the oldest entry without a nickname/username first; fall back
      // to the very oldest entry if every saved EID already has a name.
      const unnamedKey = keys.find(key => !eids[key].nickname && !eids[key].username);
      delete eids[unnamedKey ?? keys[0]];
    }
  }

  setSavedEids(eids);
  renderSavedEids();
}

function removeSavedEid(eid) {
  const eids = getSavedEids();
  delete eids[eid];
  setSavedEids(eids);
  renderSavedEids();
}

function updateSavedEidUsername(eid, username) {
  const eids = getSavedEids();
  if (!eids[eid] || !username || eids[eid].username === username) {
    return;
  }
  eids[eid] = { ...eids[eid], username };
  setSavedEids(eids);
  renderSavedEids();
}

function savedEidDisplayName(eid, entry) {
  return (entry && (entry.nickname || entry.username)) || eid;
}

function renderSavedEids() {
  if (!savedEidsWrapper || !savedEidsList) return;

  const eids = getSavedEids();
  const entries = Object.entries(eids);

  savedEidsList.innerHTML = "";

  if (entries.length === 0) {
    savedEidsWrapper.classList.add("hidden");
    return;
  }

  savedEidsWrapper.classList.remove("hidden");

  entries.forEach(([eid, entry]) => {
    const pill = document.createElement("span");
    pill.className = "saved-eid-pill";
    if (submitEidInput && submitEidInput.value.trim() === eid) {
      pill.classList.add("active");
    }

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "saved-eid-edit";
    editButton.setAttribute("aria-label", "Rename");
    editButton.textContent = "✎";
    editButton.addEventListener("click", () => {
      const name = prompt("Enter a name for this ID:", entry.nickname || entry.username || "");
      if (name === null) return;
      const eids2 = getSavedEids();
      if (!eids2[eid]) return;
      eids2[eid] = { ...eids2[eid], nickname: name || undefined };
      setSavedEids(eids2);
      renderSavedEids();
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "saved-eid-pill-name";
    nameSpan.textContent = savedEidDisplayName(eid, entry);
    nameSpan.title = eid;
    nameSpan.addEventListener("click", () => {
      submitEidInput.value = eid;
      renderSavedEids();
      submitEidInput.focus();
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "saved-eid-remove";
    removeButton.setAttribute("aria-label", "Forget this ID");
    removeButton.textContent = "\u00d7";
    removeButton.addEventListener("click", () => {
      removeSavedEid(eid);
    });

    pill.appendChild(editButton);
    pill.appendChild(nameSpan);
    pill.appendChild(removeButton);
    savedEidsList.appendChild(pill);
  });
}

/* -------------------------------------------------------------------------
   "Submit your ranking" modal - opened via the "Submit Your Score" button.
   Sends the visitor's EggInc ID to the Cloudflare Worker (see
   SUBMIT_WORKER_URL above and worker/README.md) in two steps:

     1. "Look up" runs a read-only preview - the Worker fetches the
        player's name/rank/score but does NOT publish anything yet.
     2. If the visitor clicks "Confirm & Submit", only THEN does the Worker
        actually publish the result to the leaderboard data.

   Closing the modal (via Cancel, the X button, or clicking the backdrop)
   without confirming never publishes anything.
   ------------------------------------------------------------------------- */
function resetSubmitModal() {
  submitEidInput.value = "";
  submitStatus.textContent = "";
  submitStatus.className = "status";
  submitPreview.classList.add("hidden");
  submitLookupForm.classList.remove("hidden");
  submitLookupButton.disabled = false;
  renderSavedEids();
}

function openSubmitModal() {
  if (!submitModal) return;
  resetSubmitModal();
  submitModal.classList.remove("hidden");
}


function closeSubmitModal() {
  if (!submitModal) return;
  submitModal.classList.add("hidden");
}

if (submitScoreButton) {
  submitScoreButton.addEventListener("click", openSubmitModal);
}

if (closeSubmitModalButton) {
  closeSubmitModalButton.addEventListener("click", closeSubmitModal);
}

if (submitModal) {
  submitModal.addEventListener("click", event => {
    if (event.target.classList.contains("modal-backdrop")) {
      closeSubmitModal();
    }
  });
}

if (submitEidInput) {
  submitEidInput.addEventListener("input", renderSavedEids);
}

if (submitLookupForm) {
  submitLookupForm.addEventListener("submit", async event => {
    event.preventDefault();

    const eid = submitEidInput.value.trim();

    if (!eid) {
      submitStatus.textContent = "Please enter your EggInc ID.";
      submitStatus.className = "status error";
      return;
    }

    submitLookupButton.disabled = true;
    submitStatus.textContent = "Looking up your ranking...";
    submitStatus.className = "status";
    submitPreview.classList.add("hidden");

    try {
      const response = await fetch(SUBMIT_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eid, action: "preview" })
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Something went wrong. Please try again.");
      }

      submitPreviewPlayer.textContent = result.player;
      submitPreviewRank.textContent = formatRank(result.rank);
      submitPreviewScore.textContent = formatScore(result.score);

      if (!saveEidCheckbox || saveEidCheckbox.checked) {
        addSavedEid(eid);
        updateSavedEidUsername(eid, result.player);
      }

      submitStatus.textContent = result.alreadySubmittedToday
        ? "Here's your current ranking. Note: you've already submitted today, so confirming again will be blocked until tomorrow."
        : "Here's your current ranking. Confirm below to add it to the leaderboard.";
      submitStatus.className = "status";

      submitLookupForm.classList.add("hidden");
      submitPreview.classList.remove("hidden");
    } catch (error) {
      submitStatus.textContent = error.message;
      submitStatus.className = "status error";
    } finally {
      submitLookupButton.disabled = false;
    }
  });
}

if (submitConfirmButton) {
  submitConfirmButton.addEventListener("click", async () => {
    const eid = submitEidInput.value.trim();

    submitConfirmButton.disabled = true;
    submitCancelButton.disabled = true;
    submitStatus.textContent = "Submitting...";
    submitStatus.className = "status";

    try {
      const response = await fetch(SUBMIT_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eid, action: "confirm" })
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Something went wrong. Please try again.");
      }

      if (!saveEidCheckbox || saveEidCheckbox.checked) {
        addSavedEid(eid);
        updateSavedEidUsername(eid, result.player);
      }

      submitStatus.textContent =
        `Success! Added ${result.player} - rank ${result.rank}, score ${result.score}.`;
      submitStatus.className = "status success";
      submitPreview.classList.add("hidden");
    } catch (error) {
      submitStatus.textContent = error.message;
      submitStatus.className = "status error";
    } finally {
      submitConfirmButton.disabled = false;
      submitCancelButton.disabled = false;
    }
  });
}

if (submitCancelButton) {
  submitCancelButton.addEventListener("click", () => {
    closeSubmitModal();
  });
}

clearSearchButton.addEventListener("click", () => {
  playerSearch.value = "";
  searchResultsBody.innerHTML = "";
  searchResultsTable.classList.add("hidden");
  if (historyHeader) {
    historyHeader.classList.add("hidden");
  }
  if (historyTableWrapper) {
    historyTableWrapper.classList.add("hidden");
  }
  playerSummary.innerHTML = "";
  playerSummary.classList.add("hidden");
  searchStatus.textContent = "";
  hideScoreChart();
  playerSearch.focus();
});

/* -------------------------------------------------------------------------
   11. FORMATTING / UTILITY HELPERS
   Small, reusable functions with no side effects (aside from
   updateNavigationButtons, which is here because it's tightly related to
   date navigation). Safe to reuse anywhere in this file.
   ------------------------------------------------------------------------- */
function updateNavigationButtons() {
  previousButton.disabled =
    currentDateIndex <= 0 || availableDates.length === 0;

  nextButton.disabled =
    currentDateIndex >= availableDates.length - 1 ||
    availableDates.length === 0;
}

// Month abbreviations used only by the "long" date format below.
const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-");

  if (dateFormatMode === "mdy") {
    return `${month}/${day}/${year}`;
  }

  if (dateFormatMode === "iso") {
    return `${year}-${month}-${day}`;
  }

  if (dateFormatMode === "long") {
    const monthName = MONTH_ABBREVIATIONS[Number(month) - 1] || month;
    return `${monthName} ${Number(day)} ${year}`;
  }

  // Default: "dmy"
  return `${day}/${month}/${year}`;
}

// Re-renders every currently visible piece of UI that shows a formatted
// date, so switching the date format toggle updates everything on screen
// immediately (instead of only new content going forward).
function refreshDateFormatting() {
  // Date dropdown option labels
  Array.from(dateSelect.options).forEach(option => {
    if (option.value) {
      option.textContent = formatDate(option.value);
    }
  });

  // Currently selected leaderboard's heading
  if (currentDateIndex >= 0) {
    selectedDateHeading.textContent = formatDate(availableDates[currentDateIndex]);
  }

  // Re-run search if a search is currently active, so the results table,
  // summary card, and chart labels all pick up the new format.
  if (playerSearch.value.trim().length > 0) {
    searchPlayers();
  }

  // Re-render open modals, if any.
  const heatmapModal = getHeatmapModal();
  if (heatmapModal && !heatmapModal.classList.contains("hidden")) {
    renderHeatmap();
  }

  const gapsModal = getGapsModal();
  if (gapsModal && !gapsModal.classList.contains("hidden")) {
    renderGapsReport();
  }
}

function getTodayIsoDate() {
  const today = new Date();

  return [
    today.getUTCFullYear(),
    String(today.getUTCMonth() + 1).padStart(2, "0"),
    String(today.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function daysBetween(startIsoDate, endIsoDate) {
  const [startYear, startMonth, startDay] = startIsoDate
    .split("-")
    .map(Number);

  const [endYear, endMonth, endDay] = endIsoDate
    .split("-")
    .map(Number);

  const startUtc = Date.UTC(
    startYear,
    startMonth - 1,
    startDay
  );

  const endUtc = Date.UTC(
    endYear,
    endMonth - 1,
    endDay
  );

  return Math.max(
    0,
    Math.floor((endUtc - startUtc) / 86400000)
  );
}

function formatRank(rank) {
  const numericRank = Number(rank);

  if (Number.isFinite(numericRank)) {
    return numericRank.toLocaleString("en-US");
  }

  return escapeHtml(rank);
}

function formatScore(score) {
  const scoreText = String(score)
    .replaceAll(",", "")
    .trim();

  if (!/^\d+$/.test(scoreText)) {
    return escapeHtml(score);
  }

  return Number(scoreText).toLocaleString("en-US");
}

/* -------------------------------------------------------------------------
   7. DATA FILTERING (weekly/monthly averages + peaks)
   These functions turn raw per-day entries into weekly/monthly summaries
   for the chart's "Data" dropdown (Raw / Weekly Peak / Weekly Average /
   Monthly Peak / Monthly Average). "Peak" = best single value in the
   period, "Average" = mean of all values in the period.
   ------------------------------------------------------------------------- */
function getWeekStartDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Get the day of week (0 = Sunday)
  const dayOfWeek = date.getUTCDay();

  // Calculate days to subtract to get to Monday (1)
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - daysToMonday);

  return [
    weekStart.getUTCFullYear(),
    String(weekStart.getUTCMonth() + 1).padStart(2, "0"),
    String(weekStart.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function getMonthStartDate(isoDate) {
  const [year, month] = isoDate.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function groupDataByPeriod(matches, period) {
  const groups = {};

  matches.forEach(match => {
    let key;
    if (period === "weekly" || period === "weekly-peak") {
      key = getWeekStartDate(match.date);
    } else if (period === "monthly" || period === "monthly-peak") {
      key = getMonthStartDate(match.date);
    } else {
      // raw data
      return;
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(match);
  });

  return groups;
}

function calculateAverages(groups) {
  return Object.entries(groups)
    .map(([dateKey, entries]) => {
      const avgRank = entries.reduce((sum, e) => sum + Number(e.rank), 0) / entries.length;
      const avgScore = entries.reduce((sum, e) => 
        sum + Number(String(e.score).replaceAll(",", "").trim()), 0) / entries.length;

      // Use the first date in the period as the representative date
      return {
        date: dateKey,
        rank: Math.round(avgRank),
        score: Math.round(avgScore)
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calculatePeaks(groups) {
  return Object.entries(groups)
    .map(([dateKey, entries]) => {
      // For rank: lower is better, so we want the minimum (best rank)
      const peakRank = Math.min(...entries.map(e => Number(e.rank)));

      // For score: higher is better, so we want the maximum (highest score)
      const peakScore = Math.max(...entries.map(e => 
        Number(String(e.score).replaceAll(",", "").trim())));

      // Use the first date in the period as the representative date
      return {
        date: dateKey,
        rank: peakRank,
        score: peakScore
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function filterMatchesByMode(matches, filterMode) {
  if (filterMode === "raw") {
    return matches;
  }

  const groups = groupDataByPeriod(matches, filterMode);

  if (filterMode === "weekly-peak" || filterMode === "monthly-peak") {
    return calculatePeaks(groups);
  }

  return calculateAverages(groups);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* -------------------------------------------------------------------------
   APP STARTUP
   initialize() runs once, right when the page loads (see bottom of file),
   and kicks off everything: loading aliases, dates, all leaderboard data,
   and the heatmap's data map.
   ------------------------------------------------------------------------- */
async function initialize() {
  await loadPlayerAliases();
  await loadDates();

  try {
    await loadAllLeaderboards();

    searchStatus.textContent =
      "Enter a player name to search the archive.";

    updateChartToggleButtons();

    if (typeof buildHeatmapDataMap === 'function') {
      buildHeatmapDataMap();
    }
  } catch (error) {
    searchStatus.textContent = error.message;
  }
}

function buildHeatmapDataMap() {
  dateEntryCountMap = {};
  availableDates.forEach(date => {
    dateEntryCountMap[date] = 0;
  });

  allLeaderboards.forEach(leaderboard => {
    if (dateEntryCountMap[leaderboard.date] !== undefined) {
      dateEntryCountMap[leaderboard.date] = leaderboard.entries.length;
    }
  });
}

function openHeatmapModal() {
  const modal = getHeatmapModal();
  if (!modal) {
    console.error("Heatmap modal element not found");
    return;
  }
  modal.classList.remove("hidden");
  renderHeatmap();
}

function closeHeatmapModalFunc() {
  const modal = getHeatmapModal();
  if (!modal) {
    console.error("Heatmap modal element not found");
    return;
  }
  modal.classList.add("hidden");
}

/* -------------------------------------------------------------------------
   8. HEATMAP MODAL - rendering
   renderHeatmap() builds one calendar-style "month" block per month in the
   data range, coloring each day by how many entries were recorded that day
   (see getHeatmapColor for the color scale).
   ------------------------------------------------------------------------- */
function renderHeatmap() {
  const grid = getHeatmapGrid();
  const legend = getHeatmapLegend();
  const status = getHeatmapStatus();

  if (!grid || !legend || !status) {
    console.error("Heatmap elements not found");
    return;
  }

  grid.innerHTML = "";
  legend.innerHTML = "";
  status.textContent = "";

  if (availableDates.length === 0) {
    status.textContent = "No dates available.";
    return;
  }

  const minDate = new Date(availableDates[0]);
  const maxDate = new Date(availableDates[availableDates.length - 1]);

  const counts = Object.values(dateEntryCountMap).filter(c => c > 0);
  const maxCount = counts.length > 0 ? Math.max(...counts) : 1;
  const minCount = counts.length > 0 ? Math.min(...counts) : 0;

  renderLegend(minCount, maxCount);
  renderMonthsByWeeks(minDate, maxDate, maxCount);

  status.textContent = `Coverage: ${availableDates.length} snapshots recorded from ${formatDate(availableDates[0])} to ${formatDate(availableDates[availableDates.length - 1])}`;
}

function renderLegend(minCount, maxCount) {
  const levels = [
    { label: "No data", value: 0, color: "#4b5563" },
    { label: "1-25 entries", value: 1, color: "#ef4444" },
    { label: "26-50 entries", value: 26, color: "#eab308" },
    { label: "51-99 entries", value: 51, color: "#22c55e" },
    { label: "100+ entries", value: 100, color: "#06b6d4" }
  ];

  const legendHtml = levels
    .map(level => `
      <div class="legend-item">
        <div class="legend-color" style="background: ${level.color};"></div>
        <span>${level.label}</span>
      </div>
    `)
    .join("");

  const legend = getHeatmapLegend();
  if (legend) {
    legend.innerHTML = legendHtml;
  }
}

function renderMonthsByWeeks(minDate, maxDate, maxCount) {
  const currentDate = new Date(minDate);

  while (currentDate <= maxDate) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    renderMonth(year, month, maxCount);

    currentDate.setMonth(currentDate.getMonth() + 1);
  }
}

function renderMonth(year, month, maxCount) {
  const monthDiv = document.createElement("div");
  monthDiv.className = "heatmap-month";

  const monthName = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric"
  });

  const monthTitle = document.createElement("div");
  monthTitle.className = "heatmap-month-title";
  monthTitle.textContent = monthName;
  monthDiv.appendChild(monthTitle);

  const weeksContainer = document.createElement("div");
  weeksContainer.className = "heatmap-week-container";

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();

  // Get the day of week for the first day (0 = Sunday)
  const firstDayOfWeek = firstDayOfMonth.getDay();

  let currentWeek = null;
  let dayOfWeekCounter = firstDayOfWeek;

  // Add padding days from previous month
  if (firstDayOfWeek > 0) {
    currentWeek = document.createElement("div");
    currentWeek.className = "heatmap-week";

    for (let i = 0; i < firstDayOfWeek; i++) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "heatmap-day heatmap-day-empty";
      emptyDiv.style.setProperty("--heatmap-color", "#1a1a1a");
      currentWeek.appendChild(emptyDiv);
    }
    dayOfWeekCounter = firstDayOfWeek;
  }

  // Add actual days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    if (!currentWeek) {
      currentWeek = document.createElement("div");
      currentWeek.className = "heatmap-week";
      dayOfWeekCounter = 0;
    }

    const dayDiv = document.createElement("div");
    dayDiv.className = "heatmap-day";

    // Create date string in YYYY-MM-DD format using local date
    const d = new Date(year, month, day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = dateEntryCountMap[dateStr] || 0;
    const color = getHeatmapColor(count, maxCount);

    dayDiv.style.setProperty("--heatmap-color", color);
    dayDiv.setAttribute("data-tooltip", `${formatDate(dateStr)}: ${count} entries`);
    dayDiv.title = `${formatDate(dateStr)}: ${count} entries`;

    currentWeek.appendChild(dayDiv);
    dayOfWeekCounter++;

    if (dayOfWeekCounter === 7) {
      weeksContainer.appendChild(currentWeek);
      currentWeek = null;
      dayOfWeekCounter = 0;
    }
  }

  // Add padding days from next month
  if (currentWeek) {
    while (dayOfWeekCounter < 7) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "heatmap-day heatmap-day-empty";
      emptyDiv.style.setProperty("--heatmap-color", "#1a1a1a");
      currentWeek.appendChild(emptyDiv);
      dayOfWeekCounter++;
    }
    weeksContainer.appendChild(currentWeek);
  }

  monthDiv.appendChild(weeksContainer);

  const grid = getHeatmapGrid();
  if (grid) {
    grid.appendChild(monthDiv);
  }
}

function getHeatmapColor(count, maxCount) {
  if (count === 0) return "#4b5563";      // Dark Grey
  if (count <= 25) return "#ef4444";      // Red
  if (count <= 50) return "#eab308";      // Yellow
  if (count <= 99) return "#22c55e";      // Green
  return "#06b6d4";                       // Aqua (100+)
}

/* -------------------------------------------------------------------------
   9. GAPS MODAL - analysis
   buildGapsList() looks for stretches of 14+ days with no recorded
   snapshot between two known dates, and reports them as "gaps".
   ------------------------------------------------------------------------- */
function buildGapsList() {
  if (availableDates.length === 0) {
    return [];
  }

  const gaps = [];
  const sortedDates = availableDates.slice().sort();
  const minGapDays = 14;

  for (let i = 0; i < sortedDates.length - 1; i++) {
    const currentDate = new Date(sortedDates[i]);
    const nextDate = new Date(sortedDates[i + 1]);

    // Calculate difference in days
    const diffTime = nextDate - currentDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Only include gaps of 14 days or longer
    if (diffDays >= minGapDays) {
      const gapStartDate = new Date(currentDate);
      gapStartDate.setDate(gapStartDate.getDate() + 1);

      const gapEndDate = new Date(nextDate);
      gapEndDate.setDate(gapEndDate.getDate() - 1);

      gaps.push({
        startDate: formatDate(gapStartDate.toISOString().split('T')[0]),
        endDate: formatDate(gapEndDate.toISOString().split('T')[0]),
        durationDays: diffDays - 1,
        rawStartDate: gapStartDate.toISOString().split('T')[0],
        rawEndDate: gapEndDate.toISOString().split('T')[0]
      });
    }
  }

  // Sort gaps by duration (longest first)
  gaps.sort((a, b) => b.durationDays - a.durationDays);

  return gaps;
}

function openGapsModal() {
  const modal = getGapsModal();
  if (!modal) {
    console.error("Gaps modal element not found");
    return;
  }
  modal.classList.remove("hidden");
  renderGapsReport();
}

function closeGapsModalFunc() {
  const modal = getGapsModal();
  if (!modal) {
    console.error("Gaps modal element not found");
    return;
  }
  modal.classList.add("hidden");
}

function renderGapsReport() {
  const list = getGapsList();
  const status = getGapsStatus();

  if (!list || !status) {
    console.error("Gaps list or status element not found");
    return;
  }

  list.innerHTML = "";
  const gaps = buildGapsList();

  if (gaps.length === 0) {
    status.textContent = "No data gaps detected — archive is complete!";
    return;
  }

  gaps.forEach((gap) => {
    const gapItem = document.createElement("div");
    gapItem.className = "gap-item";

    const dateRangeDiv = document.createElement("div");
    dateRangeDiv.className = "gap-date-range";

    const startSpan = document.createElement("span");
    startSpan.textContent = gap.startDate;

    const arrowSpan = document.createElement("span");
    arrowSpan.className = "gap-arrow";
    arrowSpan.textContent = "→";

    const endSpan = document.createElement("span");
    endSpan.textContent = gap.endDate;

    dateRangeDiv.appendChild(startSpan);
    dateRangeDiv.appendChild(arrowSpan);
    dateRangeDiv.appendChild(endSpan);

    const durationDiv = document.createElement("div");
    durationDiv.className = "gap-duration";
    durationDiv.innerHTML = `Duration: <span class="gap-duration-value">${gap.durationDays} day${gap.durationDays !== 1 ? 's' : ''}</span>`;

    gapItem.appendChild(dateRangeDiv);
    gapItem.appendChild(durationDiv);

    list.appendChild(gapItem);
  });

  status.textContent = `Found ${gaps.length} data gap${gaps.length !== 1 ? 's' : ''} (sorted by longest duration)`;
}

// Setup event listeners for heatmap
const heatmapButtonEl = getHeatmapButton();
if (heatmapButtonEl) {
  heatmapButtonEl.addEventListener("click", () => {
    openHeatmapModal();
  });
}

const closeBtnEl = getCloseHeatmapModal();
if (closeBtnEl) {
  closeBtnEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeHeatmapModalFunc();
  });
}

const modalElement = getHeatmapModal();
if (modalElement) {
  // Click anywhere on modal to check for backdrop
  modalElement.addEventListener("click", (e) => {
    // If clicking on the backdrop div
    if (e.target.classList.contains("modal-backdrop")) {
      e.stopPropagation();
      closeHeatmapModalFunc();
    }
  });
}

// Escape key to close
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const modal = getHeatmapModal();
    if (modal && !modal.classList.contains("hidden")) {
      closeHeatmapModalFunc();
    }
    const gapsModal = getGapsModal();
    if (gapsModal && !gapsModal.classList.contains("hidden")) {
      closeGapsModalFunc();
    }
  }
});

// Setup event listeners for gaps report
const gapsButtonEl = getGapsButton();
if (gapsButtonEl) {
  gapsButtonEl.addEventListener("click", () => {
    openGapsModal();
  });
}

const closeGapsBtnEl = getCloseGapsModal();
if (closeGapsBtnEl) {
  closeGapsBtnEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeGapsModalFunc();
  });
}

const gapsModalElement = getGapsModal();
if (gapsModalElement) {
  // Click anywhere on modal to check for backdrop
  gapsModalElement.addEventListener("click", (e) => {
    // If clicking on the backdrop div
    if (e.target.classList.contains("modal-backdrop")) {
      e.stopPropagation();
      closeGapsModalFunc();
    }
  });
}


// Kick everything off once this file loads.
initialize();