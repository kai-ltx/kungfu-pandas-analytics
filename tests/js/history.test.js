"use strict";

// Replays the V2 importer's payloads, then V4 payloads, through the real
// webhook (Code.js) into a fake spreadsheet, and reads the result with both
// the deployed V3 dashboard backend and the V4 one.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadAppsScript } = require("./load");
const { appsScriptGlobals, post } = require("./fakes");

const PAYLOADS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "payloads.json"), "utf8"));
const TOKEN = "test-token";

// Frozen copy of the deployed V3.1 backend (clasp clone, commit 44eefdc).
const PRODUCTION_DASHBOARD = path.join(__dirname, "..", "fixtures", "production", "Dashboard.v3.js");

function setup(files) {
  const env = appsScriptGlobals({ properties: { WEBHOOK_TOKEN: TOKEN } });
  const ctx = loadAppsScript(files || ["Code.js"], env.globals);
  return { ctx, ss: env.ss, env };
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
  vm.runInContext(fs.readFileSync(PRODUCTION_DASHBOARD, "utf8"), ctx, { filename: "Dashboard.v3.js" });
  const data = ctx.getDashboardData();
  assert.equal(data.ok, true);
  const expectedMatches = Object.values(PAYLOADS.v4).reduce((a, p) => a + p.matches.length, 0);
  assert.equal(data.matches.length, expectedMatches);
  assert.ok(data.matches.some(m => m.matchType === "playoffMatch"));
  const keys = data.records.map(r => r.clubId + "|" + r.matchId + "|" + r.playerId);
  assert.equal(new Set(keys).size, keys.length);
});

// ------------------------------------------------------------ V4 backend

const V4_FILES = ["Stats.js", "Code.js", "Dashboard.js"];

function realPlayerIds() {
  const ids = new Set();
  ["v2", "v4"].forEach(v => Object.values(PAYLOADS[v]).forEach(p => p.players.forEach(r => ids.add(String(r.playerId)))));
  return ids;
}

test("V4 dashboard reads mixed V2 + V4 rows without exposing EA player ids", () => {
  const { ctx } = setup(V4_FILES);
  importAll(ctx, "v2");
  importAll(ctx, "v4");
  const data = ctx.getDashboardData();
  assert.equal(data.ok, true);

  const expectedMatches = Object.values(PAYLOADS.v4).reduce((a, p) => a + p.matches.length, 0);
  assert.equal(data.matches.length, expectedMatches);
  const keys = data.appearances.map(r => r.clubId + "|" + r.matchId + "|" + r.playerId);
  assert.equal(new Set(keys).size, keys.length, "duplicate appearances");

  const json = JSON.stringify(data);
  realPlayerIds().forEach(id => assert.ok(!json.includes('"' + id + '"'), "EA player id leaked"));
  assert.ok(!("rawEvents" in data.appearances[0]), "raw events must not be sent to the browser");
  data.appearances.forEach(r => {
    assert.match(r.playerId, /^p\d+$/);
    assert.ok(Number.isInteger(r.timestampUnix), "timestampUnix");
    assert.ok(["leagueMatch", "playoffMatch"].includes(r.matchType), "legacy rows get a match type");
  });
  assert.ok(data.appearances.some(r => r.matchType === "playoffMatch"));
  assert.ok(data.appearances.some(r => r.eventCoverage === null), "V2 rows have no coverage flag");
  assert.ok(data.appearances.every(r => r.positionGroup === null || ["ATT", "MID", "DEF", "GK"].includes(r.positionGroup)));
});

test("V4 dashboard data feeds PandaInsights end to end", () => {
  const { ctx } = setup(V4_FILES);
  importAll(ctx, "v2");
  importAll(ctx, "v4");
  const data = ctx.getDashboardData();
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "client", "Insights.js"), "utf8"), ctx);
  const prepared = vm.runInContext("PandaInsights.prepare", ctx)(JSON.parse(JSON.stringify(data)));
  const model = vm.runInContext("PandaInsights.build", ctx)(prepared, {}, new Date(), null);
  assert.ok(model.overview.matches > 0);
  assert.ok(model.rankings.scores.qualified.length > 0);
  assert.equal(model.overview.coverage.appearances + model.overview.coverage.didNotPlay, model.overview.coverage.rows);
});

test("Sync_Log records status and the dashboard reports the last successful sync", () => {
  const { ctx, ss } = setup(V4_FILES);
  importAll(ctx, "v4");
  const log = ss.getSheetByName("Sync_Log");
  assert.deepEqual([...log.data[0].slice(0, 5)], ["Timestamp", "Club", "Matches Added", "Player Records Added", "Status"]);
  assert.ok(log.data.slice(1).every(r => r[4] === "ok"));
  const data = ctx.getDashboardData();
  assert.ok(data.sync.lastSync);
  assert.equal(data.sync.recent.length, Object.keys(PAYLOADS.v4).length);
  assert.ok(data.sync.recent.every(r => r.status === "ok"));
});

test("failed authorised imports are logged; unauthorised ones are not", () => {
  const { ctx, ss } = setup(V4_FILES);
  post(ctx, { token: "nope", clubId: "454058", matches: [], players: [] });
  assert.equal(ss.getSheetByName("Sync_Log"), null, "anonymous callers must not be able to write to the log");

  const res = post(ctx, { token: TOKEN, clubId: "454058", matches: "not-an-array", players: [] });
  assert.equal(res.success, false);
  const log = ss.getSheetByName("Sync_Log");
  assert.ok(log, "authorised failure should be logged");
  assert.match(String(log.data[log.data.length - 1][4]), /^error/);
});

test("dashboard cache is chunked and invalidated by new imports", () => {
  const { ctx, env } = setup(V4_FILES);
  importAll(ctx, "v2");
  vm.runInContext("PANDA_DASHBOARD.cacheChunk = 5000", ctx);
  const first = ctx.getDashboardData();
  const count = Number(env.cache.get("dashboard-v4:n"));
  assert.ok(count > 1, "payload should span several chunks");
  assert.equal(JSON.stringify(ctx.getDashboardData()), JSON.stringify(first), "served from cache");

  importAll(ctx, "v4");
  assert.equal(env.cache.has("dashboard-v4:n"), false, "import should invalidate the cache");
  const fresh = ctx.getDashboardData();
  assert.ok(fresh.matches.length > first.matches.length, "new playoff matches visible after import");
});
