# PandaMetrics V4 — Audit of the V3 System

**Date:** 12 November 2026 · **Branch:** `feature/pandametrics-v4` · **Scope:** `sync_to_sheets.py`, `test_connection.py`, `.github/workflows/test-api.yml`, `apps-script/Code.js`, `apps-script/Dashboard.js`, `apps-script/Index.html`, `apps-script/appsscript.json`, installed `fc-clubs-api` 0.3.0, and read-only EA API samples (3 clubs × league + playoff + members, fetched 12 Nov 2026).

The live Google Sheet and the two production deployments were **not** inspected or changed.

## 1. Verified working

| Component | Evidence |
|---|---|
| EA fetch for all three clubs (`common-gen5`) | 10 league matches each; Bamboo Shoots also has 3 playoff matches. |
| Webhook authentication | `doPost` checks `WEBHOOK_TOKEN` from Script Properties before writing. |
| Duplicate protection on write | `saveRecords` keys `clubId+matchId` and `clubId+matchId+playerId`. |
| Spreadsheet formula-injection guard | Strings starting `= + - @ \t \r` are prefixed with `'` (CWE-1236). |
| Concurrency | `LockService` script lock around writes; workflow `concurrency` group. |
| Frontend output encoding | `esc()` used for every interpolated player/club string. |
| Player identity | `playerId` ↔ name 1:1 in samples; the same 8 ids play for all three clubs → safe to merge profiles by `playerId`. |
| Match identity | `matchId` unique per club in samples; no fixture appears under two of our clubs. |
| Match-type codes | `clubs[*].matchType` is `"1"` for every league response and `"3"` for every playoff response. |
| Schedule window | Cron UTC hours `0-2,16-23` cover 17:00–02:59 London in both GMT and BST. |

## 2. Bugs and data-integrity defects

| # | Severity | Defect | Where | Status |
|---|---|---|---|---|
| B1 | High | **Playoffs never imported.** Both fetches use the library default `leagueMatch`. 3 Bamboo Shoots playoff matches currently missing. | `sync_to_sheets.py` | Fixed (Phase 1) |
| B2 | High | **"Everyone is a midfielder."** EA reports only a position *group* per appearance (`forward/midfielder/defender`); exact positions are not in the API (`proPos` is just 5/14/25 = CB/CM/ST stand-ins). The dashboard then reduces each player to their single most frequent group, and midfielder is the most common (102 of 195 appearances). All 8 players played in more than one group. | `Index.html` `players()` | Group-per-appearance fixed in data/engine (Phase 1–2); UI in Phase 3 |
| B3 | High | **Missing event data counted as zero.** 6 of 195 real appearances have no or truncated event aggregates (e.g. 92 passes made by EA, 16 pass events). These rows currently store 0s and pass accuracy can read 16/16 = 100%. | importer / `Index.html` | Fixed: rows flagged `eventsMissing`/`eventsIncomplete`, event stats blank |
| B4 | High | **Non-appearances counted as games.** 3 rows have `secondsPlayed=0`, no events, rating 3.0, yet count toward per-match denominators. | `Index.html` | Fixed in engine (`appearanceStatus`) |
| B5 | Medium | Per-match rates divide by **all** games even when some games lack that stat (`sum / p.games`). | `Index.html` `metric()` | Fixed in engine (`matchesWithData`) |
| B6 | Medium | Overall ranking, podium and "Golden Panda" use **EA match rating only**, which favours attackers. | `Index.html` | Panda Score built (Phase 2); UI Phase 3 |
| B7 | Medium | Shame awards not position-aware (Crab King penalises defenders for backward passes; Stormtrooper only attackers shoot). | `Index.html` | Phase 4 |
| B8 | Medium | "Possession recovered" appears in both Defending and Possession categories. | `Index.html` | Phase 3 |
| B9 | Medium | Overall pass accuracy uses event 215/216 (excludes offside passes, breaks on truncated rows) instead of EA `passesmade/passattempts`. | `Index.html` | Engine uses EA named totals |
| B10 | Medium | Two separate API calls per club (`get_club_matches`, `get_match_players`) can disagree if a match finishes between them. | `sync_to_sheets.py` | Fixed: one raw fetch feeds both |
| B11 | Medium | One club failing aborts the remaining clubs. | `sync_to_sheets.py` | Fixed: per-club isolation, non-zero exit at end |
| B12 | Medium | Backend reads with `getDisplayValues()`: numbers formatted by the sheet (`1,234`, `85%`) silently become 0, and timestamps are sorted as display strings. **Needs confirmation against the live sheet.** | `Dashboard.js` | Phase 3 (switch to `getValues`) |
| B13 | Low | Raw `match_event_aggregate_*` strings are discarded, so future event remapping is impossible. | importer | Fixed: `rawEvents` column |
| B14 | Low | Schedule runs only at 17, 19, 21, 23, 01, 02 London; requirement is hourly 17:00–02:00. Cron at minute 0 is GitHub's busiest slot. | workflow | Fixed (hourly, minute 7) — confirm |
| B15 | Low | Unpinned `pip install fc-clubs-api requests`. | workflow | Fixed: `requirements.txt` |
| B16 | Low | `Sync_Log` records successes only; failures are invisible in the sheet. | `Code.js` | Phase 3 |
| B17 | Low | `saveRecords` re-reads the full sheet every sync to build keys; fine now (~200 rows/club/month) but grows linearly against the 6-minute Apps Script limit. | `Code.js` | Monitor; Phase 3 key column |

