"""Deeper read-only audit of positions, playing time, match types and events."""

import collections
import glob
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fc_clubs_api.events import EVENT_STATS, parse_event_aggregates  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1] / "samples"
OUR_CLUBS = {"454058", "451080", "413965"}


def main():
    pos_arch = collections.Counter()
    player_pos = collections.defaultdict(collections.Counter)
    player_arch = collections.defaultdict(collections.Counter)
    seconds_spread = []
    club_match_types = collections.Counter()
    event_ids = collections.Counter()
    known = {e for stat in EVENT_STATS for e in stat.add + stat.subtract}
    experimental = {104: 0, 151: 0, 157: 0, 179: 0}
    ts = []
    passes_check = collections.Counter()

    for path in sorted(glob.glob(str(ROOT / "matches_*.json"))):
        for match in json.loads(pathlib.Path(path).read_text()):
            ts.append(match["timestamp"])
            for cid, club in match["clubs"].items():
                club_match_types[(pathlib.Path(path).stem.split("_")[2], club.get("matchType"))] += 1
            for cid, players in match["players"].items():
                secs = [int(p["secondsPlayed"]) for p in players.values()]
                seconds_spread.append((min(secs), max(secs), len(secs)))
                for pid, p in players.items():
                    if cid not in OUR_CLUBS:
                        continue
                    pos_arch[(p["pos"], p["archetypeid"])] += 1
                    player_pos[p["playername"]][p["pos"]] += 1
                    player_arch[p["playername"]][p["archetypeid"]] += 1
                    counts = parse_event_aggregates(p)
                    event_ids.update(counts.keys())
                    for k in experimental:
                        if k in counts:
                            experimental[k] += 1
                    made = int(p["passesmade"])
                    attempts = int(p["passattempts"])
                    ev_made = counts.get(215, 0)
                    ev_att = ev_made + counts.get(216, 0)
                    passes_check["made_equal" if made == ev_made else "made_diff"] += 1
                    passes_check["att_equal" if attempts == ev_att else "att_diff"] += 1
                    goals = int(p["goals"])
                    passes_check["goals_equal" if goals == counts.get(214, 0) else "goals_diff"] += 1
                    shots = int(p["shots"])
                    ev_shots = counts.get(217, 0) + counts.get(218, 0)
                    passes_check["shots_equal" if shots == ev_shots else "shots_diff"] += 1
                    tk = int(p["tacklesmade"])
                    passes_check["tackles_equal" if tk == counts.get(0, 0) else "tackles_diff"] += 1

    print("pos x archetypeid (our clubs):")
    for (pos, arch), n in sorted(pos_arch.items(), key=lambda x: (x[0][0], int(x[0][1]))):
        print(f"  {pos:<11} arch {arch:>2}: {n}")
    multi = {name: dict(c) for name, c in player_pos.items() if len(c) > 1}
    print("\nplayers with >1 pos group:", len(multi), "of", len(player_pos))
    print("players with >1 archetype:", sum(1 for c in player_arch.values() if len(c) > 1))
    varying = sum(1 for lo, hi, _ in seconds_spread if lo != hi)
    print(f"\nteams where secondsPlayed varies between players: {varying}/{len(seconds_spread)}")
    print("sample spreads:", seconds_spread[:8])
    print("\nclub matchType codes per request type:", dict(club_match_types))
    print("\nexperimental event presence (player rows):", experimental)
    unknown = {e: n for e, n in event_ids.items() if e not in known}
    print("event ids present but not decoded by library:", dict(sorted(unknown.items())))
    print("\nEA named fields vs decoded events:", dict(passes_check))
    print("\ntimestamp range:", min(ts), max(ts))


if __name__ == "__main__":
    main()
