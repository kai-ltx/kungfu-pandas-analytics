"use strict";

// Replays the V2 importer's payloads, then V4 payloads, through the real
// webhook (Code.js) into a fake spreadsheet, and reads the result with the
// currently deployed V3 dashboard backend (Dashboard.js at main).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { loadAppsScript, APPS_SCRIPT } = require("./load");
const { appsScriptGlobals, post } = require("./fakes");

const PAYLOADS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "payloads.json"), "utf8"));
const TOKEN = "test-token";

function productionDashboardSource() {
  // The V3 backend as deployed (main), independent of later branch edits.
  try {
    return execFileSync("git", ["show", "main:apps-script/Dashboard.js"], {
      cwd: path.join(APPS_SCRIPT, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    });
  } catch (_) {
    return fs.readFileSync(path.join(APPS_SCRIPT, "Dashboard.js"), "utf8");
  }
}

function setup() {
  const env = appsScriptGlobals({ properties: { WEBHOOK_TOKEN: TOKEN } });
  const ctx = loadAppsScript(["Code.js"], env.globals);
  return { ctx, ss: env.ss };
}

function keysOf(sheet, keyFields) {
  const [headers, ...rows] = sheet.data;
  return rows.map(r => keyFields.map(f => String(r[headers.indexOf(f)])).join("|"));
}

function snapshot(sheet) {
  return JSON.parse(JSON.stringify(sheet.data));
}

function importAll(ctx, version) {
  return Object.values(PAYLOADS[version]).map(p => post(ctx, Object.assign({ token: TOKEN }, p)));
}

test("V4 import after V2 history adds only playoff records and never duplicates", () => {
  const { ctx, ss } = setup();
  importAll(ctx, "v2").forEach(r => assert.equal(r.success, true));

  const matches = ss.getSheetByName("Matches");
  const players = ss.getSheetByName("Player_Match_Stats");
  const beforeMatches = snapshot(matches);
  const beforePlayers = snapshot(players);

  const results = importAll(ctx, "v4");
  results.forEach(r => assert.equal(r.success, true));

  const v4 = PAYLOADS.v4;
  const playoffMatches = Object.values(v4).reduce((a, p) => a + p.matches.filter(m => m.matchType === "playoffMatch").length, 0);
  const playoffPlayers = Object.values(v4).reduce((a, p) => a + p.players.filter(m => m.matchType === "playoffMatch").length, 0);
  assert.equal(results.reduce((a, r) => a + r.matchesAdded, 0), playoffMatches);
  assert.equal(results.reduce((a, r) => a + r.playersAdded, 0), playoffPlayers);
  assert.ok(playoffMatches > 0 && playoffPlayers > 0);

  const matchKeys = keysOf(matches, ["clubId", "matchId"]);
  const playerKeys = keysOf(players, ["clubId", "matchId", "playerId"]);
  assert.equal(new Set(matchKeys).size, matchKeys.length, "duplicate match rows");
  assert.equal(new Set(playerKeys).size, playerKeys.length, "duplicate player rows");

  // Existing headers keep their positions; new columns only appended.
  [[beforeMatches, matches], [beforePlayers, players]].forEach(([before, sheet]) => {
    assert.deepEqual(sheet.data[0].slice(0, before[0].length), before[0], "existing headers moved");
    assert.ok(sheet.data.length >= before.length);
  });
});

test("historical rows keep their exact values after a V4 import", () => {
  const { ctx, ss } = setup();
  importAll(ctx, "v2");
  const players = ss.getSheetByName("Player_Match_Stats");
  const before = snapshot(players);
  importAll(ctx, "v4");
  for (let r = 1; r < before.length; r++) {
    for (let c = 0; c < before[0].length; c++) {
      assert.equal(players.data[r][c], before[r][c], `row ${r + 1} col ${before[0][c]}`);
    }
  }
});

test("new V4 columns are appended and blank on historical rows", () => {
  const { ctx, ss } = setup();
  importAll(ctx, "v2");
  const players = ss.getSheetByName("Player_Match_Stats");
  const oldHeaders = players.data[0].slice();
  importAll(ctx, "v4");
  const headers = players.data[0];
  const added = headers.slice(oldHeaders.length);
  ["positionGroup", "archetypeId", "rawEvents", "eventCoverage", "appearanceStatus",
   "dataQualityFlags", "matchType"].forEach(col => assert.ok(added.includes(col), col));
  const col = headers.indexOf("eventCoverage");
  const historical = players.data.slice(1).filter(r => r[col] === undefined || r[col] === "");
  assert.ok(historical.length > 0, "historical rows should not be back-filled");
});

test("re-running the V4 import is idempotent", () => {
  const { ctx, ss } = setup();
  importAll(ctx, "v4");
  const rowsAfterFirst = ss.getSheetByName("Player_Match_Stats").data.length;
  const second = importAll(ctx, "v4");
  second.forEach(r => {
    assert.equal(r.matchesAdded, 0);
    assert.equal(r.playersAdded, 0);
  });
  assert.equal(ss.getSheetByName("Player_Match_Stats").data.length, rowsAfterFirst);
});

test("keys match whether the sheet stored ids as numbers or text", () => {
  const { ctx, ss } = setup();
  importAll(ctx, "v2");
  const players = ss.getSheetByName("Player_Match_Stats");
  const headers = players.data[0];
  const idCol = headers.indexOf("matchId");
  assert.equal(typeof players.data[1][idCol], "number", "fake should store numeric text as numbers like Sheets");
  const res = post(ctx, Object.assign({ token: TOKEN }, PAYLOADS.v4["454058"]));
  assert.equal(res.matchesAdded, 0);
  assert.equal(res.playersAdded, 0);
});

test("wrong token writes nothing", () => {
  const { ctx, ss } = setup();
  const res = post(ctx, Object.assign({ token: "nope" }, PAYLOADS.v4["451080"]));
  assert.equal(res.success, false);
  assert.equal(res.error, "Unauthorized");
  assert.equal(ss.getSheetByName("Matches"), null);
});

test("unknown club rejected", () => {
  const { ctx } = setup();
  const res = post(ctx, { token: TOKEN, clubId: "1", matches: [], players: [] });
  assert.equal(res.success, false);
  assert.match(res.error, /Unknown club/);
});

test("deployed V3 dashboard still reads mixed V2 + V4 rows", () => {
  const { ctx, ss } = setup();
  importAll(ctx, "v2");
  importAll(ctx, "v4");
  vm.runInContext(productionDashboardSource(), ctx, { filename: "Dashboard.js@main" });
  const data = ctx.getDashboardData();
  assert.equal(data.ok, true);
  const expectedMatches = Object.values(PAYLOADS.v4).reduce((a, p) => a + p.matches.length, 0);
  assert.equal(data.matches.length, expectedMatches);
  assert.ok(data.matches.some(m => m.matchType === "playoffMatch"));
  const keys = data.records.map(r => r.clubId + "|" + r.matchId + "|" + r.playerId);
  assert.equal(new Set(keys).size, keys.length);
});
