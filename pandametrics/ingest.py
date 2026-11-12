"""Turn raw EA ``clubs/matches`` responses into match and appearance rows.

One raw request per club and match type feeds both the match rows and the
player-appearance rows, so the two can never disagree about which matches
exist.

Column names used by the V3 production dashboard (``name``, ``position``,
``rating``, ``goals``, ``passesCompleted``, ...) are kept unchanged so rows
produced here stay compatible with the deployed webhook and dashboard. New V4
columns are additive.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo

from fc_clubs_api.events import EVENT_STATS, parse_event_aggregates

from .config import EA_MATCH_TYPE_CODES, TIMEZONE

LONDON = ZoneInfo(TIMEZONE)

# EA "pos" values seen in clubs/matches. EA only reports the position *group*
# for each appearance; exact positions (CB, CDM, ST, ...) are not in the API.
POSITION_GROUPS = {
    "goalkeeper": "GK",
    "defender": "DEF",
    "midfielder": "MID",
    "forward": "ATT",
}

# EA named per-player fields -> V3-compatible column names.
EA_PLAYER_FIELDS = {
    "playername": "name",
    "pos": "position",
    "rating": "rating",
    "goals": "goals",
    "assists": "assists",
    "shots": "shots",
    "passesmade": "passesMade",
    "passattempts": "passAttempts",
    "tacklesmade": "tacklesMade",
    "tackleattempts": "tackleAttempts",
    "saves": "saves",
    "cleansheetsany": "cleanSheet",
    "cleansheetsdef": "cleanSheetDef",
    "cleansheetsgk": "cleanSheetGK",
    "goalsconceded": "goalsConceded",
    "mom": "manOfTheMatch",
    "redcards": "redCards",
    "secondsPlayed": "secondsPlayed",
    "realtimegame": "realTimeSeconds",
    "archetypeid": "archetypeId",
}

# Named EA fields that also exist as decoded event stats. EA's value wins,
# matching fc-clubs-api behaviour, and event values are kept separately under
# an ``event`` prefix so discrepancies stay visible.
EA_OVERRIDES_EVENT = ("goals", "assists", "shots")

_INT_FIELDS = {
    "goals", "assists", "shots", "passesMade", "passAttempts", "tacklesMade",
    "tackleAttempts", "saves", "cleanSheet", "cleanSheetDef", "cleanSheetGK",
    "goalsConceded", "manOfTheMatch", "redCards", "secondsPlayed",
    "realTimeSeconds",
}


class IngestError(ValueError):
    """Raw data is unusable (missing identifiers, wrong shape)."""


# ---------------------------------------------------------------- helpers


def _to_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(str(value).strip())
    except ValueError:
        return None


def _to_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def london_iso(epoch_seconds: Any) -> Optional[str]:
    """Unix seconds -> ISO-8601 in Europe/London (``2026-11-11T21:04:05+00:00``)."""
    seconds = _to_int(epoch_seconds)
    if seconds is None:
        return None
    moment = datetime.fromtimestamp(seconds, tz=timezone.utc).astimezone(LONDON)
    return moment.isoformat()


def raw_events_string(counts: Mapping[int, int]) -> str:
    """Canonical ``id:count`` string, sorted by id, for lossless storage."""
    return ",".join(f"{event}:{counts[event]}" for event in sorted(counts))


# Event pass attempts normally match EA's named passattempts within a few
# passes (offside passes are excluded from events). Far fewer event passes
# means the aggregate strings were truncated.
INCOMPLETE_MIN_ATTEMPTS = 10
INCOMPLETE_RATIO = 0.5


def event_coverage(player: Mapping[str, Any], counts: Mapping[int, int]) -> str:
    """``complete``, ``missing`` (no events) or ``incomplete`` (truncated).

    Observed in Nov 2026 samples: rows with empty aggregates, and rows where
    only ``match_event_aggregate_0`` was filled with 8-16 pass events against
    70-92 passes in EA's named totals. Either way the event stats for that row
    are unknown, not zero.
    """
    if not counts:
        return "missing"
    attempts = _to_int(player.get("passattempts")) or 0
    event_attempts = counts.get(215, 0) + counts.get(216, 0)
    if attempts >= INCOMPLETE_MIN_ATTEMPTS and event_attempts < attempts * INCOMPLETE_RATIO:
        return "incomplete"
    return "complete"


def events_available(player: Mapping[str, Any], counts: Mapping[int, int]) -> bool:
    """Whether decoded event stats can be trusted for this row."""
    return event_coverage(player, counts) == "complete"


def appearance_status(player: Mapping[str, Any], counts: Mapping[int, int]) -> str:
    """``played`` or ``did_not_play`` (in the squad list but no game time)."""
    seconds = _to_int(player.get("secondsPlayed")) or 0
    real = _to_int(player.get("realtimegame")) or 0
    if seconds == 0 and real == 0 and not counts:
        return "did_not_play"
    return "played"


# ---------------------------------------------------------------- matches


def _result(us: Mapping[str, Any], goals: int, against: int) -> str:
    if str(us.get("wins")) == "1":
        return "win"
    if str(us.get("losses")) == "1":
        return "loss"
    if str(us.get("ties")) == "1":
        return "draw"
    if goals > against:
        return "win"
    if goals < against:
        return "loss"
    return "draw"


def normalize_match(raw: Mapping[str, Any], club_id: Any, match_type: str) -> Dict[str, Any]:
    """One match row seen from ``club_id``'s side."""
    match_id = str(raw.get("matchId") or "").strip()
    if not match_id:
        raise IngestError(f"club {club_id}: match without matchId")

    our_id = str(club_id)
    clubs = raw.get("clubs") or {}
    if our_id not in clubs:
        raise IngestError(f"club {club_id}: match {match_id} does not include this club")

    us = clubs[our_id]
    opponent_id, them = None, {}
    for other_id, other in clubs.items():
        if other_id != our_id:
            opponent_id, them = other_id, other

    goals = _to_int(us.get("goals")) or 0
    against = _to_int(us.get("goalsAgainst")) or 0
    ea_code = str(us.get("matchType") or "")
    flags = []
    expected = EA_MATCH_TYPE_CODES.get(match_type)
    if expected and ea_code and ea_code != expected:
        flags.append(f"matchTypeCode:{ea_code}")

    dnf = str(us.get("winnerByDnf")) == "1" or str(them.get("winnerByDnf")) == "1"
    if dnf:
        flags.append("dnf")

    return {
        "matchId": match_id,
        "clubId": our_id,
        "timestamp": london_iso(raw.get("timestamp")),
        "timestampUnix": _to_int(raw.get("timestamp")),
        "matchType": match_type,
        "eaMatchTypeCode": ea_code,
        "seasonId": str(us.get("season_id") or ""),
        "opponentId": opponent_id,
        "opponentName": (them.get("details") or {}).get("name"),
        "goals": goals,
        "goalsAgainst": against,
        "result": _result(us, goals, against),
        "dnf": dnf,
        "dataQualityFlags": ";".join(flags),
    }


