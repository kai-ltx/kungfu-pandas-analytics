#!/usr/bin/env node
// Local dashboard preview with sanitised fixture data and a stubbed
// google.script.run. Writes preview/index.html (gitignored); no network calls.
//
// Usage: node tools/preview.js && python3 -m http.server -d preview 8765

const fs = require("fs");
const path = require("path");
const { render } = require("./build_client");

const ROOT = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "appearances.json"), "utf8"));

const data = {
  ok: true,
  generatedAt: new Date().toISOString(),
  clubs: { "454058": "KungFu Pandas", "451080": "Bamboo Shoots", "413965": "Torquay" },
  matches: fixture.matches,
  appearances: fixture.players.map(({ rawEvents, ...r }) => r),
  sync: { lastSync: new Date().toISOString(), recent: [] }
};

const stub = `<script>
window.google = { script: { run: (function () {
  const runner = { _ok: null, _fail: null,
    withSuccessHandler(f) { this._ok = f; return this; },
    withFailureHandler(f) { this._fail = f; return this; },
    getDashboardData() { const ok = this._ok; setTimeout(() => ok(${JSON.stringify(data).replace(/</g, "\\u003c")}), 50); }
  };
  return runner;
})() } };
</script>`;

const index = fs.readFileSync(path.join(ROOT, "apps-script", "Index.html"), "utf8")
  .replace('<?!= include_("ClientLib") ?>', stub + "\n" + render());

fs.mkdirSync(path.join(ROOT, "preview"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "preview", "index.html"), index);
console.log("Wrote preview/index.html");
