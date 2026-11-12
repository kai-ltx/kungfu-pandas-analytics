"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadInsights, loadFixture } = require("./load");

const { S, I } = loadInsights();
const fixture = loadFixture();
const NOW = new Date("2026-11-12T12:00:00Z");
const CLUBS = { "454058": "KungFu Pandas", "451080": "Bamboo Shoots", "413965": "Torquay" };

function data(overrides) {
  return Object.assign({ ok: true, clubs: CLUBS, matches: fixture.matches, appearances: fixture.players, sync: null }, overrides);
}

const prepared = I.prepare(data());
const plain = v => JSON.parse(JSON.stringify(v));

test("display categories never repeat a metric and only use registered metrics", () => {
  const all = I.DISPLAY_CATEGORIES.flatMap(c => c.metrics);
  assert.equal(new Set(all).size, all.length, "metric shown in two categories");
  all.forEach(k => assert.ok(S.getMetric(k), k));
  // Redundant pairs removed: a count and its own success share are not both shown
  // unless they answer different questions (volume vs accuracy).
  ["dribbleSuccess", "possessionBalance", "passesAttempted"].forEach(k => assert.ok(!all.includes(k), k));
});

test("prepare drops duplicates and non-official matches", () => {
  const dup = fixture.players.slice(0, 5);
  const friendly = Object.assign({}, fixture.players[0], { matchId: "999", matchType: "friendlyMatch" });
  const p = I.prepare(data({ appearances: fixture.players.concat(dup, [friendly]) }));
  assert.equal(p.rows.length, fixture.players.length);
  assert.equal(p.duplicatesDropped, 5);
  assert.ok(p.rows.every(r => r.matchType === "leagueMatch" || r.matchType === "playoffMatch"));
});

test("coverage excludes zero-minute entries and counts event coverage", () => {
  const c = I.coverage(prepared.rows);
  assert.equal(c.rows, fixture.players.length);
  assert.equal(c.didNotPlay, 3);
  assert.equal(c.appearances, c.rows - 3);
  assert.equal(c.withEvents + c.eventsUnavailable, c.appearances);
  assert.equal(c.eventsUnavailable, 3);
  assert.ok(!("GK" in c.groups) || c.groups.GK > 0);
});

test("match-type filter: playoffs only returns playoff rows", () => {
  const playoffData = data({
    matches: fixture.matches.concat([Object.assign({}, fixture.matches[0], { matchId: "p1", matchType: "playoffMatch" })]),
    appearances: fixture.players.concat([Object.assign({}, fixture.players[0], { matchId: "p1", matchType: "playoffMatch" })])
  });
  const p = I.prepare(playoffData);
  const model = I.build(p, { matchType: "playoff", minMatches: 1 }, NOW, null);
  const playoffMatches = playoffData.matches.filter(m => m.matchType === "playoffMatch").length;
  const playoffRows = playoffData.appearances.filter(r => r.matchType === "playoffMatch").length;
  assert.ok(playoffMatches > 1, "fixture includes real playoff matches");
  assert.equal(model.overview.matches, playoffMatches);
  assert.equal(model.overview.coverage.rows, playoffRows);
  assert.ok(model.rankings.categoryRankings("passing")[0].ranking.ranked
    .concat(model.rankings.categoryRankings("passing")[0].ranking.provisional)
    .every(e => e.aggregate.appearances <= playoffRows));
});

test("build works for every filter combination and with no data", () => {
  I.PERIODS.forEach(period => I.MATCH_TYPES.forEach(type => ["all", "ATT", "MID", "DEF"].forEach(group => {
    const model = I.build(prepared, { period: period.key, matchType: type.key, group }, NOW, null);
    assert.ok(model.overview && model.rankings && model.evolution && model.awards);
    model.rankings.categories.forEach(c => model.rankings.categoryRankings(c.key));
  })));
  const empty = I.build(I.prepare({ ok: true, clubs: CLUBS, matches: [], appearances: [] }), {}, NOW, null);
  assert.equal(empty.lab, null);
  assert.equal(empty.overview.bamboo.week, null);
  assert.equal(empty.awards.hall.find(a => a.key === "pandaOfWeek").winner, null);
});

