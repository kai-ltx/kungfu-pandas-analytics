"use strict";

// The dashboard web app runs as the owner with anonymous access, and
// google.script.run can invoke any top-level function whose name does not end
// in "_". Keep the public surface to an explicit allowlist.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { APPS_SCRIPT } = require("./load");

const PUBLIC_ALLOWLIST = new Set(["doGet", "doPost", "getDashboardData"]);

function topLevelFunctions(source) {
  const names = [];
  const re = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let match;
  while ((match = re.exec(source))) names.push(match[1]);
  return names;
}

test("only allowlisted Apps Script functions are callable from the client", () => {
  const files = fs.readdirSync(APPS_SCRIPT).filter(f => f.endsWith(".js") || f.endsWith(".gs"));
  assert.ok(files.length > 0);
  const exposed = [];
  files.forEach(file => {
    const source = fs.readFileSync(path.join(APPS_SCRIPT, file), "utf8");
    topLevelFunctions(source).forEach(name => {
      if (!name.endsWith("_") && !PUBLIC_ALLOWLIST.has(name)) exposed.push(file + ": " + name);
    });
  });
  assert.deepEqual(exposed, []);
});

test("browser-only view code is never a server file", () => {
  const files = fs.readdirSync(APPS_SCRIPT);
  assert.ok(!files.includes("Insights.js") && !files.includes("App.js"),
    "client code in apps-script/ would be loaded on every doPost and widen the callable surface");
});

test("GitHub Actions are pinned to full commit SHAs", () => {
  const dir = path.join(APPS_SCRIPT, "..", ".github", "workflows");
  fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).forEach(file => {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const uses = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map(m => m[1]);
    uses.forEach(u => assert.match(u, /@[0-9a-f]{40}$/, file + ": " + u));
  });
});

test("no secrets are embedded in Apps Script or HTML sources", () => {
  const patterns = [
    /ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/,
    /AIza[0-9A-Za-z_-]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /WEBHOOK_TOKEN\s*[:=]\s*["'][^"']+["']/
  ];
  fs.readdirSync(APPS_SCRIPT).forEach(file => {
    const source = fs.readFileSync(path.join(APPS_SCRIPT, file), "utf8");
    patterns.forEach(p => assert.ok(!p.test(source), file + " matches " + p));
  });
});
