"use strict";

// Minimal in-memory stand-ins for the Apps Script services the webhook and
// dashboard use. setValues mimics Sheets' parsing of numeric text and leading
// apostrophes so key/dedupe behaviour matches production.

function parseCell(value) {
  if (typeof value !== "string") return value;
  if (value.startsWith("'")) return value.slice(1);
  if (/^[+-]?\d+(\.\d+)?$/.test(value.trim()) && value.trim().length <= 15) return Number(value);
  return value;
}

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? "" : v);
      }
      out.push(line);
    }
    return out;
  }

  getDisplayValues() {
    return this.getValues().map(r => r.map(v => (typeof v === "boolean" ? String(v).toUpperCase() : String(v))));
  }

  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => {
      const rowIndex = this.row - 1 + r;
      this.sheet.data[rowIndex] = this.sheet.data[rowIndex] || [];
      this.sheet.data[rowIndex][this.col - 1 + c] = parseCell(v);
    }));
    this.sheet.writes++;
    return this;
  }

  setValue(v) {
    return this.setValues([[v]]);
  }

  setFontWeight() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.writes = 0;
  }

  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(row, col, rows, cols) { return new FakeRange(this, row, col, rows || 1, cols || 1); }
  getDataRange() { return new FakeRange(this, 1, 1, this.getLastRow(), this.getLastColumn()); }

  appendRow(values) {
    this.data.push(values.map(parseCell));
    this.writes++;
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = {};
  }

  getName() { return "Fake PandaMetrics"; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { return (this.sheets[name] = new FakeSheet(name)); }
}

function appsScriptGlobals(options) {
  const opts = options || {};
  const ss = opts.spreadsheet || new FakeSpreadsheet();
  const properties = Object.assign({}, opts.properties);
  const cache = new Map();
  return {
    ss,
    globals: {
      SpreadsheetApp: { openById: () => ss },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: k => (k in properties ? properties[k] : null),
          setProperty: (k, v) => { properties[k] = String(v); }
        })
      },
      CacheService: {
        getScriptCache: () => ({
          get: k => (cache.has(k) ? cache.get(k) : null),
          put: (k, v) => { cache.set(k, v); },
          remove: k => { cache.delete(k); }
        })
      },
      ContentService: {
        MimeType: { JSON: "json" },
        createTextOutput: text => ({ text, setMimeType() { return this; }, getContent() { return text; } })
      },
      Session: {
        getActiveUser: () => ({ getEmail: () => opts.activeUser || "" }),
        getEffectiveUser: () => ({ getEmail: () => opts.effectiveUser || "owner@example.com" })
      },
      HtmlService: opts.HtmlService,
      UrlFetchApp: opts.UrlFetchApp,
      Utilities: opts.Utilities
    }
  };
}

function post(context, body) {
  const response = context.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(response.getContent());
}

module.exports = { FakeSpreadsheet, appsScriptGlobals, post, parseCell };
