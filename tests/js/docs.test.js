"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { render, OUT } = require("../../tools/build_data_dictionary");

test("data dictionary is generated from the current registry", () => {
  assert.equal(fs.readFileSync(OUT, "utf8"), render(),
    "docs/pandametrics-data-dictionary.md is stale; run node tools/build_data_dictionary.js");
});
