import json
import subprocess
import sys
from pathlib import Path

import pytest

from pandametrics.backfill import (
    PRODUCTION_SPREADSHEET_ID,
    BackfillBlocked,
    apply_plan,
    plan_backfill,
    refuse_live_sheet,
)

ROOT = Path(__file__).resolve().parents[1]
LONG_ID = "9007199254740993"


def sheets():
    return {
        "Matches": [{
            "clubId": "454058",
            "matchId": 177596832510163,
            "matchType": "",
            "opponentName": "Opponent",
            "goals": 2,
        }],
        "Player_Match_Stats": [{
            "clubId": "454058",
            "matchId": LONG_ID,
            "playerId": "42",
            "position": "midfielder",
            "positionGroup": "",
            "secondsPlayed": 0,
            "realTimeSeconds": 0,
            "goals": 0,
            "name": "Panda",
        }],
    }


def test_dry_run_fills_blanks_and_does_not_mutate():
    original = json.loads(json.dumps(sheets()))
    plan = plan_backfill(original, infer_league=True)
    assert original == sheets()
    assert plan["applied"] is False
    fills = {(c["sheet"], c["field"], c["after"]) for c in plan["changes"] if c["kind"] == "fill"}
    assert ("Player_Match_Stats", "positionGroup", "MID") in fills
    assert ("Player_Match_Stats", "appearanceStatus", "did_not_play") in fills
    assert ("Matches", "matchType", "leagueMatch") in fills
    assert ("Player_Match_Stats", "matchType", "leagueMatch") in fills
    inferred = [c for c in plan["changes"] if c["field"] == "matchType"]
    assert inferred[0]["source"].startswith("inferred")
    assert plan["counts"]["fills"] == 4


def test_non_blank_cells_are_conflicts_not_overwrites():
    data = sheets()
    data["Player_Match_Stats"][0]["positionGroup"] = "MID"
    plan = plan_backfill(data, incoming={
        "Player_Match_Stats": [{
            "clubId": "454058", "matchId": LONG_ID, "playerId": "42",
            "goals": 4, "positionGroup": "ATT",
        }]
    })
    assert plan["ok"]
    assert not any(c["kind"] == "fill" and c["field"] in ("goals", "positionGroup") for c in plan["changes"])
    assert {c["field"] for c in plan["conflicts"]} >= {"goals", "positionGroup"}
    updated = apply_plan(data, plan)
    assert updated["Player_Match_Stats"][0]["goals"] == 0
    assert updated["Player_Match_Stats"][0]["positionGroup"] == "MID"
    assert updated["Player_Match_Stats"][0]["name"] == "Panda"


def test_long_match_id_is_preserved_and_integer_ids_are_retyped():
    data = sheets()
    plan = plan_backfill(data)
    retypes = [c for c in plan["changes"] if c["kind"] == "retype"]
    assert len(retypes) == 1
    assert retypes[0]["before"] == retypes[0]["after"] == "177596832510163"
    updated = apply_plan(data, plan)
    assert updated["Matches"][0]["matchId"] == "177596832510163"
    assert isinstance(updated["Matches"][0]["matchId"], str)
    assert updated["Player_Match_Stats"][0]["matchId"] == LONG_ID


def test_float_match_id_blocks_and_apply_writes_nothing():
    data = sheets()
    data["Matches"][0]["matchId"] = 1.5
    plan = plan_backfill(data)
    assert plan["ok"] is False
    assert plan["counts"]["blockers"] >= 1
    with pytest.raises(BackfillBlocked):
        apply_plan(data, plan)
    assert data["Matches"][0]["opponentName"] == "Opponent"


def test_duplicate_keys_block():
    data = sheets()
    data["Matches"].append(dict(data["Matches"][0]))
    plan = plan_backfill(data)
    assert any(p["check"] == "duplicate" for p in plan["problems"])
    with pytest.raises(BackfillBlocked):
        apply_plan(data, plan)


def test_incoming_rows_are_not_inserted():
    data = sheets()
    plan = plan_backfill(data, incoming={
        "Matches": [{
            "clubId": "454058", "matchId": "999", "matchType": "playoffMatch", "goals": 1,
        }]
    })
    assert plan["counts"]["unmatchedIncoming"] == 1
    updated = apply_plan(data, plan)
    assert len(updated["Matches"]) == 1


def test_league_is_not_inferred_unless_asked():
    plan = plan_backfill(sheets(), infer_league=False)
    assert not any(c["field"] == "matchType" for c in plan["changes"])


def test_production_spreadsheet_is_refused():
    with pytest.raises(BackfillBlocked):
        refuse_live_sheet(PRODUCTION_SPREADSHEET_ID)
    refuse_live_sheet(None)
    refuse_live_sheet("some-other-id")


def test_cli_dry_run_and_local_apply(tmp_path):
    snapshot = tmp_path / "sheet.json"
    snapshot.write_text(json.dumps(sheets()))
    audit = tmp_path / "audit.json"
    dry = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "backfill.py"),
         "--snapshot", str(snapshot), "--audit", str(audit), "--infer-league"],
        capture_output=True, text=True, check=False,
    )
    assert dry.returncode == 0, dry.stderr
    report = json.loads(audit.read_text())
    assert report["applied"] is False
    assert report["counts"]["fills"] == 4
    assert snapshot.read_text() == json.dumps(sheets())

    output = tmp_path / "filled.json"
    applied = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "backfill.py"),
         "--snapshot", str(snapshot), "--apply", "--output", str(output)],
        capture_output=True, text=True, check=False,
    )
    assert applied.returncode == 0, applied.stderr
    filled = json.loads(output.read_text())
    assert filled["Player_Match_Stats"][0]["positionGroup"] == "MID"
    assert filled["Player_Match_Stats"][0]["goals"] == 0

    refused = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "backfill.py"),
         "--snapshot", str(snapshot), "--spreadsheet-id", PRODUCTION_SPREADSHEET_ID],
        capture_output=True, text=True, check=False,
    )
    assert refused.returncode == 2
    assert "production" in refused.stderr