# ------------------------------------------------------------- appearances


def normalize_appearance(
    raw_match: Mapping[str, Any], club_id: Any, player_id: Any,
    player: Mapping[str, Any], match_type: str,
) -> Dict[str, Any]:
    """One player-appearance row with EA fields, decoded events and quality flags."""
    match_id = str(raw_match.get("matchId") or "").strip()
    pid = str(player_id or "").strip()
    if not match_id or not pid:
        raise IngestError(f"club {club_id}: player row without matchId/playerId")

    counts = parse_event_aggregates(player)
    coverage = event_coverage(player, counts)
    has_events = coverage == "complete"
    status = appearance_status(player, counts)

    row: Dict[str, Any] = {
        "matchId": match_id,
        "timestamp": london_iso(raw_match.get("timestamp")),
        "clubId": str(club_id),
        "playerId": pid,
        "matchType": match_type,
    }

    for source, target in EA_PLAYER_FIELDS.items():
        value = player.get(source)
        if target in _INT_FIELDS:
            row[target] = _to_int(value)
        elif target == "rating":
            row[target] = _to_float(value)
        else:
            row[target] = None if value in (None, "") else str(value)

    group = POSITION_GROUPS.get(str(player.get("pos") or "").strip().lower())
    row["positionGroup"] = group

    for stat in EVENT_STATS:
        value = stat.compute(counts) if has_events else None
        if stat.name in EA_OVERRIDES_EVENT:
            row["event" + stat.name[0].upper() + stat.name[1:]] = value
        else:
            row[stat.name] = value

    flags = []
    if coverage == "missing":
        flags.append("eventsMissing")
    elif coverage == "incomplete":
        flags.append("eventsIncomplete")
    if group is None:
        flags.append("unknownPosition")
    if status == "did_not_play":
        flags.append("didNotPlay")
    if has_events and row["goals"] is not None and row["goals"] != counts.get(214, 0):
        flags.append("goalsMismatch")
    if row["passesMade"] is None:
        flags.append("passTotalsMissing")

    row["eventsAvailable"] = has_events
    row["eventCoverage"] = coverage
    row["appearanceStatus"] = status
    row["rawEvents"] = raw_events_string(counts)
    row["dataQualityFlags"] = ";".join(flags)
    return row


