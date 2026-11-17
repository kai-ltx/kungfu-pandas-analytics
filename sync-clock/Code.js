// PandaMetrics sync clock.
//
// This project has no web app and no spreadsheet. A time trigger calls
// eveningSyncTick_ every 30 minutes. During 17:00–02:59 Europe/London it
// asks GitHub to run the sync workflow, which starts immediately.
// GitHub's own schedule does not: it delays runs for hours and drops some
// (https://docs.github.com/en/actions/how-tos/troubleshoot-workflows).
//
// The GitHub token is a fine-grained personal access token with Actions
// read and write on kai-ltx/kungfu-pandas-analytics only. It lives in the
// script property GH_DISPATCH_TOKEN and is never written into source
// (CWE-798). Do not paste it into chat or the sheet.

var SYNC_REPO_ = "kai-ltx/kungfu-pandas-analytics";
var SYNC_WORKFLOW_ = "test-api.yml";
var SYNC_TOKEN_PROPERTY_ = "GH_DISPATCH_TOKEN";
var SYNC_MIN_GAP_MS_ = 20 * 60 * 1000;

function londonHour_(date) {
  return Number(Utilities.formatDate(date || new Date(), "Europe/London", "H"));
}

function inPlayingWindow_(hour) {
  return hour >= 17 || hour <= 2;
}

function github_(token, method, path, payload) {
  var options = {
    method: method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pandametrics-sync-clock"
    },
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch("https://api.github.com" + path, options);
  return { code: response.getResponseCode(), body: response.getContentText() };
}

function githubMessage_(body, token) {
  var message = "";
  try {
    message = String(JSON.parse(body).message || "");
  } catch (error) {
    message = "";
  }
  if (token) message = message.split(token).join("[redacted]");
  return message.slice(0, 200);
}

function dispatchBlockedBy_(runs, nowMs) {
  var list = (runs && runs.workflow_runs) || [];
  var active = list.some(function (run) {
    return run.status === "in_progress" || run.status === "queued" ||
      run.status === "pending" || run.status === "waiting";
  });
  if (active) return "a sync is already running";
  var latest = list[0];
  if (!latest || latest.status !== "completed" || latest.conclusion !== "success") return "";
  var started = Date.parse(latest.created_at);
  if (!isFinite(started) || nowMs - started >= SYNC_MIN_GAP_MS_) return "";
  return "synced " + Math.round((nowMs - started) / 60000) + " min ago";
}

function eveningSyncTick_() {
  var hour = londonHour_(new Date());
  if (!inPlayingWindow_(hour)) {
    console.log("Sync clock: outside playing hours (" + hour + ")");
    return;
  }
  var token = PropertiesService.getScriptProperties().getProperty(SYNC_TOKEN_PROPERTY_);
  if (!token) {
    console.error("Sync clock: GH_DISPATCH_TOKEN script property is not set");
    return;
  }
  var listed = github_(token, "get",
    "/repos/" + SYNC_REPO_ + "/actions/workflows/" + SYNC_WORKFLOW_ + "/runs?per_page=5");
  if (listed.code === 401) {
    console.error("Sync clock: GitHub rejected the token (HTTP 401)");
    return;
  }
  if (listed.code === 200) {
    var runs;
    try {
      runs = JSON.parse(listed.body);
    } catch (error) {
      console.error("Sync clock: run list was not JSON");
      return;
    }
    var reason = dispatchBlockedBy_(runs, Date.now());
    if (reason) {
      console.log("Sync clock: skipped, " + reason);
      return;
    }
  } else {
    console.error("Sync clock: could not list runs (HTTP " + listed.code +
      ") " + githubMessage_(listed.body, token));
  }
  var sent = github_(token, "post",
    "/repos/" + SYNC_REPO_ + "/actions/workflows/" + SYNC_WORKFLOW_ + "/dispatches",
    { ref: "main" });
  if (sent.code === 204) console.log("Sync clock: dispatched");
  else console.error("Sync clock: dispatch failed (HTTP " + sent.code + ") " + githubMessage_(sent.body, token));
}

// Shown in the editor's Run menu so the owner can authorise the clock once.
// This project has no web app, so the dashboard cannot call it.
function installSyncClock() {
  installEveningSyncTrigger_();
  eveningSyncTick_();
}

function installEveningSyncTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "eveningSyncTick_") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("eveningSyncTick_").timeBased().everyMinutes(30).create();
}
