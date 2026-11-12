// ==========================================
// PANDAMETRICS V4 - STATISTICS ENGINE
// ==========================================
//
// Pure functions only (no SpreadsheetApp, no DOM) so the same file runs in
// Apps Script, in the browser and under `node --test`.
// Wrapped in one object: google.script.run cannot call object members, so
// nothing here is exposed to anonymous dashboard visitors.

var PandaStats = (function () {
  "use strict";

  const TIMEZONE = "Europe/London";
  const SECONDS_PER_90 = 5400;

  // Short cameos inflate per-90 rates; treat anything shorter as 20 minutes.
  const MIN_SECONDS_FOR_RATE = 1200;

  // ----------------------------------------------------------- positions

  // EA clubs/matches only reports a position group per appearance. Exact
  // positions (CB, CDM, ST, ...) are not available from the API.
  const POSITION_GROUPS = {
    goalkeeper: "GK",
    defender: "DEF",
    midfielder: "MID",
    forward: "ATT"
  };

  const GROUP_LABELS = {
    GK: "Goalkeeper",
    DEF: "Defender",
    MID: "Midfielder",
    ATT: "Attacker"
  };

  const GROUPS = ["ATT", "MID", "DEF", "GK"];

  function positionGroup(row) {
    const explicit = String(row.positionGroup || "").trim().toUpperCase();
    if (GROUP_LABELS[explicit]) return explicit;
    const pos = String(row.position || "").trim().toLowerCase();
    return POSITION_GROUPS[pos] || null;
  }

  // -------------------------------------------------------------- values

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function toBool(value) {
    if (value === true || value === false) return value;
    const text = String(value).trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
    return null;
  }

  // ---------------------------------------------------- row data quality

  // V4 rows carry appearanceStatus/eventCoverage. V3 rows (imported before
  // V4) do not, so the same rules are re-derived from their raw fields.
  function isAppearance(row) {
    if (row.appearanceStatus) return row.appearanceStatus !== "did_not_play";
    const seconds = toNumber(row.secondsPlayed);
    return seconds === null || seconds > 0;
  }

  function eventsUsable(row) {
    if (row.eventCoverage) return row.eventCoverage === "complete";
    const flag = toBool(row.eventsAvailable);
    if (flag !== null) return flag;
    const completed = toNumber(row.passesCompleted);
    const failed = toNumber(row.passesFailed);
    if (completed === null && failed === null) return false;
    const attempts = toNumber(row.passAttempts);
    if (attempts !== null && attempts >= 10 &&
        (completed || 0) + (failed || 0) < attempts * 0.5) {
      return false;
    }
    return true;
  }

  function dedupeAppearances(rows) {
    const seen = new Set();
    const out = [];
    let dropped = 0;
    rows.forEach(row => {
      const key = [row.clubId, row.matchId, row.playerId].map(String).join("|");
      if (seen.has(key)) {
        dropped++;
        return;
      }
      seen.add(key);
      out.push(row);
    });
    return { rows: out, dropped };
  }

  // ------------------------------------------------------ metric registry

  const PASS_DIRECTION_FIELDS = [
    "passesCompletedForward", "passesFailedForward",
    "passesCompletedBackward", "passesFailedBackward",
    "passesCompletedSideways", "passesFailedSideways"
  ];

  const CATEGORIES = {
    passing: "Passing",
    attacking: "Attacking & finishing",
    creativity: "Creativity",
    defending: "Defending",
    possession: "Possession",
    decisions: "Decision-making & positioning",
    discipline: "Discipline",
    specialist: "Specialist",
    experimental: "Experimental",
    overall: "Overall"
  };

  // type:
  //   count - summed field(s); shown as total, per match and per 90
  //   ratio - pooled sum(numerator) / sum(denominator) * 100
  //   mean  - average of a per-appearance value (EA rating)
  // higherIsBetter: true / false / null (context only, never "good" or "bad")
  // confidence: verified (EA named field), high (community-confirmed event),
  //             medium (derived/caveated), experimental (not used in scores)
  const METRICS = [
    // Passing
    m("passesCompleted", "Passes completed", "passing", "count", { fields: ["passesMade"] },
      "ea", "verified", true,
      "Completed passes from EA's named total.",
      { overlap: "EA counts a pass that leads to an offside as completed." }),
    m("passAccuracy", "Pass accuracy", "passing", "ratio",
      { numerator: ["passesMade"], denominator: ["passAttempts"] },
      "ea", "verified", true,
      "Completed passes as a share of attempted passes.",
      { minAttempts: 30, shrinkage: 10,
        overlap: "Passes leading to an offside count as completed (EA definition)." }),
    m("forwardPassesCompleted", "Forward passes completed", "passing", "count",
      { fields: ["passesCompletedForward"] }, "event", "high", true,
      "Completed passes played forward. A progression proxy, not metres gained."),
    m("forwardPassAccuracy", "Forward-pass accuracy", "passing", "ratio",
      { numerator: ["passesCompletedForward"],
        denominator: ["passesCompletedForward", "passesFailedForward"] },
      "event", "medium", true,
      "Completed forward passes as a share of forward pass attempts.",
      { minAttempts: 15, shrinkage: 8,
        overlap: "Reads high: direction events cover ~98% of completed but only ~78% of failed passes (community research)." }),
    m("forwardPassShare", "Forward-pass share", "passing", "ratio",
      { numerator: ["passesCompletedForward", "passesFailedForward"],
        denominator: PASS_DIRECTION_FIELDS },
      "event", "medium", null,
      "Share of pass attempts with a known direction that were played forward.",
      { minAttempts: 30,
        overlap: "Passes without a direction event are excluded from both sides; failed directions are under-recorded." }),
    m("backwardPassShare", "Backward-pass share", "passing", "ratio",
      { numerator: ["passesCompletedBackward", "passesFailedBackward"],
        denominator: PASS_DIRECTION_FIELDS },
      "event", "medium", null,
      "Share of pass attempts with a known direction that were played backward. Context, not a fault: compare with positional peers.",
      { minAttempts: 30 }),
    m("shortPassAccuracy", "Short-pass accuracy", "passing", "ratio",
      { numerator: ["passesCompletedShort"],
        denominator: ["passesCompletedShort", "passesFailedShort"] },
      "event", "high", true, "Completed short passes as a share of short attempts.",
      { minAttempts: 15 }),
    m("mediumPassAccuracy", "Medium-pass accuracy", "passing", "ratio",
      { numerator: ["passesCompletedMedium"],
        denominator: ["passesCompletedMedium", "passesFailedMedium"] },
      "event", "high", true, "Completed medium passes as a share of medium attempts.",
      { minAttempts: 10 }),
    m("longPassAccuracy", "Long-pass accuracy", "passing", "ratio",
      { numerator: ["passesCompletedLong"],
        denominator: ["passesCompletedLong", "passesFailedLong"] },
      "event", "high", true, "Completed long passes as a share of long attempts.",
      { minAttempts: 8 }),
    m("firstTimePasses", "First-time passes", "passing", "count",
      { fields: ["firstTimePasses"] }, "event", "high", true, "First-time passes played."),
    m("switchesOfPlay", "Switches of play", "passing", "count",
      { fields: ["switchesOfPlay"] }, "event", "high", true, "Switch-of-play passes."),
    m("flairPasses", "Flair passes", "passing", "count",
      { fields: ["flairPasses"] }, "event", "high", true, "Fancy passes completed."),
    m("crossesCompleted", "Crosses completed", "passing", "count",
      { fields: ["passesCompletedCross"] }, "event", "high", true,
      "Completed crosses, including set pieces.",
      { overlap: "Includes set-piece crosses; failed crosses are open play only." }),
    m("crossAccuracy", "Cross accuracy", "passing", "ratio",
      { numerator: ["passesCompletedCross"],
        denominator: ["passesCompletedCross", "passesFailedCross"] },
      "event", "experimental", true,
      "Completed crosses as a share of crosses. Biased upward: completed crosses include set pieces, failed crosses are open play only.",
      { minAttempts: 8 }),
    m("offsidePasses", "Passes into offside", "passing", "count",
      { fields: ["offsidePasses"] }, "event", "high", false,
      "Passes to a team-mate who was caught offside. Not the same as this player being offside."),

    // Attacking & finishing
    m("goals", "Goals", "attacking", "count", { fields: ["goals"] },
      "ea", "verified", true, "Goals scored (EA named total)."),
    m("goalInvolvements", "Goal involvements", "attacking", "count",
      { fields: ["goals", "assists"] }, "ea", "verified", true, "Goals plus assists."),
    m("shots", "Shots", "attacking", "count", { fields: ["shots"] },
      "ea", "verified", true, "Shots taken (EA named total)."),
    m("shotAccuracy", "Shot accuracy", "attacking", "ratio",
      { numerator: ["shotsOnTarget"], denominator: ["shotsOnTarget", "shotsOffTarget"] },
      "event", "high", true, "Shots on target as a share of shots.",
      { minAttempts: 5, shrinkage: 3,
        overlap: "Blocked shots can be folded into on-target counts." }),
    m("conversion", "Shot conversion", "attacking", "ratio",
      { numerator: ["goals"], denominator: ["shots"] },
      "ea", "verified", true, "Goals per shot.",
      { minAttempts: 5, shrinkage: 3 }),
    m("goalsFirstTime", "First-time goals", "attacking", "count",
      { fields: ["goalsFirstTime"] }, "event", "high", true,
      "Goals from first-time shots. A tag on goals: never add to the goal total."),
    m("goalsWeakFoot", "Weak-foot goals", "attacking", "count",
      { fields: ["goalsWeakFoot"] }, "event", "high", true,
      "Goals with the weak foot. A tag on goals: never add to the goal total."),
    m("goalsOffPost", "Goals off the post", "attacking", "count",
      { fields: ["goalsOffPost"] }, "event", "high", true,
      "Goals that went in off the post. A tag on goals: never add to the goal total."),
    m("shotsInsideBox", "Shots inside the box", "attacking", "count",
      { fields: ["shotsOnTargetInsideBox", "shotsOffTargetInsideBox"] }, "event", "high", true,
      "Shots from inside the box, on and off target.",
      { overlap: "A breakdown of shots, not an extra shot total." }),
    m("shotsOutsideBox", "Shots outside the box", "attacking", "count",
      { fields: ["shotsOnTargetOutsideBox", "shotsOffTargetOutsideBox"] }, "event", "high", true,
      "Shots from outside the box, on and off target.",
      { overlap: "A breakdown of shots, not an extra shot total." }),

    // Creativity
    m("assists", "Assists", "creativity", "count", { fields: ["assists"] },
      "ea", "verified", true, "Assists (EA named total)."),
    m("secondAssists", "Second assists", "creativity", "count",
      { fields: ["secondAssists"] }, "event", "high", true, "The pass before the assist."),
    m("throughPasses", "Through balls", "creativity", "count",
      { fields: ["throughPasses"] }, "event", "high", true, "Successful through balls."),
    m("throughBallAssists", "Through-ball assists", "creativity", "count",
      { fields: ["throughBallAssists"] }, "event", "high", true,
      "Assists from through balls. A tag on assists: never add to the assist total."),

    // Defending
    m("tacklesWon", "Tackles won", "defending", "count", { fields: ["tacklesMade"] },
      "ea", "verified", true, "Successful tackles (EA named total).",
      { overlap: "Do not add dispossessions: they can describe the same action." }),
    m("tacklesLost", "Tackles lost", "defending", "count", { fields: ["tacklesLost"] },
      "event", "high", false, "Tackles attempted and lost.",
      { overlap: "The other half of tackle success. Do not add this to tackles won." }),
    m("tackleSuccess", "Tackle success", "defending", "ratio",
      { numerator: ["tacklesMade"], denominator: ["tackleAttempts"] },
      "ea", "verified", true, "Successful tackles as a share of tackle attempts.",
      { minAttempts: 5, shrinkage: 4 }),
    m("interceptions", "Interceptions", "defending", "count",
      { fields: ["interceptions"] }, "event", "high", true, "Passes intercepted."),
    m("opponentsDispossessed", "Dispossessions", "defending", "count",
      { fields: ["opponentsDispossessed"] }, "event", "high", true,
      "Times this player took the ball from an opponent.",
      { overlap: "Can overlap tackles won; never sum the two." }),
    m("crossesBlocked", "Crosses blocked", "defending", "count",
      { fields: ["crossesBlocked"] }, "event", "high", true, "Crosses blocked."),
    m("aerialDuelsWonDefending", "Defensive aerials won", "defending", "count",
      { fields: ["aerialDuelsWonDefending"] }, "event", "high", true,
      "Aerial duels won while defending. No success rate: lost duels are not decoded."),
    m("aerialDuelsWonAttacking", "Attacking aerials won", "attacking", "count",
      { fields: ["aerialDuelsWonAttacking"] }, "event", "high", true,
      "Aerial duels won while attacking. No success rate: lost duels are not decoded."),
    m("dangerousTackles", "Dangerous tackles", "discipline", "count",
      { fields: ["dangerousTackles"] }, "event", "high", false, "Dangerous tackles."),

    // Possession
    m("possessionWon", "Possession won", "possession", "count",
      { fields: ["possessionWonDefensiveThird", "possessionWonMiddleThird",
                 "possessionWonAttackingThird"] },
      "event", "high", true, "Possession won across all three thirds."),
    m("highRecoveries", "High recoveries", "possession", "count",
      { fields: ["possessionWonAttackingThird"] }, "event", "high", true,
      "Possession won in the attacking third."),
    m("possessionLost", "Possession lost", "possession", "count",
      { fields: ["possessionLostDefensiveThird", "possessionLostMiddleThird",
                 "possessionLostAttackingThird"] },
      "event", "high", false,
      "Possession lost across all three thirds. Attackers naturally lose more in the final third; compare with positional peers.",
      { strengthLabel: "Ball security", weaknessLabel: "Loses the ball often" }),
    m("defensiveThirdLosses", "Defensive-third losses", "possession", "count",
      { fields: ["possessionLostDefensiveThird"] }, "event", "high", false,
      "Possession lost near your own goal: the riskiest losses.",
      { strengthLabel: "Safe in own third", weaknessLabel: "Risky losses near own goal" }),
    m("dribblesCompleted", "Dribbles completed", "possession", "count",
      { fields: ["dribblesCompleted"] }, "event", "high", true, "Dribbles completed."),
    m("playersBeaten", "Players beaten", "possession", "count",
      { fields: ["dribblesBeat", "dribblesSkillMoveBeat"] }, "event", "high", true,
      "Opponents beaten while dribbling, with or without a skill move.",
      { overlap: "The two counters do not overlap: skill-move beats are counted separately." }),

    // Decision-making & positioning (EA in-game feedback, not validated tactics)
    m("bestOptionTaken", "Best option taken", "decisions", "count",
      { fields: ["feedbackBestOptionTaken"] }, "event", "high", true,
      "EA feedback: the player chose the best available option."),
    m("shouldHavePassedElsewhere", "Missed a better pass", "decisions", "count",
      { fields: ["feedbackShouldHavePassedElsewhere"] }, "event", "high", false,
      "EA feedback: a better pass was available."),
    m("goodDecisionShare", "Good-decision share", "decisions", "ratio",
      { numerator: ["feedbackBestOptionTaken", "feedbackGoodOptionTaken"],
        denominator: ["feedbackBestOptionTaken", "feedbackGoodOptionTaken",
                      "feedbackShouldHavePassedElsewhere"] },
      "event", "medium", true,
      "Good or best options as a share of all graded passing decisions. Derived from EA gameplay feedback.",
      { minAttempts: 10 }),
    m("outOfPosition", "Out of position", "decisions", "count",
      { fields: ["outOfPosition"] }, "event", "high", false,
      "Times EA flagged the player out of position (any severity).",
      { strengthLabel: "Positional discipline", weaknessLabel: "Often out of position" }),
    m("severeOutOfPosition", "Badly out of position", "decisions", "count",
      { fields: ["outOfPositionSeverity4", "outOfPositionSeverity5"] },
      "event", "high", false, "Out-of-position flags at severity 4 or 5 of 5."),
    m("inPosition", "In position", "decisions", "count",
      { fields: ["inPosition"] }, "event", "high", true,
      "Times EA praised this player's positioning."),
    m("noGoodOption", "No good option", "decisions", "count",
      { fields: ["feedbackNoGoodOption"] }, "event", "high", null,
      "EA feedback that no good pass was on. Context, not a mistake."),

    // Discipline
    m("foulsConceded", "Fouls conceded", "discipline", "count",
      { fields: ["foulsConceded"] }, "event", "high", false, "Fouls committed."),
    m("yellowCards", "Yellow cards", "discipline", "count",
      { fields: ["yellowCards"] }, "event", "high", false, "Yellow cards."),
    m("redCards", "Red cards", "discipline", "count", { fields: ["redCards"] },
      "ea", "verified", false, "Red cards (EA named total)."),
    m("penaltiesConceded", "Penalties conceded", "discipline", "count",
      { fields: ["penaltiesConceded"] }, "event", "high", false, "Penalties given away."),
    m("foulsWon", "Fouls won", "discipline", "count",
      { fields: ["foulsWon"] }, "event", "high", null, "Times this player was fouled."),

    // Specialist
    m("saves", "Saves", "specialist", "count", { fields: ["saves"] },
      "ea", "verified", true, "Saves (EA named total)."),
    m("goalsConceded", "Goals conceded", "specialist", "count",
      { fields: ["goalsConceded"] }, "ea", "verified", false,
      "Goals conceded while on the pitch (EA named total).",
      { strengthLabel: "Hard to beat", weaknessLabel: "Concedes often" }),
    m("cornersTaken", "Corners taken", "specialist", "count",
      { fields: ["cornersTaken"] }, "event", "high", null, "Corners taken."),
    m("cleanSheets", "Clean sheets", "specialist", "count",
      { fields: ["cleanSheetDef", "cleanSheetGK"] }, "ea", "verified", true,
      "Clean sheets EA awarded for this appearance. Counted for defenders and goalkeepers only.",
      { eligibleGroups: ["DEF", "GK"] }),
    m("saveRate", "Save rate", "specialist", "ratio",
      { numerator: ["saves"], denominator: ["saves", "goalsConceded"] },
      "derived", "medium", true,
      "Saves as a share of saves plus goals conceded, for goalkeeper appearances only. Goals conceded are not the same as shots faced.",
      { minAttempts: 5, shrinkage: 3, eligibleGroups: ["GK"] }),
    m("manOfTheMatch", "EA man of the match", "specialist", "count",
      { fields: ["manOfTheMatch"] }, "ea", "verified", true,
      "Times EA named this player man of the match. Shown as a fun fact, not as an overall ranking."),

    // Experimental community ids. Mappings are partial; never used in scores or awards.
    m("expPlayerOffside", "Caught offside", "experimental", "count",
      { fields: ["expPlayerOffside"] }, "event", "experimental", false,
      "Times this player was caught offside. Experimental mapping of event 104; the count is often short.",
      { overlap: "Not the same as a pass that put a team-mate offside." }),
    m("expBadPass", "Bad pass", "experimental", "count",
      { fields: ["expBadPass"] }, "event", "experimental", false,
      "Experimental mapping of event 151, possibly a hospital or poor pass. Not verified enough to score."),
    m("expOpenPlayCrosses", "Open-play crosses", "experimental", "count",
      { fields: ["expOpenPlayCrosses"] }, "event", "experimental", null,
      "Experimental mapping of event 157: open-play crosses attempted. Add event 145 when a corner is crossed."),
    m("expShouldHaveShot", "Should have shot", "experimental", "count",
      { fields: ["expShouldHaveShot"] }, "event", "experimental", false,
      "Experimental mapping of event 179: EA thought a shot was on. Checked on only a handful of matches."),

    // Overall
    m("rating", "EA match rating", "overall", "mean", { fields: ["rating"] },
      "ea", "verified", true,
      "Average EA match rating. Shown for reference; not used in the Panda Score because it favours attackers.")
  ];

  function m(key, label, category, type, spec, source, confidence,
             higherIsBetter, description, extra) {
    return Object.assign({
      key, label, category, type, source, confidence, higherIsBetter, description,
      fields: spec.fields || null,
      numerator: spec.numerator || null,
      denominator: spec.denominator || null,
      minAttempts: 0,
      shrinkage: 0,
      overlap: "",
      eligibleGroups: null,
      strengthLabel: label,
      weaknessLabel: label
    }, extra || {});
  }

  const METRIC_INDEX = {};
  METRICS.forEach(metric => { METRIC_INDEX[metric.key] = metric; });

  function getMetric(key) {
    const metric = METRIC_INDEX[key];
    if (!metric) throw new Error("Unknown metric: " + key);
    return metric;
  }

  function requiredFields(metric) {
    if (metric.type === "ratio") {
      return [...new Set(metric.numerator.concat(metric.denominator))];
    }
    return metric.fields;
  }

  function formula(metric) {
    if (metric.type === "ratio") {
      return "sum(" + metric.numerator.join(" + ") + ") / sum(" +
        metric.denominator.join(" + ") + ") × 100";
    }
    if (metric.type === "mean") return "mean(" + metric.fields[0] + ")";
    return "sum(" + metric.fields.join(" + ") + ")";
  }

  // Experimental community event ids. The raw log is never sent to the
  // browser; these four counts are copied onto the row instead.
  const EXPERIMENTAL_FIELDS = {
    104: "expPlayerOffside",
    151: "expBadPass",
    157: "expOpenPlayCrosses",
    179: "expShouldHaveShot"
  };

  function parseRawEvents(value) {
    if (value === null || value === undefined || value === "") return null;
    const counts = new Map();
    String(value).split(",").forEach(part => {
      const bits = part.split(":");
      if (bits.length !== 2 || !/^\d+$/.test(bits[0]) || !/^\d+$/.test(bits[1])) return;
      counts.set(Number(bits[0]), Number(bits[1]));
    });
    return counts;
  }

  // Null when the row has no raw event log and no extracted count.
  // A present log with the id missing is a real zero.
  function experimentalFields(row) {
    const parsed = parseRawEvents(row.rawEvents);
    const out = {};
    Object.entries(EXPERIMENTAL_FIELDS).forEach(([id, field]) => {
      if (parsed) out[field] = parsed.has(Number(id)) ? parsed.get(Number(id)) : 0;
      else out[field] = toNumber(row[field]);
    });
    return out;
  }

  // ------------------------------------------------------- aggregation

  function rowEligible(row, metric) {
    return !metric.eligibleGroups || metric.eligibleGroups.includes(positionGroup(row));
  }

  function rowHasData(row, metric) {
    if (!isAppearance(row) || !rowEligible(row, metric)) return false;
    if (metric.source === "event" && !eventsUsable(row)) return false;
    return requiredFields(metric).every(field => toNumber(row[field]) !== null);
  }

  function sumFields(row, fields) {
    return fields.reduce((total, field) => total + toNumber(row[field]), 0);
  }

  // Pooled aggregate over appearance rows. Rows lacking the metric's inputs
  // are excluded from both numerator and denominator (missing != zero).
  function aggregate(rows, key) {
    const metric = getMetric(key);
    const appearances = rows.filter(row => isAppearance(row) && rowEligible(row, metric));
    const withData = appearances.filter(row => rowHasData(row, metric));

    const seconds = withData.map(row => toNumber(row.secondsPlayed));
    const secondsKnown = seconds.every(s => s !== null && s > 0);
    const totalSeconds = secondsKnown ? seconds.reduce((a, b) => a + b, 0) : null;

    const result = {
      key,
      appearances: appearances.length,
      matchesWithData: withData.length,
      missing: appearances.length - withData.length,
      seconds: totalSeconds,
      total: null,
      perMatch: null,
      per90: null,
      numerator: null,
      denominator: null,
      rate: null,
      mean: null
    };

    if (!withData.length) return result;

    if (metric.type === "ratio") {
      result.numerator = withData.reduce((a, row) => a + sumFields(row, metric.numerator), 0);
      result.denominator = withData.reduce((a, row) => a + sumFields(row, metric.denominator), 0);
      result.rate = result.denominator > 0
        ? result.numerator / result.denominator * 100
        : null;
      return result;
    }

    if (metric.type === "mean") {
      const values = withData.map(row => toNumber(row[metric.fields[0]]));
      result.mean = values.reduce((a, b) => a + b, 0) / values.length;
      return result;
    }

    result.total = withData.reduce((a, row) => a + sumFields(row, metric.fields), 0);
    result.perMatch = result.total / withData.length;
    result.per90 = totalSeconds ? result.total / totalSeconds * SECONDS_PER_90 : null;
    return result;
  }

  // The single value used for ranking a metric under a given view.
  function headlineValue(agg, metric, view) {
    if (metric.type === "ratio") return agg.rate;
    if (metric.type === "mean") return agg.mean;
    if (view === "total") return agg.total;
    if (view === "per90") return agg.per90;
    return agg.perMatch;
  }

  // ------------------------------------------------------- qualification

  function qualify(agg, key, thresholds) {
    const metric = getMetric(key);
    const minMatches = (thresholds && thresholds.minMatches) || 0;
    const minAttempts = thresholds && thresholds.minAttempts !== undefined
      ? thresholds.minAttempts
      : metric.minAttempts;
    const reasons = [];

    if (!agg.matchesWithData) return { status: "no_data", reasons: ["No matches with this data"] };

    if (agg.matchesWithData < minMatches) {
      reasons.push(agg.matchesWithData + " of " + minMatches + " matches");
    }
    if (metric.type === "ratio" && (agg.denominator || 0) < minAttempts) {
      reasons.push((agg.denominator || 0) + " of " + minAttempts + " attempts");
    }
    if (metric.type === "ratio" && agg.rate === null) {
      return { status: "no_data", reasons: ["No attempts"] };
    }
    return { status: reasons.length ? "provisional" : "qualified", reasons };
  }

  // --------------------------------------------------------- grouping

  // Player identity is EA playerId (verified stable across all three clubs).
  function groupByPlayer(rows) {
    const map = new Map();
    rows.forEach(row => {
      const id = String(row.playerId || "").trim();
      if (!id) return;
      if (!map.has(id)) map.set(id, { id, name: null, latest: -Infinity, rows: [] });
      const player = map.get(id);
      player.rows.push(row);
      const when = parseTimestamp(row);
      const t = when ? when.getTime() : -Infinity;
      if (row.name && (t >= player.latest || !player.name)) {
        player.name = String(row.name);
        player.latest = t;
      }
    });
    return [...map.values()].map(p => ({ id: p.id, name: p.name || p.id, rows: p.rows }));
  }

  // Filters apply to appearances before aggregation.
  function filterRows(rows, filters) {
    const f = filters || {};
    return rows.filter(row => {
      if (f.clubIds && f.clubIds.length && !f.clubIds.includes(String(row.clubId))) return false;
      if (f.matchTypes && f.matchTypes.length && !f.matchTypes.includes(String(row.matchType || "leagueMatch"))) return false;
      if (f.groups && f.groups.length && !f.groups.includes(positionGroup(row))) return false;
      if (f.playerIds && f.playerIds.length && !f.playerIds.includes(String(row.playerId))) return false;
      if (f.from || f.to) {
        const when = parseTimestamp(row);
        if (!when) return false;
        if (f.from && when < f.from) return false;
        if (f.to && when >= f.to) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------ ranking

  function compareValues(a, b, higherIsBetter) {
    return higherIsBetter === false ? a - b : b - a;
  }

  // Competition ranking (1, 2, 2, 4). Provisional players are listed
  // separately and never receive a rank.
  function rank(players, key, options) {
    const metric = getMetric(key);
    const opts = options || {};
    const view = opts.view || "perMatch";
    const thresholds = { minMatches: opts.minMatches || 0 };
    if (opts.minAttempts !== undefined) thresholds.minAttempts = opts.minAttempts;

    const entries = players.map(player => {
      const agg = aggregate(player.rows, key);
      const q = qualify(agg, key, thresholds);
      return {
        id: player.id,
        name: player.name,
        value: headlineValue(agg, metric, view),
        aggregate: agg,
        status: q.status,
        reasons: q.reasons
      };
    });

    const direction = metric.higherIsBetter === null ? true : metric.higherIsBetter;
    const byValue = (a, b) =>
      compareValues(a.value, b.value, direction) ||
      b.aggregate.matchesWithData - a.aggregate.matchesWithData ||
      String(a.name).localeCompare(String(b.name));

    const ranked = entries
      .filter(e => e.status === "qualified" && e.value !== null)
      .sort(byValue);

    let previous = null;
    ranked.forEach((entry, index) => {
      entry.rank = previous !== null && entry.value === previous.value ? previous.rank : index + 1;
      previous = entry;
    });

    return {
      metric: key,
      view,
      contextOnly: metric.higherIsBetter === null,
      ranked,
      provisional: entries.filter(e => e.status === "provisional" && e.value !== null).sort(byValue),
      noData: entries.filter(e => e.status === "no_data" || e.value === null)
    };
  }

  // ------------------------------------------------- Panda Score (role-aware)

  // Per-appearance weights by the position group actually played in that
  // match. Only verified/high-confidence metrics; no EA rating, no
  // experimental events, and no source field used by two components of the
  // same role (enforced by tests).
  const ROLE_WEIGHTS = {
    ATT: { goals: 3, assists: 2, shotAccuracy: 1.5, dribblesCompleted: 1,
           highRecoveries: 1, passAccuracy: 1 },
    MID: { passAccuracy: 2, forwardPassesCompleted: 2, assists: 1.5, goals: 1,
           throughPasses: 1, interceptions: 1, tacklesWon: 1, possessionLost: 1 },
    DEF: { interceptions: 2, defensiveThirdLosses: 2, tackleSuccess: 2,
           passAccuracy: 1.5, aerialDuelsWonDefending: 1, crossesBlocked: 0.5,
           outOfPosition: 1 },
    GK: { saves: 2, goalsConceded: 2, passAccuracy: 1 }
  };

  const SCORE_SETTINGS = {
    minBenchmarkAppearances: 10,
    minWeightCoverage: 0.6
  };

  // One appearance's value for a metric, comparable across appearances:
  // counts per 90 (minimum 20 minutes), ratios shrunk towards the benchmark
  // rate so a 1/1 shot does not count as 100%.
  function appearanceValue(row, metric, priorRate) {
    if (!rowHasData(row, metric)) return null;

    if (metric.type === "ratio") {
      const num = sumFields(row, metric.numerator);
      const den = sumFields(row, metric.denominator);
      const k = metric.shrinkage || 0;
      if (den + k === 0) return null;
      const prior = priorRate === null || priorRate === undefined ? 0 : priorRate;
      return (num + k * prior) / (den + k) * 100;
    }

    if (metric.type === "mean") return toNumber(row[metric.fields[0]]);

    const total = sumFields(row, metric.fields);
    const seconds = toNumber(row.secondsPlayed);
    if (seconds === null || seconds <= 0) return total;
    return total / Math.max(seconds, MIN_SECONDS_FOR_RATE) * SECONDS_PER_90;
  }

  function percentile(sorted, value) {
    if (!sorted.length) return null;
    let below = 0;
    let equal = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] < value) below++;
      else if (sorted[i] === value) equal++;
      else break;
    }
    return (below + equal / 2) / sorted.length * 100;
  }

  // Benchmarks: for each role and metric, the distribution of appearance
  // values among all appearances in that role. Small roles fall back to all
  // appearances so one or two games do not define "typical".
  function buildBenchmarks(rows) {
    const appearances = rows.filter(row => isAppearance(row) && positionGroup(row));
    const benchmarks = {};

    Object.keys(ROLE_WEIGHTS).forEach(group => {
      const groupRows = appearances.filter(row => positionGroup(row) === group);
      benchmarks[group] = { appearances: groupRows.length, metrics: {} };

      Object.keys(ROLE_WEIGHTS[group]).forEach(key => {
        const metric = getMetric(key);
        let source = groupRows.filter(row => rowHasData(row, metric));
        let fallback = false;
        if (source.length < SCORE_SETTINGS.minBenchmarkAppearances) {
          source = appearances.filter(row => rowHasData(row, metric));
          fallback = true;
        }
        const pooled = metric.type === "ratio" ? aggregate(source, key).rate : null;
        const prior = pooled === null ? null : pooled / 100;
        const values = source
          .map(row => appearanceValue(row, metric, prior))
          .filter(v => v !== null)
          .sort((a, b) => a - b);
        benchmarks[group].metrics[key] = { values, prior, fallback, sample: values.length };
      });
    });
    return benchmarks;
  }

  function scoreAppearance(row, benchmarks) {
    const group = positionGroup(row);
    if (!group || !isAppearance(row) || !ROLE_WEIGHTS[group]) return null;

    const weights = ROLE_WEIGHTS[group];
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    let usedWeight = 0;
    let weighted = 0;
    const contributions = {};

    Object.keys(weights).forEach(key => {
      const metric = getMetric(key);
      const bench = benchmarks[group].metrics[key];
      if (!bench || !bench.values.length) return;
      const value = appearanceValue(row, metric, bench.prior);
      if (value === null) return;
      let pct = percentile(bench.values, value);
      if (metric.higherIsBetter === false) pct = 100 - pct;
      contributions[key] = { value, percentile: pct, weight: weights[key], fallback: bench.fallback };
      usedWeight += weights[key];
      weighted += pct * weights[key];
    });

    const coverage = usedWeight / totalWeight;
    if (coverage < SCORE_SETTINGS.minWeightCoverage) {
      return { group, score: null, coverage, contributions, reason: "Not enough data for this role" };
    }
    return { group, score: weighted / usedWeight, coverage, contributions };
  }

  // Player score = mean of per-appearance role scores, so a player who
  // splits time between roles is judged against the right peers each match.
  function pandaScore(playerRows, benchmarks, options) {
    const opts = options || {};
    const minMatches = opts.minMatches || 0;
    const scored = playerRows
      .map(row => scoreAppearance(row, benchmarks))
      .filter(s => s && s.score !== null);

    const byGroup = {};
    const metricPct = {};
    scored.forEach(s => {
      byGroup[s.group] = byGroup[s.group] || { total: 0, appearances: 0 };
      byGroup[s.group].total += s.score;
      byGroup[s.group].appearances++;
      Object.entries(s.contributions).forEach(([key, c]) => {
        metricPct[key] = metricPct[key] || { total: 0, count: 0 };
        metricPct[key].total += c.percentile;
        metricPct[key].count++;
      });
    });

    const score = scored.length
      ? scored.reduce((a, s) => a + s.score, 0) / scored.length
      : null;

    Object.keys(byGroup).forEach(group => {
      byGroup[group] = {
        score: byGroup[group].total / byGroup[group].appearances,
        appearances: byGroup[group].appearances
      };
    });

    const metrics = Object.keys(metricPct).map(key => {
      const metric = getMetric(key);
      return {
        key,
        label: metric.label,
        strengthLabel: metric.strengthLabel,
        weaknessLabel: metric.weaknessLabel,
        percentile: metricPct[key].total / metricPct[key].count,
        appearances: metricPct[key].count
      };
    }).sort((a, b) => b.percentile - a.percentile);

    return {
      score,
      scoredAppearances: scored.length,
      status: score === null ? "no_data"
        : scored.length < minMatches ? "provisional" : "qualified",
      byGroup,
      strengths: metrics.filter(x => x.percentile >= 60).slice(0, 3)
        .map(x => Object.assign({}, x, { label: x.strengthLabel })),
      weaknesses: metrics.filter(x => x.percentile <= 40).reverse().slice(0, 3)
        .map(x => Object.assign({}, x, { label: x.weaknessLabel })),
      metrics
    };
  }

  // ------------------------------------------------------------- periods

  // Created on first use: every Apps Script request (including the webhook)
  // evaluates this file, so nothing that could fail runs at load time.
  let londonFormatter = null;

  function formatter() {
    if (!londonFormatter) {
      londonFormatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", hour12: false, weekday: "short"
      });
    }
    return londonFormatter;
  }

  const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  function parseTimestamp(row) {
    const unix = toNumber(row.timestampUnix);
    if (unix !== null && unix > 0) return new Date(unix * 1000);
    const value = row.timestamp;
    if (value instanceof Date) return isNaN(value) ? null : value;
    if (value === null || value === undefined || value === "") return null;
    const numeric = toNumber(value);
    if (numeric !== null) return new Date(numeric > 1e11 ? numeric : numeric * 1000);
    const parsed = new Date(String(value));
    return isNaN(parsed) ? null : parsed;
  }

  function londonParts(date) {
    const parts = {};
    formatter().formatToParts(date).forEach(p => { parts[p.type] = p.value; });
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour) % 24,
      weekday: WEEKDAYS[parts.weekday]
    };
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // Monday-Sunday weeks in Europe/London, keyed by the Monday's date.
  function weekKey(date) {
    const p = londonParts(date);
    const civil = new Date(Date.UTC(p.year, p.month - 1, p.day));
    civil.setUTCDate(civil.getUTCDate() - (p.weekday - 1));
    return civil.getUTCFullYear() + "-" + pad(civil.getUTCMonth() + 1) + "-" + pad(civil.getUTCDate());
  }

  function monthKey(date) {
    const p = londonParts(date);
    return p.year + "-" + pad(p.month);
  }

  function periodKey(date, period) {
    return period === "month" ? monthKey(date) : weekKey(date);
  }

  // A period is complete once "now" is in a later period.
  function isPeriodComplete(key, period, now) {
    return periodKey(now, period) > key;
  }

  // The UTC instant of 00:00 Europe/London on a civil date. London is UTC+0
  // or UTC+1, so midnight is either 00:00 or 23:00 (previous day) UTC.
  function londonMidnight(year, month, day) {
    const bst = new Date(Date.UTC(year, month - 1, day) - 3600 * 1000);
    const p = londonParts(bst);
    if (p.day === day && p.hour === 0) return bst;
    return new Date(Date.UTC(year, month - 1, day));
  }

  // [start, end) of a week ("YYYY-MM-DD" Monday) or month ("YYYY-MM") key.
  function periodBounds(key, period) {
    const [y, mo, d] = key.split("-").map(Number);
    if (period === "month") {
      const next = mo === 12 ? [y + 1, 1] : [y, mo + 1];
      return { start: londonMidnight(y, mo, 1), end: londonMidnight(next[0], next[1], 1) };
    }
    const civil = new Date(Date.UTC(y, mo - 1, d + 7));
    return {
      start: londonMidnight(y, mo, d),
      end: londonMidnight(civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate())
    };
  }

  function previousPeriodKey(key, period) {
    const { start } = periodBounds(key, period);
    return periodKey(new Date(start.getTime() - 3600 * 1000), period);
  }

  function percentagePointChange(before, after) {
    if (before === null || after === null || before === undefined || after === undefined) return null;
    return after - before;
  }

  // ----------------------------------------------------------- public API

  return {
    TIMEZONE,
    SECONDS_PER_90,
    POSITION_GROUPS,
    GROUP_LABELS,
    GROUPS,
    CATEGORIES,
    METRICS,
    ROLE_WEIGHTS,
    SCORE_SETTINGS,
    EXPERIMENTAL_FIELDS,
    experimentalFields,
    positionGroup,
    toNumber,
    isAppearance,
    eventsUsable,
    dedupeAppearances,
    getMetric,
    requiredFields,
    formula,
    aggregate,
    headlineValue,
    qualify,
    groupByPlayer,
    filterRows,
    rank,
    appearanceValue,
    percentile,
    buildBenchmarks,
    scoreAppearance,
    pandaScore,
    parseTimestamp,
    londonParts,
    weekKey,
    monthKey,
    periodKey,
    isPeriodComplete,
    londonMidnight,
    periodBounds,
    previousPeriodKey,
    percentagePointChange
  };
})();
