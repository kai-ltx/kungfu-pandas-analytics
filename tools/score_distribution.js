#!/usr/bin/env node
// Anonymised Panda Score distribution for docs/pandametrics-score-review.md.
// Input: normalised appearances (default samples/real_appearances.json, local
// and gitignored). Output: markdown with players labelled by rank only.
//
// Usage: node tools/score_distribution.js [appearances.json]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script", "Stats.js"), "utf8"), ctx);
const S = ctx.PandaStats;

const file = process.argv[2] || path.join(ROOT, "samples", "real_appearances.json");
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const rows = S.dedupeAppearances(Array.isArray(raw) ? raw : raw.players || raw.appearances).rows
  .filter(r => !r.matchType || r.matchType === "leagueMatch" || r.matchType === "playoffMatch");
const bench = S.buildBenchmarks(rows);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summary(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length || 1));
  return { n: s.length, min: s[0], p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75), max: s[s.length - 1], mean, sd };
}

function rankArray(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}

function spearman(a, b) {
  const ra = rankArray(a);
  const rb = rankArray(b);
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length;
  const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

const f = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));
const out = [];

// Appearance level.
const appearances = rows.filter(S.isAppearance);
const scored = appearances.map(r => ({ row: r, s: S.scoreAppearance(r, bench) })).filter(x => x.s);
out.push(`Source: ${appearances.length} appearances (${rows.length - appearances.length} zero-minute entries excluded), ${new Set(rows.map(r => r.playerId)).size} players.\n`);
out.push("| Group | Appearances | Scored | Unscored (<60% weight) | Min | P25 | Median | P75 | Max | Mean | SD | Mean weight coverage |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
["ATT", "MID", "DEF", "GK"].forEach(g => {
  const list = scored.filter(x => x.s.group === g);
  const ok = list.filter(x => x.s.score !== null);
  if (!list.length) {
    out.push(`| ${g} | 0 | — | — | — | — | — | — | — | — | — | — |`);
    return;
  }
  const st = summary(ok.map(x => x.s.score));
  const cov = list.reduce((a, x) => a + x.s.coverage, 0) / list.length;
  out.push(`| ${g} | ${list.length} | ${ok.length} | ${list.length - ok.length} | ${f(st.min)} | ${f(st.p25)} | ${f(st.median)} | ${f(st.p75)} | ${f(st.max)} | ${f(st.mean)} | ${f(st.sd)} | ${f(cov * 100, 0)}% |`);
});

// Component availability.
out.push("\nComponent availability (share of the group's appearances where the component had data):\n");
out.push("| Group | Component | Weight | Available | Benchmark sample | Fallback to all groups |");
out.push("|---|---|---|---|---|---|");
Object.entries(S.ROLE_WEIGHTS).forEach(([g, weights]) => {
  const list = scored.filter(x => x.s.group === g);
  Object.entries(weights).forEach(([k, w]) => {
    const avail = list.filter(x => x.s.contributions[k]).length;
    const b = bench[g].metrics[k];
    out.push(`| ${g} | ${S.getMetric(k).label} | ${w} | ${list.length ? avail + "/" + list.length : "—"} | ${b.sample} | ${b.fallback ? "yes" : "no"} |`);
  });
});

// Agreement with EA rating (reference only, not an input).
const paired = scored.filter(x => x.s.score !== null && S.toNumber(x.row.rating) !== null);
if (paired.length > 5) {
  const rho = spearman(paired.map(x => x.s.score), paired.map(x => S.toNumber(x.row.rating)));
  out.push(`\nSpearman correlation between appearance Panda Score and EA match rating (reference only, not an input): ${f(rho, 2)} over ${paired.length} appearances.`);
}

// Player level, anonymised by rank.
const players = S.groupByPlayer(rows).map(p => Object.assign({ appearances: p.rows.filter(S.isAppearance).length }, S.pandaScore(p.rows, bench, { minMatches: 3 })))
  .filter(p => p.score !== null)
  .sort((a, b) => b.score - a.score);
out.push("\nPlayer scores (anonymised by rank, qualification = 3+ scored matches):\n");
out.push("| Player | Score | Status | Scored / played | By group (score, matches) |");
out.push("|---|---|---|---|---|");
players.forEach((p, i) => {
  const groups = Object.entries(p.byGroup).sort((a, b) => b[1].appearances - a[1].appearances)
    .map(([g, v]) => `${g} ${f(v.score, 0)} (${v.appearances})`).join(", ");
  out.push(`| Player ${String.fromCharCode(65 + i)} | ${f(p.score)} | ${p.status} | ${p.scoredAppearances} / ${p.appearances} | ${groups} |`);
});
const ps = summary(players.map(p => p.score));
out.push(`\nPlayer score spread: min ${f(ps.min)}, median ${f(ps.median)}, max ${f(ps.max)}, SD ${f(ps.sd)}.`);

console.log(out.join("\n"));
