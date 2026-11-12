// ==========================================
// PANDAMETRICS V3.1 - DASHBOARD BACKEND
// ==========================================

const PANDA_DASHBOARD = {
  spreadsheetId: "18tYVaGchByuhKAAAt87q37_8f2_jWtJ75YP4kvEu32c",
  clubs: {
    "454058": "KungFu Pandas",
    "451080": "Bamboo Shoots",
    "413965": "Torquay"
  }
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("PandaMetrics | The Panda Den")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function pandaReadSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);

  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift().map(x => String(x).trim());

  return values
    .filter(row => row.some(value => value !== ""))
    .map(row => {
      const record = {};

      headers.forEach((header, index) => {
        if (header) record[header] = row[index];
      });

      return record;
    });
}

function pandaNumber_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pandaClub_(record) {
  return String(record.clubId || "454058").trim();
}

function getDashboardData() {
  const ss = SpreadsheetApp.openById(
    PANDA_DASHBOARD.spreadsheetId
  );

  const matchRows = pandaReadSheet_(ss, "Matches");
  const playerRows = pandaReadSheet_(ss, "Player_Match_Stats");

  if (!matchRows.length) {
    return {
      ok: false,
      message: "No matches have been imported yet."
    };
  }

  // Deduplicate matches across repeated imports.
  const matchMap = new Map();

  matchRows.forEach(record => {
    const clubId = pandaClub_(record);
    const matchId = String(record.matchId || "").trim();

    if (!matchId || !PANDA_DASHBOARD.clubs[clubId]) return;

    matchMap.set(clubId + "|" + matchId, record);
  });

  const matches = [...matchMap.values()].map(record => ({
    clubId: pandaClub_(record),
    clubName: PANDA_DASHBOARD.clubs[pandaClub_(record)],
    matchId: String(record.matchId),
    timestamp: String(record.timestamp || ""),
    opponent: String(record.opponentName || "Unknown"),
    result: String(record.result || "").toLowerCase(),
    goals: pandaNumber_(record.goals),
    goalsAgainst: pandaNumber_(record.goalsAgainst),
    matchType: String(record.matchType || "")
  }));

  matches.sort((a, b) =>
    String(b.timestamp).localeCompare(String(a.timestamp))
  );

  const matchIndex = new Map(
    matches.map(match => [
      match.clubId + "|" + match.matchId,
      match
    ])
  );

  const excludedFields = new Set([
    "clubId", "clubName", "matchId", "playerId",
    "name", "position", "timestamp", "rating",
    "result", "opponentName", "matchType"
  ]);

  const records = [];
  const seen = new Set();
  const metricFields = new Set();

  playerRows.forEach(row => {
    const clubId = pandaClub_(row);
    const matchId = String(row.matchId || "").trim();
    const playerId = String(row.playerId || "").trim();

    if (!matchId || !playerId) return;
    if (!PANDA_DASHBOARD.clubs[clubId]) return;

    const key = clubId + "|" + matchId + "|" + playerId;

    if (seen.has(key)) return;
    seen.add(key);

    const match = matchIndex.get(clubId + "|" + matchId);

    const stats = {};

    Object.entries(row).forEach(([field, value]) => {
      if (excludedFields.has(field)) return;
      if (value === "" || value === null) return;

      const number = Number(value);

      if (Number.isFinite(number)) {
        stats[field] = number;
        metricFields.add(field);
      }
    });

    const ratingValue = String(row.rating || "").trim();

    records.push({
      clubId,
      matchId,
      playerId,
      name: String(row.name || playerId),
      position: String(row.position || "Unknown"),
      timestamp: String(
        row.timestamp || (match ? match.timestamp : "")
      ),
      result: match ? match.result : "",
      rating: ratingValue && Number.isFinite(Number(ratingValue))
        ? Number(ratingValue)
        : null,
      stats
    });
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    clubs: PANDA_DASHBOARD.clubs,
    matches,
    records,
    metricFields: [...metricFields]
  };
}