test("awards: Panda of the Period is the top score, Shotgun Target the lowest eligible score", () => {
  const model = I.build(prepared, { minMatches: 3 }, NOW, null);
  const qualified = model.rankings.scores.qualified;
  assert.ok(qualified.length >= 2);
  const top = model.awards.hall.find(a => a.key === "pandaOfWeek");
  const shotgun = model.awards.shame.find(a => a.key === "shotgunTarget");
  assert.equal(top.winner.id, qualified[0].id);
  assert.equal(shotgun.winner.id, qualified[qualified.length - 1].id);
  assert.equal(shotgun.shame, true);
  assert.ok(shotgun.advice.length > 0);
  assert.equal(model.awards.eligible, qualified.length);
});

test("awards only go to eligible players and shame needs a real excess", () => {
  const model = I.build(prepared, { minMatches: 3 }, NOW, null);
  const eligibleIds = new Set(model.rankings.scores.qualified.map(t => t.id));
  model.awards.hall.concat(model.awards.shame).forEach(a => {
    if (a.winner) assert.ok(eligibleIds.has(a.winner.id), a.key);
    if (["crabKing", "butterfingers", "tunnelVision", "lostPanda", "offsideOutlet"].includes(a.key) && a.winner) {
      assert.match(a.value, /^\+/);
    }
  });
});

test("no eligible players means no Shotgun Target", () => {
  const model = I.build(prepared, { minMatches: 1000 }, NOW, null);
  assert.equal(model.awards.shame.find(a => a.key === "shotgunTarget").winner, null);
  assert.equal(model.awards.eligible, 0);
});

test("Weekly Bamboo uses the last complete Monday-Sunday week with matches", () => {
  const b = I.weeklyBamboo(prepared, I.DEFAULT_STATE, NOW);
  assert.ok(b.week);
  assert.ok(b.week < S.periodKey(NOW, "week"), "current week is never complete");
  assert.ok(S.isPeriodComplete(b.week, "week", NOW));
  assert.equal(b.minMatches, 2);
  const bounds = S.periodBounds(b.week, "week");
  const inWeek = prepared.matches.filter(m => {
    const d = S.parseTimestamp(m);
    return d >= bounds.start && d < bounds.end;
  });
  assert.equal(b.matches, inWeek.length);
  assert.equal(b.record.wins + b.record.draws + b.record.losses, b.matches);
  assert.equal(new Date(b.start).getUTCDay() === 0 || new Date(b.start).getUTCDay() === 1, true, "starts at London Monday midnight");
});

test("evolution: sorted periods, in-progress flag and percentage points for ratios", () => {
  const e = I.evolution(prepared, prepared.rows, Object.assign({}, I.DEFAULT_STATE, { evolutionMetric: "passAccuracy" }), NOW);
  assert.deepEqual(plain(e.keys), plain(e.keys).slice().sort());
  e.series.forEach(s => assert.equal(s.points.length, e.keys.length));
  assert.equal(e.complete.length, e.keys.length);
  if (e.keys.includes(S.periodKey(NOW, "week"))) assert.equal(e.complete[e.keys.length - 1], false);
  e.improvers.concat(e.decliners).forEach(m => assert.equal(m.unit, "pp"));
  e.improvers.forEach(m => assert.ok(m.change > 0));
  e.decliners.forEach(m => assert.ok(m.change < 0));
  e.improvers.concat(e.decliners).forEach(m => {
    assert.ok(S.isPeriodComplete(m.to, "week", NOW), "movers use completed periods");
    assert.ok(m.samples.every(n => n >= 3), "movers need 3+ matches per period");
  });
  for (let i = 1; i < e.keys.length; i++) {
    assert.equal(S.previousPeriodKey(e.keys[i], "week"), e.keys[i - 1], "weeks are contiguous");
  }

  const monthly = I.evolution(prepared, prepared.rows, Object.assign({}, I.DEFAULT_STATE, { evolutionPeriod: "month" }), NOW);
  monthly.keys.forEach(k => assert.match(k, /^\d{4}-\d{2}$/));
  monthly.squad.forEach(p => assert.ok(p.value === null || (p.value >= 0 && p.value <= 100)));
});

test("coaching tips target the player's own weaknesses with evidence", () => {
  let checked = 0;
  S.groupByPlayer(prepared.rows).forEach(p => {
    const l = I.lab(prepared, prepared.rows, p.id, I.DEFAULT_STATE);
    const weak = new Set(l.score.weaknesses.map(w => w.key));
    assert.ok(l.tips.length <= 3);
    l.tips.forEach(t => {
      assert.ok(weak.has(t.metric), t.metric);
      assert.ok(I.TIPS[t.metric]);
      assert.match(t.evidence, /vs a typical/);
      checked++;
    });
  });
  assert.ok(checked > 0, "fixture should produce at least one tip");
});

