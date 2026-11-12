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

## Phase 3 — Six-section mobile dashboard (next)

- `Dashboard.js`: `getValues()` instead of display values; normalise rows; return minimal fields + opaque player ids; cache with `CacheService` (5 min); expose sync status from `Sync_Log`.
- Include `Stats.js` in the page via `HtmlService` templating; compute client-side so filters are instant.
- Sections: Overview, Rankings (Panda Score + category leaderboards with qualified/provisional split), Evolution (stub), Panda Lab (per-player, per-role breakdown, denominators), Squad & Builds (group-level positions, archetype ids marked unmapped), Awards (stub).
- Global filters (club, period, match type, position group, players, minimum matches).
- Remove duplicated metrics; human labels only; experimental badges.
- Webhook: log failures to `Sync_Log`; write ID columns as text.
- Tests: JS tests for the data-shaping layer; manual check via a **test deployment** (not production).

## Phase 4 — Evolution, Weekly Bamboo, awards, coaching

- Weekly/monthly series with sample sizes and incomplete-period markers; pp changes for accuracies.
- Weekly Bamboo snapshot (reproducible from data, optionally persisted to a `Weekly_Snapshots` sheet — needs approval).
- Hall of Pandas / Wall of Shame using position-adjusted, qualified results only; Shotgun Target = lowest eligible Panda Score.
- Coaching tips from per-role percentile weaknesses, varied by metric and role.

## Phase 5 — Builds, chemistry, opponents, safe manual sync

- Member stats (`proOverall`, height, nationality) for cards; archetype names only if a verified mapping appears.
- Teammate pair/trio results with sample sizes, no causal claims.
- Opponent comparison via `both_teams` raw data.
- Manual "Sync from EA": admin-only unless secure teammate auth is feasible (see audit S9).
- Pin GitHub Actions to SHAs; consider HMAC-signed webhook payloads.

## Decisions needed from Kai

| # | Decision | When |
|---|---|---|
| D1 | Approve hourly imports (17:00–02:00 London) instead of the current six runs. | Before merging to `main` |
| D2 | Approve the first V4 sync adding columns (`positionGroup`, `archetypeId`, `rawEvents`, `eventCoverage`, `appearanceStatus`, `dataQualityFlags`, `eventGoals/Assists/Shots`, `timestampUnix`, …) and playoff rows to the live sheet. | Before merging to `main` |
| D3 | Review Panda Score v1 role weights (data dictionary). | Before Phase 3 UI |
| D4 | Approve a separate **test** web-app deployment for Phase 3 review (production untouched). | Start of Phase 3 |
| D5 | Manual sync: admin-only vs teammate sign-in. | Phase 5 |

## Rollout (after approval only)

1. Review diff → merge branch to `main` → `git push` (importer + workflow go live; sheet gains V4 columns).
2. `clasp push` source → create a **new test deployment** → review.
3. Update production dashboard deployment to the reviewed version; webhook deployment separately and only if `Code.js` changed.
