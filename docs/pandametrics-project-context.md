# PandaMetrics V4 — Project Context and Product Requirements

**Prepared:** 12 November 2026  
**Purpose:** Authoritative planning context for Cursor. This is a consolidated account of decisions, not a verbatim chat export. Inspect the actual repository, API responses and deployment configuration before implementing anything.

## 1. Product vision

PandaMetrics is a free, mobile-friendly, fun EA Sports FC 27 Pro Clubs analytics website for a small group of teammates. It combines football analysis (Sofascore-style), FUT-inspired player cards, playful awards and actionable coaching. The goal is **fully automated collection**: nobody should have to log incidents while playing. The application should be accessible by a shared URL without requiring teammates to use the underlying Google Sheet.

Tagline: **“The stats don't lie. The pandas might.”**

## 2. Existing working architecture

- EA Clubs unofficial/community API -> Python `fc-clubs-api` importer -> GitHub Actions -> Google Apps Script `doPost` webhook -> Google Sheets -> Apps Script `doGet` HTML dashboard.
- GitHub repository: `kai-ltx/kungfu-pandas-analytics`.
- Local clone: `/Users/kai/Documents/kungfu-pandas-analytics`.
- Apps Script project cloned with `clasp` into `apps-script/`, containing `Code.js` (webhook), `Dashboard.js` (backend), `Index.html` (frontend), `appsscript.json` and `.clasp.json`.
- Existing spreadsheet ID: `18tYVaGchByuhKAAAt87q37_8f2_jWtJ75YP4kvEu32c`.
- Clubs, all `common-gen5`:
  - KungFu Pandas: `454058`
  - Bamboo Shoots: `451080`
  - Torquay: `413965`
- Existing sheets include `Matches`, `Player_Match_Stats`, `Sync_Log`; other sheets must be discovered, not assumed.
- A prior successful multi-club import added 10 matches/59 player records for Bamboo Shoots and 10 matches/50 player records for Torquay; original KungFu Pandas import had 10 matches/74 player records. These are historical observations, not current counts.
- Webhook token is stored in Apps Script Properties and GitHub Actions Secrets; never request, print, commit or embed it in frontend code.
- GitHub workflow and scheduling have been edited repeatedly; verify the actual file on `main`. GitHub Actions experienced a service incident on 11 Nov 2026; do not assume missed runs prove faulty cron.
- There are separate versioned web-app deployments for dashboard and webhook in the **same Apps Script project**. Do not modify either production deployment without explicit approval.

## 3. Locked product decisions

1. **Position-aware everywhere**: all analysis, rankings, awards, improvement advice and custom performance scores must account for the position actually played **in each match**, not a single permanent profile position. Support exact positions and ATT/MID/DEF/GK groups. All stats remain viewable for all roles; position affects comparison and weighting, not visibility.
2. **Official matches**: include league and playoffs, exclude friendlies. Verify playoff retrieval/match type identifiers against actual API responses.
3. **Three-club support**: combined view by default with per-club filters. Merge player profiles only using verified stable identifiers; deduplicate records using club/match/player keys and account for potential same fixture in multiple clubs.
4. **No manual gameplay logging** of missed one-on-ones, chances or offsides. Community-decoded event counters are acceptable for a fun personal project, but label uncertain mappings as experimental. Preserve raw events for future remapping.
5. **Free stack**: keep Google Sheets, Apps Script, GitHub Actions and community API; avoid paid hosting or AI APIs.
6. **Dashboard clarity over quantity**: do not expose opaque raw EA field names to teammates. Provide human-readable names, explanations, denominators, sample sizes and meaningful visuals. Avoid duplicated tabs, scores, rankings and awards.
7. **No blind production changes**: develop on a feature branch; test locally, review diffs and seek approval before any `clasp push`, deployment update, GitHub push, secrets or live Sheet mutation.

## 4. Proposed information architecture (six primary sections)

| Section | Distinct purpose |
|---|---|
| Overview / Panda Den | Club results, recent form, Weekly Bamboo highlights, sync status |
| Rankings | Full-squad leaderboards, category and position-adjusted standings, podium and qualification labels |
| Evolution | Week-on-week/month-on-month trends, squad comparison graphs and individual player mini-charts |
| Panda Lab | Player-specific deep dives, passing DNA, metrics with definitions, strengths and personalised coaching |
| Squad & Builds | FUT-style cards, actual build information where accessible, positions, archetypes, Best Position Finder and Archetype Advisor |
| Awards | Hall of Pandas, Wall of Shame, Shotgun Target, weekly/monthly award history |

Keep Panda Wars/1v1 comparisons as secondary detail, not a primary navigation tab. Rankings answer **who**, Panda Lab answers **why**, Evolution answers **how performance changes**. Ensure mobile-first layouts and consistent alignment of award cards.

### Filters

