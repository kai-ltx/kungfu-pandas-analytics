// ==========================================
// PANDAMETRICS V4 - DASHBOARD INSIGHTS
// ==========================================
//
// Pure view-model builders for the six dashboard sections, on top of
// PandaStats. Browser-only: inlined into the page by tools/build_client.js and
// never pushed as a server file, so it cannot affect doPost or be reached via
// google.script.run.

var PandaInsights = (function () {
  "use strict";

  const S = PandaStats;

  // One metric per idea per category: no duplicates across categories.
  const DISPLAY_CATEGORIES = [
    { key: "passing", label: "🎯 Passing",
      metrics: ["passAccuracy", "passesCompleted", "forwardPassesCompleted", "forwardPassShare",
                "shortPassAccuracy", "longPassAccuracy", "crossesCompleted"] },
    { key: "attacking", label: "⚽ Attacking",
      metrics: ["goals", "shots", "shotAccuracy", "conversion", "goalInvolvements", "aerialDuelsWonAttacking"] },
    { key: "creativity", label: "🪄 Creativity",
      metrics: ["assists", "secondAssists", "throughPasses", "switchesOfPlay", "firstTimePasses"] },
    { key: "defending", label: "🛡️ Defending",
      metrics: ["tacklesWon", "tackleSuccess", "interceptions", "crossesBlocked", "aerialDuelsWonDefending"] },
    { key: "possession", label: "🔄 Possession",
      metrics: ["possessionWon", "highRecoveries", "possessionLost", "defensiveThirdLosses", "dribblesCompleted"] },
    { key: "decisions", label: "🧠 Decisions",
      metrics: ["goodDecisionShare", "bestOptionTaken", "shouldHavePassedElsewhere", "outOfPosition", "foulsConceded"] }
  ];

  // Everything the lab shows. Rankings stay on the shorter list above.
  const LAB_NOTE = "Community mapping, not fully verified. Left out of the Panda Score and every award.";
  const LAB_CATEGORIES = [
    { key: "passing", label: "🎯 Passing",
      metrics: ["passAccuracy", "passesCompleted", "forwardPassesCompleted", "forwardPassAccuracy",
                "forwardPassShare", "backwardPassShare", "shortPassAccuracy", "mediumPassAccuracy",
                "longPassAccuracy", "flairPasses", "offsidePasses"] },
    { key: "attacking", label: "⚽ Attacking",
      metrics: ["goals", "shots", "shotsInsideBox", "shotsOutsideBox", "shotAccuracy", "conversion",
                "goalInvolvements", "goalsFirstTime", "goalsWeakFoot", "goalsOffPost", "aerialDuelsWonAttacking"] },
    { key: "creativity", label: "🪄 Creativity",
      metrics: ["assists", "secondAssists", "throughPasses", "throughBallAssists", "switchesOfPlay", "firstTimePasses"] },
    { key: "defending", label: "🛡️ Defending",
      metrics: ["tacklesWon", "tacklesLost", "tackleSuccess", "interceptions", "opponentsDispossessed",
                "crossesBlocked", "aerialDuelsWonDefending"] },
    { key: "possession", label: "🔄 Possession",
      metrics: ["possessionWon", "highRecoveries", "possessionLost", "defensiveThirdLosses",
                "dribblesCompleted", "playersBeaten"] },
    { key: "decisions", label: "🧠 Decisions",
      metrics: ["goodDecisionShare", "bestOptionTaken", "shouldHavePassedElsewhere", "noGoodOption",
                "inPosition", "outOfPosition", "severeOutOfPosition"] },
    { key: "discipline", label: "🟨 Discipline",
      metrics: ["foulsConceded", "foulsWon", "yellowCards", "redCards", "penaltiesConceded", "dangerousTackles"] },
    { key: "specialist", label: "🧤 Specialist",
      metrics: ["crossesCompleted", "crossAccuracy", "cornersTaken", "saves", "saveRate",
                "goalsConceded", "cleanSheets", "manOfTheMatch"] },
    { key: "experimental", label: "🧪 Experimental", note: LAB_NOTE,
      metrics: ["expPlayerOffside", "expBadPass", "expOpenPlayCrosses", "expShouldHaveShot"] }
  ];

  const PERIODS = [
    { key: "all", label: "All recorded" },
    { key: "last28", label: "Last 28 days" },
    { key: "thisWeek", label: "This week" },
    { key: "lastWeek", label: "Last week" },
    { key: "thisMonth", label: "This month" },
    { key: "lastMonth", label: "Last month" }
  ];

  const MATCH_TYPES = [
    { key: "official", label: "Official (league + playoffs)", types: ["leagueMatch", "playoffMatch"] },
    { key: "league", label: "League", types: ["leagueMatch"] },
    { key: "playoff", label: "Playoffs", types: ["playoffMatch"] }
  ];

  const DEFAULT_STATE = {
    club: "all",
    period: "all",
    matchType: "official",
    group: "all",
    minMatches: 3,
    evolutionPeriod: "week",
    evolutionMetric: "pandaScore"
  };

  // --------------------------------------------------------------- utils

  function periodRange(key, now) {
    if (key === "all" || !key) return { from: null, to: null };
    if (key === "last28") return { from: new Date(now.getTime() - 28 * 86400000), to: null };
    const period = key.endsWith("Month") ? "month" : "week";
    let pk = S.periodKey(now, period);
    if (key.startsWith("last")) pk = S.previousPeriodKey(pk, period);
    const b = S.periodBounds(pk, period);
    return { from: b.start, to: b.end, key: pk };
  }

  function filtersFor(state, now) {
    const range = periodRange(state.period, now);
    const type = MATCH_TYPES.find(t => t.key === state.matchType) || MATCH_TYPES[0];
    return {
      clubIds: state.club && state.club !== "all" ? [String(state.club)] : null,
      matchTypes: type.types,
      groups: state.group && state.group !== "all" ? [state.group] : null,
      from: range.from,
      to: range.to
    };
  }

  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function sum(values) {
    return values.reduce((a, b) => a + b, 0);
  }

  // ------------------------------------------------------------- prepare

  // Normalises the server payload once: dedupe, attach match type to legacy
  // rows, and build benchmarks from every official appearance so scores stay
  // comparable whatever filter is applied.
  function prepare(data) {
    const matchIndex = new Map();
    (data.matches || []).forEach(m => matchIndex.set(m.clubId + "|" + m.matchId, m));

    const deduped = S.dedupeAppearances(data.appearances || []);
    const rows = deduped.rows.map(r => {
      const match = matchIndex.get(r.clubId + "|" + r.matchId);
      const row = Object.assign({}, r, S.experimentalFields(r), {
        matchType: r.matchType || (match && match.matchType) || "leagueMatch",
        timestampUnix: r.timestampUnix || (match && match.timestampUnix) || null,
        result: match ? match.result : null
      });
      delete row.rawEvents;
      return row;
    });

    const official = rows.filter(r => r.matchType === "leagueMatch" || r.matchType === "playoffMatch");
    return {
      clubs: data.clubs || {},
      matches: (data.matches || []).filter(m => m.matchType !== "friendlyMatch"),
      rows: official,
      duplicatesDropped: deduped.dropped,
      benchmarks: S.buildBenchmarks(official),
      sync: data.sync || null,
      generatedAt: data.generatedAt || null
    };
  }

  function filteredMatches(prepared, filters) {
    return prepared.matches.filter(m => {
      if (filters.clubIds && !filters.clubIds.includes(String(m.clubId))) return false;
      if (filters.matchTypes && !filters.matchTypes.includes(m.matchType)) return false;
      const when = S.parseTimestamp(m);
      if ((filters.from || filters.to) && !when) return false;
      if (filters.from && when < filters.from) return false;
      if (filters.to && when >= filters.to) return false;
      return true;
    }).sort((a, b) => (b.timestampUnix || 0) - (a.timestampUnix || 0));
  }

  // ----------------------------------------------------------- coverage

  function coverage(rows) {
    const total = rows.length;
    const played = rows.filter(S.isAppearance);
    const didNotPlay = total - played.length;
    const withEvents = played.filter(S.eventsUsable).length;
    const groups = {};
    played.forEach(r => {
      const g = S.positionGroup(r) || "Unknown";
      groups[g] = (groups[g] || 0) + 1;
    });
    return {
      rows: total,
      appearances: played.length,
      didNotPlay,
      withEvents,
      eventsUnavailable: played.length - withEvents,
      eventCoveragePct: played.length ? withEvents / played.length * 100 : null,
      groups
    };
  }

  function metricCoverage(agg) {
    return {
      withData: agg.matchesWithData,
      appearances: agg.appearances,
      pct: agg.appearances ? agg.matchesWithData / agg.appearances * 100 : null
    };
  }

  // ----------------------------------------------------------- overview

  function clubSummaries(prepared, matches) {
    const out = {};
    Object.keys(prepared.clubs).forEach(id => {
      const list = matches.filter(m => String(m.clubId) === id);
      out[id] = {
        id,
        name: prepared.clubs[id],
        played: list.length,
        wins: list.filter(m => m.result === "win").length,
        draws: list.filter(m => m.result === "draw").length,
        losses: list.filter(m => m.result === "loss").length,
        goalsFor: sum(list.map(m => Number(m.goals) || 0)),
        goalsAgainst: sum(list.map(m => Number(m.goalsAgainst) || 0)),
        form: list.slice(0, 5).map(m => m.result),
        playoffs: list.filter(m => m.matchType === "playoffMatch").length
      };
    });
    return out;
  }

  // ------------------------------------------------------------- scoring

  function scoreTable(prepared, rows, minMatches) {
    return S.groupByPlayer(rows).map(p => {
      const result = S.pandaScore(p.rows, prepared.benchmarks, { minMatches });
      const appearances = p.rows.filter(S.isAppearance).length;
      return Object.assign({ id: p.id, name: p.name, appearances, rows: p.rows }, result);
    });
  }

  function rankScores(table) {
    const qualified = table.filter(t => t.status === "qualified").sort((a, b) => b.score - a.score);
    let prev = null;
    qualified.forEach((t, i) => {
      t.rank = prev && Math.abs(prev.score - t.score) < 1e-9 ? prev.rank : i + 1;
      prev = t;
    });
    return {
      qualified,
      provisional: table.filter(t => t.status === "provisional").sort((a, b) => b.score - a.score),
      noData: table.filter(t => t.status === "no_data")
    };
  }

  // ------------------------------------------------- role-adjusted rates

  // Compares a player's per-90 rate with what an average player would
  // produce in the same mix of position groups (pooled group rates).
  function roleAdjusted(playerRows, allRows, key) {
    const metric = S.getMetric(key);
    const actual = S.aggregate(playerRows, key);
    if (!actual.matchesWithData) return null;

    let expectedNum = 0;
    let expectedDen = 0;
    const byGroup = {};
    playerRows.forEach(r => {
      const g = S.positionGroup(r);
      if (g) byGroup[g] = (byGroup[g] || []).concat([r]);
    });

    Object.entries(byGroup).forEach(([g, rows]) => {
      const mine = S.aggregate(rows, key);
      if (!mine.matchesWithData) return;
      const peers = S.aggregate(allRows.filter(r => S.positionGroup(r) === g), key);
      if (metric.type === "ratio") {
        if (peers.rate === null) return;
        expectedNum += peers.rate / 100 * mine.denominator;
        expectedDen += mine.denominator;
      } else {
        const peerRate = peers.per90 !== null ? peers.per90 : peers.perMatch;
        const weight = mine.seconds ? mine.seconds / S.SECONDS_PER_90 : mine.matchesWithData;
        expectedNum += peerRate * weight;
        expectedDen += weight;
      }
    });

    if (!expectedDen) return null;
    const value = metric.type === "ratio" ? actual.rate
      : actual.per90 !== null ? actual.per90 : actual.perMatch;
    const expected = metric.type === "ratio" ? expectedNum / expectedDen * 100 : expectedNum / expectedDen;
    return {
      value,
      expected,
      diff: value === null ? null : value - expected,
      ratio: expected > 0 && value !== null ? value / expected : null,
      aggregate: actual
    };
  }

  // -------------------------------------------------------------- awards

  function eligible(table) {
    return table.filter(t => t.status === "qualified");
  }

  function pick(list, valueOf, direction) {
    const scored = list
      .map(item => ({ item, value: valueOf(item) }))
      .filter(x => x.value !== null && x.value !== undefined && Number.isFinite(x.value));
    if (!scored.length) return null;
    scored.sort((a, b) => direction === "low" ? a.value - b.value : b.value - a.value);
    return scored[0];
  }

  function awardEntry(def, winner, format) {
    return {
      key: def.key,
      title: def.title,
      shame: !!def.shame,
      description: def.description,
      advice: def.advice || "",
      winner: winner ? { id: winner.item.id, name: winner.item.name } : null,
      value: winner ? format(winner.value, winner.item) : null,
      sample: winner ? winner.item.appearances + " matches" : null
    };
  }

  function fmt(n, digits) {
    return n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(digits);
  }

  function awards(prepared, rows, table, previousTable) {
    const pool = eligible(table);
    const allRows = prepared.rows;
    const byId = {};
    (previousTable || []).forEach(t => { byId[t.id] = t; });

    const totalOf = key => p => S.aggregate(p.rows, key).total;
    const rateOf = (key, groups) => p => {
      const rows = groups ? p.rows.filter(r => groups.includes(S.positionGroup(r))) : p.rows;
      const agg = S.aggregate(rows, key);
      if (agg.matchesWithData < 2) return null;
      return agg.per90 !== null ? agg.per90 : agg.perMatch;
    };
    const excess = key => p => {
      const r = roleAdjusted(p.rows, allRows, key);
      return r && r.aggregate.matchesWithData >= 2 ? r.diff : null;
    };
    const change = p => byId[p.id] && byId[p.id].status === "qualified" ? p.score - byId[p.id].score : null;
    const defensive = p => {
      const rows = p.rows.filter(r => ["DEF", "MID"].includes(S.positionGroup(r)));
      const t = S.aggregate(rows, "tacklesWon");
      const i = S.aggregate(rows, "interceptions");
      if (t.matchesWithData < 2 || i.matchesWithData < 2) return null;
      return (t.per90 !== null ? t.per90 : t.perMatch) + (i.per90 !== null ? i.per90 : i.perMatch);
    };
    const aerialRate = p => {
      const parts = [["ATT", "aerialDuelsWonAttacking"], ["MID", "aerialDuelsWonDefending"], ["DEF", "aerialDuelsWonDefending"]];
      let weighted = 0;
      let weight = 0;
      let matches = 0;
      parts.forEach(([group, key]) => {
        const agg = S.aggregate(p.rows.filter(r => S.positionGroup(r) === group), key);
        const rate = agg.per90 !== null ? agg.per90 : agg.perMatch;
        if (!agg.matchesWithData || rate === null) return;
        const w = agg.seconds ? agg.seconds / S.SECONDS_PER_90 : agg.matchesWithData;
        weighted += rate * w;
        weight += w;
        matches += agg.matchesWithData;
      });
      return matches >= 2 && weight ? weighted / weight : null;
    };
    const clearest = p => {
      const compared = roleAdjusted(p.rows, allRows, "goodDecisionShare");
      if (!compared || compared.diff <= 0 || compared.aggregate.matchesWithData < 2) return null;
      if ((compared.aggregate.denominator || 0) < S.getMetric("goodDecisionShare").minAttempts) return null;
      return compared.diff;
    };

    const hall = [
      [{ key: "pandaOfWeek", title: "🐼 Panda of the Period", description: "Highest position-adjusted Panda Score." },
       pick(pool, p => p.score), v => fmt(v, 0)],
      [{ key: "goldenBoot", title: "👟 Golden Boot", description: "Most goals." },
       pick(pool, totalOf("goals")), v => String(v)],
      [{ key: "assistKing", title: "🎁 Assist King", description: "Most assists." },
       pick(pool, totalOf("assists")), v => String(v)],
      [{ key: "forwardThinker", title: "🚀 Forward Thinker", description: "Most completed forward passes per 90 as a midfielder or defender." },
       pick(pool, rateOf("forwardPassesCompleted", ["MID", "DEF"])), v => fmt(v, 1) + " /90"],
      [{ key: "kungFuMaster", title: "🥋 Kung Fu Master", description: "Most tackles won + interceptions per 90 as a defender or midfielder (separate counters, no overlap)." },
       pick(pool, defensive), v => fmt(v, 1) + " /90"],
      [{ key: "crossMaster", title: "📐 Cross Master", description: "Most completed crosses per 90 as an attacker or midfielder." },
       pick(pool, rateOf("crossesCompleted", ["ATT", "MID"])), v => fmt(v, 1) + " /90"],
      [{ key: "aerialAce", title: "🦅 Aerial Ace", description: "Most aerial duels won per 90 in the duel that matches the position played: attacking duels for attackers, defensive duels for midfielders and defenders." },
       pick(pool, aerialRate), v => fmt(v, 1) + " /90"],
      [{ key: "clearestHead", title: "🧠 Clearest Head", description: "Best share of good passing decisions compared with players in the same positions." },
       pick(pool, clearest), v => "+" + fmt(v, 1) + " pp"],
      [{ key: "mostImproved", title: "📈 Most Improved", description: "Biggest Panda Score rise on the previous period." },
       pick(pool, change), v => "+" + fmt(v, 1)]
    ].map(([def, w, f]) => awardEntry(def, w, f));

    const shame = [
      [{ key: "shotgunTarget", title: "🎯 Shotgun Target", shame: true,
         description: "Lowest eligible position-adjusted Panda Score.",
         advice: "See your Panda Lab tips: the fix is in your weakest role metrics." },
       pick(pool, p => p.score, "low"), v => fmt(v, 0)],
      [{ key: "crabKing", title: "🦀 Crab King", shame: true,
         description: "Most backward passing above what players in the same positions usually play.",
         advice: "Scan before receiving so a forward option is ready." },
       pick(pool, excess("backwardPassShare")), v => "+" + fmt(v, 1) + " pp"],
      [{ key: "butterfingers", title: "🧈 Butterfingers", shame: true,
         description: "Most possession lost per 90 above positional peers.",
         advice: "Release the ball a touch earlier when two opponents close in." },
       pick(pool, excess("possessionLost")), v => "+" + fmt(v, 1) + " /90"],
      [{ key: "tunnelVision", title: "🙈 Tunnel Vision", shame: true,
         description: "Most 'better pass available' feedback per 90 above positional peers.",
         advice: "Check your shoulder before the ball arrives." },
       pick(pool, excess("shouldHavePassedElsewhere")), v => "+" + fmt(v, 1) + " /90"],
      [{ key: "lostPanda", title: "🗺️ Lost Panda", shame: true,
         description: "Most out-of-position flags per 90 above positional peers.",
         advice: "Recover your shape first after an attack breaks down." },
       pick(pool, excess("outOfPosition")), v => "+" + fmt(v, 1) + " /90"],
      [{ key: "offsideOutlet", title: "🚩 Offside Outlet", shame: true,
         description: "Most passes into offside per 90 above players in the same positions. This is the pass, not the player being caught offside.",
         advice: "Hold the through ball until the runner is level." },
       pick(pool, excess("offsidePasses")), v => "+" + fmt(v, 1) + " /90"],
      [{ key: "biggestDecline", title: "📉 Biggest Decline", shame: true,
         description: "Largest Panda Score drop on the previous period.",
         advice: "Compare this period's weakest metrics with last period in Evolution." },
       pick(pool, change, "low"), v => fmt(v, 1)]
    ].map(([def, w, f]) => {
      const entry = awardEntry(def, w, f);
      // A "shame" for a positive change or below-average excess is not a shame.
      if (w && ["crabKing", "butterfingers", "tunnelVision", "lostPanda", "offsideOutlet"].includes(def.key) && w.value <= 0) entry.winner = null;
      if (w && def.key === "biggestDecline" && w.value >= 0) entry.winner = null;
      if (!entry.winner) entry.value = null;
      return entry;
    });

    hall.forEach(a => {
      if (a.key === "mostImproved" && a.winner && pick(pool, change).value <= 0) {
        a.winner = null;
        a.value = null;
      }
    });

    return { hall, shame, eligible: pool.length };
  }

  // ------------------------------------------------------------- coaching

  const TIPS = {
    passAccuracy: "Take an extra touch to open your body before passing, and choose the safer option when pressed.",
    forwardPassesCompleted: "Look for the forward pass first: scan before receiving so the line-breaking option is ready.",
    assists: "Arrive in the half-spaces earlier and look for the cut-back instead of the cross.",
    goals: "Get into the box before the ball does; shots from inside the box are on target far more often.",
    shotAccuracy: "Shoot across the keeper and avoid low-angle efforts; a pass to a better-placed teammate counts too.",
    dribblesCompleted: "Attack the defender's weaker side and release before the second defender arrives.",
    highRecoveries: "Press the first pass straight after losing the ball in the final third.",
    throughPasses: "Watch for runs in behind and play the through ball early, before the line steps up.",
    interceptions: "Hold the passing lane between ball and runner instead of charging the ball carrier.",
    tacklesWon: "Jockey and wait for a heavy touch before committing to the tackle.",
    tackleSuccess: "Jockey and wait for a heavy touch before committing to the tackle.",
    possessionLost: "Release earlier when two opponents close in; a simple lay-off keeps the attack alive.",
    defensiveThirdLosses: "Near your own goal, a safe pass or clearance beats a risky dribble.",
    outOfPosition: "Recover your shape before joining the attack; let a teammate cover your space first.",
    aerialDuelsWonDefending: "Attack the ball at its highest point and body-check the striker before the cross.",
    crossesBlocked: "Show attackers onto their weaker foot and close the crossing angle early.",
    saves: "Hold your position longer before diving; let the shooter commit first.",
    goalsConceded: "Organise the line on set pieces and stay big in one-on-ones."
  };

  function coachingTips(score, benchmarks, playerRows) {
    if (!score || score.score === null) return [];
    const mainGroup = Object.entries(score.byGroup).sort((a, b) => b[1].appearances - a[1].appearances)[0];
    if (!mainGroup) return [];
    const group = mainGroup[0];
    return score.weaknesses
      .filter(w => TIPS[w.key])
      .slice(0, 3)
      .map(w => {
        const metric = S.getMetric(w.key);
        const groupRows = playerRows.filter(r => S.positionGroup(r) === group);
        const bench = benchmarks[group] && benchmarks[group].metrics[w.key];
        const agg = S.aggregate(groupRows.length ? groupRows : playerRows, w.key);
        const mine = metric.type === "ratio" ? agg.rate : (agg.per90 !== null ? agg.per90 : agg.perMatch);
        const typical = bench ? median(bench.values) : null;
        const unit = metric.type === "ratio" ? "%" : " per 90";
        return {
          metric: w.key,
          title: w.label,
          tip: TIPS[w.key],
          evidence: "As a " + S.GROUP_LABELS[group].toLowerCase() + ": " + fmt(mine, 1) + unit +
            " vs a typical " + fmt(typical, 1) + unit + " (" + agg.matchesWithData + " matches with data; better than " +
            Math.round(w.percentile) + "% of " + S.GROUP_LABELS[group].toLowerCase() + " appearances)."
        };
      });
  }

  // -------------------------------------------------------------- rankings

  function categoryRankings(players, category, state) {
    return category.metrics.map(key => {
      const metric = S.getMetric(key);
      const view = metric.type === "count" ? "per90" : "rate";
      const r = S.rank(players, key, { minMatches: state.minMatches, view });
      const usePerMatch = metric.type === "count" && r.ranked.concat(r.provisional).every(e => e.aggregate.per90 === null);
      const ranking = usePerMatch ? S.rank(players, key, { minMatches: state.minMatches, view: "perMatch" }) : r;
      return {
        key,
        label: metric.label,
        description: metric.description,
        confidence: metric.confidence,
        formula: S.formula(metric),
        direction: metric.higherIsBetter === null ? "context" : metric.higherIsBetter ? "higher" : "lower",
        unit: metric.type === "ratio" ? "%" : usePerMatch ? "per match" : "per 90",
        minAttempts: metric.minAttempts,
        ranking
      };
    });
  }

  // -------------------------------------------------------------- evolution

  const MAX_EVOLUTION_PERIODS = 52;
  const MIN_MOVER_SAMPLE = 3;

  function evolution(prepared, rows, state, now) {
    const period = state.evolutionPeriod === "month" ? "month" : "week";
    const metricKey = state.evolutionMetric || "pandaScore";
    const present = [...new Set(rows.map(r => {
      const d = S.parseTimestamp(r);
      return d ? S.periodKey(d, period) : null;
    }).filter(Boolean))].sort();
    // Contiguous periods so a week without matches shows as a gap, not as
    // two adjacent points.
    const keys = [];
    if (present.length) {
      let k = present[present.length - 1];
      while (k >= present[0] && keys.length < MAX_EVOLUTION_PERIODS) {
        keys.unshift(k);
        k = S.previousPeriodKey(k, period);
      }
    }

    const players = S.groupByPlayer(rows);
    const valueFor = (pRows) => {
      if (metricKey === "pandaScore") {
        const s = S.pandaScore(pRows, prepared.benchmarks, { minMatches: 1 });
        return { value: s.score, sample: s.scoredAppearances };
      }
      const metric = S.getMetric(metricKey);
      const agg = S.aggregate(pRows, metricKey);
      const value = metric.type === "ratio" ? agg.rate : metric.type === "mean" ? agg.mean
        : agg.per90 !== null ? agg.per90 : agg.perMatch;
      return { value, sample: agg.matchesWithData };
    };

    const inPeriod = (list, key) => {
      const b = S.periodBounds(key, period);
      return list.filter(r => {
        const d = S.parseTimestamp(r);
        return d && d >= b.start && d < b.end;
      });
    };

    const series = players.map(p => ({
      id: p.id,
      name: p.name,
      points: keys.map(k => Object.assign({ period: k }, valueFor(inPeriod(p.rows, k))))
    }));

    const squad = keys.map(k => Object.assign({ period: k, complete: S.isPeriodComplete(k, period, now) },
      valueFor(inPeriod(rows, k))));

    const isRatio = metricKey !== "pandaScore" && S.getMetric(metricKey).type === "ratio";
    // Movers compare completed periods with enough matches; a half-played
    // week or a single match is noise.
    const movers = series.map(s => {
      const pts = s.points.filter(p => p.value !== null && p.sample >= MIN_MOVER_SAMPLE &&
        S.isPeriodComplete(p.period, period, now));
      if (pts.length < 2) return null;
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      return { id: s.id, name: s.name, from: prev.period, to: last.period,
               change: last.value - prev.value, unit: isRatio ? "pp" : "",
               samples: [prev.sample, last.sample] };
    }).filter(Boolean).sort((a, b) => b.change - a.change);

    return {
      period,
      metric: metricKey,
      metricLabel: metricKey === "pandaScore" ? "Panda Score" : S.getMetric(metricKey).label,
      keys,
      complete: keys.map(k => S.isPeriodComplete(k, period, now)),
      series,
      squad,
      improvers: movers.filter(m => m.change > 0).slice(0, 3),
      decliners: movers.filter(m => m.change < 0).reverse().slice(0, 3)
    };
  }

  // ----------------------------------------------------------- Weekly Bamboo

  function weeklyBamboo(prepared, state, now) {
    const base = Object.assign({}, state, { period: "all", group: "all" });
    const filters = filtersFor(base, now);
    const rows = S.filterRows(prepared.rows, filters);
    const matches = filteredMatches(prepared, filters);

    // Most recent complete Monday-Sunday week with official matches.
    const current = S.periodKey(now, "week");
    const weeks = [...new Set(matches.map(m => {
      const d = S.parseTimestamp(m);
      return d ? S.periodKey(d, "week") : null;
    }).filter(k => k && k < current))].sort();
    if (!weeks.length) return { week: null };

    const week = weeks[weeks.length - 1];
    const prevWeek = S.previousPeriodKey(week, "week");
    const bounds = S.periodBounds(week, "week");
    const prevBounds = S.periodBounds(prevWeek, "week");
    const within = (list, b) => list.filter(r => {
      const d = S.parseTimestamp(r);
      return d && d >= b.start && d < b.end;
    });

    const weekRows = within(rows, bounds);
    const weekMatches = within(matches, bounds);
    const minMatches = 2;
    const table = scoreTable(prepared, weekRows, minMatches);
    const prevTable = scoreTable(prepared, within(rows, prevBounds), minMatches);

    return {
      week,
      start: bounds.start,
      end: new Date(bounds.end.getTime() - 1),
      matches: weekMatches.length,
      record: {
        wins: weekMatches.filter(m => m.result === "win").length,
        draws: weekMatches.filter(m => m.result === "draw").length,
        losses: weekMatches.filter(m => m.result === "loss").length
      },
      clubs: clubSummaries(prepared, weekMatches),
      awards: awards(prepared, weekRows, table, prevTable),
      minMatches,
      coverage: coverage(weekRows)
    };
  }

  // ----------------------------------------------------------- Panda Lab

  function lab(prepared, rows, playerId, state) {
    const players = S.groupByPlayer(rows);
    const player = players.find(p => p.id === playerId) || players[0];
    if (!player) return null;
    const score = S.pandaScore(player.rows, prepared.benchmarks, { minMatches: state.minMatches });

    const categories = LAB_CATEGORIES.map(cat => ({
      note: cat.note || "",
      key: cat.key,
      label: cat.label,
      metrics: cat.metrics.map(key => {
        const metric = S.getMetric(key);
        const agg = S.aggregate(player.rows, key);
        const q = S.qualify(agg, key, { minMatches: 1 });
        const adj = roleAdjusted(player.rows, prepared.rows, key);
        return {
          key,
          label: metric.label,
          description: metric.description,
          confidence: metric.confidence,
          type: metric.type,
          direction: metric.higherIsBetter,
          total: agg.total,
          perMatch: agg.perMatch,
          per90: agg.per90,
          rate: agg.rate,
          numerator: agg.numerator,
          denominator: agg.denominator,
          coverage: metricCoverage(agg),
          status: q.status,
          reasons: q.reasons,
          peer: adj ? adj.expected : null
        };
      })
    }));

    const dirs = ["Forward", "Backward", "Sideways"].map(d => {
      const completed = S.aggregate(player.rows, "forwardPassesCompleted"); // coverage reference
      const rowsWithEvents = player.rows.filter(r => S.isAppearance(r) && S.eventsUsable(r));
      const c = sum(rowsWithEvents.map(r => S.toNumber(r["passesCompleted" + d]) || 0));
      const f = sum(rowsWithEvents.map(r => S.toNumber(r["passesFailed" + d]) || 0));
      return { direction: d, completed: c, failed: f, attempts: c + f, matches: completed.matchesWithData };
    });
    const known = sum(dirs.map(d => d.attempts));
    dirs.forEach(d => {
      d.share = known ? d.attempts / known * 100 : null;
      d.accuracy = d.attempts ? d.completed / d.attempts * 100 : null;
    });

    const groups = {};
    player.rows.filter(S.isAppearance).forEach(r => {
      const g = S.positionGroup(r) || "Unknown";
      groups[g] = (groups[g] || 0) + 1;
    });

    return {
      id: player.id,
      name: player.name,
      players: players.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
      score,
      rating: S.aggregate(player.rows, "rating"),
      groups,
      coverage: coverage(player.rows),
      categories,
      passingDna: dirs,
      tips: coachingTips(score, prepared.benchmarks, player.rows)
    };
  }

  // -------------------------------------------------------- Squad & Builds

  function squad(prepared, rows, state) {
    return scoreTable(prepared, rows, state.minMatches).map(t => {
      const archetypes = {};
      t.rows.filter(S.isAppearance).forEach(r => {
        if (r.archetypeId) archetypes[r.archetypeId] = (archetypes[r.archetypeId] || 0) + 1;
      });
      const topArch = Object.entries(archetypes).sort((a, b) => b[1] - a[1])[0];
      const best = Object.entries(t.byGroup)
        .map(([g, v]) => ({ group: g, label: S.GROUP_LABELS[g], score: v.score, appearances: v.appearances,
                            tentative: v.appearances < 5 }))
        .sort((a, b) => b.score - a.score);
      return {
        id: t.id,
        name: t.name,
        score: t.score,
        status: t.status,
        appearances: t.appearances,
        groups: best,
        bestGroup: best[0] || null,
        goals: S.aggregate(t.rows, "goals").total,
        assists: S.aggregate(t.rows, "assists").total,
        rating: S.aggregate(t.rows, "rating").mean,
        archetype: topArch ? { id: topArch[0], appearances: topArch[1] } : null,
        strengths: t.strengths
      };
    }).sort((a, b) => (b.score === null ? -1 : b.score) - (a.score === null ? -1 : a.score));
  }

  // ------------------------------------------------------------------ build

  function build(prepared, state, now, selectedPlayer) {
    const st = Object.assign({}, DEFAULT_STATE, state);
    const filters = filtersFor(st, now);
    const rows = S.filterRows(prepared.rows, filters);
    const matches = filteredMatches(prepared, Object.assign({}, filters, { groups: null }));
    const players = S.groupByPlayer(rows);
    const table = scoreTable(prepared, rows, st.minMatches);

    // Previous period for Most Improved / Biggest Decline.
    let previousTable = null;
    const range = periodRange(st.period, now);
    if (range.key) {
      const period = st.period.endsWith("Month") ? "month" : "week";
      const pb = S.periodBounds(S.previousPeriodKey(range.key, period), period);
      const prevRows = S.filterRows(prepared.rows, Object.assign({}, filters, { from: pb.start, to: pb.end }));
      previousTable = scoreTable(prepared, prevRows, st.minMatches);
    }

    return {
      state: st,
      filters,
      overview: {
        clubs: clubSummaries(prepared, matches),
        matches: matches.length,
        recent: matches.slice(0, 8),
        coverage: coverage(rows),
        sync: prepared.sync,
        generatedAt: prepared.generatedAt,
        duplicatesDropped: prepared.duplicatesDropped,
        bamboo: weeklyBamboo(prepared, st, now)
      },
      rankings: {
        scores: rankScores(table),
        categories: DISPLAY_CATEGORIES.map(c => ({ key: c.key, label: c.label })),
        categoryRankings: cat => categoryRankings(players, DISPLAY_CATEGORIES.find(c => c.key === cat) || DISPLAY_CATEGORIES[0], st)
      },
      evolution: evolution(prepared, rows, st, now),
      lab: lab(prepared, rows, selectedPlayer, st),
      squad: squad(prepared, rows, st),
      awards: awards(prepared, rows, table, previousTable)
    };
  }

  return {
    DISPLAY_CATEGORIES,
    LAB_CATEGORIES,
    PERIODS,
    MATCH_TYPES,
    DEFAULT_STATE,
    TIPS,
    periodRange,
    filtersFor,
    prepare,
    coverage,
    roleAdjusted,
    awards,
    coachingTips,
    evolution,
    weeklyBamboo,
    lab,
    squad,
    scoreTable,
    rankScores,
    categoryRankings,
    build
  };
})();