## 3. API limitations (verified against real responses)

- **No exact position**: only `pos` group per appearance. `members/stats` `favoritePosition`/`proPos` are also group-level. Best Position Finder can work at group level only.
- **`archetypeid`** (1–13 observed) varies per appearance and crosses groups; no verified id→name mapping exists in the library or the community research. Stored, labelled "unmapped".
- **`secondsPlayed`** is identical for every player in 59 of 66 line-ups (33 matches, both sides), i.e. it is usually match length; lower values appear for late joiners. Per-90 is usable but labelled `medium` confidence.
- **No goalkeeper appearances** (AI keepers): GK role weights are defined but untested on real data.
- **EA returns at most 10 matches per type per request** — the importer must run often enough to avoid gaps (hourly in the play window is ample).
- **Event aggregates are sometimes empty or truncated** (6/195 rows).
- **EA `passesmade` includes passes that lead to an offside**; events 215/216 exclude them. Differences are ±3 per match except truncated rows.
- **Not available**: lost aerial duels, xG/xA, distance, pressing, PlayStyles, attribute allocations, portraits.
- Experimental event ids `104`, `151`, `157`, `179` occur in 13/90/73/24 of 195 rows; meanings are partial in the community research.
- `get_playoff_achievements` returns an empty list (library note).

## 4. Security findings

| # | Risk | Identifier | Plain-language explanation | Fix | Status |
|---|---|---|---|---|---|
| S1 | **Anonymous visitors could call internal server functions.** The web app runs as the owner with `ANYONE_ANONYMOUS` access, and `google.script.run` can call any top-level function not ending in `_`. `migrateExistingClubData()` writes to the sheet; `testSpreadsheetAccess()` reveals the sheet name. | CWE-749, CWE-284, OWASP A01:2021 | Anyone with the dashboard URL could open the browser console and run those functions as you. | Renamed to `migrateExistingClubData_`, `testSpreadsheetAccess_`, `saveRecords_`, `jsonResponse_`; added a test that fails if any non-allowlisted public function appears. Source: [Google Apps Script — private functions](https://developers.google.com/apps-script/guides/html/communication#private_functions). | Fixed locally, **not deployed** |
| S2 | Dashboard returns EA `playerId` and every raw stat to anonymous visitors. | CWE-359, OWASP API3:2023 | More personal data than the page needs is sent to anyone with the link. | Phase 3: return only display fields and an opaque id. | Open |
| S3 | Workflow uses the repository's default `GITHUB_TOKEN` permissions and persists checkout credentials. | CWE-250, OWASP CICD-SEC-5 | If a dependency were compromised it could get write access to the repo. | `permissions: contents: read`, `persist-credentials: false`. Source: [GitHub — security hardening for Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions). | Fixed locally |
| S4 | Unpinned Python dependencies. | CWE-1357, OWASP CICD-SEC-3 | A malicious or broken new release would run with the webhook secrets. | Pinned versions in `requirements.txt`. Hash pinning (`--require-hashes`) recommended next. | Partly fixed |
| S5 | Third-party actions pinned by tag, not commit SHA. | CWE-829, OWASP CICD-SEC-8 | A moved tag could run different code. | Pin `actions/checkout`, `setup-python`, `setup-node` to full SHAs (source: GitHub hardening guide above). | Open — needs SHA lookup |
| S6 | HTTP errors from `requests` include the full webhook URL (a secret) in the message. | CWE-532 | The URL could be printed in logs (GitHub masks registered secrets, but defence in depth). | Importer now prints only the status code. | Fixed |
| S7 | Token comparison is not constant-time. | CWE-208 | Theoretical timing leak; impractical over Apps Script's network jitter. | Accept; note only. | Accepted (low) |
| S8 | Webhook has no rate limit or replay protection. | CWE-770, CWE-294 | A leaked token allows unlimited writes; replays are deduplicated. | Rotate token if exposed; consider HMAC + timestamp in Phase 5. | Open (low) |
| S9 | Planned "Sync from EA" button. | CWE-862 | Hiding a button is not authorisation; anonymous users could trigger GitHub runs. | Phase 5: server-side check against an allowlist of signed-in Google accounts, cooldown, GitHub token in Script Properties. Requires a non-anonymous deployment or admin-only. | Design |

No secrets were found in the repository. `.clasprc.json`, `.env*`, credential JSON and raw samples are git-ignored.
