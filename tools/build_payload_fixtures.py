"""Write tests/fixtures/payloads.json: webhook payloads from the V2 and V4 importers.

V2 payloads are produced with the exact library calls the V2 importer used
(league only, curated columns + events, ``default=serialize``), against the
same sanitised raw fixtures, so the historical-compatibility tests replay what
is already in the production sheet.

    python tools/build_payload_fixtures.py
"""

import json
import pathlib
import sys
from datetime import date, datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fc_clubs_api import FC27API  # noqa: E402

from pandametrics import ingest  # noqa: E402
from pandametrics.config import CLUBS, OFFICIAL_MATCH_TYPES  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"
OUT = FIXTURES / "payloads.json"


def raw(club_id, match_type):
    return json.loads((FIXTURES / f"matches_{club_id}_{match_type}.json").read_text())


def v2_serialize(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(type(value).__name__)


class FixtureAPI(FC27API):
    def get_json(self, endpoint, params=None):
        assert endpoint == "clubs/matches"
        return raw(params["clubIds"], params["matchType"])


def v2_payload(club_id):
    api = FixtureAPI(timezone="Europe/London")
    payload = {
        "clubId": str(club_id),
        "matches": api.get_club_matches(club_id),
        "players": api.get_match_players(club_id, include_events=True),
    }
    return json.loads(json.dumps(payload, default=v2_serialize))


def v4_payload(club_id):
    data = ingest.collect_club(raw, club_id, OFFICIAL_MATCH_TYPES)
    return {"clubId": str(club_id), "matches": data["matches"], "players": data["players"]}


def render():
    out = {
        "v2": {str(c): v2_payload(c) for c in CLUBS},
        "v4": {str(c): v4_payload(c) for c in CLUBS},
    }
    return json.dumps(out, indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(render())
    print(f"wrote {OUT.relative_to(ROOT)}")
