const dateSelect = document.getElementById("date-select");
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

    console.log("Player alias map loaded with", Object.keys(playerAliasMap).length, "entries");
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

let availableDates = [];
let currentDateIndex = -1;
let allLeaderboards = [];
let scoreChart = null;
let chartMode = "score";
let rankScaleZoom = "default";
let dateEntryCountMap = {};
let dataFilterMode = "raw";

async function loadDates() {
  try {
    const response = await fetch("data/dates.json");

    if (!response.ok) {
      throw new Error("Could not load dates.json");
    }

    availableDates = await response.json();
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

async function loadLeaderboard(date) {
  try {
    selectedDateHeading.textContent = formatDate(date);
    statusText.textContent = "Loading leaderboard...";
    leaderboardBody.innerHTML = "";

    const response = await fetch(`data/${date}.json`);

    if (!response.ok) {
      throw new Error(`Could not load leaderboard for ${date}`);
    }

    const leaderboard = await response.json();

    leaderboard.entries.forEach(entry => {
      const row = document.createElement("tr");
      const displayName = normalizePlayerName(entry.player);

      row.innerHTML = `
        <td>${formatRank(entry.rank)}</td>
        <td>${escapeHtml(displayName)}</td>
        <td>${formatScore(entry.score)}</td>
      `;

      leaderboardBody.appendChild(row);
    });

    if (leaderboard.entries.length === 0) {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td colspan="3">No entries recorded for this date.</td>
      `;

      leaderboardBody.appendChild(row);
    }

    statusText.textContent =
      `${leaderboard.observed_entries} observed entries — partial snapshot`;

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

async function searchPlayers() {
  const searchTerm = playerSearch.value.trim().toLowerCase();

  searchResultsBody.innerHTML = "";
  searchResultsTable.classList.add("hidden");
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

    row.innerHTML = `
      <td>${formatDate(match.date)}</td>
      <td>${formatRank(match.rank)}</td>
      <td>${escapeHtml(match.player)}</td>
      <td>${formatScore(match.score)}</td>
    `;

    searchResultsBody.appendChild(row);
  });

  const extraPlayers = matchingNames.length - 1;

  searchStatus.textContent =
    `${matches.length} snapshot${matches.length === 1 ? "" : "s"} found for ${focusedPlayer}` +
    (extraPlayers > 0
      ? ` · ${extraPlayers} other matching player${extraPlayers === 1 ? "" : "s"}`
      : "");

     searchResultsTable.classList.remove("hidden");

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

function renderScoreChart(playerName, matches) {
  console.log(`renderScoreChart called for ${playerName} with ${matches.length} matches`);

  if (!scoreChartContainer || !scoreChartCanvas) {
    console.warn("Chart containers not found");
    return;
  }

  // Apply filter based on selected mode
  const filteredMatches = filterMatchesByMode(matches, dataFilterMode);
  console.log(`After filtering: ${filteredMatches.length} matches`);

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

if (dataFilterSelect) {
  dataFilterSelect.addEventListener("change", (event) => {
    console.log(`Filter dropdown changed to: ${event.target.value}`);
    dataFilterMode = event.target.value;
    console.log(`dataFilterMode is now: ${dataFilterMode}`);
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

clearSearchButton.addEventListener("click", () => {
  playerSearch.value = "";
  searchResultsBody.innerHTML = "";
  searchResultsTable.classList.add("hidden");
  playerSummary.innerHTML = "";
  playerSummary.classList.add("hidden");
  searchStatus.textContent = "";
  hideScoreChart();
  playerSearch.focus();
});

function updateNavigationButtons() {
  previousButton.disabled =
    currentDateIndex <= 0 || availableDates.length === 0;

  nextButton.disabled =
    currentDateIndex >= availableDates.length - 1 ||
    availableDates.length === 0;
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
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
  console.log(`filterMatchesByMode called: ${matches.length} matches, filter mode: ${filterMode}`);

  if (filterMode === "raw") {
    console.log("Returning raw matches");
    return matches;
  }

  const groups = groupDataByPeriod(matches, filterMode);
  console.log(`Grouped into ${Object.keys(groups).length} groups`);

  let filtered;
  if (filterMode === "weekly-peak" || filterMode === "monthly-peak") {
    filtered = calculatePeaks(groups);
    console.log(`Result: ${filtered.length} peak data points`);
  } else {
    filtered = calculateAverages(groups);
    console.log(`Result: ${filtered.length} averaged data points`);
  }

  return filtered;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

// Data gaps analysis helpers
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


initialize();