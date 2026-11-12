# Panda Score — Review

**Branch:** `feature/pandametrics-v4` · **Engine:** `apps-script/Stats.js` (`ROLE_WEIGHTS`, `scoreAppearance`, `pandaScore`) · **Distribution regenerated with:** `node tools/score_distribution.js` (reads the local, gitignored `samples/real_appearances.json`; output anonymised by rank).

## 1. What the score is

A position-adjusted rating from 0 to 100 where **50 is a typical appearance for that position group**. EA match rating is **not** an input.

1. **One score per appearance**, using the position group EA reported for *that match* (`pos` → ATT / MID / DEF / GK). A player who plays midfield on Monday and defence on Tuesday is compared with midfielders, then defenders.
2. **Each component becomes a percentile** against every appearance in the same group (the *benchmark*). Lower-is-better components (possession lost, defensive-third losses, out of position, goals conceded) are inverted (`100 − percentile`).
3. **Comparable per-appearance values**:
   - counts are per 90 minutes, with a 20-minute floor so a 5-minute cameo with one goal is not "18 goals per 90";
   - ratios are shrunk towards the group's pooled rate (`(made + k·prior) / (attempts + k)`), so 1/1 shots is not 100%.
4. **Weighted average** of the available component percentiles. Weights are below.
5. **Player score = mean of their appearance scores.** "Qualified" needs at least the minimum matches chosen in the dashboard (default 3 scored matches); fewer is shown as *provisional* and never ranked.

## 2. Role weights

Source key: **EA** = EA's named per-player totals (always present for a real appearance). **Event** = decoded `match_event_aggregate` events (blank when the match's event data is missing or truncated).

### Attackers (ATT) — total weight 9.5

| Component | Weight | Source fields | Type and handling | Why it is here |
|---|---|---|---|---|
| Goals | 3 | EA `goals` | per 90 | Primary output of the role |
| Assists | 2 | EA `assists` | per 90 | Chance creation |
| Shot accuracy | 1.5 | Event `shotsOnTarget`, `shotsOffTarget` | ratio, shrinkage k=3; ranking needs 5+ shots | Finishing quality, not volume |
| Dribbles completed | 1 | Event `dribblesCompleted` | per 90 | Beating a player |
| High recoveries | 1 | Event `possessionWonAttackingThird` | per 90 | Pressing from the front |
| Pass accuracy | 1 | EA `passesmade`, `passattempts` | ratio, k=10; ranking needs 30+ attempts | Link-up without giving the ball away |

### Midfielders (MID) — total weight 10.5

| Component | Weight | Source fields | Type and handling | Why it is here |
|---|---|---|---|---|
| Pass accuracy | 2 | EA `passesmade`, `passattempts` | ratio, k=10 | Ball retention |
| Forward passes completed | 2 | Event `passesCompletedForward` | per 90 | Progression: rewards playing forward, not safe sideways passes |
| Assists | 1.5 | EA `assists` | per 90 | Final ball |
| Goals | 1 | EA `goals` | per 90 | Goal threat from midfield |
| Through balls | 1 | Event `throughPasses` | per 90 | Line-breaking creativity |
| Interceptions | 1 | Event `interceptions` | per 90 | Reading the game |
| Tackles won | 1 | EA `tacklesmade` | per 90 | Winning the ball back |
| Possession lost | 1 (lower is better) | Event `possessionLost{Defensive,Middle,Attacking}Third` | per 90, inverted | Security on the ball |

### Defenders (DEF) — total weight 10

| Component | Weight | Source fields | Type and handling | Why it is here |
|---|---|---|---|---|
| Interceptions | 2 | Event `interceptions` | per 90 | Main defensive action in Pro Clubs |
| Defensive-third losses | 2 (lower is better) | Event `possessionLostDefensiveThird` | per 90, inverted | The most costly mistakes |
| Tackle success | 2 | EA `tacklesmade`, `tackleattempts` | ratio, k=4; ranking needs 5+ attempts | Timing, not lunging |
| Pass accuracy | 1.5 | EA `passesmade`, `passattempts` | ratio, k=10 | Playing out from the back |
| Defensive aerials won | 1 | Event `aerialDuelsWonDefending` | per 90 | Clearing crosses (EA has no aerials *lost*, so this is volume) |
| Crosses blocked | 0.5 | Event `crossesBlocked` | per 90 | Low weight: rare and opponent-dependent |
| Out of position | 1 (lower is better) | Event `outOfPosition` | per 90, inverted | Shape discipline |

### Goalkeepers (GK) — total weight 5 (untested)

| Component | Weight | Source fields | Handling |
|---|---|---|---|
| Saves | 2 | EA `saves` | per 90 |
| Goals conceded | 2 (lower is better) | EA `goalsconceded` | per 90, inverted |
| Pass accuracy | 1 | EA `passesmade`, `passattempts` | ratio, k=10 |

The club uses AI keepers, so there are **no GK appearances** in the data. The weights are defined so a human keeper would be scored, but they are unvalidated.

## 3. Missing and incomplete data

