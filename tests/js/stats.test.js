"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadStats, loadFixture } = require("./load");

const S = loadStats();
const fixture = loadFixture();

function row(overrides) {
  return Object.assign({
    clubId: "454058", matchId: "1", playerId: "p1", name: "P1",
    position: "midfielder", positionGroup: "MID", matchType: "leagueMatch",
    appearanceStatus: "played", eventCoverage: "complete", eventsAvailable: true,
    secondsPlayed: 5400, timestampUnix: 1794603600
  }, overrides);
}

// ------------------------------------------------------------- registry

test("metric registry is internally consistent", () => {
  const keys = new Set();
  const validTypes = new Set(["count", "ratio", "mean"]);
  const validConfidence = new Set(["verified", "high", "medium", "experimental"]);
  S.METRICS.forEach(m => {
    assert.ok(!keys.has(m.key), "duplicate metric " + m.key);
    keys.add(m.key);
    assert.ok(validTypes.has(m.type), m.key);
    assert.ok(validConfidence.has(m.confidence), m.key);
    assert.ok(S.CATEGORIES[m.category], m.key);
    assert.ok(m.label && m.description, m.key);
    assert.ok([true, false, null].includes(m.higherIsBetter), m.key);
    if (m.type === "ratio") {
      assert.ok(m.numerator.length && m.denominator.length, m.key);
    } else {
      assert.ok(m.fields.length, m.key);
    }
    if (m.source === "ea") assert.equal(m.confidence, "verified", m.key);
  });
});

test("every registry field exists in ingested rows", () => {
  const columns = new Set(Object.keys(fixture.players[0]));
  S.METRICS.forEach(m => {
    S.requiredFields(m).forEach(field => {
      assert.ok(columns.has(field), m.key + " needs missing column " + field);
    });
  });
});

test("role weights use only scoreable metrics without known overlaps", () => {
  Object.entries(S.ROLE_WEIGHTS).forEach(([group, weights]) => {
    assert.ok(S.GROUP_LABELS[group]);
    const keys = Object.keys(weights);
    keys.forEach(key => {
      const m = S.getMetric(key);
      assert.notEqual(m.confidence, "experimental", group + ":" + key);
      assert.notEqual(m.key, "rating", "EA rating must not drive the Panda Score");
      assert.notEqual(m.higherIsBetter, null, group + ":" + key + " is context-only");
      assert.ok(weights[key] > 0);
    });
    assert.ok(!(keys.includes("tacklesWon") && keys.includes("opponentsDispossessed")),
      group + " sums overlapping tackle counters");
    assert.ok(!(keys.includes("goals") && keys.includes("goalInvolvements")),
      group + " double-counts goals");
  });
});

test("no source field feeds two components of the same role", () => {
  Object.entries(S.ROLE_WEIGHTS).forEach(([group, weights]) => {
    const owner = {};
    Object.keys(weights).forEach(key => {
      S.requiredFields(S.getMetric(key)).forEach(field => {
        assert.ok(!owner[field], `${group}: ${field} used by ${owner[field]} and ${key}`);
        owner[field] = key;
      });
    });
  });
});

test("role weights only use high or verified confidence metrics", () => {
  Object.values(S.ROLE_WEIGHTS).forEach(weights => {
    Object.keys(weights).forEach(key => {
      assert.ok(["verified", "high"].includes(S.getMetric(key).confidence), key);
    });
  });
});

test("lower-is-better score metrics have readable strength/weakness labels", () => {
  const used = new Set(Object.values(S.ROLE_WEIGHTS).flatMap(w => Object.keys(w)));
  used.forEach(key => {
    const m = S.getMetric(key);
    if (m.higherIsBetter === false) {
      assert.notEqual(m.strengthLabel, m.label, key + " needs a strengthLabel");
      assert.notEqual(m.weaknessLabel, m.label, key + " needs a weaknessLabel");
    }
  });
});

test("formula strings describe pooled ratios", () => {
  assert.equal(S.formula(S.getMetric("passAccuracy")), "sum(passesMade) / sum(passAttempts) × 100");
  assert.equal(S.formula(S.getMetric("goals")), "sum(goals)");
});

// ------------------------------------------------------------ positions

test("position groups map EA pos values", () => {
  assert.equal(S.positionGroup({ position: "forward" }), "ATT");
  assert.equal(S.positionGroup({ position: "Midfielder" }), "MID");
  assert.equal(S.positionGroup({ position: "defender" }), "DEF");
  assert.equal(S.positionGroup({ position: "goalkeeper" }), "GK");
  assert.equal(S.positionGroup({ positionGroup: "def", position: "forward" }), "DEF");
  assert.equal(S.positionGroup({ position: "sweeper" }), null);
  assert.equal(S.positionGroup({}), null);
});