test("lab lists every supported stat once and keeps experimental events separate", () => {
  const keys = I.LAB_CATEGORIES.flatMap(c => c.metrics);
  assert.equal(new Set(keys).size, keys.length);
  keys.forEach(k => assert.ok(S.getMetric(k), k));
  const experimental = I.LAB_CATEGORIES.find(c => c.key === "experimental");
  experimental.metrics.forEach(k => assert.equal(S.getMetric(k).confidence, "experimental", k));
  I.DISPLAY_CATEGORIES.flatMap(c => c.metrics).forEach(k => {
    assert.notEqual(S.getMetric(k).confidence, "experimental", k + " is on a rankings board");
  });
  const first = S.groupByPlayer(prepared.rows)[0];
  const l = I.lab(prepared, prepared.rows, first.id, I.DEFAULT_STATE);
  const shown = l.categories.flatMap(c => c.metrics.map(m => m.key));
  assert.deepEqual(shown, keys);
  assert.match(l.categories.find(c => c.key === "experimental").note, /not fully verified/);
  assert.ok(!("rawEvents" in prepared.rows[0]));
});

test("added awards keep goal and assist totals and stay position-aware", () => {
  const model = I.build(prepared, { minMatches: 3 }, NOW, null);
  const byKey = key => model.awards.hall.concat(model.awards.shame).find(a => a.key === key);
  assert.match(byKey("goldenBoot").description, /Most goals/);
  assert.match(byKey("assistKing").description, /Most assists/);
  assert.match(byKey("crossMaster").description, /attacker or midfielder/);
  assert.match(byKey("aerialAce").description, /position played/);
  assert.match(byKey("clearestHead").description, /same positions/);
  const offside = byKey("offsideOutlet");
  assert.equal(offside.shame, true);
  assert.match(offside.description, /same positions/);
  if (offside.winner) assert.match(offside.value, /^\+/);
  if (byKey("clearestHead").winner) assert.match(byKey("clearestHead").value, /^\+/);
});

test("Panda Lab passing DNA shares add up and categories carry coverage", () => {
  const first = S.groupByPlayer(prepared.rows)[0];
  const l = I.lab(prepared, prepared.rows, first.id, I.DEFAULT_STATE);
  const shares = l.passingDna.map(d => d.share || 0).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(shares - 100) < 1e-6 || shares === 0);
  assert.equal(l.categories.length, I.LAB_CATEGORIES.length);
  l.categories.forEach(c => c.metrics.forEach(m => assert.ok(m.coverage.withData <= m.coverage.appearances)));
});

test("squad cards flag tentative position groups and expose no EA ids", () => {
  const cards = I.squad(prepared, prepared.rows, I.DEFAULT_STATE);
  assert.ok(cards.length > 0);
  cards.forEach(c => c.groups.forEach(g => assert.equal(g.tentative, g.appearances < 5)));
  const scores = cards.map(c => c.score).filter(s => s !== null);
  assert.deepEqual(plain(scores), plain(scores).slice().sort((a, b) => b - a));
});

test("score rankings use competition ranking and keep provisional players unranked", () => {
  const r = I.rankScores([
    { id: "a", score: 60, status: "qualified" }, { id: "b", score: 60, status: "qualified" },
    { id: "c", score: 50, status: "qualified" }, { id: "d", score: 90, status: "provisional" }
  ]);
  assert.deepEqual(r.qualified.map(t => t.rank), [1, 1, 3]);
  assert.equal(r.provisional[0].rank, undefined);
});

// --------------------------------------------------------- client bundle

test("ClientLib.html is generated from the current sources", () => {
  const { render, OUT } = require("../../tools/build_client.js");
  assert.equal(fs.readFileSync(OUT, "utf8"), render(), "run: node tools/build_client.js");
});

test("client UI avoids dangerous sinks", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "client", "App.js"), "utf8");
  ["eval(", "new Function", "document.write", "outerHTML", "insertAdjacentHTML", "javascript:"].forEach(s =>
    assert.ok(!app.includes(s), s));
  assert.match(app, /function esc\(/);
  const index = fs.readFileSync(path.join(__dirname, "..", "..", "apps-script", "Index.html"), "utf8");
  assert.ok(!/<script[^>]+src=/i.test(index), "no third-party scripts");
  assert.match(index, /include_\("ClientLib"\)/);
});
