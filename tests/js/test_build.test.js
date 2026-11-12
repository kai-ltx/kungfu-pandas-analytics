"use strict";

// The isolated test build must not be able to reach the production
// spreadsheet or accept webhook writes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { appsScriptGlobals, FakeSpreadsheet, post } = require("./fakes");
const {
  build, verify, MANIFEST, PRODUCTION_SPREADSHEET_ID, PRODUCTION_SCRIPT_ID
} = require("../../tools/build_test_project");

const TEST_ID = "TEST_sheet_0123456789abcdefghijklmnopqrs";
const TEST_SCRIPT = "TEST_script_0123456789abcdefghijklmnop";

function loadBuilt(files, active) {
  const { globals } = appsScriptGlobals();
  globals.SpreadsheetApp = {
    openById: () => { throw new Error("openById must not be reachable in the test build"); },
    getActiveSpreadsheet: () => active
  };
  const ctx = vm.createContext(Object.assign({ console: { error() {}, log() {} } }, globals));
  ["Stats.js", "Code.js", "Dashboard.js", "TestGuard.js"].forEach(name => {
    vm.runInContext(files[name], ctx, { filename: name });
  });
  return ctx;
}

function boundSpreadsheet(id) {
  const ss = new FakeSpreadsheet();
  ss.getId = () => id;
  return ss;
}

test("test build removes every production id and openById call", () => {
  const files = build({ spreadsheetId: TEST_ID, scriptId: TEST_SCRIPT });
  Object.entries(files).forEach(([name, text]) => {
    assert.ok(!text.includes(PRODUCTION_SPREADSHEET_ID), name);
    assert.ok(!text.includes(PRODUCTION_SCRIPT_ID), name);
    assert.ok(!/openById/.test(text), name);
  });
  assert.match(files["Code.js"], new RegExp(TEST_ID));
  assert.match(files["Dashboard.js"], new RegExp(TEST_ID));
});

test("test manifest only allows the bound spreadsheet", () => {
  const files = build({ spreadsheetId: TEST_ID });
  const manifest = JSON.parse(files["appsscript.json"]);
  assert.deepEqual(manifest.oauthScopes, ["https://www.googleapis.com/auth/spreadsheets.currentonly"]);
  assert.deepEqual(manifest.oauthScopes, MANIFEST.oauthScopes);
});

test("test build refuses production ids in its config", () => {
  assert.throws(() => build({ spreadsheetId: PRODUCTION_SPREADSHEET_ID }), /PRODUCTION spreadsheet/);
  assert.throws(() => build({ spreadsheetId: TEST_ID, scriptId: PRODUCTION_SCRIPT_ID }), /PRODUCTION Apps Script/);
  assert.throws(() => build({ spreadsheetId: "short" }), /malformed/);
});

test("isolation check rejects services that reach other files or the network", () => {
  const base = { "appsscript.json": JSON.stringify(MANIFEST) };
  ["SpreadsheetApp.openById(x)", "SpreadsheetApp.openByUrl(x)", "DriveApp.getFiles()", "UrlFetchApp.fetch(x)"]
    .forEach(code => assert.throws(() => verify({ ...base, "X.js": code }), /Test build failed/));
  assert.throws(
    () => verify({ "appsscript.json": JSON.stringify({ oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"] }) }),
    /currentonly/
  );
});

test("built dashboard reads only the bound test spreadsheet", () => {
  const files = build({ spreadsheetId: TEST_ID });
  const bound = loadBuilt(files, boundSpreadsheet(TEST_ID));
  assert.equal(bound.getDashboardData().message, "No matches have been imported yet.");

  const wrong = loadBuilt(files, boundSpreadsheet(PRODUCTION_SPREADSHEET_ID));
  const result = wrong.getDashboardData();
  assert.equal(result.ok, false);
  assert.match(result.message, /could not load/);
  assert.throws(() => vm.runInContext("pandaTestSpreadsheet_(" + JSON.stringify(PRODUCTION_SPREADSHEET_ID) + ")", wrong), /refused/);
});

test("built webhook rejects every post when no test token is configured", () => {
  const files = build({ spreadsheetId: TEST_ID });
  const ss = boundSpreadsheet(TEST_ID);
  const ctx = loadBuilt(files, ss);
  const result = post(ctx, { token: "", clubId: "454058", matches: [], players: [] });
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(ss.sheets), []);
});

test("build writes a separate clasp config and never the production script id", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "panda-test-build-"));
  build({ spreadsheetId: TEST_ID, scriptId: TEST_SCRIPT }, out);
  const clasp = JSON.parse(fs.readFileSync(path.join(out, ".clasp.json"), "utf8"));
  assert.equal(clasp.scriptId, TEST_SCRIPT);
  assert.equal(clasp.rootDir, "");
  assert.ok(fs.existsSync(path.join(out, "TestGuard.js")));
  fs.rmSync(out, { recursive: true, force: true });
});
