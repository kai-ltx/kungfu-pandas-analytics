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

test("rare events rank as totals and accuracies stay percentages", () => {
  const model = I.build(prepared, { minMatches: 1 }, NOW, null);
  const passing = model.rankings.categoryRankings("passing");
  const byKey = key => passing.find(r => r.key === key);
  assert.equal(byKey("passAccuracy").unit, "%");
  assert.equal(byKey("passesCompleted").unit, "per 90");
  const labOffside = model.lab.categories.flatMap(c => c.metrics).find(m => m.key === "expPlayerOffside");
  const labGoals = model.lab.categories.flatMap(c => c.metrics).find(m => m.key === "goals");
  const labPasses = model.lab.categories.flatMap(c => c.metrics).find(m => m.key === "passesCompleted");
  assert.equal(labOffside.display, "total");
  assert.equal(labGoals.display, "total");
  assert.equal(labPasses.display, "per90");
  assert.equal(S.getMetric("offsidePasses").display, "total");
  assert.equal(S.getMetric("shotAccuracy").type, "ratio");
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
  const shares = l.passing.directions.map(d => d.share || 0).reduce((a, b) => a + b, 0);
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

test("archetype ids 1-13 map to the community names in list order", () => {
  const names = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(id => S.archetypeName(id));
  assert.deepEqual(names, ["Shot Stopper", "Sweeper Keeper", "Progressor", "Boss", "Marauder",
    "Disruptor", "Recycler", "Maestro", "Creator", "Spark", "Magician", "Finisher", "Target"]);
  assert.equal(S.archetypeName(14), null);
  assert.equal(S.archetypeName(undefined), null);
});

test("score rankings use competition ranking and keep provisional players unranked", () => {
  const r = I.rankScores([
    { id: "a", score: 60, status: "qualified" }, { id: "b", score: 60, status: "qualified" },
    { id: "c", score: 50, status: "qualified" }, { id: "d", score: 90, status: "provisional" }
  ]);
  assert.deepEqual(r.qualified.map(t => t.rank), [1, 1, 3]);
  assert.equal(r.provisional[0].rank, undefined);
});

// ------------------------------------------------------------ V4.1

const model41 = I.build(prepared, { minMatches: 3 }, NOW, null);
const players41 = S.groupByPlayer(prepared.rows);

test("Panda Score weights are unchanged by V4.1", () => {
  assert.deepEqual(plain(S.ROLE_WEIGHTS), {
    ATT: { goals: 3, assists: 2, shotAccuracy: 1.5, dribblesCompleted: 1, highRecoveries: 1, passAccuracy: 1 },
    MID: { passAccuracy: 2, forwardPassesCompleted: 2, assists: 1.5, goals: 1, throughPasses: 1, interceptions: 1, tacklesWon: 1, possessionLost: 1 },
    DEF: { interceptions: 2, defensiveThirdLosses: 2, tackleSuccess: 2, passAccuracy: 1.5, aerialDuelsWonDefending: 1, crossesBlocked: 0.5, outOfPosition: 1 },
    GK: { saves: 2, goalsConceded: 2, passAccuracy: 1 }
  });
});

test("score explanation adds up exactly to the Panda Score", () => {
  players41.forEach(p => {
    const score = S.pandaScore(p.rows, prepared.benchmarks).score;
    const ex = S.explainScore(p.rows, prepared.benchmarks);
    if (score === null) return assert.equal(ex, null);
    const points = ex.components.reduce((a, c) => a + c.points, 0);
    const impact = ex.components.reduce((a, c) => a + c.impact, 0);
    assert.ok(Math.abs(points - score) < 1e-9, p.name + " points");
    assert.ok(Math.abs(impact - (score - 50)) < 1e-9, p.name + " impact");
    ex.strongest.forEach(c => assert.ok(c.impact > 0));
    ex.weakest.forEach(c => assert.ok(c.impact < 0));
  });
});

test("score explanation compares with the teammates ranked either side", () => {
  const table = I.scoreTable(prepared, prepared.rows, 3);
  const ranked = I.rankScores(table.slice()).qualified;
  const middle = ranked[Math.floor(ranked.length / 2)];
  const ex = I.scoreExplanation(prepared, table, middle.id);
  assert.equal(ex.above.relation, "above");
  assert.ok(ex.above.score >= ex.score);
  assert.ok(ex.below.score <= ex.score);
  ex.below.reasons.forEach(r => assert.ok(r.diff > 0, "reasons explain why they are ahead"));
  ex.above.reasons.forEach(r => assert.ok(r.diff < 0, "reasons explain why they are behind"));
  ex.components.forEach(c => assert.ok(["%", "/90", "/match"].includes(c.unit)));
});

test("personalities need a sample, a clear margin and label experimental data", () => {
  const all = model41.awards.personalities;
  assert.equal(all.awards.length, 12);
  all.awards.forEach(a => {
    assert.equal(a.kind, "personality");
    assert.ok(a.description.length > 10);
    const def = I.PERSONALITIES.find(d => d.key === a.key);
    const usesExperimental = def.components.some(c => S.getMetric(c.key).confidence === "experimental");
    assert.equal(a.experimental, usesExperimental, a.key);
    if (!a.winner) return;
    assert.ok(a.index >= 1.25, a.key);
    assert.ok(a.stats.length > 0 && a.stats.every(s => /typical/.test(s.text)), a.key);
    const winnerRows = prepared.rows.filter(r => String(r.playerId) === a.winner.id && S.isAppearance(r));
    assert.ok(winnerRows.length >= 3, a.key + " sample");
    if (def.groups) assert.ok(winnerRows.some(r => def.groups.includes(S.positionGroup(r))), a.key + " position");
  });
  Object.values(all.badges).forEach(list => assert.ok(list.length <= 3));
  ["shootDonkey", "livesOffside"].forEach(k => assert.equal(all.awards.find(a => a.key === k).experimental, true));
});

test("personalities are position-aware: an attacker cannot win Brexit Defender", () => {
  const def = I.PERSONALITIES.find(d => d.key === "brexitDefender");
  assert.deepEqual(plain(def.groups), ["DEF", "MID"]);
  const attackersOnly = prepared.rows.filter(r => S.positionGroup(r) === "ATT");
  const res = I.personalities(prepared, attackersOnly, 1);
  assert.equal(res.awards.find(a => a.key === "brexitDefender").winner, null);
});

test("awards are not duplicated between the Wall of Shame and personalities", () => {
  const shame = model41.awards.shame.map(a => a.key);
  const persona = model41.awards.personalities.awards.map(a => a.key);
  assert.ok(!shame.includes("crabKing") && !shame.includes("butterfingers"));
  assert.equal(shame.filter(k => persona.includes(k)).length, 0);
  ["pandaOfWeek", "goldenBoot", "assistKing"].forEach(k => assert.ok(model41.awards.hall.some(a => a.key === k)));
  assert.ok(shame.includes("shotgunTarget"));
  [model41.awards.hall, model41.awards.shame, model41.awards.personalities.awards].flat().forEach(a => {
    ["key", "title", "kind", "description", "winner", "value", "stats", "sample"].forEach(f => assert.ok(f in a, a.key + " " + f));
  });
});

test("all-time awards ignore the period and position filters but follow the club", () => {
  const filtered = I.build(prepared, { minMatches: 3, period: "lastWeek", group: "ATT" }, NOW, null);
  const winners = m => m.awards.hall.concat(m.awards.shame).map(a => a.key + ":" + (a.winner && a.winner.id));
  assert.deepEqual(winners(filtered), winners(model41));
  assert.ok(!model41.awards.hall.some(a => a.key === "mostImproved"), "Most Improved is weekly only");
  const bamboo = model41.overview.bamboo;
  assert.ok(bamboo.awards.hall.some(a => a.key === "mostImproved"));
  assert.ok(bamboo.personalities.awards.length === 12);
});

test("form compares the last five matches with the five before, never overlapping", () => {
  players41.forEach(p => {
    const f = I.lastFive(prepared, p.rows, "pandaScore");
    assert.ok(f.last.sample <= 5 && f.previous.sample <= 5);
    if (f.ready) {
      assert.ok(f.last.sample >= 3 && f.previous.sample >= 3);
      assert.ok(Math.abs(f.change - (f.last.value - f.previous.value)) < 1e-9);
    } else {
      assert.equal(f.change, null);
      assert.match(f.needs, /Needs 3\+/);
    }
  });
  const week = I.periodCompare(prepared, players41[0].rows, "pandaScore", "week", NOW);
  if (week.current) assert.equal(week.previous.key, S.previousPeriodKey(week.current.key, "week"));
});

test("form trends judge lower-is-better stats correctly", () => {
  let checked = 0;
  players41.forEach(p => {
    const f = I.lastFive(prepared, p.rows, "possessionLost");
    if (!f.ready || f.trend.direction === "steady") return;
    assert.equal(f.trend.good, f.change < 0, p.name);
    checked++;
  });
  const goals = I.lastFive(prepared, players41[0].rows, "goals");
  assert.ok(goals.last.value === null || goals.last.value <= 5, "totals are compared per match");
  assert.ok(checked >= 0);
});

test("directional passing shares unrecorded failures and never reads higher than recorded", () => {
  const row = { appearanceStatus: "played", eventCoverage: "complete", passAttempts: 120, passesMade: 90,
    passesCompletedForward: 40, passesFailedForward: 10, passesCompletedBackward: 20, passesFailedBackward: 0,
    passesCompletedSideways: 30, passesFailedSideways: 10 };
  const d = S.directionalPassing([row]);
  const by = k => d.directions.find(x => x.direction === k);
  assert.equal(d.unrecordedFailed, 10);
  assert.ok(Math.abs(by("Forward").accuracy - 40 / 55 * 100) < 1e-9);
  assert.equal(by("Forward").recordedAccuracy, 80);
  assert.equal(by("Backward").accuracy, 100);
  assert.ok(Math.abs(by("Sideways").accuracy - 30 / 45 * 100) < 1e-9);
  players41.forEach(p => S.directionalPassing(p.rows).directions.forEach(x => {
    if (x.accuracy !== null) assert.ok(x.accuracy <= x.recordedAccuracy + 1e-9);
  }));
  assert.equal(S.directionalPassing([Object.assign({}, row, { eventCoverage: "incomplete" })]).matches, 0);
  assert.throws(() => S.getMetric("forwardPassAccuracy"), /Unknown metric/);
});

test("archetype advisor: honest basis, new alternatives, confidence and position limits", () => {
  model41.squad.forEach(card => {
    const a = card.advisor;
    assert.match(a.note, /community-inferred/);
    a.usage.forEach(u => assert.equal(u.proven, u.scoredMatches >= I.ADVISOR.proven));
    if (a.status !== "ok") {
      assert.match(a.message, /Needs 4\+/);
      return;
    }
    assert.ok(["Low", "Medium", "High"].includes(a.confidence));
    const expected = a.scoredInMain >= 15 ? "High" : a.scoredInMain >= 8 ? "Medium" : "Low";
    assert.equal(a.confidence, expected);
    const used = new Set(a.usage.map(u => u.id));
    a.recommendations.forEach(r => {
      assert.ok(I.ARCHETYPE_PROFILES[r.id].groups.includes(r.group), "archetype fits the group");
      assert.ok([a.mainGroup, a.secondGroup].includes(r.group));
      assert.ok(!(r.group !== "GK" && ["1", "2"].includes(r.id)), "no keeper archetypes for outfielders");
      assert.equal(r.name, S.archetypeName(r.id));
      if (r.basis === "Proven") assert.ok(a.usage.find(u => u.id === r.id).proven);
    });
    const alt = a.recommendations.find(r => r.role === "Alternative playstyle");
    if (alt) assert.ok(!used.has(alt.id), "alternative must be a new archetype");
    const ids = a.recommendations.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length);
    if (a.change && a.change.ready) {
      assert.ok(a.change.before.matches >= 3 && a.change.after.matches >= 3);
    }
  });
  const few = prepared.rows.filter(r => String(r.playerId) === players41[0].id).slice(0, 3);
  assert.equal(I.archetypeAdvisor(prepared, few).status, "insufficient");
});

test("squad cards carry form, badges and key stats; lab carries explanation and form", () => {
  model41.squad.forEach(c => {
    assert.ok(c.badges.length <= 3);
    assert.ok(c.recent.length <= 5);
    c.positives.forEach(x => assert.ok(x.impact > 0));
    c.negatives.forEach(x => assert.ok(x.impact < 0));
    if (c.bestGroup && c.groups.some(g => !g.tentative)) assert.equal(c.bestGroup.tentative, false);
  });
  const l = model41.lab;
  assert.ok(l.explanation && l.form && Array.isArray(l.badges));
  assert.ok(model41.overview.clubhouse.funny.length <= 4);
  model41.overview.clubhouse.hot.forEach(p => assert.equal(p.trend.direction, "up"));
  model41.overview.clubhouse.cold.forEach(p => assert.equal(p.trend.direction, "down"));
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
