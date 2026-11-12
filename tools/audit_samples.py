"""Summarise the schema of raw samples in samples/ (read-only, local)."""

import collections
import glob
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / "samples"


def main():
    player_keys = collections.Counter()
    match_keys = collections.Counter()
    club_keys = collections.Counter()
    values = collections.defaultdict(collections.Counter)
    match_ids = collections.defaultdict(set)
    player_rows = 0
    fixtures = collections.Counter()

    for path in sorted(glob.glob(str(ROOT / "matches_*.json"))):
        club_id = path.split("_")[1]
        for match in json.loads(pathlib.Path(path).read_text()):
            match_keys.update(match.keys())
            match_ids[str(match["matchId"])].add(club_id)
            fixtures[str(match["matchId"])] += 1
            for cid, club in (match.get("clubs") or {}).items():
                club_keys.update(club.keys())
            for cid, players in (match.get("players") or {}).items():
                for pid, stats in players.items():
                    player_rows += 1
                    player_keys.update(stats.keys())
                    for field in ("pos", "archetypeid", "secondsPlayed", "vproattr",
                                  "vprohackreason", "realtimegame", "realtimeidle",
                                  "gameTime", "userResult", "cleansheetsdef",
                                  "cleansheetsgk", "cleansheetsany", "redcards", "mom"):
                        if field in stats:
                            v = stats[field]
                            if field == "vproattr":
                                v = f"len={len(str(v))}"
                            values[field][str(v)] += 1

    print("player rows (both teams):", player_rows)
    print("\nMATCH KEYS:", dict(match_keys))
    print("\nCLUB KEYS:", sorted(club_keys))
    print("\nPLAYER KEYS (count):")
    for k, c in sorted(player_keys.items()):
        print(f"  {k}: {c}")
    print("\nVALUE DISTRIBUTIONS:")
    for field, counter in values.items():
        top = counter.most_common(25)
        print(f"  {field}: {top}")
    shared = {m: c for m, c in match_ids.items() if len(c) > 1}
    print("\nmatchIds seen by >1 of our clubs:", shared)
    print("duplicate matchIds within files:", {m: n for m, n in fixtures.items() if n > 1})

    for path in sorted(glob.glob(str(ROOT / "members_*.json"))):
        data = json.loads(pathlib.Path(path).read_text())
        print("\n", pathlib.Path(path).name, "top keys:", list(data.keys()))
        if data.get("members"):
            print("  member keys:", sorted(data["members"][0].keys()))
            print("  favoritePosition:", collections.Counter(m.get("favoritePosition") for m in data["members"]))
            print("  positionCount:", data.get("positionCount"))


if __name__ == "__main__":
    main()
