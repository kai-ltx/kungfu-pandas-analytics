# PandaMetrics V4 — Data Quality, Positions and Historical Safety

**Branch:** `feature/pandametrics-v4` · Evidence is the real EA samples from 12 Nov 2026 (195 player rows, 33 official matches, 3 clubs) and the automated tests named below.

## 1. Zero-minute entries and incomplete events

### Confirmed behaviour

| Rule | Where it is enforced | Test |
|---|---|---|
| A row is **not an appearance** when `appearanceStatus = did_not_play` (V4) or `secondsPlayed = 0` (legacy V2/V3 rows). | `PandaStats.isAppearance` | "did-not-play rows are not appearances (V4 and legacy rows)" |
| Non-appearances are excluded from **every participation count**: appearances, per-match denominators, per-90 time, benchmarks and scores. | `aggregate` filters `isAppearance` first, and so do `buildBenchmarks` and `scoreAppearance`. The dashboard's `coverage()` reports them separately. | "did-not-play rows do not dilute per-match rates"; Insights test "coverage excludes zero-minute entries and counts event coverage" |
| A row whose events are **missing or truncated** stays an appearance. Only **event-sourced** metrics skip it; they never treat it as zero. | `rowHasData` returns false only when `metric.source === "event"` and `eventsUsable(row)` is false. | "missing event data is excluded, not treated as zero"; "incomplete events excluded but EA named totals still used" |
| The 13 metrics backed by EA's named fields still use those rows: passes completed, pass accuracy (`passesmade/passattempts`), goals, goal involvements, shots, conversion, assists, tackles won, tackle success, red cards, saves, goals conceded, rating. | Metric registry `source: "ea"` | Same tests |
| Real counts: 3 did-not-play, 3 events missing, 3 events truncated. | Ingest flags in `pandametrics/ingest.py`. | `tests/test_ingest.py` |

### Coverage indicators added to the dashboard

- **Panda Den:**
  - an "event coverage" headline (98% on the samples);
  - a Data coverage panel stating how many appearances have full event data, how many use EA totals only, and how many zero-minute entries were excluded;
  - appearances per position group;
  - the duplicate rows ignored.
- **Rankings:**
  - every leaderboard row shows a chip with *matches with data / appearances*, coloured green at 95% or more, amber at 75% or more, red below that;
  - ratio rows show the numerator and denominator (for example `412/478`);
  - provisional players are listed separately with the reason (too few matches or attempts).
- **Panda Lab:**
  - the profile line shows appearances, how many have full event data, and zero-minute entries excluded;
  - each metric card has its own coverage chip and a *Provisional* tag when below the threshold.
- **Evolution:** each chart shows the number of matches behind every period. Periods still in progress are hollow points and are excluded from the improvers and decliners lists.
- **Badges:** *Experimental* and *Caveat* badges mark lower-confidence metrics.

## 2. Position awareness

### What EA provides (verified)

| Source | Field | Content | Use |
|---|---|---|---|
| `clubs/matches` → `players[club][player]` | `pos` | `forward` / `midfielder` / `defender` / `goalkeeper` per appearance | **ATT / MID / DEF / GK per appearance**. This is the only position signal. |
| same | `archetypeid` | Integer 1–13. It varies per appearance and crosses groups. | Stored and shown as "Archetype #n (unmapped)". EA publishes no name mapping. |
| `members/stats` | `proPos`, `favoritePosition` | `proPos` is only 5/14/25; `favoritePosition` is a group name | Not used. Group-level and not per match. |
| `members/career/stats` | — | No position or archetype fields | — |
| `clubs/info` | — | Club metadata and crest only | Crest URL (stored) |
| `clubs/overallStats` | — | Club totals only | — |
| Leaderboards and season search | — | Club ranking only | — |
| `club/playoffAchievements` | — | Empty list in samples | — |
| `members/stats` | `proStyle`, `vproattr` | Always `"0"` and `"NH"` | Not usable for builds |

**Conclusion:** no endpoint exposes exact positions (CB, CDM, ST and so on) or named archetypes. V4 therefore:
- scores and benchmarks each appearance by its group;
- shows per-group scores for every player;
- offers a **Best Position Finder** at group level, marked *tentative* under 5 matches;
- never invents exact positions or build names.