| Situation | Rows in real data | Handling |
|---|---|---|
| **Zero-minute entry** (`secondsPlayed = 0`, `realtimegame = 0`, no events; `appearanceStatus = did_not_play`) | 3 of 195 | Excluded everywhere: not an appearance, not in denominators, not in benchmarks, not scored. |
| **Event data missing** (`eventCoverage = missing`) | 3 | EA-backed components (goals, assists, pass accuracy, tackles, tackle success, saves) still count. Event components are skipped, never treated as 0. |
| **Event data truncated** (`eventCoverage = incomplete`: event pass attempts < 50% of EA `passattempts`, with 10+ attempts) | 3 | Same as missing: event components skipped. |
| **Not enough weight available** | 3 (2 MID, 1 DEF) | An appearance is scored only if components worth **≥ 60% of the role's weight** have data. Without event data an attacker keeps 6/9.5 = 63% (scored); a midfielder keeps 5.5/10.5 = 52% and a defender 3.5/10 = 35% (both unscored). The match still counts for EA-backed category stats. |
| **Small benchmark group** | GK (0 appearances) | If a group has fewer than 10 appearances with data for a component, that component is benchmarked against all appearances and flagged `fallback`. |
| **Short appearance** | — | Per-90 values use at least 20 minutes of playing time. |

## 4. Overlap prevention

- **No source field is used by two components of the same role.** Enforced by the test "no source field feeds two components of the same role" in `tests/js/stats.test.js`.
- **No composite of composites.** Every component is a registry metric with its own formula. The score does not reuse other scores, EA rating, context-only metrics or experimental events (ids 104, 151, 157, 179). Enforced by "role weights use only scoreable metrics without known overlaps" and "role weights only use high or verified confidence metrics". The first also blocks known overlapping pairs: tackles won with opponents dispossessed, and goals with goal involvements.
- **Related but distinct pairs are kept on purpose:**
  - Goals and shot accuracy for attackers measure output versus finishing quality. A goal is also an on-target shot, so they correlate, but shot accuracy uses event shot counts while goals come from EA's named total.
  - Pass accuracy and forward passes completed for midfielders measure retention versus progression. Forward passes are a subset of completed passes. The weights (2 each) reflect that a midfielder who passes safely sideways should not outscore one who passes forward at a slightly lower accuracy.
  - Tackles won (MID) and tackle success (DEF) share `tacklesmade`, but they never appear in the same role.

## 5. Real distribution (anonymised)

Source: 192 appearances (3 zero-minute entries excluded), 8 players, all official league and playoff matches in the 12 Nov 2026 samples.

| Group | Appearances | Scored | Unscored (<60% weight) | Min | P25 | Median | P75 | Max | Mean | SD | Mean weight coverage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ATT | 54 | 54 | 0 | 18.0 | 38.5 | 49.3 | 61.4 | 82.8 | 50.0 | 15.8 | 100% |
| MID | 99 | 97 | 2 | 22.1 | 40.8 | 50.9 | 59.4 | 71.6 | 49.8 | 12.2 | 99% |
| DEF | 39 | 38 | 1 | 28.6 | 40.6 | 51.0 | 58.4 | 74.6 | 50.0 | 11.7 | 98% |
| GK | 0 | — | — | — | — | — | — | — | — | — | — |

Every ATT/MID/DEF component had its own group benchmark (no fallback). The benchmark sample per component was 38–99 appearances.

Spearman correlation between appearance Panda Score and EA match rating: **0.60** over 189 appearances. The scores agree on direction with EA's rating without copying it, because EA's rating is not an input.

| Player | Score | Status | Scored / played | By group (score, matches) |
|---|---|---|---|---|
| Player A | 56.4 | qualified | 14 / 14 | ATT 55 (8), MID 59 (6) |
| Player B | 51.1 | qualified | 28 / 28 | MID 50 (24), DEF 56 (4) |
| Player C | 51.0 | qualified | 20 / 20 | DEF 59 (10), ATT 43 (10) |
| Player D | 50.6 | qualified | 30 / 31 | MID 54 (14), DEF 43 (9), ATT 53 (7) |
| Player E | 50.2 | qualified | 30 / 31 | ATT 54 (15), MID 46 (9), DEF 47 (6) |
| Player F | 48.7 | qualified | 22 / 23 | MID 52 (12), DEF 46 (9), ATT 29 (1) |
| Player G | 48.3 | qualified | 23 / 23 | MID 50 (17), ATT 45 (6) |
| Player H | 44.8 | qualified | 22 / 22 | MID 43 (15), ATT 49 (7) |

Player score spread: min 44.8, median 50.4, max 56.4, SD 3.1.

## 6. Findings and recommendations

1. **The position adjustment works.** Each group centres on 50 with a similar spread, so no group is favoured. Under V3's EA-rating ranking, attackers dominated.
2. **Player averages are tightly clustered (44.8–56.4).** Single matches vary a lot (appearance SD 12–16), and averaging 14–31 matches pulls players towards 50. The ordering is meaningful, but the gaps look small. Two display options, which don't change the maths:
   - keep 0–100 with "50 = typical" (current), or
   - additionally show each player's **rank percentile among the squad**.
   Recommendation: keep the current scale. Show the per-group chips (already in the UI), which carry the real signal: for example, Player C is a strong defender (59) but a weak attacker (43).
3. **Group splits matter for selection.** Five of eight players differ by at least 6 points between two groups in which they have 4 or more matches. The Best Position Finder surfaces this, marked tentative under 5 matches.
4. **Unscored appearances are rare (3 of 192)** and are all event-data failures in MID and DEF. Lowering the 60% threshold would let a midfielder be scored on pass accuracy, goals, assists and tackles alone. That is not recommended, because those components miss the role's main value (progression and security).
5. **GK is untested.** The weights stay in place but are not validated until a human keeper plays.
6. **Possible tuning, awaiting your call:**
   - ATT pass accuracy weight 1 → 0.5. Attackers' accuracy mostly reflects where they receive the ball.
   - DEF aerials won 1 → 0.5, until EA exposes aerials lost.
   Neither change is applied.
