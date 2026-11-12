import copy
import json
import pathlib

import pytest

from pandametrics import ingest
from pandametrics.config import CLUBS, OFFICIAL_MATCH_TYPES

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def load(club_id, match_type):
    return json.loads((FIXTURES / f"matches_{club_id}_{match_type}.json").read_text())


def fixture_fetch(club_id, match_type):
    return load(club_id, match_type)


@pytest.fixture(scope="module")
def all_clubs():
    return {cid: ingest.collect_club(fixture_fetch, cid, OFFICIAL_MATCH_TYPES) for cid in CLUBS}


# ---------------------------------------------------------------- matches


def test_official_match_types_exclude_friendlies():
    assert OFFICIAL_MATCH_TYPES == ("leagueMatch", "playoffMatch")


def test_playoffs_are_collected(all_clubs):
    bamboo = all_clubs[451080]
    assert bamboo["perType"] == {"leagueMatch": 10, "playoffMatch": 3}
    playoff = [m for m in bamboo["matches"] if m["matchType"] == "playoffMatch"]
    assert len(playoff) == 3
    assert {m["eaMatchTypeCode"] for m in playoff} == {"3"}


def test_league_match_type_code_verified(all_clubs):
    for data in all_clubs.values():
        league = [m for m in data["matches"] if m["matchType"] == "leagueMatch"]
        assert {m["eaMatchTypeCode"] for m in league} == {"1"}
        assert not any("matchTypeCode" in m["dataQualityFlags"] for m in league)


def test_match_type_mismatch_is_flagged():
    raw = load(451080, "playoffMatch")[0]
    row = ingest.normalize_match(raw, 451080, "leagueMatch")
    assert "matchTypeCode:3" in row["dataQualityFlags"]


def test_match_ids_are_strings_and_timestamps_london(all_clubs):
    for data in all_clubs.values():
        for m in data["matches"]:
            assert isinstance(m["matchId"], str) and m["matchId"].isdigit()
            assert m["timestamp"].endswith(("+00:00", "+01:00"))


def test_london_iso_handles_bst_and_gmt():
    assert ingest.london_iso(1782936000) == "2026-07-01T21:00:00+01:00"  # BST
    assert ingest.london_iso(1794603600) == "2026-11-13T21:00:00+00:00"  # GMT
    assert ingest.london_iso(None) is None


def test_result_uses_ea_flags_then_score():
    assert ingest._result({"wins": "1"}, 0, 3) == "win"
    assert ingest._result({"losses": "1"}, 3, 0) == "loss"
    assert ingest._result({}, 2, 1) == "win"
    assert ingest._result({}, 1, 1) == "draw"


def test_missing_match_id_raises():
    raw = copy.deepcopy(load(451080, "leagueMatch")[0])
    raw["matchId"] = ""
    with pytest.raises(ingest.IngestError):
        ingest.normalize_match(raw, 451080, "leagueMatch")


def test_long_match_id_stays_an_exact_json_string():
    # 2^53+1 cannot survive JavaScript or Google Sheets as a number.
    match_id = 9007199254740993
    raw = copy.deepcopy(load(451080, "leagueMatch")[0])
    raw["matchId"] = match_id
    matches, players = ingest.normalize_club_matches([raw], 451080, "leagueMatch")
    assert matches[0]["matchId"] == "9007199254740993"
    assert all(p["matchId"] == "9007199254740993" for p in players)
    payload = json.dumps({"matches": matches, "players": players})
    assert '"matchId": "9007199254740993"' in payload
    assert '"matchId": 9007199254740993' not in payload
    restored = json.loads(payload)
    assert restored["matches"][0]["matchId"] == "9007199254740993"


def test_float_match_id_is_rejected():
    raw = copy.deepcopy(load(451080, "leagueMatch")[0])
    raw["matchId"] = 1.5
    with pytest.raises(ingest.IngestError):
        ingest.normalize_match(raw, 451080, "leagueMatch")


def test_match_without_our_club_raises():
    raw = load(451080, "leagueMatch")[0]
    with pytest.raises(ingest.IngestError):
        ingest.normalize_match(raw, 999, "leagueMatch")


# ------------------------------------------------------------ appearances


def test_one_appearance_per_club_match_player(all_clubs):
    for data in all_clubs.values():
        keys = [(p["clubId"], p["matchId"], p["playerId"]) for p in data["players"]]
        assert len(keys) == len(set(keys))


