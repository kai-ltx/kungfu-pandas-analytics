// ==========================================
// PANDAMETRICS V4 - DASHBOARD BACKEND
// ==========================================
//
// Public entry points (anonymous web app): doGet, getDashboardData.
// Everything else ends in "_" so google.script.run cannot call it.

const PANDA_DASHBOARD = {
  spreadsheetId: "18tYVaGchByuhKAAAt87q37_8f2_jWtJ75YP4kvEu32c",
  clubs: {
    "454058": "KungFu Pandas",
    "451080": "Bamboo Shoots",
    "413965": "Torquay"
  },
  cacheKey: "dashboard-v4",
  cacheSeconds: 300,
  cacheChunk: 90000,
  syncLogRows: 10
};

const PANDA_TEXT_FIELDS_ = [
  "name", "position", "positionGroup", "appearanceStatus", "eventCoverage", "archetypeId", "matchType"
];

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("PandaMetrics | The Panda Den")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// Read-only. Returns display data only: no EA player ids, no raw events.
function getDashboardData() {
  try {
    const cached = pandaCacheGet_();
    if (cached) return cached;

    const data = pandaBuildData_();
    pandaCachePut_(data);
    return data;
  } catch (error) {
    console.error(error);
    return { ok: false, message: "PandaMetrics could not load the stats. Please try again shortly." };
  }
}

function pandaBuildData_() {
  const ss = SpreadsheetApp.openById(PANDA_DASHBOARD.spreadsheetId);
  const matchRows = pandaReadRows_(ss, "Matches");
  const playerRows = pandaReadRows_(ss, "Player_Match_Stats");

  if (!matchRows.length) {
    return { ok: false, message: "No matches have been imported yet." };
  }

  const matches = pandaNormalizeMatches_(matchRows);
  const matchIndex = new Map(matches.map(m => [m.clubId + "|" + m.matchId, m]));
  const appearances = pandaNormalizeAppearances_(playerRows, matchIndex);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    clubs: PANDA_DASHBOARD.clubs,
    matches,
    appearances,
    sync: pandaSyncStatus_(ss)
  };
}

// getValues (not getDisplayValues): numbers stay numbers whatever the
// sheet's display format, and dates arrive as Date objects.
function pandaReadRows_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values.shift().map(h => String(h).trim());

  return values
    .filter(row => row.some(v => v !== "" && v !== null))
    .map(row => {
      const record = {};
      headers.forEach((h, i) => {
        if (h) record[h] = row[i];
      });
      return record;
    });
}

function pandaClub_(record) {
  return String(record.clubId || "454058").trim();
}

function pandaId_(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value.toFixed(0);
  return String(value).trim();
}

function pandaUnix_(record) {
  const when = PandaStats.parseTimestamp(record);
  return when ? Math.floor(when.getTime() / 1000) : null;
}

function pandaNormalizeMatches_(rows) {
  const seen = new Set();
  const out = [];
  rows.forEach(r => {
    const clubId = pandaClub_(r);
    const matchId = pandaId_(r.matchId);
    if (!matchId || !PANDA_DASHBOARD.clubs[clubId]) return;
    const key = clubId + "|" + matchId;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      clubId,
      matchId,
      timestampUnix: pandaUnix_(r),
      matchType: String(r.matchType || "leagueMatch"),
      opponentName: String(r.opponentName || "Unknown"),
      goals: PandaStats.toNumber(r.goals),
      goalsAgainst: PandaStats.toNumber(r.goalsAgainst),
      result: String(r.result || "").toLowerCase(),
      dnf: r.dnf === true || String(r.dnf).toUpperCase() === "TRUE"
    });
  });
  return out;
}

function pandaMetricFields_() {
  const fields = new Set(["secondsPlayed", "rating", "passAttempts", "passesCompleted", "passesFailed"]);
  PandaStats.METRICS.forEach(m => PandaStats.requiredFields(m).forEach(f => fields.add(f)));
  ["Forward", "Backward", "Sideways"].forEach(d => {
    fields.add("passesCompleted" + d);
    fields.add("passesFailed" + d);
  });
  return [...fields];
}