Global filters: club, date/period, match type (official combined, league, playoff), exact position/position group, selected players, minimum matches/attempts. Evolution-specific: weekly/monthly, metric, compare-squad vs one-chart-per-player; on mobile favour player mini-charts. Filters should apply to match appearances before aggregation.

## 5. Data integrity and statistical engine — highest priority

Audit actual imported fields, data types and community library schema before coding new calculations. Build a documented metric registry/data dictionary with field name, label, description, unit, source, formula, numerator/denominator, overlap risks, confidence, eligible positions, qualification threshold and preferred ranking direction.

- Verify EA position code mapping: existing UI reportedly labels nearly everyone “midfielder.” Do not trust positions until corrected.
- One player appearance per unique club + match + player. Confirm `matchId`, `playerId` stability and any opponent/fixture collisions.
- Preserve missing vs true zero; do not divide by all appearances if some lack that event's data.
- Percentages must use pooled numerator/denominator, not average match percentages.
- For totals, per match, per 90 (only with verified minutes/seconds played), and accuracy, expose all three views together where meaningful.
- Qualify rankings by both matches and attempts; show provisional players separately, not ranked as if eligible. Example: 1 goal/1 shot = 100% but provisional.
- Avoid double-counting overlapping counters: tackles/dispossessions, goals/goal subtypes, passes classified by direction and length, crossing/set-piece counters, aerial actions, etc.
- Use EA named aggregate fields for overall totals where reliable and community events for detailed breakdowns; explicitly flag discrepancies.
- Reconcile match timestamps in `Europe/London`, not import time. Weekly periods Monday–Sunday, monthly calendar months. Show incomplete periods and sample sizes.
- Score design must be explainable, position-aware and validated; avoid using EA match rating or attack-only actions as the sole overall measure.

## 6. Consolidated metric taxonomy

Retain **six core categories** plus specialist detail. Raw stats can remain stored without each becoming a separate dashboard metric.

### Passing
- Total attempts/completions, overall accuracy, completed passes per match/per 90.
- Forward/backward/sideways attempted, completed and accuracy; forward share and successful forward passes per match (progression **proxy**, not metres progressed).
- Short/medium/long accuracy and volume; first-time passes, through balls, switches, flair passes.
- Crosses completed and failed; **validate crossing denominator** because successful crosses may include set pieces while failed counters may not. Distinguish crossing from crosses specifically into the box (not confirmed).
- Passes resulting in offside vs player caught offside must not be conflated.
- Combined volume vs accuracy chart and positional benchmarks.

### Attacking / finishing
- Goals, shots, shots on/off target, saves, conversion and shot accuracy; shots inside/outside box where available.
- First-time/weak-foot/post-related goal subtypes; don't add to total goals.
- Goals and goal involvements per match/per 90; finishing with meaningful minimum shot counts.
- No claim of identifying a missed 1v1 or failure to shoot unless validated event semantics support it.

### Creativity
- Assists, second assists, through passes, through-ball assists, first-time creative passing, switches; avoid duplicating passing metrics as separate composite scores.

### Defending
- Tackles won/lost, tackle success, interceptions, dispossessions, blocked crosses, dangerous tackles, fouls.
- Attacking and defensive aerial duels (role-aware; only compute success percentage if attempted/lost counts are reliable).
- Defensive action rate; check overlap before summing actions.

### Possession
- Possession won/lost by defensive/middle/attacking third, per match/per 90; defensive-third loss risk and high recoveries.
- Recovery-to-loss comparison as context, not an absolute quality score.
- Avoid inventing ball-touch denominators.

### Decision-making / positioning
- Good/best options, missed better passes, no good option, out-of-position events and severity 1–5, fouls/cards/penalties, offsides where mapped.
- EA feedback is gameplay feedback, not independently validated tactical intelligence.
- Experimental community IDs previously discussed: `104` (possibly player offside), `151` (possibly bad pass), `157` (possibly open-play crosses), `179` (possibly should-have-shot). Verify library documentation and data availability; label experimental and exclude from serious composite scoring until credible.

### Specialist
- GK saves, save rate if reliable attempts/goals allowed available, clean sheets with valid attribution.
- Corners taken/conceded, crossing/set pieces, shot technique and aerial specialisms.

## 7. Advanced derived analytics (avoid redundant composites)

Prioritise a small explainable set: passing volume vs accuracy; forward-pass output and accuracy; shot conversion with minimum attempts; defensive reliability; position-aware possession safety; consistency of match rating/performance; recent form; team impact/on-off and teammate pair/trio chemistry **with sample sizes and no causal claims**; opponent shot/pass comparisons if both-team data can be retrieved. Match Control is a custom proxy, not true possession/xG.

Weekly/monthly Evolution: accuracy changes in **percentage points**, rates per match/per 90, changes in possession losses, finishing, defending, decision-making, consistency, hot/cold streaks, improvement/decline. Offer squad comparison and separate player charts.

## 8. Position & archetype intelligence