def test_only_our_club_players_are_kept(all_clubs):
    for cid, data in all_clubs.items():
        assert {p["clubId"] for p in data["players"]} == {str(cid)}


def test_dedupe_drops_repeated_rows():
    rows = [{"clubId": "1", "matchId": "2", "playerId": "3", "v": 1},
            {"clubId": "1", "matchId": "2", "playerId": "3", "v": 2},
            {"clubId": "4", "matchId": "2", "playerId": "3", "v": 3}]
    out, dropped = ingest.dedupe(rows, ingest.APPEARANCE_KEY)
    assert dropped == 1
    assert [r["v"] for r in out] == [1, 3]


def test_same_fixture_in_two_clubs_kept_separately():
    raw = load(451080, "leagueMatch")
    data_a = ingest.collect_club(lambda c, t: raw if t == "leagueMatch" else [], 451080, OFFICIAL_MATCH_TYPES)
    data_b = ingest.collect_club(lambda c, t: raw if t == "leagueMatch" else [], 451080, OFFICIAL_MATCH_TYPES)
    combined, dropped = ingest.dedupe(data_a["matches"] + data_b["matches"], ingest.MATCH_KEY)
    assert dropped == len(data_a["matches"])  # identical club+match => duplicate
    assert len(combined) == len(data_a["matches"])


def test_position_group_mapping(all_clubs):
    groups = {p["positionGroup"] for d in all_clubs.values() for p in d["players"]}
    assert groups <= {"ATT", "MID", "DEF", "GK"}
    assert {"ATT", "MID", "DEF"} <= groups
    for d in all_clubs.values():
        for p in d["players"]:
            assert p["positionGroup"] == ingest.POSITION_GROUPS[p["position"]]


def test_position_is_per_appearance_not_per_player(all_clubs):
    by_player = {}
    for d in all_clubs.values():
        for p in d["players"]:
            by_player.setdefault(p["playerId"], set()).add(p["positionGroup"])
    assert any(len(groups) > 1 for groups in by_player.values())


def test_unknown_position_flagged():
    raw = copy.deepcopy(load(451080, "leagueMatch")[0])
    pid, stats = next(iter(raw["players"]["451080"].items()))
    stats["pos"] = "sweeper"
    row = ingest.normalize_appearance(raw, "451080", pid, stats, "leagueMatch")
    assert row["positionGroup"] is None
    assert "unknownPosition" in row["dataQualityFlags"]


def test_archetype_preserved_as_string(all_clubs):
    for d in all_clubs.values():
        for p in d["players"]:
            assert p["archetypeId"] is None or p["archetypeId"].isdigit()


def test_raw_events_preserved_losslessly(all_clubs):
    from fc_clubs_api.events import parse_event_aggregates

    for d in all_clubs.values():
        for p in d["players"]:
            if not p["rawEvents"]:
                continue
            reparsed = parse_event_aggregates({"match_event_aggregate_0": p["rawEvents"]})
            assert ingest.raw_events_string(reparsed) == p["rawEvents"]


def test_raw_events_string_sorted():
    assert ingest.raw_events_string({216: 5, 30: 8, 215: 21}) == "30:8,215:21,216:5"


# ------------------------------------------------------ missing vs zero


def _player(**overrides):
    base = {
        "playername": "X", "pos": "midfielder", "rating": "7.0",
        "goals": "0", "assists": "0", "shots": "0",
        "passesmade": "0", "passattempts": "0",
        "tacklesmade": "0", "tackleattempts": "0",
        "secondsPlayed": "5400", "realtimegame": "900",
        "match_event_aggregate_0": "", "match_event_aggregate_1": "",
        "match_event_aggregate_2": "", "match_event_aggregate_3": "",
    }
    base.update(overrides)
    return base


RAW_MATCH = {"matchId": "123", "timestamp": "1794603600"}


def test_events_missing_when_aggregates_empty():
    row = ingest.normalize_appearance(RAW_MATCH, "1", "9", _player(passesmade="40", passattempts="45"), "leagueMatch")
    assert row["eventsAvailable"] is False
    assert row["passesCompletedForward"] is None
    assert row["interceptions"] is None
    assert "eventsMissing" in row["dataQualityFlags"]
    # EA named totals still usable
    assert row["passesMade"] == 40 and row["passAttempts"] == 45


