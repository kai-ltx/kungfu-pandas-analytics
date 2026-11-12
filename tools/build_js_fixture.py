"""Write tests/fixtures/appearances.json (ingested rows) for the JS tests.

    python tools/build_js_fixture.py
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pandametrics import ingest  # noqa: E402
from pandametrics.config import CLUBS, OFFICIAL_MATCH_TYPES  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"
OUT = FIXTURES / "appearances.json"


def build():
    def fetch(club_id, match_type):
        return json.loads((FIXTURES / f"matches_{club_id}_{match_type}.json").read_text())

    matches, players = [], []
    for club_id in CLUBS:
        data = ingest.collect_club(fetch, club_id, OFFICIAL_MATCH_TYPES)
        matches.extend(data["matches"])
        players.extend(data["players"])
    return {"matches": matches, "players": players}


def render():
    return json.dumps(build(), indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(render())
    print(f"wrote {OUT.relative_to(ROOT)}")