test("fixture players appear in several position groups", () => {
  const groups = {};
  fixture.players.forEach(r => {
    (groups[r.playerId] = groups[r.playerId] || new Set()).add(S.positionGroup(r));
  });
  assert.ok(Object.values(groups).some(g => g.size > 1));
});

// ------------------------------------------------------- data quality

test("did-not-play rows are not appearances (V4 and legacy rows)", () => {
  assert.equal(S.isAppearance(row({ appearanceStatus: "did_not_play" })), false);
  assert.equal(S.isAppearance({ secondsPlayed: 0 }), false);
  assert.equal(S.isAppearance({ secondsPlayed: "5400" }), true);
  assert.equal(S.isAppearance({}), true);
});

test("event coverage respected for V4 and legacy rows", () => {
  assert.equal(S.eventsUsable(row({ eventCoverage: "incomplete" })), false);
  assert.equal(S.eventsUsable({ eventsAvailable: "FALSE" }), false);
  assert.equal(S.eventsUsable({ passesCompleted: 30, passesFailed: 5, passAttempts: 36 }), true);
  assert.equal(S.eventsUsable({ passesCompleted: 16, passesFailed: 0, passAttempts: 99 }), false);
  assert.equal(S.eventsUsable({ passAttempts: 40 }), false);
});

test("dedupe keeps one appearance per club+match+player", () => {
  const rows = [row(), row(), row({ clubId: "451080" }), row({ playerId: "p2" })];
  const { rows: out, dropped } = S.dedupeAppearances(rows);
  assert.equal(out.length, 3);
  assert.equal(dropped, 1);
});

// --------------------------------------------------------- aggregation

test("ratio metrics pool numerators and denominators", () => {
  // Match A 1/1 (100%), match B 1/9 (11%): pooled 2/10 = 20%, not 55.6%.
  const rows = [
    row({ matchId: "a", goals: 1, shots: 1 }),
    row({ matchId: "b", goals: 1, shots: 9 })
  ];
  const agg = S.aggregate(rows, "conversion");
  assert.equal(agg.numerator, 2);
  assert.equal(agg.denominator, 10);
  assert.equal(agg.rate, 20);
});

test("missing event data is excluded, not treated as zero", () => {
  const rows = [
    row({ matchId: "a", interceptions: 4 }),
    row({ matchId: "b", interceptions: 2 }),
    row({ matchId: "c", interceptions: null, eventCoverage: "missing", eventsAvailable: false })
  ];
  const agg = S.aggregate(rows, "interceptions");
  assert.equal(agg.appearances, 3);
  assert.equal(agg.matchesWithData, 2);
  assert.equal(agg.missing, 1);
  assert.equal(agg.total, 6);
  assert.equal(agg.perMatch, 3);
});

test("true zeros count towards the denominator", () => {
  const rows = [row({ matchId: "a", interceptions: 4 }), row({ matchId: "b", interceptions: 0 })];
  assert.equal(S.aggregate(rows, "interceptions").perMatch, 2);
});

test("incomplete events excluded but EA named totals still used", () => {
  const r = row({ eventCoverage: "incomplete", eventsAvailable: false,
                  passesMade: 92, passAttempts: 99, interceptions: null });
  assert.equal(S.aggregate([r], "interceptions").matchesWithData, 0);
  assert.equal(S.aggregate([r], "passAccuracy").denominator, 99);
});

test("did-not-play rows do not dilute per-match rates", () => {
  const rows = [
    row({ matchId: "a", goals: 2 }),
    row({ matchId: "b", goals: 0, appearanceStatus: "did_not_play", secondsPlayed: 0 })
  ];
  const agg = S.aggregate(rows, "goals");
  assert.equal(agg.appearances, 1);
  assert.equal(agg.perMatch, 2);
});

test("per 90 uses seconds played and is null when seconds are unknown", () => {
  const rows = [row({ matchId: "a", goals: 1, secondsPlayed: 2700 }),
                row({ matchId: "b", goals: 1, secondsPlayed: 2700 })];
  assert.equal(S.aggregate(rows, "goals").per90, 2);
  const unknown = [row({ goals: 1, secondsPlayed: null })];
  assert.equal(S.aggregate(unknown, "goals").per90, null);
  assert.equal(S.aggregate(unknown, "goals").perMatch, 1);
});

