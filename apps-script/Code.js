// ==========================================
// PANDAMETRICS V2 - MULTI-CLUB WEBHOOK
// ==========================================
//
// The dashboard web app is anonymous and google.script.run can call any
// top-level function without a trailing underscore. Only doGet, doPost and
// getDashboardData may be public; every other function must end in "_".

const CONFIG = {
  spreadsheetId: "18tYVaGchByuhKAAAt87q37_8f2_jWtJ75YP4kvEu32c",

  clubs: {
    "454058": "KungFu Pandas",
    "451080": "Bamboo Shoots",
    "413965": "Torquay"
  }
};


// ==========================================
// RECEIVE DATA FROM GITHUB
// ==========================================

function doPost(e) {

  let lock;

  try {

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Missing POST data");
    }

    const data = JSON.parse(e.postData.contents);

    const expectedToken = PropertiesService
      .getScriptProperties()
      .getProperty("WEBHOOK_TOKEN");

    if (!expectedToken || data.token !== expectedToken) {
      throw new Error("Unauthorized");
    }

    const clubId = String(data.clubId);

    if (!Object.prototype.hasOwnProperty.call(CONFIG.clubs, clubId)) {
      throw new Error("Unknown club ID: " + clubId);
    }

    if (!Array.isArray(data.matches) || !Array.isArray(data.players)) {
      throw new Error("Invalid match or player data");
    }

    lock = LockService.getScriptLock();
    lock.waitLock(30000);

    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

    const clubName = CONFIG.clubs[clubId];

    // Add club identifiers to all incoming records.
    const matches = data.matches.map(record => ({
      ...record,
      clubId: clubId,
      clubName: clubName
    }));

    const players = data.players.map(record => ({
      ...record,
      clubId: clubId,
      clubName: clubName
    }));

    // Save matches and player statistics.
    const matchesAdded = saveRecords_(
      ss,
      "Matches",
      matches,
      ["clubId", "matchId"]
    );

    const playersAdded = saveRecords_(
      ss,
      "Player_Match_Stats",
      players,
      ["clubId", "matchId", "playerId"]
    );

    // Log the synchronization.
    let logSheet = ss.getSheetByName("Sync_Log");

    if (!logSheet) {
      logSheet = ss.insertSheet("Sync_Log");
    }

    if (logSheet.getLastRow() === 0) {
      logSheet.appendRow([
        "Timestamp",
        "Club",
        "Matches Added",
        "Player Records Added"
      ]);
    }

    logSheet.appendRow([
      new Date(),
      clubName,
      matchesAdded,
      playersAdded
    ]);

    return jsonResponse_({
      success: true,
      club: clubName,
      matchesAdded: matchesAdded,
      playersAdded: playersAdded
    });

  } catch (error) {

    console.error(error);

    return jsonResponse_({
      success: false,
      error: String(error.message)
    });

  } finally {

    if (lock) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }

  }
}


// ==========================================
// SAVE RECORDS WITHOUT DUPLICATES
// ==========================================

function saveRecords_(ss, sheetName, records, keyFields) {

  if (!records.length) return 0;

  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  let headers = [];

  if (sheet.getLastRow() > 0) {
    headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(String);
  }

  const incomingFields = [
    ...new Set(records.flatMap(record => Object.keys(record)))
  ];

  const newFields = incomingFields.filter(
    field => !headers.includes(field)
  );

  headers = headers.concat(newFields);

  if (newFields.length > 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers]);
  }

  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#d9ead3");

  const existingKeys = new Set();

  if (sheet.getLastRow() > 1) {

    const existing = sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      headers.length
    ).getValues();

    existing.forEach(row => {

      const key = keyFields.map(field => {
        const index = headers.indexOf(field);
        return String(row[index]);
      }).join("|");

      existingKeys.add(key);

    });
  }

  const rows = [];

  records.forEach(record => {

    const key = keyFields.map(
      field => String(record[field])
    ).join("|");

    if (existingKeys.has(key)) return;

    existingKeys.add(key);

    const row = headers.map(field => {

      const value = record[field];

      if (value === undefined || value === null) {
        return "";
      }

      if (typeof value === "object") {
        return JSON.stringify(value);
      }

      if (
        typeof value === "string" &&
        /^[=+\-@\t\r]/.test(value)
      ) {
        return "'" + value;
      }

      return value;

    });

    rows.push(row);

  });

  if (rows.length > 0) {
    sheet.getRange(
      sheet.getLastRow() + 1,
      1,
      rows.length,
      headers.length
    ).setValues(rows);
  }

  return rows.length;
}


// ==========================================
// MIGRATE EXISTING KUNGFU PANDAS DATA
// RUN ONCE BEFORE FIRST MULTI-CLUB SYNC
// ==========================================

function migrateExistingClubData_() {

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  ["Matches", "Player_Match_Stats"].forEach(sheetName => {

    const sheet = ss.getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() < 2) return;

    let headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(String);

    ["clubId", "clubName"].forEach(field => {

      if (!headers.includes(field)) {
        sheet.getRange(1, sheet.getLastColumn() + 1)
          .setValue(field);

        headers.push(field);
      }

    });

    const clubIdCol = headers.indexOf("clubId") + 1;
    const clubNameCol = headers.indexOf("clubName") + 1;

    const rowCount = sheet.getLastRow() - 1;

    const ids = sheet
      .getRange(2, clubIdCol, rowCount, 1)
      .getValues()
      .map(row => [row[0] || "454058"]);

    const names = sheet
      .getRange(2, clubNameCol, rowCount, 1)
      .getValues()
      .map(row => [row[0] || "KungFu Pandas"]);

    sheet.getRange(2, clubIdCol, rowCount, 1)
      .setValues(ids);

    sheet.getRange(2, clubNameCol, rowCount, 1)
      .setValues(names);

    console.log(
      sheetName + ": migrated " + rowCount + " records"
    );

  });

  console.log("Migration complete.");

}


// ==========================================
// TEST SPREADSHEET ACCESS
// ==========================================

function testSpreadsheetAccess_() {

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  console.log("Connected to: " + ss.getName());

}


// ==========================================
// JSON RESPONSE
// ==========================================

function jsonResponse_(data) {

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);

}