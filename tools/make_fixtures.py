"""Build sanitised test fixtures from raw samples in samples/.

Replaces gamertags, player ids and opponent names with stable placeholders and
drops opponents' player rows. Event aggregates and numeric fields are kept.

    python tools/make_fixtures.py
"""

import glob
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
OUT = ROOT / "tests" / "fixtures"
OUR_CLUBS = {"454058", "451080", "413965"}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    player_ids = {}
    opponents = {}

    def fake_player(pid):
        if pid not in player_ids:
            player_ids[pid] = str(900000001 + len(player_ids))
        return player_ids[pid]

    def fake_opponent(cid):
        if cid not in opponents:
            opponents[cid] = (str(800001 + len(opponents)), f"Opponent {len(opponents) + 1}")
        return opponents[cid]

    for path in sorted(glob.glob(str(SAMPLES / "matches_*.json"))):
        matches = json.loads(pathlib.Path(path).read_text())
        cleaned = []
        for match in matches:
            clubs = {}
            for cid, club in match["clubs"].items():
                if cid in OUR_CLUBS:
                    clubs[cid] = club
                else:
                    new_id, new_name = fake_opponent(cid)
                    club = dict(club)
                    club["details"] = {**(club.get("details") or {}), "name": new_name, "clubId": int(new_id)}
                    clubs[new_id] = club
            players = {}
            for cid, roster in match["players"].items():
                if cid not in OUR_CLUBS:
                    continue
                players[cid] = {}
                for pid, stats in roster.items():
                    fake = fake_player(pid)
                    stats = dict(stats)
                    stats["playername"] = f"Panda {int(fake) - 900000000}"
                    players[cid][fake] = stats
            cleaned.append({
                "matchId": match["matchId"],
                "timestamp": match["timestamp"],
                "clubs": clubs,
                "players": players,
            })
        name = pathlib.Path(path).name
        (OUT / name).write_text(json.dumps(cleaned, indent=1))
        print(f"{name}: {len(cleaned)} matches")


if __name__ == "__main__":
    main()