Investigation scripts: `tools/audit_positions.py` and `tools/fetch_samples.py`. Samples are local and gitignored.

## 3. Historical data and the new columns

| Requirement | How it is met | Test |
|---|---|---|
| **No duplicates** | The webhook dedupes on `clubId+matchId` (Matches) and `clubId+matchId+playerId` (Player_Match_Stats), comparing as strings, so a legacy numeric id still matches a new text id. | History tests "V4 import after V2 history adds only playoff records and never duplicates" and "legacy numeric match ids still dedupe and are not rewritten" |
| **No overwrites** | `saveRecords_` only appends rows; existing rows are never rewritten. | "historical rows keep their exact values after a V4 import" (cell-by-cell) |
| **New columns are safe** | New fields (`positionGroup`, `archetypeId`, `rawEvents`, `eventCoverage`, `appearanceStatus`, `dataQualityFlags`, `matchType`, crest URLs and others) are appended to the right of the existing header. Existing column positions are unchanged, and historical rows stay blank in new columns (no back-fill). | "new V4 columns are appended and blank on historical rows" |
| **Playoff rows** | Bamboo Shoots' 3 playoff matches (13 player rows) are the only new records when V4 runs after V2 history. League rows already present are skipped. | First history test (exact counts) |
| **Idempotent** | Running the V4 import twice adds nothing the second time. | "re-running the V4 import is idempotent" |
| **Same keys and timestamps as V2** | V4 keeps V2's column names, key fields and timestamp format, so V2 and V4 rows for the same match collide and dedupe. | `tests/test_history.py` |
| **Legacy rows readable** | The V4 dashboard fills `matchType` from the match (or `leagueMatch`), derives `positionGroup` from `position`, and re-derives zero-minute and event usability from raw fields. | "V4 dashboard reads mixed V2 + V4 rows without exposing EA player ids" |
| **Production dashboard keeps working** | The deployed V3.1 backend (frozen copy in `tests/fixtures/production/`) still reads a sheet containing mixed V2 and V4 rows. | "deployed V3 dashboard still reads mixed V2 + V4 rows" |
| **Bad requests write nothing** | Wrong token, unknown club or malformed payload are rejected before any data row is written. | "wrong token writes nothing", "unknown club rejected", "failed authorised imports are logged; unauthorised ones are not" |

## 4. Match id precision

Google Sheets stores numbers as IEEE-754 doubles. Integers above 2^53−1 (16 digits, starting at 9007199254740993) are rounded, so a later import would not recognise the match.

- The importer keeps `matchId` as an exact digit string and refuses a float (`pandametrics/ingest.py` `match_id_text`). `json.dumps` therefore sends `"matchId": "9007..."` and not a JSON number.
- The webhook writes every new match id with a leading apostrophe and sets the match-id column format to `@` (plain text). The apostrophe is not stored.
- Cells already stored as numbers are not rewritten. Dedupe compares `String(existing)` with `String(incoming)`, so a 15-digit legacy id still matches.
- Tests cover a 16-digit unsafe integer and a 20-digit id, including a second import that adds nothing.

## 5. Historical backfill (not run)

`python tools/backfill.py` plans a backfill from a **local JSON snapshot**. It does not connect to Google Sheets, and it refuses the production spreadsheet id.

- **Dry-run is the default.** It writes an audit JSON of every proposed change and does not modify the snapshot.
- **Fills blank cells only.** A non-blank cell that disagrees with incoming data is recorded as a conflict and left unchanged. Incoming rows whose key is not already in the snapshot are not inserted.
- **Derived values** are position group (from `position`) and appearance status (from minutes, and only `did_not_play` when there are also no goals, assists or shots). Event coverage is not guessed, because old rows stored missing events as 0.
- **`--infer-league`** fills a blank match type with `leagueMatch` and marks that change as inferred. It is off by default.
- **Match ids** that are exact integers can be retyped as the same digit string. A float match id blocks the run.
- **`--apply`** writes a local JSON file only, and only when the quality checks pass.
- This was not executed against the live Sheet.