def test_events_incomplete_when_pass_events_absent_but_ea_shows_passes():
    player = _player(passesmade="76", passattempts="83", match_event_aggregate_0="0:2,6:1")
    row = ingest.normalize_appearance(RAW_MATCH, "1", "9", player, "leagueMatch")
    assert row["eventsAvailable"] is False
    assert row["eventCoverage"] == "incomplete"
    assert row["tacklesWon"] is None
    assert "eventsIncomplete" in row["dataQualityFlags"]


def test_events_incomplete_when_truncated():
    # Observed shape: 92 passes made by EA, only 16 pass events decoded.
    player = _player(passesmade="92", passattempts="99", match_event_aggregate_0="215:16,0:3,6:2")
    row = ingest.normalize_appearance(RAW_MATCH, "1", "9", player, "leagueMatch")
    assert row["eventCoverage"] == "incomplete"
    assert row["passesCompleted"] is None


def test_small_offside_gap_is_still_complete():
    # EA passesmade includes offside passes; events exclude them.
    player = _player(passesmade="31", passattempts="36", match_event_aggregate_0="215:30,216:5,153:1")
    row = ingest.normalize_appearance(RAW_MATCH, "1", "9", player, "leagueMatch")
    assert row["eventCoverage"] == "complete"
    assert row["offsidePasses"] == 1


def test_true_zero_kept_when_events_present():
    player = _player(passesmade="20", passattempts="22", match_event_aggregate_0="215:20,216:2,30:5")
    row = ingest.normalize_appearance(RAW_MATCH, "1", "9", player, "leagueMatch")
    assert row["eventsAvailable"] is True
    assert row["interceptions"] == 0
    assert row["passesCompletedForward"] == 5


def test_did_not_play_detected():
    player = _player(secondsPlayed="0", realtimegame="0", rating="3.00")
    row = ingest.normalize_appearance(RAW_MATCH, "1", "9", player, "leagueMatch")
    assert row["appearanceStatus"] == "did_not_play"
    assert "didNotPlay" in row["dataQualityFlags"]


def test_fixture_contains_quality_edge_cases(all_clubs):
    flags = {}
    for d in all_clubs.values():
        for k, v in ingest.quality_summary(d["players"]).items():
            flags[k] = flags.get(k, 0) + v
    assert flags.get("didNotPlay", 0) >= 1
    assert flags.get("eventsMissing", 0) >= 1
    assert flags.get("eventsIncomplete", 0) >= 1


def test_ea_goals_kept_and_event_goals_separate(all_clubs):
    for d in all_clubs.values():
        for p in d["players"]:
            assert "eventGoals" in p
            if p["eventsAvailable"] and p["eventGoals"] != p["goals"]:
                assert "goalsMismatch" in p["dataQualityFlags"]


# --------------------------------------------------- V3 compatibility


V3_COLUMNS = {
    "matchId", "timestamp", "clubId", "playerId", "name", "position", "rating",
    "goals", "assists", "shots", "passesMade", "passAttempts", "tacklesMade",
    "tackleAttempts", "saves", "cleanSheet", "manOfTheMatch", "redCards",
    "secondsPlayed", "passesCompleted", "passesFailed", "passesCompletedForward",
    "passesFailedForward", "passesCompletedBackward", "passesFailedBackward",
    "passesCompletedSideways", "passesFailedSideways", "shotsOnTarget",
    "shotsOffTarget", "interceptions", "tacklesWon", "possessionWonDefensiveThird",
    "possessionWonMiddleThird", "possessionWonAttackingThird",
    "possessionLostDefensiveThird", "possessionLostMiddleThird",
    "possessionLostAttackingThird", "outOfPosition", "feedbackBestOptionTaken",
    "feedbackShouldHavePassedElsewhere",
}

V3_MATCH_COLUMNS = {"matchId", "timestamp", "opponentName", "result", "goals", "goalsAgainst", "matchType"}


def test_rows_keep_v3_dashboard_columns(all_clubs):
    for d in all_clubs.values():
        for p in d["players"]:
            assert V3_COLUMNS <= set(p)
        for m in d["matches"]:
            assert V3_MATCH_COLUMNS <= set(m)


def test_payload_is_json_serialisable(all_clubs):
    for d in all_clubs.values():
        json.dumps({"matches": d["matches"], "players": d["players"]})


def test_bad_raw_shape_raises():
    with pytest.raises(ingest.IngestError):
        ingest.normalize_club_matches({"not": "a list"}, 451080, "leagueMatch")