- Preserve exact position for each match; separate position played, preferred/current build position and recommended position.
- Position-adjusted Panda Score uses per-appearance role-specific weighting/benchmarks, then aggregates; do not score all of a player's history as one position.
- Best Position Finder compares sufficient actual performances at different positions; low-sample recommendations are tentative. Potential alternative positions inferred from style must be distinguished from proven performance.
- Archetype Advisor suggests actual verified EA archetypes based on player strengths and roles, with explanation and confidence.
- Investigate `members/stats`, career/season stats and match `archetypeid` for overall, height, nationality, style/archetype, position. Owned archetypes, attribute-point allocations, PlayStyles, full attributes and character portrait endpoints are **not verified**; do not invent them.
- Optional teammate screenshots of created Pros for FUT-style cards; no requirement to record during play. If external build-planner links are supported, verify before integrating.
- Build vs Performance only when build ratings and match/build attribution are available.

## 9. Weekly roundup and awards

- **Weekly Bamboo**: previous Monday–Sunday across official matches, positive/negative awards, club form, top improvements and declines; preserve historical weekly/monthly snapshots or reproducible history.
- **Hall of Pandas**: Panda of Week, Golden Boot, Assist King, Forward Thinker, Kung Fu Master, Most Improved (rotate less important awards).
- **Wall of Shame**: **Shotgun Target** (inside joke: lowest *eligible* position-adjusted overall performer), Crab King, Butterfingers, Tunnel Vision, Lost Panda, Biggest Decline; optional Redemption Panda after improvement.
- Do not call every backward pass bad or every attacking-third turnover a failure; compare to positional peers and provide evidence-based, varied coaching suggestions, not the same generic advice for everyone.
- Official EA MOTM totals may be collected as a secondary fun fact. EA match ratings/podiums may favour attackers; do not use as sole overall rank. Reconstructed podium != official EA podium.

## 10. Sync and security

- Target automatic **hourly imports at 17:00,18:00,...,23:00,00:00,01:00,02:00 Europe/London**, and no imports 03:00–16:59. Confirm actual GitHub Actions syntax and DST handling against current documentation; scheduler is best-effort and may be delayed or dropped. Monitor last successful sync and failures.
- Public read-only **Refresh Stats** button reloads Sheets-backed dashboard data.
- Optional **Sync from EA** button triggers GitHub `workflow_dispatch` via Apps Script server-side GitHub credential stored in Script Properties, with real server-side authorization (not merely hiding a button), rate limits/cooldown and status feedback. Do not expose privileged `google.script.run` methods to anonymous visitors. Evaluate whether secure teammate authentication is feasible given public anonymous access; if not, use admin-only sync and explain trade-off.
- Apps Script web app currently runs as deploying user and allows anonymous access; audit callable functions, spreadsheet permissions, input validation, response contents and rate limiting before introducing privileged functions.
- Keep credentials outside repository. `clasp` source sync and updating production deployments are separate operations. Never silently redeploy webhook/dashboard.

## 11. Exclusions, caveats and outstanding questions

- Exclude friendlies; include playoffs once verified.
- No manual logging during games.
- No unverified xG/xA, metres progressed, true pressing intensity, actual 1v1 misses, exact shot opportunity quality, or inferred goal sequence from final scores alone.
- Community event research is useful but can contain tentative mappings; expose provenance/confidence.
- Audit whether `both_teams=True`, `all_columns=True`, `include_events=True` and raw event aggregate retention are supported in the installed library version. Earlier conversation contained example code that may not match current library signatures.
- Inspect actual match schema for position, time played, match types, names, duplicate identifiers and missing values.
- Verify member/build API fields and archetype mapping before promising complete build trees or images.
- Evaluate Sheets scalability and Apps Script execution limits; prefer efficient batched reads and caching.

## 12. Cursor execution instructions

1. Read the entire repo and Apps Script files; treat this document as product intent, **not** proof of API support or correctness of earlier snippets.
2. Audit the current system and list verified working components, bugs, gaps and security risks.
3. Create `docs/pandametrics-v4-spec.md`, `docs/pandametrics-v4-implementation-plan.md` and a data dictionary with verified/experimental status.
4. Work in a `feature/pandametrics-v4` branch, not directly on main.
5. Phase 1: data audit, position mapping, match-type ingestion, data quality tests. Phase 2: metric registry and role-aware scoring with unit tests. Phase 3: six-tab mobile dashboard, filters and clear leaderboards. Phase 4: Evolution, Weekly Bamboo, awards, personalised tips. Phase 5: build/archetype features, opponent/chemistry analysis, safe manual sync.
6. Test each phase with fixtures and real read-only samples. Show formulas, denominators, eligibility and provenance. Preserve existing production behaviour until reviewed.
7. Do not modify live Google Sheets, GitHub secrets, production Apps Script deployments or push changes without explicit approval.
8. Keep the user informed with concise reports and specific decisions needed, not manual find-and-replace code instructions.
