"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "sync-clock", "Code.js"), "utf8");
const TOKEN = "test-dispatch-token";

function load(options) {
  const calls = [];
  const logs = [];
  const triggers = (options.triggers || []).map(name => ({ getHandlerFunction: () => name }));
  const created = [];
  const properties = Object.assign({}, options.properties);
  const context = {
    console: {
      log: msg => logs.push(String(msg)),
      error: msg => logs.push(String(msg))
    },
    Utilities: { formatDate: () => String(options.hour) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (key in properties ? properties[key] : null)
      })
    },
    UrlFetchApp: {
      fetch: (url, request) => {
        calls.push({ url, request });
        const hit = options.fetch(url, request);
        return {
          getResponseCode: () => hit.code,
          getContentText: () => hit.body || ""
        };
      }
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: trigger => {
        const index = triggers.indexOf(trigger);
        if (index !== -1) triggers.splice(index, 1);
      },
      newTrigger: name => ({
        timeBased: () => ({
          everyMinutes: minutes => ({
            create: () => created.push({ name, minutes })
          })
        })
      })
    }
  };
  vm.runInNewContext(SOURCE, context, { filename: "sync-clock/Code.js" });
  return { context, calls, logs, created, triggers };
}

function runsResponse(runs) {
  return { code: 200, body: JSON.stringify({ workflow_runs: runs }) };
}

test("the clock does not call GitHub outside playing hours or without a token", () => {
  const quiet = load({
    hour: 10,
    properties: { GH_DISPATCH_TOKEN: TOKEN },
    fetch: () => { throw new Error("no fetch expected"); }
  });
  quiet.context.eveningSyncTick_();
  assert.equal(quiet.calls.length, 0);
  assert.match(quiet.logs.join("\n"), /outside playing hours/);

  const missing = load({
    hour: 21,
    properties: {},
    fetch: () => { throw new Error("no fetch expected"); }
  });
  missing.context.eveningSyncTick_();
  assert.equal(missing.calls.length, 0);
  assert.match(missing.logs.join("\n"), /GH_DISPATCH_TOKEN/);
});

test("a recent or running sync is not dispatched again", () => {
  const running = load({
    hour: 21,
    properties: { GH_DISPATCH_TOKEN: TOKEN },
    fetch: () => runsResponse([{ status: "in_progress", created_at: new Date().toISOString() }])
  });
  running.context.eveningSyncTick_();
  assert.equal(running.calls.length, 1);
  assert.match(running.logs.join("\n"), /already running/);

  const recent = load({
    hour: 21,
    properties: { GH_DISPATCH_TOKEN: TOKEN },
    fetch: () => runsResponse([{
      status: "completed",
      conclusion: "success",
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    }])
  });
  recent.context.eveningSyncTick_();
  assert.equal(recent.calls.length, 1);
  assert.match(recent.logs.join("\n"), /synced 5 min ago/);
});

test("a stale evening dispatches main and never logs the token", () => {
  const clock = load({
    hour: 22,
    properties: { GH_DISPATCH_TOKEN: TOKEN },
    fetch: (url) => url.endsWith("/runs?per_page=5")
      ? runsResponse([{
        status: "completed",
        conclusion: "success",
        created_at: new Date(Date.now() - 40 * 60 * 1000).toISOString()
      }])
      : { code: 204, body: "" }
  });
  clock.context.eveningSyncTick_();
  assert.equal(clock.calls.length, 2);
  const post = clock.calls[1];
  assert.equal(post.request.method, "post");
  assert.match(post.url, /\/repos\/kai-ltx\/kungfu-pandas-analytics\/actions\/workflows\/test-api.yml\/dispatches$/);
  assert.equal(post.request.payload, JSON.stringify({ ref: "main" }));
  assert.equal(post.request.headers.Authorization, "Bearer " + TOKEN);
  assert.ok(!post.url.includes(TOKEN));
  assert.ok(!clock.logs.join("\n").includes(TOKEN));
  assert.match(clock.logs.join("\n"), /dispatched/);
});

test("a rejected token is not used to dispatch", () => {
  const clock = load({
    hour: 22,
    properties: { GH_DISPATCH_TOKEN: TOKEN },
    fetch: () => ({ code: 401, body: JSON.stringify({ message: "Bad credentials " + TOKEN }) })
  });
  clock.context.eveningSyncTick_();
  assert.equal(clock.calls.length, 1);
  assert.match(clock.logs.join("\n"), /HTTP 401/);
  assert.ok(!clock.logs.join("\n").includes(TOKEN));
});

test("installing the trigger replaces an existing one and runs every 30 minutes", () => {
  const clock = load({ hour: 22, triggers: ["eveningSyncTick_", "somethingElse_"] });
  clock.context.installSyncClock();
  assert.deepEqual(clock.created, [{ name: "eveningSyncTick_", minutes: 30 }]);
  assert.deepEqual(clock.triggers.map(t => t.getHandlerFunction()), ["somethingElse_"]);
});