# ------------------------------------------------------------------ batch


def normalize_club_matches(
    raw_matches: Iterable[Mapping[str, Any]], club_id: Any, match_type: str
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Normalise one raw ``clubs/matches`` list for our club only."""
    if not isinstance(raw_matches, list):
        raise IngestError(f"club {club_id}: expected a list of matches, got {type(raw_matches).__name__}")

    our_id = str(club_id)
    matches: List[Dict[str, Any]] = []
    players: List[Dict[str, Any]] = []
    for raw in raw_matches:
        matches.append(normalize_match(raw, our_id, match_type))
        for pid, stats in ((raw.get("players") or {}).get(our_id) or {}).items():
            players.append(normalize_appearance(raw, our_id, pid, stats, match_type))
    return matches, players


def dedupe(rows: Iterable[Dict[str, Any]], keys: Tuple[str, ...]) -> Tuple[List[Dict[str, Any]], int]:
    """Keep the first row per key; return (rows, number of duplicates dropped)."""
    seen = set()
    out = []
    dropped = 0
    for row in rows:
        key = tuple(str(row.get(k)) for k in keys)
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        out.append(row)
    return out, dropped


MATCH_KEY = ("clubId", "matchId")
APPEARANCE_KEY = ("clubId", "matchId", "playerId")


def collect_club(fetch, club_id: Any, match_types: Iterable[str]) -> Dict[str, Any]:
    """Fetch and normalise every official match type for one club.

    ``fetch(club_id, match_type)`` must return EA's raw match list.
    """
    matches: List[Dict[str, Any]] = []
    players: List[Dict[str, Any]] = []
    per_type: Dict[str, int] = {}
    for match_type in match_types:
        raw = fetch(club_id, match_type)
        m, p = normalize_club_matches(raw, club_id, match_type)
        per_type[match_type] = len(m)
        matches.extend(m)
        players.extend(p)

    matches, dup_matches = dedupe(matches, MATCH_KEY)
    players, dup_players = dedupe(players, APPEARANCE_KEY)
    return {
        "matches": matches,
        "players": players,
        "perType": per_type,
        "duplicatesDropped": dup_matches + dup_players,
    }


def quality_summary(players: Iterable[Mapping[str, Any]]) -> Dict[str, int]:
    """Count data-quality flags across appearance rows."""
    summary: Dict[str, int] = {}
    for row in players:
        for flag in filter(None, str(row.get("dataQualityFlags") or "").split(";")):
            summary[flag] = summary.get(flag, 0) + 1
    return summary
