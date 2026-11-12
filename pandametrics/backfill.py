"""Plan a historical backfill that only fills blank cells.

This never talks to Google Sheets. ``tools/backfill.py`` dry-runs by default
and, with ``--apply``, writes a local JSON file. The production spreadsheet
id is refused so this cannot be pointed at the live Sheet by mistake.

Existing non-blank cells are never changed, except a match id that is already
an exact integer may be retyped as a digit string (same digits). A match id
that arrived as a float is treated as already rounded and blocks the run.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

# The live PandaMetrics spreadsheet. Apply refuses this id unconditionally.
PRODUCTION_SPREADSHEET_ID = "18tYVaGchByuhKAAAt87q37_8f2_jWtJ75YP4kvEu32c"

KEY_FIELDS = {
    "Matches": ("clubId", "matchId"),
    "Player_Match_Stats": ("clubId", "matchId", "playerId"),
}

POSITION_GROUPS = {
    "goalkeeper": "GK",
    "defender": "DEF",
    "midfielder": "MID",
    "forward": "ATT",
    "gk": "GK",
    "def": "DEF",
    "mid": "MID",
    "att": "ATT",
}

OFFICIAL_MATCH_TYPES = {"leagueMatch", "playoffMatch"}
APPEARANCE_STATUSES = {"played", "did_not_play"}
GROUPS = {"ATT", "MID", "DEF", "GK"}


class BackfillBlocked(RuntimeError):
    """Quality checks failed, or a change would overwrite a non-blank cell."""


def is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def exact_match_id(value: Any) -> Optional[str]:
    """Digit string when the value is exact. None when it is missing or rounded.

    Floats are never accepted: a 16+ digit id stored as a Sheets number has
    already lost low-order digits and must not be rewritten or matched.
    """
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, float):
        return None
    if isinstance(value, int):
        return str(value) if value >= 0 else None
    text = str(value).strip()
    if text.startswith("'"):
        text = text[1:]
    if text.endswith(".0") and text[:-2].isdigit():
        text = text[:-2]
    return text if text.isdigit() else None


def _as_int(value: Any) -> Optional[int]:
    if isinstance(value, bool) or value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    text = str(value).strip()
    if text.startswith("-"):
        if text[1:].isdigit():
            return int(text)
        return None
    return int(text) if text.isdigit() else None


def derive_fields(row: Mapping[str, Any], infer_league: bool) -> Dict[str, Any]:
    """Values that can be computed from columns already stored on the row.

    Event coverage is not derived. Historical rows stored missing events as 0,
    which cannot be told apart from a real zero.
    """
    derived: Dict[str, Any] = {}
    sources: Dict[str, str] = {}

    position = str(row.get("position") or "").strip().lower()
    group = POSITION_GROUPS.get(position)
    if group:
        derived["positionGroup"] = group
        sources["positionGroup"] = "derived from position"

    seconds = _as_int(row.get("secondsPlayed"))
    realtime = _as_int(row.get("realTimeSeconds"))
    activity = [_as_int(row.get(name)) or 0 for name in ("goals", "assists", "shots")]
    if seconds == 0 and (realtime is None or realtime == 0) and not any(activity):
        derived["appearanceStatus"] = "did_not_play"
        sources["appearanceStatus"] = "derived from zero minutes and no goals, assists or shots"
    elif seconds is not None and seconds > 0:
        derived["appearanceStatus"] = "played"
        sources["appearanceStatus"] = "derived from seconds played"

    if infer_league and is_blank(row.get("matchType")):
        derived["matchType"] = "leagueMatch"
        sources["matchType"] = "inferred: playoffs were not imported before V4"

    return {"values": derived, "sources": sources}


def _key(row: Mapping[str, Any], fields: Sequence[str]) -> Tuple[Tuple[str, ...], bool]:
    parts: List[str] = []
    ok = True
    for field in fields:
        if field == "matchId":
            text = exact_match_id(row.get("matchId"))
            if text is None:
                ok = False
                text = ""
            parts.append(text)
        else:
            text = str(row.get(field) or "").strip()
            if isinstance(row.get(field), float):
                text = str(int(row[field])) if row[field].is_integer() else ""
            if not text:
                ok = False
            parts.append(text)
    return tuple(parts), ok


def _enum_problem(row_number: int, field: str, value: Any, allowed: set) -> Optional[Dict[str, Any]]:
    if is_blank(value):
        return None
    if str(value) not in allowed:
        return {
            "row": row_number,
            "check": field,
            "severity": "blocker",
            "detail": f"{field} {value!r} is not one of {sorted(allowed)}",
        }
    return None


def quality_checks(sheets: Mapping[str, Sequence[Mapping[str, Any]]]) -> List[Dict[str, Any]]:
    problems: List[Dict[str, Any]] = []
    for name, rows in sheets.items():
        fields = KEY_FIELDS.get(name)
        if fields is None:
            problems.append({
                "sheet": name, "row": None, "check": "sheet",
                "severity": "blocker", "detail": "unknown sheet",
            })
            continue
        seen: Dict[Tuple[str, ...], int] = {}
        for index, row in enumerate(rows, start=2):
            key, ok = _key(row, fields)
            if not ok:
                detail = "missing or rounded id"
                if name and exact_match_id(row.get("matchId")) is None:
                    detail = "matchId is missing or not an exact digit string"
                problems.append({
                    "sheet": name, "row": index, "check": "identity",
                    "severity": "blocker", "detail": detail,
                })
            elif key in seen:
                problems.append({
                    "sheet": name, "row": index, "check": "duplicate",
                    "severity": "blocker",
                    "detail": f"same key as row {seen[key]}: {'|'.join(key)}",
                })
            else:
                seen[key] = index

            for field, allowed in (
                ("matchType", OFFICIAL_MATCH_TYPES),
                ("positionGroup", GROUPS),
                ("appearanceStatus", APPEARANCE_STATUSES),
            ):
                problem = _enum_problem(index, field, row.get(field), allowed)
                if problem:
                    problem["sheet"] = name
                    problems.append(problem)
    return problems


def plan_backfill(
    sheets: Mapping[str, Sequence[Mapping[str, Any]]],
    incoming: Optional[Mapping[str, Sequence[Mapping[str, Any]]]] = None,
    derive: bool = True,
    infer_league: bool = False,
) -> Dict[str, Any]:
    """Describe fills and match-id retypes. Does not mutate ``sheets``."""
    incoming = incoming or {}
    problems = quality_checks(sheets)
    for name, rows in incoming.items():
        if name not in KEY_FIELDS:
            problems.append({
                "sheet": name, "row": None, "check": "sheet",
                "severity": "blocker", "detail": "incoming sheet is unknown",
            })
    problems.extend(
        {**p, "sheet": p.get("sheet"), "detail": "incoming: " + p["detail"]}
        for p in quality_checks(incoming)
    )

    changes: List[Dict[str, Any]] = []
    conflicts: List[Dict[str, Any]] = []
    unmatched: List[Dict[str, Any]] = []

    incoming_index: Dict[Tuple[str, Tuple[str, ...]], Mapping[str, Any]] = {}
    for name, rows in incoming.items():
        fields = KEY_FIELDS.get(name)
        if not fields:
            continue
        for row in rows:
            key, ok = _key(row, fields)
            if ok:
                incoming_index[(name, key)] = row

    seen_incoming = set()
    for name, rows in sheets.items():
        fields = KEY_FIELDS.get(name, ())
        for row in rows:
            key, ok = _key(row, fields)
            if not ok:
                continue
            fresh = incoming_index.get((name, key))
            if fresh is not None:
                seen_incoming.add((name, key))
            candidates: Dict[str, Any] = {}
            sources: Dict[str, str] = {}
            if derive:
                derived = derive_fields(row, infer_league)
                candidates.update(derived["values"])
                sources.update(derived["sources"])
            if fresh:
                for field, value in fresh.items():
                    if field in fields or is_blank(value):
                        continue
                    candidates[field] = value
                    sources[field] = "incoming row"
            for field, value in candidates.items():
                if field in fields:
                    continue
                current = row.get(field)
                if is_blank(current):
                    changes.append({
                        "kind": "fill",
                        "sheet": name,
                        "key": list(key),
                        "field": field,
                        "before": "" if current is None else current,
                        "after": value,
                        "source": sources.get(field, "incoming row"),
                    })
                elif str(current) != str(value):
                    conflicts.append({
                        "sheet": name,
                        "key": list(key),
                        "field": field,
                        "existing": current,
                        "incoming": value,
                    })

            match_id = row.get("matchId")
            exact = exact_match_id(match_id)
            if exact is not None and not isinstance(match_id, str):
                changes.append({
                    "kind": "retype",
                    "sheet": name,
                    "key": list(key),
                    "field": "matchId",
                    "before": exact,
                    "after": exact,
                    "beforeType": type(match_id).__name__,
                    "afterType": "str",
                    "source": "storage: same digits, text instead of a number",
                })

    for (name, key), row in incoming_index.items():
        if (name, key) not in seen_incoming:
            unmatched.append({"sheet": name, "key": list(key)})

    blockers = [p for p in problems if p.get("severity") == "blocker"]
    return {
        "ok": not blockers,
        "applied": False,
        "mode": "dry-run",
        "problems": problems,
        "changes": changes,
        "conflicts": conflicts,
        "unmatchedIncoming": unmatched,
        "counts": {
            "fills": sum(1 for c in changes if c["kind"] == "fill"),
            "retypes": sum(1 for c in changes if c["kind"] == "retype"),
            "conflicts": len(conflicts),
            "unmatchedIncoming": len(unmatched),
            "blockers": len(blockers),
        },
    }


def apply_plan(
    sheets: Mapping[str, Sequence[Mapping[str, Any]]],
    plan: Mapping[str, Any],
) -> Dict[str, List[Dict[str, Any]]]:
    """Return updated copies of the sheets. Refuses blockers and overwrites."""
    if not plan.get("ok", False):
        raise BackfillBlocked("quality checks failed; nothing was written")
    out: Dict[str, List[Dict[str, Any]]] = {
        name: [dict(row) for row in rows] for name, rows in sheets.items()
    }
    index: Dict[Tuple[str, Tuple[str, ...]], Dict[str, Any]] = {}
    for name, rows in out.items():
        fields = KEY_FIELDS.get(name, ())
        for row in rows:
            key, ok = _key(row, fields)
            if ok:
                index[(name, key)] = row

    for change in plan.get("changes", []):
        row = index[(change["sheet"], tuple(change["key"]))]
        field = change["field"]
        if change["kind"] == "fill":
            if not is_blank(row.get(field)):
                raise BackfillBlocked(f"refusing to overwrite {field}")
            row[field] = change["after"]
        elif change["kind"] == "retype":
            if exact_match_id(row.get(field)) != change["after"]:
                raise BackfillBlocked("refusing to change matchId digits")
            row[field] = change["after"]
        else:
            raise BackfillBlocked("unknown change kind")
    return out


def refuse_live_sheet(spreadsheet_id: Optional[str]) -> None:
    """This tool has no Google writer. The production id is rejected anyway."""
    if spreadsheet_id and spreadsheet_id.strip() == PRODUCTION_SPREADSHEET_ID:
        raise BackfillBlocked(
            "refusing the production spreadsheet; this tool never writes to Google Sheets"
        )
