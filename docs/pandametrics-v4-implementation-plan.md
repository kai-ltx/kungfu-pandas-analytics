# PandaMetrics V4 — Implementation Plan

Branch: `feature/pandametrics-v4`. Every phase ends with `python -m pytest -q` and `node --test "tests/js/*.test.js"` green. Nothing is pushed, deployed or written to the live sheet without approval.

## Priorities

1. Data correctness (wrong numbers are worse than missing features).
2. Position-aware comparison.
3. Security of the anonymous web app.
4. Dashboard clarity.
5. Fun features (awards, cards, builds).

## Phase 1 — Data audit, ingestion, data quality ✅

- [x] Audit repo, library 0.3.0 and real EA samples (`docs/pandametrics-v4-audit.md`).
- [x] `pandametrics/ingest.py`: one raw fetch per club × match type; league + playoff; per-appearance position group; `archetypeId`; `rawEvents`; `eventCoverage`; `appearanceStatus`; `dataQualityFlags`; London timestamps; V3 column compatibility.
- [x] `sync_to_sheets.py`: uses ingest; per-club failure isolation; secret-safe error messages; same webhook payload.
- [x] Sanitised fixtures from real samples (`tools/make_fixtures.py`) — no gamertags/ids/opponent names.
- [x] Workflow: hourly 17:00–02:00 London at minute 7, `permissions: contents: read`, pinned deps, tests gate the sync. New `tests.yml` CI.
- [x] Webhook hardening: internal functions made private; allowlist test.
- Tests: 34 Python (ingest, sync, fixture freshness).

## Phase 2 — Metric registry and role-aware scoring ✅

- [x] `apps-script/Stats.js` (`PandaStats`): registry, pooled aggregation, missing-vs-zero, qualification, ranking, filters, player merge, Panda Score v1, London weeks/months, percentage-point change.
- [x] Generated `docs/pandametrics-data-dictionary.md` (+ freshness test).
- Tests: 44 JS (registry integrity, pooling, missing data, provisional ranking, role scoring monotonicity/bounds/position-awareness, DST periods, public-function allowlist, secret scan).

## Phase 3 — Six-section mobile dashboard ✅ (local, not deployed)

- [x] `Dashboard.js` (V4): `getValues()`; normalised rows; display fields only with opaque player ids; legacy rows get `matchType`/`positionGroup`; 5-minute chunked `CacheService` cache cleared by the webhook; sync status from `Sync_Log`.
- [x] `Index.html` template + generated `ClientLib.html` (`tools/build_client.js` inlines `Stats.js`, `client/Insights.js`, `client/App.js`); everything computed client-side so filters are instant.
- [x] Six sections: Panda Den (clubs, form, Weekly Bamboo, coverage, recent matches, last sync, Refresh), Rankings (Panda Score qualified/provisional + six non-redundant category leaderboards with denominators, coverage and confidence badges), Evolution, Panda Lab, Squad & Builds, Awards.
- [x] Global filters: club, period (all / last 28 days / this or last week / this or last month), match type (official / league / playoffs), position group, minimum matches.
- [x] Webhook: `Sync_Log` `Status` column; authorised failures logged; cache invalidated after imports.
- [x] Local preview (`tools/preview.js`, sanitised fixture, stubbed `google.script.run`).
- [ ] Write ID columns as text — deferred, see D6.

## Phase 4 — Evolution, Weekly Bamboo, awards, coaching ✅ (pulled into Phase 3)

- [x] Weekly/monthly series (contiguous periods, sample sizes, hollow in-progress points, pp changes for accuracies, movers from completed periods with 3+ matches); squad chart or one mini-chart per player.
- [x] Weekly Bamboo: last complete Monday–Sunday week (London) with matches; record and weekly awards (2+ matches that week). Computed from data; no extra sheet.
- [x] Hall of Pandas / Wall of Shame from qualified players only; shame awards use excess over positional peers; Shotgun Target = lowest eligible Panda Score.
- [x] Coaching tips from the player's own weakest role components with evidence vs the role median.

## Phase 5 — Builds, chemistry, opponents, safe manual sync

- Member stats (`proOverall`, height, nationality) for cards; archetype names only if a verified mapping appears.
- Teammate pair/trio results with sample sizes, no causal claims.
- Opponent comparison via `both_teams` raw data.
- Manual "Sync from EA": admin-only design in `docs/pandametrics-security.md` §4.
- [x] GitHub Actions pinned to SHAs. Consider HMAC-signed webhook payloads.

## Decisions needed from Kai

| # | Decision | When |
|---|---|---|
| D1 | Approve hourly imports (17:00–02:00 London) instead of the current six runs. | Before merging to `main` |
| D2 | Approve the first V4 sync adding columns (`positionGroup`, `archetypeId`, `rawEvents`, `eventCoverage`, `appearanceStatus`, `dataQualityFlags`, `eventGoals/Assists/Shots`, `timestampUnix`, …) and playoff rows to the live sheet. | Before merging to `main` |
| D3 | Review Panda Score v1 role weights (data dictionary). | Before Phase 3 UI |
| D4 | Approve a separate **test** web-app deployment for Phase 3 review (production untouched). | Start of Phase 3 |
| D5 | Manual sync: GitHub "Run workflow" only, admin-only dashboard button, or teammate sign-in. | Phase 5 |
| D6 | Store `matchId`/`playerId` as text in new rows (prefix `'`). Current ids are 15 digits, the most Sheets stores exactly; a 16-digit id would be rounded and break dedupe. Dedupe already compares as strings, so mixed old/new types are safe. | Before ids reach 16 digits |
| D7 | Optional Panda Score tuning (ATT pass accuracy 1→0.5, DEF aerials 1→0.5) — see `docs/pandametrics-score-review.md` §6. | Any time |

## Rollout (after approval only)

1. Review diff → merge branch to `main` → `git push` (importer + workflow go live; sheet gains V4 columns).
2. `node tools/build_client.js --check` → `clasp push` (replaces the project's editable HEAD code; versioned production deployments keep serving their pinned version) → create a **new test deployment** → review.
3. Update production dashboard deployment to the reviewed version; webhook deployment separately and only if `Code.js` changed.
