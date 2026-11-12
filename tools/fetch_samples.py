"""Download read-only raw EA API samples for schema auditing.

Writes to samples/ (git-ignored). Never sends anything to Google.

    python tools/fetch_samples.py
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fc_clubs_api import FC27API  # noqa: E402

from pandametrics.config import CLUBS, OFFICIAL_MATCH_TYPES  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[1] / "samples"


def main():
    OUT.mkdir(exist_ok=True)
    api = FC27API(timezone="Europe/London", output="raw", timeout=20)

    for club_id in CLUBS:
        for match_type in OFFICIAL_MATCH_TYPES:
            data = api.get_club_matches(club_id, match_type=match_type, count=10)
            path = OUT / f"matches_{club_id}_{match_type}.json"
            path.write_text(json.dumps(data, indent=1))
            print(f"{path.name}: {len(data)} matches")

        members = api.get_member_stats(club_id)
        (OUT / f"members_{club_id}.json").write_text(json.dumps(members, indent=1))
        print(f"members_{club_id}.json: {len(members.get('members', []))} members")


if __name__ == "__main__":
    main()
