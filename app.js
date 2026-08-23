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

const zoomInButton =
  document.getElementById("zoom-in-button");

const zoomOutButton =
  document.getElementById("zoom-out-button");

const zoomResetButton =
  document.getElementById("zoom-reset-button");

let availableDates = [];
let currentDateIndex = -1;
let allLeaderboards = [];
let scoreChart = null;
let chartMode = "score";
let chartZoomLevel = 1;

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

      row.innerHTML = `
        <td>${formatRank(entry.rank)}</td>
        <td>${escapeHtml(entry.player)}</td>
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

      return {
        date,
        entries: leaderboard.entries
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
    searchStatus.textContent = "No matching players found.";
    return;
  }

  const focusedPlayer = chooseFocusedPlayer(
    matchingNames,
    searchTerm
  );

  const matches = allEntries
    .filter(entry => entry.player === focusedPlayer)
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
      <div class="summary-label">Best rank</div>
      <div class="summary-value">${formatRank(bestRank)}</div>
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

function renderScoreChart(playerName, matches) {
  if (!scoreChartContainer || !scoreChartCanvas) {
    return;
  }

  if (matches.length < 2) {
    hideScoreChart();

    if (chartStatus) {
      chartStatus.textContent =
        "A trend needs at least two recorded snapshots.";
    }

    return;
  }

  const labels = matches.map(match => formatDate(match.date));

  const scores = matches.map(match => {
    return Number(
      String(match.score).replaceAll(",", "").trim()
    );
  });

  const ranks = matches.map(match => Number(match.rank));

  const isScoreMode = chartMode === "score";
  const values = isScoreMode ? scores : ranks;

  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const valueRange = maximumValue - minimumValue;

  const padding = valueRange === 0
    ? Math.max(minimumValue * 0.1, 1)
    : valueRange * 0.12;

  const chartMinimum = isScoreMode
    ? Math.max(0, minimumValue - padding)
    : Math.max(1, Math.floor(minimumValue - padding));

  const chartMaximum = isScoreMode
    ? maximumValue + padding
    : Math.ceil(maximumValue + padding);

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
          borderColor: isScoreMode
            ? "#f4bd55"
            : "#4d9cff",
          backgroundColor: isScoreMode
            ? "rgba(244, 189, 85, 0.16)"
            : "rgba(77, 156, 255, 0.16)",
          pointBackgroundColor: isScoreMode
            ? "#f4bd55"
            : "#4d9cff",
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
        },
        zoom: {
          zoom: {
            wheel: {
              enabled: true,
              speed: 0.1
            },
            pinch: {
              enabled: true
            },
            mode: "y",
            onZoomStart(event) {
              // Handle zoom start if needed
            },
            onZoomComplete() {
              updateZoomButtonStates();
            }
          },
          pan: {
            enabled: false
          },
          limits: {
            y: {
              min: isScoreMode ? 0 : 1,
              max: isScoreMode ? "original" : "original"
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
            stepSize: isScoreMode ? undefined : 1,
            precision: isScoreMode ? undefined : 0,
            callback: value => {
              if (!isScoreMode && !Number.isInteger(value)) {
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

  chartZoomLevel = 1;
  updateChartToggleButtons();
  updateZoomButtonStates();
}

function hideScoreChart() {
  if (scoreChart) {
    scoreChart.destroy();
    scoreChart = null;
  }

  chartZoomLevel = 1;

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
}

scoreChartButton.addEventListener("click", () => {
  chartMode = "score";
  chartZoomLevel = 1;
  refreshFocusedChart();
});

rankChartButton.addEventListener("click", () => {
  chartMode = "rank";
  chartZoomLevel = 1;
  refreshFocusedChart();
});

zoomInButton.addEventListener("click", () => {
  if (scoreChart) {
    scoreChart.zoom(1.2, "auto");
    chartZoomLevel *= 1.2;
    updateZoomButtonStates();
  }
});

zoomOutButton.addEventListener("click", () => {
  if (scoreChart) {
    scoreChart.zoom(0.85, "auto");
    chartZoomLevel *= 0.85;
    updateZoomButtonStates();
  }
});

zoomResetButton.addEventListener("click", () => {
  if (scoreChart) {
    scoreChart.resetZoom("auto");
    chartZoomLevel = 1;
    updateZoomButtonStates();
  }
});

function updateZoomButtonStates() {
  // Disable zoom-in if we're already at max zoom (arbitrary limit: 5x)
  zoomInButton.disabled = chartZoomLevel >= 5;
  // Disable zoom-out if we're at normal zoom or less
  zoomOutButton.disabled = chartZoomLevel <= 1;
  // Disable reset if we're at normal zoom
  zoomResetButton.disabled = chartZoomLevel <= 1.01;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function initialize() {
  await loadDates();

  try {
    await loadAllLeaderboards();

    searchStatus.textContent =
      "Enter a player name to search the archive.";

    updateChartToggleButtons();
  } catch (error) {
    searchStatus.textContent = error.message;
  }
}

initialize();