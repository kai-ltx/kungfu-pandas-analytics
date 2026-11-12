"use strict";

// Loads Apps Script source files into an isolated context, the way Apps Script
// concatenates them into one global scope.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APPS_SCRIPT = path.join(__dirname, "..", "..", "apps-script");

function loadAppsScript(files, globals) {
  const context = vm.createContext(Object.assign({ console }, globals || {}));
  files.forEach(file => {
    const code = fs.readFileSync(path.join(APPS_SCRIPT, file), "utf8");
    vm.runInContext(code, context, { filename: file });
  });
  return context;
}

function loadStats() {
  return loadAppsScript(["Stats.js"]).PandaStats;
}

function loadInsights() {
  const context = loadAppsScript(["Stats.js"]);
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "client", "Insights.js"), "utf8");
  vm.runInContext(code, context, { filename: "Insights.js" });
  return { S: context.PandaStats, I: context.PandaInsights, context };
}

function loadFixture() {
  const file = path.join(__dirname, "..", "fixtures", "appearances.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = { APPS_SCRIPT, loadAppsScript, loadStats, loadInsights, loadFixture };
