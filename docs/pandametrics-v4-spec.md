# PandaMetrics V4 — Specification

Derived from `docs/pandametrics-project-context.md` (product intent) and `docs/pandametrics-v4-audit.md` (verified facts). Where the two differ, the audit's verified API behaviour wins.

## 1. Data pipeline

```
EA clubs/matches (raw, league + playoff, ≤10 each)
  └─ pandametrics.ingest  (one fetch → match rows + appearance rows, quality flags, rawEvents)
       └─ sync_to_sheets.py  (per-club isolation, payload {token, clubId, matches, players})
            └─ Apps Script doPost → Sheets: Matches, Player_Match_Stats, Sync_Log
                 └─ Dashboard.js getDashboardData → PandaStats (Stats.js) → Index.html
```

- **Keys:** match = `clubId + matchId`; appearance = `clubId + matchId + playerId`. Player profile = `playerId` across clubs.
- **Official matches:** `leagueMatch` (EA code `1`) and `playoffMatch` (code `3`). Friendlies never fetched. A code mismatch is flagged, not dropped.
- **Timestamps:** stored as ISO-8601 Europe/London plus `timestampUnix`. Weeks Monday–Sunday and calendar months, both in Europe/London.
- **Missing vs zero:** event stats are blank when `eventCoverage` ≠ `complete`. EA named totals (`passesMade`, `tacklesMade`, `goals`, …) remain usable.
- **Non-appearances:** `appearanceStatus = did_not_play` rows are stored but never counted.
- **Backward compatibility:** all V3 column names are preserved; V4 columns are additive. V3 rows lacking V4 columns are interpreted by the same rules (`secondsPlayed = 0` → not an appearance; event coverage re-derived from pass counts).

## 2. Position model

| Level | Source | Status |
|---|---|---|
| Group per appearance (ATT/MID/DEF/GK) | `pos` | Verified; used everywhere |
| Exact position per appearance | — | **Not available from the API** |
| Archetype per appearance | `archetypeid` | Stored; unmapped id |
| Profile/build position | `members/stats` `favoritePosition`, `proPos` | Group-level only |

Every ranking, award and score filters or weights by the group played **in that match**. Filters apply to appearances before aggregation.

## 3. Statistics engine (`apps-script/Stats.js`)

Pure JavaScript shared by Apps Script, the browser and Node tests. Exposed as one `PandaStats` object (not callable via `google.script.run`).

- **Metric registry**: 50 metrics with label, description, category, type (`count`/`ratio`/`mean`), fields or numerator/denominator, source, confidence, direction (`higher`/`lower`/`context`), minimum attempts, shrinkage and overlap notes. Rendered into `docs/pandametrics-data-dictionary.md`.
- **Views**: counts → total, per match, per 90 (only if every included row has `secondsPlayed`). Ratios → pooled rate with numerator and denominator.
- **Qualification**: minimum matches **and** minimum attempts. Provisional players are returned separately and never ranked. Context-only metrics (e.g. backward-pass share) are flagged and must not be presented as good or bad.
- **Ranking**: competition ranking (1, 2, 2, 4), tie-break by sample size then name.
- **Panda Score (v1)**: per appearance, percentile against same-group appearances for each role-weighted metric (inverted when lower is better); counts per 90 with a 20-minute floor; ratios shrunk towards the role's pooled rate; ≥60% weight coverage required; groups with <10 appearances fall back to all appearances. Player score = mean of appearance scores, with per-group breakdown, strengths and weaknesses. EA rating and experimental events are excluded.

## 4. Dashboard

Six sections: Panda Den, Rankings, Evolution, Panda Lab, Squad & Builds, Awards.

- **Global filters:** club, period (all / last 28 days / this or last week / this or last month, Europe/London), match type (official / league / playoffs), position group, minimum matches.
- **Display rules:**
  - every number shows its denominator or sample size and a coverage chip;
  - experimental and caveated metrics carry a badge;
  - raw EA field names are never shown.
- **Architecture:**
  - `getDashboardData` returns minimal rows with opaque player ids;
  - `client/Insights.js` builds every view model in the browser on top of `PandaStats`;
  - `client/App.js` renders them;
  - both are inlined into `ClientLib.html` by `tools/build_client.js`.
- **Categories:** six non-redundant display categories (Passing, Attacking, Creativity, Defending, Possession, Decisions). No metric appears twice (test-enforced).
- **Awards:**
  - Weekly Bamboo uses the last complete Monday–Sunday week with matches (2+ matches to qualify);
  - the filter-period awards use the minimum-matches filter;
  - shame awards measure excess over what positional peers produce in the same role mix;
  - Shotgun Target is the lowest eligible Panda Score.
- **Evolution:** contiguous weeks or months, matches per period, hollow in-progress points, accuracy changes in percentage points, movers from completed periods with 3+ matches.

Details: `docs/pandametrics-score-review.md`, `docs/pandametrics-data-quality.md`, `docs/pandametrics-security.md`.

## 5. Security requirements

- Public server functions limited to `doGet`, `doPost`, `getDashboardData` (enforced by test).
- Dashboard payload limited to display fields; no raw ids (Phase 3).
- Any privileged action (manual sync) requires server-side authorisation, a cooldown, and credentials in Script Properties only.
- No deployment, `clasp push`, GitHub push, secret change or live-sheet change without explicit approval.