test("count metrics sum multiple fields", () => {
  const r = row({ possessionWonDefensiveThird: 1, possessionWonMiddleThird: 2,
                  possessionWonAttackingThird: 3 });
  assert.equal(S.aggregate([r], "possessionWon").total, 6);
});

test("mean metric averages EA rating", () => {
  const rows = [row({ matchId: "a", rating: 7 }), row({ matchId: "b", rating: 8 })];
  assert.equal(S.aggregate(rows, "rating").mean, 7.5);
});

test("ratio with zero attempts has no rate", () => {
  const agg = S.aggregate([row({ goals: 0, shots: 0 })], "conversion");
  assert.equal(agg.rate, null);
  assert.equal(S.qualify(agg, "conversion", {}).status, "no_data");
});

// ------------------------------------------------------- qualification

test("1 goal from 1 shot is provisional, not 100% ranked", () => {
  const agg = S.aggregate([row({ goals: 1, shots: 1 })], "conversion");
  assert.equal(agg.rate, 100);
  const q = S.qualify(agg, "conversion", { minMatches: 1 });
  assert.equal(q.status, "provisional");
  assert.match(q.reasons[0], /1 of 5 attempts/);
});

test("qualification needs both matches and attempts", () => {
  const rows = Array.from({ length: 2 }, (_, i) => row({ matchId: String(i), goals: 3, shots: 10 }));
  const agg = S.aggregate(rows, "conversion");
  assert.equal(S.qualify(agg, "conversion", { minMatches: 3 }).status, "provisional");
  assert.equal(S.qualify(agg, "conversion", { minMatches: 2 }).status, "qualified");
});

// ------------------------------------------------------------- ranking

function player(id, rows) {
  return { id, name: id, rows: rows.map(r => Object.assign({ playerId: id }, r)) };
}

test("rank separates qualified and provisional players", () => {
  const players = [
    player("A", [row({ matchId: "1", goals: 1, shots: 1 })]),
    player("B", [row({ matchId: "1", goals: 2, shots: 10 }), row({ matchId: "2", goals: 1, shots: 5 })]),
    player("C", [row({ matchId: "1", goals: 0, shots: 6 })]),
    player("D", [row({ matchId: "1", goals: 0, shots: 0 })])
  ];
  const r = S.rank(players, "conversion", { minMatches: 1 });
  assert.deepEqual(r.ranked.map(e => e.id), ["B", "C"]);
  assert.deepEqual(r.provisional.map(e => e.id), ["A"]);
  assert.deepEqual(r.noData.map(e => e.id), ["D"]);
  assert.equal(r.ranked[0].rank, 1);
});

test("lower-is-better metrics rank ascending and ties share a rank", () => {
  const players = ["A", "B", "C"].map((id, i) =>
    player(id, [row({ possessionLostDefensiveThird: [3, 1, 1][i] })]));
  const r = S.rank(players, "defensiveThirdLosses", {});
  assert.deepEqual(r.ranked.map(e => [e.id, e.rank]), [["B", 1], ["C", 1], ["A", 3]]);
});

test("context-only metrics are flagged", () => {
  const r = S.rank([player("A", [row({ passesCompletedForward: 1, passesFailedForward: 0,
    passesCompletedBackward: 1, passesFailedBackward: 0, passesCompletedSideways: 0,
    passesFailedSideways: 0 })])], "backwardPassShare", { minAttempts: 0 });
  assert.equal(r.contextOnly, true);
});

test("filters apply to appearances before aggregation", () => {
  const rows = [
    row({ matchId: "1", positionGroup: "DEF", goals: 0, clubId: "454058" }),
    row({ matchId: "2", positionGroup: "ATT", goals: 2, clubId: "451080", matchType: "playoffMatch" })
  ];
  assert.equal(S.aggregate(S.filterRows(rows, { groups: ["ATT"] }), "goals").perMatch, 2);
  assert.equal(S.filterRows(rows, { clubIds: ["454058"] }).length, 1);
  assert.equal(S.filterRows(rows, { matchTypes: ["playoffMatch"] }).length, 1);
  assert.equal(S.filterRows([{ timestamp: "" }], { from: new Date(0) }).length, 0);
});

test("groupByPlayer merges by playerId across clubs and keeps latest name", () => {
  const rows = [
    row({ clubId: "454058", matchId: "1", name: "Old", timestampUnix: 100 }),
    row({ clubId: "451080", matchId: "2", name: "New", timestampUnix: 200 })
  ];
  const players = S.groupByPlayer(rows);
  assert.equal(players.length, 1);
  assert.equal(players[0].name, "New");
  assert.equal(players[0].rows.length, 2);
});