function pandaNormalizeAppearances_(rows, matchIndex) {
  const numeric = pandaMetricFields_();
  const ids = new Map();
  const realIds = [...new Set(rows.map(r => pandaId_(r.playerId)).filter(Boolean))].sort();
  realIds.forEach((id, i) => ids.set(id, "p" + (i + 1)));

  const seen = new Set();
  const out = [];
  rows.forEach(r => {
    const clubId = pandaClub_(r);
    const matchId = pandaId_(r.matchId);
    const playerId = pandaId_(r.playerId);
    if (!matchId || !playerId || !PANDA_DASHBOARD.clubs[clubId]) return;
    const key = clubId + "|" + matchId + "|" + playerId;
    if (seen.has(key)) return;
    seen.add(key);

    const match = matchIndex.get(clubId + "|" + matchId);
    const row = {
      clubId,
      matchId,
      playerId: ids.get(playerId),
      timestampUnix: pandaUnix_(r) || (match ? match.timestampUnix : null)
    };
    PANDA_TEXT_FIELDS_.forEach(f => {
      row[f] = r[f] === undefined || r[f] === "" || r[f] === null ? null : String(r[f]);
    });
    if (!row.matchType && match) row.matchType = match.matchType;
    if (!row.positionGroup) row.positionGroup = PandaStats.positionGroup(r);
    if (r.eventsAvailable !== undefined && r.eventsAvailable !== "") {
      row.eventsAvailable = r.eventsAvailable === true || String(r.eventsAvailable).toUpperCase() === "TRUE";
    }
    numeric.forEach(f => {
      row[f] = PandaStats.toNumber(r[f]);
    });
    // Four experimental counts only. The raw event log stays on the sheet.
    Object.assign(row, PandaStats.experimentalFields(r));
    out.push(row);
  });
  return out;
}

function pandaSyncStatus_(ss) {
  const sheet = ss.getSheetByName("Sync_Log");
  if (!sheet || sheet.getLastRow() < 2) return { lastSync: null, recent: [] };

  const count = Math.min(PANDA_DASHBOARD.syncLogRows, sheet.getLastRow() - 1);
  const width = Math.min(sheet.getLastColumn(), 5);
  const rows = sheet.getRange(sheet.getLastRow() - count + 1, 1, count, width).getValues();

  const recent = rows.map(r => {
    const at = r[0] instanceof Date ? r[0] : new Date(r[0]);
    return {
      at: isNaN(at) ? null : at.toISOString(),
      club: String(r[1] || ""),
      matches: PandaStats.toNumber(r[2]),
      players: PandaStats.toNumber(r[3]),
      status: String(r[4] || "ok").startsWith("error") ? "error" : "ok"
    };
  }).reverse();

  const ok = recent.filter(r => r.status === "ok" && r.at);
  return { lastSync: ok.length ? ok[0].at : null, recent };
}

// ------------------------------------------------------------------ cache

// CacheService values are limited to 100 KB, so the payload is chunked.
function pandaCacheGet_() {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(PANDA_DASHBOARD.cacheKey + ":n"));
  if (!count) return null;
  let text = "";
  for (let i = 0; i < count; i++) {
    const part = cache.get(PANDA_DASHBOARD.cacheKey + ":" + i);
    if (part === null) return null;
    text += part;
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function pandaCachePut_(data) {
  if (!data.ok) return;
  const cache = CacheService.getScriptCache();
  const text = JSON.stringify(data);
  const size = PANDA_DASHBOARD.cacheChunk;
  const count = Math.ceil(text.length / size);
  for (let i = 0; i < count; i++) {
    cache.put(PANDA_DASHBOARD.cacheKey + ":" + i, text.slice(i * size, (i + 1) * size), PANDA_DASHBOARD.cacheSeconds);
  }
  cache.put(PANDA_DASHBOARD.cacheKey + ":n", String(count), PANDA_DASHBOARD.cacheSeconds);
}

// Called by the webhook after new rows are written.
function invalidateDashboardCache_() {
  CacheService.getScriptCache().remove(PANDA_DASHBOARD.cacheKey + ":n");
}
