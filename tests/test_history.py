"""V4 rows must stay compatible with what V2 already wrote to the sheet."""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import build_payload_fixtures  # noqa: E402

PAYLOADS = json.loads((ROOT / "tests" / "fixtures" / "payloads.json").read_text())

# V2 columns V4 intentionally changes. Each must be explained here.
V2_ONLY_PLAYER_COLUMNS = set()
V2_ONLY_MATCH_COLUMNS = {"clubName"}  # webhook adds clubName to every row itself


def columns(rows):
    return {k for row in rows for k in row}


def test_payload_fixture_is_fresh():
    current = (ROOT / "tests" / "fixtures" / "payloads.json").read_text()
    assert current == build_payload_fixtures.render(), "run python tools/build_payload_fixtures.py"


def test_v4_keeps_every_v2_player_column():
    for club, v2 in PAYLOADS["v2"].items():
        v4 = PAYLOADS["v4"][club]
        missing = columns(v2["players"]) - columns(v4["players"]) - V2_ONLY_PLAYER_COLUMNS
        assert not missing, f"{club}: V4 drops {sorted(missing)}"


def test_v4_keeps_every_v2_match_column():
    for club, v2 in PAYLOADS["v2"].items():
        v4 = PAYLOADS["v4"][club]
        missing = columns(v2["matches"]) - columns(v4["matches"]) - V2_ONLY_MATCH_COLUMNS
        assert not missing, f"{club}: V4 drops {sorted(missing)}"


def test_keys_serialise_identically():
    # The webhook dedupes on String(value); V2 sent ints, V4 sends strings.
    for club, v2 in PAYLOADS["v2"].items():
        v4 = PAYLOADS["v4"][club]
        v2_keys = {(str(p["clubId"]), str(p["matchId"]), str(p["playerId"])) for p in v2["players"]}
        v4_keys = {(p["clubId"], p["matchId"], p["playerId"]) for p in v4["players"]
                   if p["matchType"] == "leagueMatch"}
        assert v2_keys == v4_keys, club


def test_timestamps_identical_format():
    for club, v2 in PAYLOADS["v2"].items():
        v4 = {m["matchId"]: m for m in PAYLOADS["v4"][club]["matches"]}
        for m in v2["matches"]:
            assert v4[str(m["matchId"])]["timestamp"] == m["timestamp"]


def test_shared_values_agree_with_v2():
    """Where both versions have a value, it must be the same (except documented changes)."""
    changed = set()
    for club, v2 in PAYLOADS["v2"].items():
        v4 = {(p["matchId"], p["playerId"]): p for p in PAYLOADS["v4"][club]["players"]}
        for p in v2["players"]:
            q = v4[(str(p["matchId"]), str(p["playerId"]))]
            for key, value in p.items():
                if key in ("matchId", "playerId", "clubId"):
                    continue
                if value != q.get(key):
                    changed.add((key, "eventsUnavailable" if q.get(key) is None else "value"))
    # Only event stats on rows whose events are missing/incomplete may differ: V2 wrote 0, V4 blank.
    assert all(reason == "eventsUnavailable" for _, reason in changed), sorted(changed)