test("fixture: three clubs merge into one profile per player", () => {
  const players = S.groupByPlayer(fixture.players);
  const ids = new Set(fixture.players.map(r => r.playerId));
  assert.equal(players.length, ids.size);
  assert.ok(players.every(p => new Set(p.rows.map(r => r.clubId)).size >= 1));
});

// --------------------------------------------------------- Panda Score

function benchRows(group, n, make) {
  return Array.from({ length: n }, (_, i) =>
    row(Object.assign({ matchId: group + i, playerId: group + "bench" + i, positionGroup: group }, make(i))));
}

const DEF_STATS = i => ({
  interceptions: i % 5, possessionLostDefensiveThird: i % 3, tacklesMade: i % 4,
  tackleAttempts: (i % 4) + 2, passesMade: 30 + i, passAttempts: 38 + i,
  aerialDuelsWonDefending: i % 2, crossesBlocked: i % 2, outOfPosition: i % 3
});

const ATT_STATS = i => ({
  goals: i % 3, assists: i % 2, shots: (i % 3) + 2, shotsOnTarget: (i % 3) + 1,
  shotsOffTarget: 1, dribblesCompleted: i % 6, possessionWonAttackingThird: i % 3,
  passesMade: 20 + i, passAttempts: 28 + i
});

test("percentile handles ties and bounds", () => {
  assert.equal(S.percentile([1, 2, 3, 4], 0), 0);
  assert.equal(S.percentile([1, 2, 3, 4], 5), 100);
  assert.equal(S.percentile([1, 2, 2, 3], 2), 50);
  assert.equal(S.percentile([], 1), null);
});

test("ratio appearance values shrink towards the benchmark", () => {
  const m = S.getMetric("conversion");
  const lucky = S.appearanceValue(row({ goals: 1, shots: 1 }), m, 0.2);
  assert.ok(lucky < 50 && lucky > 20, "1/1 should not score as 100%: " + lucky);
});

test("count appearance values use per 90 with a 20-minute floor", () => {
  const m = S.getMetric("goals");
  assert.equal(S.appearanceValue(row({ goals: 1, secondsPlayed: 2700 }), m), 2);
  assert.equal(S.appearanceValue(row({ goals: 1, secondsPlayed: 60 }), m), 4.5);
});

test("defenders are scored against defenders, not attackers", () => {
  const rows = benchRows("DEF", 20, DEF_STATS).concat(benchRows("ATT", 20, ATT_STATS));
  const benchmarks = S.buildBenchmarks(rows);
  const elite = row({ positionGroup: "DEF", interceptions: 6, possessionLostDefensiveThird: 0,
    tacklesMade: 5, tackleAttempts: 5, passesMade: 50, passAttempts: 52,
    aerialDuelsWonDefending: 3, crossesBlocked: 2, outOfPosition: 0, goals: 0, shots: 0 });
  const s = S.scoreAppearance(elite, benchmarks);
  assert.equal(s.group, "DEF");
  assert.ok(s.score > 85, "elite defender with 0 goals scored " + s.score);
  assert.ok(!("goals" in s.contributions));
});

test("improving a positive stat never lowers the score", () => {
  const rows = benchRows("DEF", 20, DEF_STATS);
  const benchmarks = S.buildBenchmarks(rows);
  const base = row(Object.assign({ positionGroup: "DEF" }, DEF_STATS(7)));
  const better = Object.assign({}, base, { interceptions: base.interceptions + 3 });
  const worse = Object.assign({}, base, { possessionLostDefensiveThird: 5 });
  const s0 = S.scoreAppearance(base, benchmarks).score;
  assert.ok(S.scoreAppearance(better, benchmarks).score >= s0);
  assert.ok(S.scoreAppearance(worse, benchmarks).score <= s0);
});

test("scores stay within 0-100 and average near 50 on the benchmark", () => {
  const rows = benchRows("DEF", 30, DEF_STATS);
  const benchmarks = S.buildBenchmarks(rows);
  const scores = rows.map(r => S.scoreAppearance(r, benchmarks).score);
  scores.forEach(s => assert.ok(s >= 0 && s <= 100));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  assert.ok(Math.abs(mean - 50) < 8, "benchmark mean " + mean);
});

