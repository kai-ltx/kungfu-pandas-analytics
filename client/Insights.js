// ==========================================
// PANDAMETRICS V4.1 - DASHBOARD INSIGHTS
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
  const LAB_NOTE = "Community mapping, not fully verified. Left out of the Panda Score and every performance award; used only for fun personalities, where it is labelled.";
  const LAB_CATEGORIES = [
    { key: "passing", label: "🎯 Passing",
      metrics: ["passAccuracy", "passesCompleted", "forwardPassesCompleted",
                "forwardPassShare", "backwardPassShare", "shortPassAccuracy", "mediumPassAccuracy",
                "longPassAccuracy", "flairPasses", "offsidePasses"] },
    { key: "attacking", label: "⚽ Attacking",
      metrics: ["goals", "shots", "shotsInsideBox", "shotsOutsideBox", "shotAccuracy", "conversion",
                "goalInvolvements", "goalsFirstTime", "goalsWeakFoot", "goalsOffPost", "aerialDuelsWonAttacking"] },
    { key: "creativity", label: "🪄 Creativity",
      metrics: ["assists", "secondAssists", "throughPasses", "throughBallAssists", "switchesOfPlay", "firstTimePasses"] },
    { key: "defending", label: "🛡️ Defending",
      metrics: ["tacklesWon", "tacklesLost", "tackleSuccess", "slidingTackles", "interceptions",
                "opponentsDispossessed", "crossesBlocked", "aerialDuelsWonDefending"] },
    { key: "possession", label: "🔄 Possession",
      metrics: ["possessionWon", "highRecoveries", "possessionLost", "defensiveThirdLosses",
                "dribblesCompleted", "playersBeaten", "skillMoveBeats"] },
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

  function mean(values) {
    return values.length ? sum(values) / values.length : null;
  }

  function fmt(n, digits) {
    return n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(digits);
  }

  function unitValue(value, unit) {
    if (unit === "%") return fmt(value, 1) + "%";
    return fmt(value, 2) + " " + unit;
  }

  // Per-90 when minutes are known, otherwise per match.
  function rateOfAggregate(agg) {
    return agg.per90 !== null ? agg.per90 : agg.perMatch;
  }

  function rateUnit(agg) {
    return agg.per90 !== null ? "/90" : "/match";
  }

  function mainGroupOf(byGroup) {
    const top = Object.entries(byGroup || {}).sort((a, b) => b[1].appearances - a[1].appearances)[0];
    return top ? top[0] : null;
  }

  function groupLabel(group, plural) {
    const label = (S.GROUP_LABELS[group] || group || "player").toLowerCase();
    return plural ? label + "s" : label;
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
    const incomplete = played.filter(r => r.eventCoverage === "incomplete").length;
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
      incomplete,
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

  // Pooled peer aggregates are reused across players and awards.
  const peerCache = new WeakMap();

  function peerAggregate(allRows, group, key) {
    let cache = peerCache.get(allRows);
    if (!cache) {
      cache = new Map();
      peerCache.set(allRows, cache);
    }
    const id = group + "|" + key;
    if (!cache.has(id)) cache.set(id, S.aggregate(allRows.filter(r => S.positionGroup(r) === group), key));
    return cache.get(id);
  }

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
      const peers = peerAggregate(allRows, g, key);
      if (metric.type === "ratio") {
        if (peers.rate === null) return;
        expectedNum += peers.rate / 100 * mine.denominator;
        expectedDen += mine.denominator;
      } else {
        const peerRate = rateOfAggregate(peers);
        if (peerRate === null) return;
        const weight = mine.seconds ? mine.seconds / S.SECONDS_PER_90 : mine.matchesWithData;
        expectedNum += peerRate * weight;
        expectedDen += weight;
      }
    });

    if (!expectedDen) return null;
    const value = metric.type === "ratio" ? actual.rate : rateOfAggregate(actual);
    const expected = metric.type === "ratio" ? expectedNum / expectedDen * 100 : expectedNum / expectedDen;
    return {
      value,
      expected,
      diff: value === null ? null : value - expected,
      ratio: expected > 0 && value !== null ? value / expected : null,
      unit: metric.type === "ratio" ? "%" : rateUnit(actual),
      aggregate: actual
    };
  }

  function peerLine(r) {
    if (!r) return null;
    return unitValue(r.value, r.unit) + " vs " + unitValue(r.expected, r.unit) + " typical for the same positions";
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

  // Every award card (hall, shame and personality) has the same shape.
  function card(def, fields) {
    return Object.assign({
      key: def.key,
      title: def.title,
      kind: def.kind || (def.shame ? "shame" : "hall"),
      shame: !!def.shame,
      description: def.description,
      advice: def.advice || "",
      note: def.note || "",
      experimental: !!def.experimental,
      winner: null,
      value: null,
      stats: [],
      sample: null
    }, fields || {});
  }

  function awards(prepared, rows, table, previousTable) {
    const pool = eligible(table);
    const allRows = prepared.rows;
    const byId = {};
    (previousTable || []).forEach(t => { byId[t.id] = t; });
    const hasPrevious = !!previousTable;

    const rowsIn = (p, groups) => groups ? p.rows.filter(r => groups.includes(S.positionGroup(r))) : p.rows;
    const totalOf = key => p => S.aggregate(p.rows, key).total;
    const rateOf = (key, groups) => p => {
      const agg = S.aggregate(rowsIn(p, groups), key);
      if (agg.matchesWithData < 2) return null;
      return rateOfAggregate(agg);
    };
    const excess = key => p => {
      const r = roleAdjusted(p.rows, allRows, key);
      return r && r.aggregate.matchesWithData >= 2 ? r.diff : null;
    };
    const change = p => byId[p.id] && byId[p.id].status === "qualified" ? p.score - byId[p.id].score : null;
    const defensive = p => {
      const r = rowsIn(p, ["DEF", "MID"]);
      const t = S.aggregate(r, "tacklesWon");
      const i = S.aggregate(r, "interceptions");
      if (t.matchesWithData < 2 || i.matchesWithData < 2) return null;
      return rateOfAggregate(t) + rateOfAggregate(i);
    };
    const aerialParts = [["ATT", "aerialDuelsWonAttacking"], ["MID", "aerialDuelsWonDefending"], ["DEF", "aerialDuelsWonDefending"]];
    const aerialRate = p => {
      let weighted = 0;
      let weight = 0;
      let matches = 0;
      aerialParts.forEach(([group, key]) => {
        const agg = S.aggregate(rowsIn(p, [group]), key);
        const rate = rateOfAggregate(agg);
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

    const matchesLine = p => p.scoredAppearances + " scored of " + p.appearances + " matches";
    const totalLine = (key, groups, label) => p => {
      const agg = S.aggregate(rowsIn(p, groups), key);
      return [agg.total + " " + label + " in " + agg.matchesWithData + " matches with data"];
    };
    const peer = key => p => [peerLine(roleAdjusted(p.rows, allRows, key))].filter(Boolean);
    const scoreChange = p => [fmt(byId[p.id].score, 1) + " last period → " + fmt(p.score, 1) + " now"];
    const weakest = p => {
      const w = p.weaknesses && p.weaknesses[0];
      return w ? ["Weakest area: " + w.label + " (better than " + Math.round(w.percentile) + "% of positional peers)"] : [];
    };

    const hallDefs = [
      { key: "pandaOfWeek", title: previousTable ? "🐼 Panda of the Week" : "🐼 Panda of All Time", description: "Highest position-adjusted Panda Score.",
        valueOf: p => p.score, format: v => fmt(v, 0), detail: p => [matchesLine(p)] },
      { key: "goldenBoot", title: "👟 Golden Boot", description: "Most goals.",
        valueOf: totalOf("goals"), format: v => String(v),
        detail: p => [S.aggregate(p.rows, "goals").total + " goals in " + p.appearances + " matches"] },
      { key: "assistKing", title: "🎁 Assist King", description: "Most assists.",
        valueOf: totalOf("assists"), format: v => String(v),
        detail: p => [S.aggregate(p.rows, "assists").total + " assists in " + p.appearances + " matches"] },
      { key: "forwardThinker", title: "🚀 Forward Thinker", description: "Most completed forward passes per 90 as a midfielder or defender.",
        valueOf: rateOf("forwardPassesCompleted", ["MID", "DEF"]), format: v => fmt(v, 1) + " /90",
        detail: totalLine("forwardPassesCompleted", ["MID", "DEF"], "forward passes completed") },
      { key: "kungFuMaster", title: "🥋 Kung Fu Master", description: "Most tackles won + interceptions per 90 as a defender or midfielder (separate counters, no overlap).",
        valueOf: defensive, format: v => fmt(v, 1) + " /90",
        detail: p => totalLine("tacklesWon", ["DEF", "MID"], "tackles won")(p).concat(totalLine("interceptions", ["DEF", "MID"], "interceptions")(p)) },
      { key: "crossMaster", title: "📐 Cross Master", description: "Most completed crosses per 90 as an attacker or midfielder.",
        valueOf: rateOf("crossesCompleted", ["ATT", "MID"]), format: v => fmt(v, 1) + " /90",
        detail: totalLine("crossesCompleted", ["ATT", "MID"], "crosses completed") },
      { key: "aerialAce", title: "🦅 Aerial Ace", description: "Most aerial duels won per 90 in the duel that matches the position played: attacking duels for attackers, defensive duels for midfielders and defenders.",
        valueOf: aerialRate, format: v => fmt(v, 1) + " /90",
        detail: p => aerialParts.map(([g, k]) => {
          const agg = S.aggregate(rowsIn(p, [g]), k);
          return agg.matchesWithData ? agg.total + " won as " + groupLabel(g) + " (" + agg.matchesWithData + " matches)" : null;
        }).filter(Boolean) },
      { key: "clearestHead", title: "🧠 Clearest Head", description: "Best share of good passing decisions compared with players in the same positions.",
        valueOf: clearest, format: v => "+" + fmt(v, 1) + " pp", detail: peer("goodDecisionShare") },
      { key: "mostImproved", title: "📈 Most Improved", description: "Biggest Panda Score rise on the previous period.",
        valueOf: change, format: v => "+" + fmt(v, 1), detail: scoreChange, needsPrevious: true, positiveOnly: true }
    ];

    const shameDefs = [
      { key: "shotgunTarget", title: "🎯 Shotgun Target", shame: true,
        description: "Lowest eligible position-adjusted Panda Score.",
        advice: "See your Panda Lab tips: the fix is in your weakest role metrics.",
        valueOf: p => p.score, direction: "low", format: v => fmt(v, 0), detail: p => [matchesLine(p)].concat(weakest(p)) },
      { key: "tunnelVision", title: "🙈 Tunnel Vision", shame: true,
        description: "Most 'better pass available' feedback per 90 above positional peers.",
        advice: "Check your shoulder before the ball arrives.",
        valueOf: excess("shouldHavePassedElsewhere"), format: v => "+" + fmt(v, 1) + " /90",
        detail: peer("shouldHavePassedElsewhere"), positiveOnly: true },
      { key: "lostPanda", title: "🗺️ Lost Panda", shame: true,
        description: "Most out-of-position flags per 90 above positional peers.",
        advice: "Recover your shape first after an attack breaks down.",
        valueOf: excess("outOfPosition"), format: v => "+" + fmt(v, 1) + " /90",
        detail: peer("outOfPosition"), positiveOnly: true },
      { key: "offsideOutlet", title: "🚩 Offside Outlet", shame: true,
        description: "Most passes into offside per 90 above players in the same positions. This is the pass, not the player being caught offside.",
        advice: "Hold the through ball until the runner is level.",
        valueOf: excess("offsidePasses"), format: v => "+" + fmt(v, 1) + " /90",
        detail: peer("offsidePasses"), positiveOnly: true },
      { key: "biggestDecline", title: "📉 Biggest Decline", shame: true,
        description: "Largest Panda Score drop on the previous period.",
        advice: "Compare this period's weakest metrics with last period in Evolution.",
        valueOf: change, direction: "low", format: v => fmt(v, 1), detail: scoreChange, needsPrevious: true, negativeOnly: true }
    ];

    const decide = defs => defs.filter(d => !d.needsPrevious || hasPrevious).map(d => {
      const w = pick(pool, d.valueOf, d.direction);
      // A "shame" for a positive change or below-average excess is not a shame.
      const valid = w && !(d.positiveOnly && !(w.value > 0)) && !(d.negativeOnly && !(w.value < 0));
      if (!valid) return card(d);
      return card(d, {
        winner: { id: w.item.id, name: w.item.name },
        value: d.format(w.value, w.item),
        stats: (d.detail ? d.detail(w.item, w.value) : []).map(text => ({ text, experimental: false })),
        sample: w.item.appearances + " matches"
      });
    });

    return { hall: decide(hallDefs), shame: decide(shameDefs), eligible: pool.length, comparesPrevious: hasPrevious };
  }

  // ---------------------------------------------------- personalities

  // Fun, but measured: every component is the player's rate divided by what a
  // typical player produces in the same mix of position groups (1.0 =
  // typical). Rare events are floored so one card cannot dominate, and every
  // personality needs a minimum sample and a clear margin over typical.
  const PERSONALITY_MIN_INDEX = 1.25;
  const BADGE_MIN_INDEX = 1.5;
  const INDEX_CAP = 5;

  const PERSONALITIES = [
    { key: "livesOffside", title: "🚩 Lives Offside",
      description: "Treats the last defender as a rough suggestion. Most times caught offside.",
      components: [{ key: "expPlayerOffside" }], minTotal: 2 },
    { key: "otherTeam", title: "🤝 Plays for the Other Team",
      description: "So generous in their own third that the opposition should send a thank-you card.",
      components: [{ key: "defensiveThirdLosses", weight: 2 }, { key: "expBadPass" }], minTotal: 3 },
    { key: "passionate", title: "🔥 Most Passionate",
      description: "All heart, no brakes: sliding in, showing off and collecting cards.",
      components: [{ key: "slidingTackles" }, { key: "skillMoveBeats" }, { key: "yellowCards", floor: 0.3 }], minTotal: 3 },
    { key: "skillMerchant", title: "🎮 Skill Merchant",
      description: "Has watched every skills compilation on YouTube. Twice.",
      components: [{ key: "skillMoveBeats", weight: 2 }, { key: "playersBeaten" }], minTotal: 3,
      note: "EA records successful skill-move beats only, not attempts." },
    { key: "crabFC", title: "🦀 Crab FC",
      description: "Sideways, backwards, anything but forwards.",
      components: [{ key: "backwardPassShare" }] },
    { key: "shootDonkey", title: "🫣 Shoot, You Donkey!",
      description: "EA was screaming 'shoot!' and they passed anyway.",
      components: [{ key: "expShouldHaveShot" }], minTotal: 2 },
    { key: "butterfingers", title: "🧈 Butterfingers",
      description: "The ball is slippery and so are they.",
      components: [{ key: "possessionLost" }] },
    { key: "brexitDefender", title: "🧱 Brexit Defender",
      description: "Nothing gets in. Heads everything, blocks everything.",
      components: [{ key: "aerialDuelsWonDefending" }, { key: "crossesBlocked" }], groups: ["DEF", "MID"], minTotal: 3,
      note: "EA does not record clearances, so this uses defensive aerials won and crosses blocked as a defender or midfielder." },
    { key: "walkingYellow", title: "🟨 Walking Yellow Card",
      description: "The referee knows them by first name.",
      components: [{ key: "foulsConceded" }, { key: "yellowCards", floor: 0.3 }, { key: "redCards", floor: 0.3 },
                   { key: "dangerousTackles", floor: 0.3 }], minTotal: 3 },
    { key: "mainCharacter", title: "🧠 Main Character Syndrome",
      description: "Why pass when you can take on four players and lose it to the fifth?",
      components: [{ key: "dribblesCompleted" }, { key: "possessionLost" }], mode: "both" },
    { key: "stormtrooper", title: "🥅 Stormtrooper",
      description: "Shoots a lot, hits very little.",
      components: [{ key: "shotAccuracy", direction: "low", minAttempts: 8 }] },
    { key: "chaosMerchant", title: "🎢 Chaos Merchant",
      description: "Scores, assists, gives it away, repeat. Never boring.",
      components: [{ key: "goalInvolvements", floor: 0.3 }, { key: "possessionLost" }], mode: "both" }
  ];

  function componentIndex(rows, allRows, comp, minMatches) {
    const metric = S.getMetric(comp.key);
    const r = roleAdjusted(rows, allRows, comp.key);
    if (!r || r.value === null || r.expected === null) return null;
    const agg = r.aggregate;
    if (agg.matchesWithData < minMatches) return null;
    const isRatio = metric.type === "ratio";
    if (isRatio && (agg.denominator || 0) < (comp.minAttempts || metric.minAttempts)) return null;
    const floor = isRatio ? 1 : (comp.floor || 0.15);
    const raw = comp.direction === "low"
      ? Math.max(r.expected, floor) / Math.max(r.value, floor)
      : Math.max(r.value, 0) / Math.max(r.expected, floor);
    const experimental = metric.confidence === "experimental";
    return {
      key: comp.key,
      label: metric.label,
      experimental,
      isRatio,
      value: r.value,
      expected: r.expected,
      unit: r.unit,
      total: isRatio ? null : agg.total,
      matches: agg.matchesWithData,
      index: Math.min(raw, INDEX_CAP),
      text: metric.label + ": " + unitValue(r.value, r.unit) + " vs " + unitValue(r.expected, r.unit) + " typical" +
        (isRatio ? " (" + agg.numerator + "/" + agg.denominator + ")" : " (" + agg.total + " in " + agg.matchesWithData + " matches)")
    };
  }

  function personalityFor(def, player, allRows, minMatches) {
    const rows = def.groups ? player.rows.filter(r => def.groups.includes(S.positionGroup(r))) : player.rows;
    if (!rows.filter(S.isAppearance).length) return null;
    const comps = def.components.map(c => componentIndex(rows, allRows, c, minMatches));
    const present = comps.map((c, i) => c && { c, weight: def.components[i].weight || 1 }).filter(Boolean);
    if (!present.length) return null;
    if (def.mode === "both" && present.length < comps.length) return null;
    const events = sum(present.filter(x => !x.c.isRatio).map(x => x.c.total || 0));
    if (def.minTotal && events < def.minTotal) return null;
    const index = def.mode === "both"
      ? Math.min(...present.map(x => x.c.index))
      : sum(present.map(x => x.c.index * x.weight)) / sum(present.map(x => x.weight));
    return {
      index,
      components: present.map(x => x.c),
      matches: Math.max(...present.map(x => x.c.matches))
    };
  }

  function personalities(prepared, rows, minMatches) {
    const players = S.groupByPlayer(rows).filter(p => p.rows.filter(S.isAppearance).length >= minMatches);
    const allRows = prepared.rows;
    const earned = {};
    const list = PERSONALITIES.map(def => {
      const experimental = def.components.some(c => S.getMetric(c.key).confidence === "experimental");
      const results = players
        .map(p => ({ p, r: personalityFor(def, p, allRows, minMatches) }))
        .filter(x => x.r)
        .sort((a, b) => b.r.index - a.r.index || b.r.matches - a.r.matches);
      results.forEach(x => {
        (earned[x.p.id] = earned[x.p.id] || []).push({ key: def.key, title: def.title, index: x.r.index });
      });
      const top = results[0];
      const base = card(Object.assign({ kind: "personality", experimental }, def));
      if (!top || top.r.index < PERSONALITY_MIN_INDEX) {
        return Object.assign(base, { candidates: results.length });
      }
      return Object.assign(base, {
        candidates: results.length,
        winner: { id: top.p.id, name: top.p.name },
        index: top.r.index,
        value: fmt(top.r.index, 1) + "× typical",
        stats: top.r.components.map(c => ({ text: c.text, experimental: c.experimental })),
        sample: top.r.matches + " matches"
      });
    });

    const won = {};
    list.forEach(a => { if (a.winner) won[a.winner.id + "|" + a.key] = true; });
    const badges = {};
    Object.entries(earned).forEach(([id, items]) => {
      badges[id] = items
        .map(b => Object.assign({}, b, { winner: !!won[id + "|" + b.key] }))
        .filter(b => b.winner || b.index >= BADGE_MIN_INDEX)
        .sort((a, b) => (b.winner - a.winner) || b.index - a.index)
        .slice(0, 3);
    });
    return { awards: list, badges, minMatches };
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
    const group = mainGroupOf(score.byGroup);
    if (!group) return [];
    return score.weaknesses
      .filter(w => TIPS[w.key])
      .slice(0, 3)
      .map(w => {
        const metric = S.getMetric(w.key);
        const groupRows = playerRows.filter(r => S.positionGroup(r) === group);
        const bench = benchmarks[group] && benchmarks[group].metrics[w.key];
        const agg = S.aggregate(groupRows.length ? groupRows : playerRows, w.key);
        const mine = metric.type === "ratio" ? agg.rate : rateOfAggregate(agg);
        const typical = bench ? median(bench.values) : null;
        const unit = metric.type === "ratio" ? "%" : " per 90";
        return {
          metric: w.key,
          title: w.label,
          tip: TIPS[w.key],
          evidence: "As a " + groupLabel(group) + ": " + fmt(mine, 1) + unit +
            " vs a typical " + fmt(typical, 1) + unit + " (" + agg.matchesWithData + " matches with data; better than " +
            Math.round(w.percentile) + "% of " + groupLabel(group) + " appearances)."
        };
      });
  }

  // ------------------------------------------------- explain the score

  function describeComponents(prepared, playerRows, explanation) {
    const group = explanation.mainGroup;
    const groupRows = playerRows.filter(r => S.positionGroup(r) === group);
    explanation.components.forEach(c => {
      const metric = S.getMetric(c.key);
      const agg = S.aggregate(groupRows, c.key);
      const bench = prepared.benchmarks[group] && prepared.benchmarks[group].metrics[c.key];
      c.mine = metric.type === "ratio" ? agg.rate : rateOfAggregate(agg);
      c.typical = bench && bench.values.length ? median(bench.values) : null;
      c.unit = metric.type === "ratio" ? "%" : rateUnit(agg);
      c.inMainGroup = agg.matchesWithData;
    });
    return explanation;
  }

  // Why A is above (or below) B: the components whose points differ most.
  function compareExplanations(a, b) {
    const keys = new Set(a.components.map(c => c.key).concat(b.components.map(c => c.key)));
    const pointsOf = (ex, key) => {
      const c = ex.components.find(x => x.key === key);
      return c ? c.points : 0;
    };
    return [...keys].map(key => ({
      key,
      label: S.getMetric(key).label,
      diff: pointsOf(a, key) - pointsOf(b, key)
    })).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  }

  function scoreExplanation(prepared, table, playerId) {
    const entry = table.find(t => t.id === playerId);
    if (!entry) return null;
    const ex = S.explainScore(entry.rows, prepared.benchmarks);
    if (!ex) return null;
    describeComponents(prepared, entry.rows, ex);

    const ranked = rankScores(table.slice()).qualified;
    const position = ranked.findIndex(t => t.id === playerId);
    const neighbour = (other, relation) => {
      if (!other) return null;
      const otherEx = S.explainScore(other.rows, prepared.benchmarks);
      if (!otherEx) return null;
      const reasons = compareExplanations(ex, otherEx);
      const gap = ex.score - otherEx.score;
      const favour = reasons.filter(r => (gap >= 0 ? r.diff > 0 : r.diff < 0)).slice(0, 3);
      return { id: other.id, name: other.name, relation, score: otherEx.score, gap, reasons: favour };
    };

    const sameGroup = ranked.filter(t => mainGroupOf(t.byGroup) === ex.mainGroup);
    const groupRank = sameGroup.findIndex(t => t.id === playerId);
    return Object.assign(ex, {
      id: entry.id,
      name: entry.name,
      status: entry.status,
      rank: position === -1 ? null : ranked[position].rank,
      of: ranked.length,
      groupRank: groupRank === -1 ? null : groupRank + 1,
      groupOf: sameGroup.length,
      above: position > 0 ? neighbour(ranked[position - 1], "above") : null,
      below: position !== -1 && position < ranked.length - 1 ? neighbour(ranked[position + 1], "below") : null
    });
  }

  // ------------------------------------------------------------- form

  const FORM_WINDOW = 5;
  const FORM_MIN = 3;
  const PERIOD_MIN = { week: 2, month: 3 };

  function metricWindowValue(prepared, rows, metricKey) {
    if (metricKey === "pandaScore") {
      const scores = rows.map(r => S.scoreAppearance(r, prepared.benchmarks)).filter(s => s && s.score !== null);
      return { value: mean(scores.map(s => s.score)), sample: scores.length };
    }
    const metric = S.getMetric(metricKey);
    const agg = S.aggregate(rows, metricKey);
    const value = metric.type === "ratio" ? agg.rate : metric.type === "mean" ? agg.mean
      : metric.display === "total" ? agg.total
      : rateOfAggregate(agg);
    return { value, sample: agg.matchesWithData };
  }

  function rowCounts(prepared, row, metricKey) {
    if (!S.isAppearance(row) || !S.parseTimestamp(row)) return false;
    if (metricKey === "pandaScore") {
      const s = S.scoreAppearance(row, prepared.benchmarks);
      return !!(s && s.score !== null);
    }
    return S.rowHasData(row, S.getMetric(metricKey));
  }

  function trend(metricKey, before, change) {
    if (change === null || change === undefined || !Number.isFinite(change)) return { direction: "unknown", good: null };
    const metric = metricKey === "pandaScore" ? null : S.getMetric(metricKey);
    const threshold = !metric || metric.type === "ratio" ? 3 : Math.max(0.05, Math.abs(before || 0) * 0.15);
    if (Math.abs(change) < threshold) return { direction: "steady", good: null };
    const direction = change > 0 ? "up" : "down";
    const higher = metric ? metric.higherIsBetter : true;
    return { direction, good: higher === null ? null : (direction === "up") === higher };
  }

  // Totals are not comparable between windows of different sizes, so form
  // always compares rates (or the per-match mean for counts shown as totals).
  function formValue(prepared, rows, metricKey) {
    const v = metricWindowValue(prepared, rows, metricKey);
    if (metricKey !== "pandaScore" && S.getMetric(metricKey).display === "total" && v.sample) {
      return { value: v.value / v.sample, sample: v.sample };
    }
    return v;
  }

  function lastFive(prepared, playerRows, metricKey) {
    const ordered = playerRows.filter(r => rowCounts(prepared, r, metricKey))
      .sort((a, b) => S.parseTimestamp(a) - S.parseTimestamp(b));
    const last = ordered.slice(-FORM_WINDOW);
    const prev = ordered.slice(-2 * FORM_WINDOW, -FORM_WINDOW);
    const a = formValue(prepared, last, metricKey);
    const b = formValue(prepared, prev, metricKey);
    const ready = a.sample >= FORM_MIN && b.sample >= FORM_MIN;
    const change = ready && a.value !== null && b.value !== null ? a.value - b.value : null;
    return {
      last: a,
      previous: b,
      ready,
      needs: ready ? null : "Needs " + FORM_MIN + "+ matches in both windows (has " + a.sample + " and " + b.sample + ")",
      change,
      trend: trend(metricKey, b.value, change)
    };
  }

  function periodCompare(prepared, playerRows, metricKey, period, now) {
    const counted = playerRows.filter(r => rowCounts(prepared, r, metricKey));
    if (!counted.length) return { ready: false, needs: "No matches with this data" };
    const latest = counted.map(r => S.periodKey(S.parseTimestamp(r), period)).sort().pop();
    const previous = S.previousPeriodKey(latest, period);
    const within = key => {
      const b = S.periodBounds(key, period);
      return counted.filter(r => {
        const d = S.parseTimestamp(r);
        return d >= b.start && d < b.end;
      });
    };
    const a = formValue(prepared, within(latest), metricKey);
    const b = formValue(prepared, within(previous), metricKey);
    const min = PERIOD_MIN[period];
    const ready = a.sample >= min && b.sample >= min;
    const change = ready && a.value !== null && b.value !== null ? a.value - b.value : null;
    return {
      period,
      current: Object.assign({ key: latest, inProgress: !S.isPeriodComplete(latest, period, now) }, a),
      previous: Object.assign({ key: previous }, b),
      ready,
      needs: ready ? null : "Needs " + min + "+ matches in " + latest + " and in " + previous + " (has " + a.sample + " and " + b.sample + ")",
      change,
      trend: trend(metricKey, b.value, change)
    };
  }

  function playerForm(prepared, playerRows, now) {
    const recent = playerRows.filter(r => rowCounts(prepared, r, "pandaScore"))
      .sort((a, b) => S.parseTimestamp(a) - S.parseTimestamp(b))
      .slice(-FORM_WINDOW)
      .map(r => ({
        score: S.scoreAppearance(r, prepared.benchmarks).score,
        when: S.parseTimestamp(r).getTime(),
        group: S.positionGroup(r),
        result: r.result || null
      }));
    return {
      recent,
      lastFive: lastFive(prepared, playerRows, "pandaScore"),
      week: periodCompare(prepared, playerRows, "pandaScore", "week", now),
      month: periodCompare(prepared, playerRows, "pandaScore", "month", now)
    };
  }

  function formTable(prepared, rows, metricKey) {
    const players = S.groupByPlayer(rows).map(p => Object.assign({ id: p.id, name: p.name }, lastFive(prepared, p.rows, metricKey)));
    const ready = players.filter(p => p.ready && p.change !== null);
    const score = p => (p.trend.good === false ? -1 : 1) * Math.abs(p.change) * (p.trend.direction === "steady" ? 0 : 1);
    return {
      metric: metricKey,
      ready: ready.sort((a, b) => score(b) - score(a) || b.change - a.change),
      waiting: players.filter(p => !(p.ready && p.change !== null)).sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  // ------------------------------------------------------------- evolution

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
      points: keys.map(k => Object.assign({ period: k }, metricWindowValue(prepared, inPeriod(p.rows, k), metricKey)))
    }));

    const squad = keys.map(k => Object.assign({ period: k, complete: S.isPeriodComplete(k, period, now) },
      metricWindowValue(prepared, inPeriod(rows, k), metricKey)));

    const metric = metricKey === "pandaScore" ? null : S.getMetric(metricKey);
    const isRatio = metric && metric.type === "ratio";
    // Movers compare consecutive completed periods with enough matches; a
    // half-played week or a single match is noise.
    const movers = series.map(s => {
      const pts = s.points.filter(p => p.value !== null && p.sample >= MIN_MOVER_SAMPLE &&
        S.isPeriodComplete(p.period, period, now));
      if (pts.length < 2) return null;
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      if (S.previousPeriodKey(last.period, period) !== prev.period) return null;
      const lastV = metric && metric.display === "total" ? last.value / last.sample : last.value;
      const prevV = metric && metric.display === "total" ? prev.value / prev.sample : prev.value;
      const change = lastV - prevV;
      return { id: s.id, name: s.name, from: prev.period, to: last.period,
               change, unit: isRatio ? " pp" : metric && metric.display === "total" ? " /match" : "",
               trend: trend(metricKey, prevV, change),
               samples: [prev.sample, last.sample] };
    }).filter(Boolean);
    const better = m => m.trend.good !== false && m.trend.direction !== "steady";
    const worse = m => m.trend.good === false;

    return {
      period,
      metric: metricKey,
      metricLabel: metric ? metric.label : "Panda Score",
      unit: metric ? (metric.type === "ratio" ? "%" : metric.display === "total" ? "total" : "per 90") : "score",
      direction: metric ? metric.higherIsBetter : true,
      keys,
      complete: keys.map(k => S.isPeriodComplete(k, period, now)),
      series,
      squad,
      improvers: movers.filter(better).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3),
      decliners: movers.filter(worse).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3),
      form: formTable(prepared, rows, metricKey)
    };
  }

  // ----------------------------------------------------------- Weekly Bamboo

  const WEEKLY_MIN_MATCHES = 2;

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
    const table = scoreTable(prepared, weekRows, WEEKLY_MIN_MATCHES);
    const prevTable = scoreTable(prepared, within(rows, prevBounds), WEEKLY_MIN_MATCHES);

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
      personalities: personalities(prepared, weekRows, WEEKLY_MIN_MATCHES),
      minMatches: WEEKLY_MIN_MATCHES,
      coverage: coverage(weekRows)
    };
  }

  // ------------------------------------------------- archetype advisor

  // Focus of each archetype, written from the community descriptions
  // (proclubsbuilder.co.uk, Dexerto). It maps an archetype to the recorded
  // stats it is built around; it says nothing about attributes or PlayStyles.
  const STYLE_DIMENSIONS = {
    finishing: { label: "Finishing", metrics: ["goals", "shotAccuracy", "conversion"] },
    creating: { label: "Chance creation", metrics: ["assists", "throughPasses", "secondAssists"] },
    passing: { label: "Passing security", metrics: ["passAccuracy", "shortPassAccuracy"] },
    progression: { label: "Progressive passing", metrics: ["forwardPassesCompleted", "longPassAccuracy", "switchesOfPlay"] },
    dribbling: { label: "Dribbling", metrics: ["playersBeaten", "dribblesCompleted"] },
    crossing: { label: "Crossing", metrics: ["crossesCompleted"] },
    defending: { label: "Defending", metrics: ["interceptions", "tacklesWon", "tackleSuccess"] },
    ballWinning: { label: "Ball winning", metrics: ["possessionWon", "highRecoveries"] },
    aerial: { label: "Aerial duels", metrics: ["aerialDuelsWonDefending", "aerialDuelsWonAttacking"] },
    security: { label: "Ball security", metrics: ["possessionLost"] },
    goalkeeping: { label: "Goalkeeping", metrics: ["saves", "saveRate"] }
  };

  const ARCHETYPE_PROFILES = {
    1: { groups: ["GK"], focus: "shot stopping", dims: { goalkeeping: 2 } },
    2: { groups: ["GK"], focus: "sweeping and distribution", dims: { goalkeeping: 1.5, passing: 1 } },
    3: { groups: ["DEF"], focus: "progressive passing from the back", dims: { progression: 2, defending: 1, passing: 1 } },
    4: { groups: ["DEF"], focus: "tackling and aerial duels", dims: { defending: 2, aerial: 2 } },
    5: { groups: ["DEF"], focus: "attacking full-back play", dims: { crossing: 2, dribbling: 1, defending: 1 } },
    6: { groups: ["MID", "DEF"], focus: "winning the ball back", dims: { ballWinning: 2, defending: 1.5 } },
    7: { groups: ["MID"], focus: "intercepting and recycling possession", dims: { defending: 1.5, security: 1.5, passing: 1 } },
    8: { groups: ["MID"], focus: "tempo passing", dims: { passing: 2, progression: 1.5, security: 1 } },
    9: { groups: ["MID", "ATT"], focus: "chance creation", dims: { creating: 2, progression: 1 } },
    10: { groups: ["ATT", "MID"], focus: "wide running and crossing", dims: { dribbling: 2, crossing: 1.5 } },
    11: { groups: ["ATT", "MID"], focus: "dribbling and creativity", dims: { dribbling: 2, creating: 1, finishing: 1 } },
    12: { groups: ["ATT"], focus: "finishing", dims: { finishing: 2.5, dribbling: 0.5 } },
    13: { groups: ["ATT"], focus: "aerial threat in the box", dims: { aerial: 2, finishing: 1.5 } }
  };

  const ADVISOR = {
    minScored: 4,
    proven: 5,
    medium: 8,
    high: 15,
    minPeerMatches: 3,
    minPeers: 4,
    weakDimension: 45,
    changeWindow: 5,
    changeMin: 3
  };

  const ARCHETYPE_NOTE = "Archetype names are community-inferred: EA sends only an id (1–13) and the names follow the order published by proclubsbuilder.co.uk. Raw ids are shown. Attributes, PlayStyles and exact positions are not in EA's data and are never guessed.";

  function playerValue(rows, key) {
    const metric = S.getMetric(key);
    const agg = S.aggregate(rows, key);
    if (agg.matchesWithData < ADVISOR.minPeerMatches) return null;
    if (metric.type === "ratio") return (agg.denominator || 0) >= metric.minAttempts ? agg.rate : null;
    return rateOfAggregate(agg);
  }

  const distributionCache = new WeakMap();

  function peerDistribution(prepared, group, key) {
    let cache = distributionCache.get(prepared.rows);
    if (!cache) {
      cache = new Map();
      distributionCache.set(prepared.rows, cache);
    }
    const id = group + "|" + key;
    if (!cache.has(id)) {
      const values = S.groupByPlayer(prepared.rows.filter(r => S.positionGroup(r) === group))
        .map(p => playerValue(p.rows, key))
        .filter(v => v !== null)
        .sort((a, b) => a - b);
      cache.set(id, values);
    }
    return cache.get(id);
  }

  function styleProfile(prepared, playerRows, group) {
    const rows = playerRows.filter(r => S.positionGroup(r) === group);
    const out = {};
    Object.entries(STYLE_DIMENSIONS).forEach(([key, dim]) => {
      const evidence = dim.metrics.map(mk => {
        const metric = S.getMetric(mk);
        const value = playerValue(rows, mk);
        if (value === null) return null;
        const dist = peerDistribution(prepared, group, mk);
        if (dist.length < ADVISOR.minPeers) return null;
        let pct = S.percentile(dist, value);
        if (metric.higherIsBetter === false) pct = 100 - pct;
        const unit = metric.type === "ratio" ? "%" : rateUnit(S.aggregate(rows, mk));
        return { key: mk, label: metric.label, value, unit, percentile: pct, peers: dist.length,
                 text: metric.label + " " + unitValue(value, unit) + " (better than " + Math.round(pct) + "% of " + groupLabel(group, true) + ")" };
      }).filter(Boolean);
      out[key] = { key, label: dim.label, score: evidence.length ? mean(evidence.map(e => e.percentile)) : null, evidence };
    });
    return out;
  }

  function archetypeUsage(timeline, apps) {
    const usage = {};
    apps.forEach(r => {
      if (!r.archetypeId) return;
      const id = String(r.archetypeId);
      const u = usage[id] || (usage[id] = { id, name: S.archetypeName(id), appearances: 0, scored: [], groups: {} });
      u.appearances++;
      const g = S.positionGroup(r);
      if (g) u.groups[g] = (u.groups[g] || 0) + 1;
    });
    timeline.forEach(x => {
      if (x.row.archetypeId && usage[String(x.row.archetypeId)]) usage[String(x.row.archetypeId)].scored.push(x.s.score);
    });
    return Object.values(usage).map(u => ({
      id: u.id,
      name: u.name,
      appearances: u.appearances,
      scoredMatches: u.scored.length,
      averageScore: mean(u.scored),
      groups: u.groups,
      proven: u.scored.length >= ADVISOR.proven
    })).sort((a, b) => b.appearances - a.appearances);
  }

  function archetypeChange(timeline) {
    const withArch = timeline.filter(x => x.row.archetypeId);
    let idx = -1;
    for (let i = withArch.length - 1; i > 0; i--) {
      if (String(withArch[i].row.archetypeId) !== String(withArch[i - 1].row.archetypeId)) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return null;
    const fromId = String(withArch[idx - 1].row.archetypeId);
    const toId = String(withArch[idx].row.archetypeId);
    const before = [];
    for (let i = idx - 1; i >= 0 && before.length < ADVISOR.changeWindow; i--) {
      if (String(withArch[i].row.archetypeId) !== fromId) break;
      before.unshift(withArch[i].s.score);
    }
    const after = withArch.slice(idx).map(x => x.s.score).slice(-ADVISOR.changeWindow);
    const ready = before.length >= ADVISOR.changeMin && after.length >= ADVISOR.changeMin;
    return {
      from: { id: fromId, name: S.archetypeName(fromId) },
      to: { id: toId, name: S.archetypeName(toId) },
      when: withArch[idx].when.getTime(),
      before: { average: mean(before), matches: before.length },
      after: { average: mean(after), matches: after.length },
      ready,
      change: ready ? mean(after) - mean(before) : null,
      needs: ready ? null : "Needs " + ADVISOR.changeMin + "+ scored matches either side of the switch"
    };
  }

  function archetypeAdvisor(prepared, playerRows) {
    const apps = playerRows.filter(S.isAppearance);
    const timeline = apps
      .map(row => ({ row, when: S.parseTimestamp(row), s: S.scoreAppearance(row, prepared.benchmarks) }))
      .filter(x => x.when && x.s && x.s.score !== null)
      .sort((a, b) => a.when - b.when);
    const usage = archetypeUsage(timeline, apps);
    const groupCounts = {};
    timeline.forEach(x => { groupCounts[x.s.group] = (groupCounts[x.s.group] || 0) + 1; });
    const groups = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);
    const base = { usage, change: archetypeChange(timeline), note: ARCHETYPE_NOTE, requirement: ADVISOR.minScored };

    if (!groups.length || groups[0][1] < ADVISOR.minScored) {
      return Object.assign(base, {
        status: "insufficient",
        have: groups.length ? groups[0][1] : 0,
        message: "Needs " + ADVISOR.minScored + "+ scored matches in one position group before recommending a build."
      });
    }

    const main = groups[0][0];
    const mainCount = groups[0][1];
    const second = groups[1] && groups[1][1] >= ADVISOR.changeMin ? groups[1][0] : null;
    const profiles = { [main]: styleProfile(prepared, playerRows, main) };
    if (second) profiles[second] = styleProfile(prepared, playerRows, second);
    const confidence = mainCount >= ADVISOR.high ? "High" : mainCount >= ADVISOR.medium ? "Medium" : "Low";
    const used = new Set(usage.map(u => u.id));
    const usageById = {};
    usage.forEach(u => { usageById[u.id] = u; });

    const fits = Object.entries(ARCHETYPE_PROFILES).map(([id, prof]) => {
      const group = prof.groups.includes(main) ? main : second && prof.groups.includes(second) ? second : null;
      if (!group) return null;
      const dims = profiles[group];
      let weighted = 0;
      let covered = 0;
      let total = 0;
      const parts = [];
      Object.entries(prof.dims).forEach(([d, w]) => {
        total += w;
        if (dims[d] && dims[d].score !== null) {
          weighted += w * dims[d].score;
          covered += w;
          parts.push({ dim: dims[d], weight: w });
        }
      });
      if (covered < total * 0.5) return null;
      const u = usageById[id];
      return {
        id,
        name: S.archetypeName(id),
        focus: prof.focus,
        group,
        fit: weighted / covered,
        evidence: parts.sort((a, b) => b.weight * b.dim.score - a.weight * a.dim.score)
          .slice(0, 2)
          .flatMap(p => p.dim.evidence.slice(0, 1).map(e => e.text)),
        used: used.has(id),
        proven: u && u.proven ? { average: u.averageScore, matches: u.scoredMatches } : null,
        tried: u ? u.appearances : 0
      };
    }).filter(Boolean).sort((a, b) => b.fit - a.fit);

    const mainFits = fits.filter(f => f.group === main);
    let best = mainFits[0] || fits[0] || null;
    const provenBest = mainFits.filter(f => f.proven).sort((a, b) => b.proven.average - a.proven.average)[0];
    if (provenBest && best && provenBest !== best && provenBest.proven.average >= 50 && best.fit - provenBest.fit <= 8) best = provenBest;
    const alternative = fits.find(f => f !== best && !f.used) || null;

    const weak = Object.values(profiles[main]).filter(d => d.score !== null && d.score < ADVISOR.weakDimension)
      .sort((a, b) => a.score - b.score);
    const development = mainFits
      .filter(f => f !== best && f !== alternative)
      .map(f => {
        const prof = ARCHETYPE_PROFILES[f.id];
        const targets = weak.filter(d => prof.dims[d.key]);
        const gain = sum(targets.map(d => prof.dims[d.key] * (50 - d.score)));
        return { f, gain, targets };
      })
      .filter(x => x.gain > 0)
      .sort((a, b) => b.gain - a.gain)[0] || null;

    const recommendation = (role, f, basis, why) => f && {
      role, id: f.id, name: f.name, focus: f.focus, group: f.group, fit: f.fit, basis, why,
      evidence: f.evidence
    };
    const bestBasis = best && best.proven ? "Proven" : best && best.tried ? "Tried, mostly predicted" : "Predicted";
    const bestWhy = !best ? "" : best.proven
      ? "Proven: " + fmt(best.proven.average, 0) + " average Panda Score over " + best.proven.matches + " scored matches with this archetype. Style match " + fmt(best.fit, 0) + "/100."
      : "Predicted from your " + groupLabel(best.group) + " stats: style match " + fmt(best.fit, 0) + "/100" +
        (best.tried ? " (used in " + best.tried + " matches, too few to prove)." : ".");

    return Object.assign(base, {
      status: "ok",
      mainGroup: main,
      secondGroup: second,
      scoredInMain: mainCount,
      confidence,
      profile: Object.values(profiles[main]).filter(d => d.score !== null).sort((a, b) => b.score - a.score),
      fits,
      recommendations: [
        recommendation("Best fit", best, bestBasis, bestWhy),
        recommendation("Alternative playstyle", alternative, "Predicted",
          alternative ? "Not used yet. Predicted style match " + fmt(alternative.fit, 0) + "/100 as a " + groupLabel(alternative.group) + "." : ""),
        development && recommendation("Development build", development.f,
          development.f.proven ? "Proven" : development.f.used ? "Tried" : "Predicted",
          "Built around your weakest recorded area: " + development.targets.map(d => d.label + " (" + Math.round(d.score) + "th percentile among " + groupLabel(main, true) + ")").join(", ") + ".")
      ].filter(Boolean)
    });
  }

  // ----------------------------------------------------------- Panda Lab

  function lab(prepared, rows, playerId, state, context) {
    const ctx = context || {};
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
          display: metric.display === "total" ? "total" : metric.type === "ratio" ? "rate" : "per90",
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

    const groups = {};
    player.rows.filter(S.isAppearance).forEach(r => {
      const g = S.positionGroup(r) || "Unknown";
      groups[g] = (groups[g] || 0) + 1;
    });

    const formRows = (ctx.formRows || rows).filter(r => String(r.playerId) === player.id);
    return {
      id: player.id,
      name: player.name,
      players: players.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
      score,
      rating: S.aggregate(player.rows, "rating"),
      groups,
      coverage: coverage(player.rows),
      categories,
      passing: S.directionalPassing(player.rows),
      tips: coachingTips(score, prepared.benchmarks, player.rows),
      explanation: ctx.table ? scoreExplanation(prepared, ctx.table, player.id) : null,
      form: playerForm(prepared, formRows, ctx.now || new Date()),
      badges: (ctx.badges && ctx.badges[player.id]) || []
    };
  }

  // -------------------------------------------------------- Squad & Builds

  function squad(prepared, rows, state, context) {
    const ctx = context || {};
    const table = scoreTable(prepared, rows, state.minMatches);
    return table.map(t => {
      const best = Object.entries(t.byGroup)
        .map(([g, v]) => ({ group: g, label: S.GROUP_LABELS[g], score: v.score, appearances: v.appearances,
                            tentative: v.appearances < 5 }))
        .sort((a, b) => b.score - a.score);
      const strongest = best.find(g => !g.tentative) || best[0] || null;
      const ex = S.explainScore(t.rows, prepared.benchmarks);
      if (ex) describeComponents(prepared, t.rows, ex);
      const keyLine = c => ({ label: c.label, percentile: c.percentile, mine: c.mine, typical: c.typical, unit: c.unit, impact: c.impact });
      const allRows = (ctx.formRows || rows).filter(r => String(r.playerId) === t.id);
      const advisor = archetypeAdvisor(prepared, allRows);
      const top = advisor.usage[0];
      return {
        id: t.id,
        name: t.name,
        score: t.score,
        status: t.status,
        appearances: t.appearances,
        groups: best,
        bestGroup: strongest,
        goals: S.aggregate(t.rows, "goals").total,
        assists: S.aggregate(t.rows, "assists").total,
        rating: S.aggregate(t.rows, "rating").mean,
        archetype: top ? { id: top.id, name: top.name, appearances: top.appearances } : null,
        strengths: t.strengths,
        positives: ex ? ex.strongest.slice(0, 2).map(keyLine) : [],
        negatives: ex ? ex.weakest.slice(0, 2).map(keyLine) : [],
        form: lastFive(prepared, allRows, "pandaScore"),
        recent: playerForm(prepared, allRows, ctx.now || new Date()).recent,
        badges: (ctx.badges && ctx.badges[t.id]) || [],
        advisor
      };
    }).sort((a, b) => (b.score === null ? -1 : b.score) - (a.score === null ? -1 : a.score));
  }

  // ------------------------------------------------------------- clubhouse

  function clubhouse(prepared, formRows, bamboo) {
    const form = formTable(prepared, formRows, "pandaScore");
    const funny = bamboo.week ? bamboo.personalities.awards.filter(a => a.winner) : [];
    return {
      hot: form.ready.filter(p => p.trend.direction === "up").slice(0, 3),
      cold: form.ready.filter(p => p.trend.direction === "down").sort((a, b) => a.change - b.change).slice(0, 3),
      funny: funny.sort((a, b) => (a.experimental - b.experimental) || b.index - a.index).slice(0, 4)
    };
  }

  // ------------------------------------------------------------------ build

  function build(prepared, state, now, selectedPlayer) {
    const st = Object.assign({}, DEFAULT_STATE, state);
    const filters = filtersFor(st, now);
    const rows = S.filterRows(prepared.rows, filters);
    const matches = filteredMatches(prepared, Object.assign({}, filters, { groups: null }));
    const players = S.groupByPlayer(rows);
    const table = scoreTable(prepared, rows, st.minMatches);

    // All-time awards and personalities follow the club filter only.
    const clubRows = S.filterRows(prepared.rows, filtersFor(Object.assign({}, st, { period: "all", group: "all" }), now));
    const allTimeTable = scoreTable(prepared, clubRows, st.minMatches);
    const allTimePersonalities = personalities(prepared, clubRows, st.minMatches);
    // Form ignores the period filter: "last five" means the last five.
    const formRows = S.filterRows(prepared.rows, Object.assign({}, filters, { from: null, to: null }));
    const bamboo = weeklyBamboo(prepared, st, now);
    const context = { table, formRows, badges: allTimePersonalities.badges, now };

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
        bamboo,
        clubhouse: clubhouse(prepared, formRows, bamboo)
      },
      rankings: {
        scores: rankScores(table),
        categories: DISPLAY_CATEGORIES.map(c => ({ key: c.key, label: c.label })),
        categoryRankings: cat => categoryRankings(players, DISPLAY_CATEGORIES.find(c => c.key === cat) || DISPLAY_CATEGORIES[0], st)
      },
      evolution: evolution(prepared, rows, st, now),
      lab: lab(prepared, rows, selectedPlayer, st, context),
      squad: squad(prepared, rows, st, context),
      awards: Object.assign(awards(prepared, clubRows, allTimeTable, null), { personalities: allTimePersonalities })
    };
  }

  // -------------------------------------------------------------- rankings

  function categoryRankings(players, category, state) {
    return category.metrics.map(key => {
      const metric = S.getMetric(key);
      const asTotal = metric.display === "total";
      const view = metric.type === "ratio" ? "rate" : asTotal ? "total" : "per90";
      const r = S.rank(players, key, { minMatches: state.minMatches, view });
      const usePerMatch = !asTotal && metric.type === "count" && r.ranked.concat(r.provisional).every(e => e.aggregate.per90 === null);
      const ranking = usePerMatch ? S.rank(players, key, { minMatches: state.minMatches, view: "perMatch" }) : r;
      return {
        key,
        label: metric.label,
        description: metric.description,
        confidence: metric.confidence,
        formula: S.formula(metric),
        direction: metric.higherIsBetter === null ? "context" : metric.higherIsBetter ? "higher" : "lower",
        unit: metric.type === "ratio" ? "%" : asTotal ? "total" : usePerMatch ? "per match" : "per 90",
        minAttempts: metric.minAttempts,
        ranking
      };
    });
  }

  return {
    DISPLAY_CATEGORIES,
    LAB_CATEGORIES,
    PERIODS,
    MATCH_TYPES,
    DEFAULT_STATE,
    TIPS,
    PERSONALITIES,
    ARCHETYPE_PROFILES,
    STYLE_DIMENSIONS,
    ADVISOR,
    periodRange,
    filtersFor,
    prepare,
    coverage,
    roleAdjusted,
    awards,
    personalities,
    coachingTips,
    scoreExplanation,
    lastFive,
    periodCompare,
    playerForm,
    formTable,
    evolution,
    weeklyBamboo,
    archetypeAdvisor,
    lab,
    squad,
    scoreTable,
    rankScores,
    categoryRankings,
    build
  };
})();