test("small roles fall back to all appearances for benchmarks", () => {
  const rows = benchRows("DEF", 20, DEF_STATS).concat(benchRows("MID", 3, DEF_STATS));
  const benchmarks = S.buildBenchmarks(rows);
  assert.equal(benchmarks.MID.metrics.interceptions.fallback, true);
  assert.equal(benchmarks.DEF.metrics.interceptions.fallback, false);
});

test("appearances without enough data get no score", () => {
  const rows = benchRows("DEF", 20, DEF_STATS);
  const benchmarks = S.buildBenchmarks(rows);
  const sparse = row({ positionGroup: "DEF", eventCoverage: "missing", eventsAvailable: false,
    passesMade: 30, passAttempts: 35, tacklesMade: 1, tackleAttempts: 2 });
  const s = S.scoreAppearance(sparse, benchmarks);
  assert.equal(s.score, null);
  assert.ok(s.coverage < S.SCORE_SETTINGS.minWeightCoverage);
});

test("player score averages per-appearance role scores", () => {
  const rows = benchRows("DEF", 20, DEF_STATS).concat(benchRows("ATT", 20, ATT_STATS));
  const benchmarks = S.buildBenchmarks(rows);
  const mixed = [
    row(Object.assign({ matchId: "x1", playerId: "Z", positionGroup: "DEF" }, DEF_STATS(4))),
    row(Object.assign({ matchId: "x2", playerId: "Z", positionGroup: "ATT" }, ATT_STATS(2)))
  ];
  const result = S.pandaScore(mixed, benchmarks, { minMatches: 3 });
  assert.equal(result.scoredAppearances, 2);
  assert.deepEqual(Object.keys(result.byGroup).sort(), ["ATT", "DEF"]);
  const expected = (result.byGroup.ATT.score + result.byGroup.DEF.score) / 2;
  assert.ok(Math.abs(result.score - expected) < 1e-9);
  assert.equal(result.status, "provisional");
});

test("fixture: every scored player gets a bounded score with explanations", () => {
  const benchmarks = S.buildBenchmarks(fixture.players);
  const players = S.groupByPlayer(fixture.players);
  players.forEach(p => {
    const result = S.pandaScore(p.rows, benchmarks, { minMatches: 3 });
    assert.ok(result.score === null || (result.score >= 0 && result.score <= 100), p.id);
    if (result.score !== null) assert.ok(result.metrics.length > 0);
  });
});

// -------------------------------------------------------------- periods

test("timestamps parse from unix, ISO with offset and Date", () => {
  assert.equal(S.parseTimestamp({ timestampUnix: 1794603600 }).toISOString(), "2026-11-13T21:00:00.000Z");
  assert.equal(S.parseTimestamp({ timestamp: "2026-07-01T21:00:00+01:00" }).toISOString(), "2026-07-01T20:00:00.000Z");
  assert.equal(S.parseTimestamp({ timestamp: "" }), null);
  assert.equal(S.parseTimestamp({ timestamp: "not a date" }), null);
});

test("weeks run Monday to Sunday in Europe/London", () => {
  // Sun 15 Nov 2026 23:30 London is still week of Mon 9 Nov.
  assert.equal(S.weekKey(new Date("2026-11-15T23:30:00Z")), "2026-11-09");
  // Mon 16 Nov 2026 00:10 London starts a new week.
  assert.equal(S.weekKey(new Date("2026-11-16T00:10:00Z")), "2026-11-16");
});

test("BST late-night match belongs to the London day, not UTC", () => {
  // Sun 5 Jul 2026 23:30 UTC = Mon 6 Jul 00:30 BST -> week of Mon 6 Jul.
  assert.equal(S.weekKey(new Date("2026-07-05T23:30:00Z")), "2026-07-06");
  // 31 Oct 2026 23:30 UTC (GMT after 25 Oct) stays in October.
  assert.equal(S.monthKey(new Date("2026-10-31T23:30:00Z")), "2026-10");
  // 30 Sep 2026 23:30 UTC = 1 Oct 00:30 BST.
  assert.equal(S.monthKey(new Date("2026-09-30T23:30:00Z")), "2026-10");
});

test("period completeness and percentage-point change", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  assert.equal(S.isPeriodComplete("2026-11-02", "week", now), true);
  assert.equal(S.isPeriodComplete("2026-11-09", "week", now), false);
  assert.equal(S.isPeriodComplete("2026-10", "month", now), true);
  assert.equal(S.percentagePointChange(70, 75.5), 5.5);
  assert.equal(S.percentagePointChange(null, 75), null);
});
