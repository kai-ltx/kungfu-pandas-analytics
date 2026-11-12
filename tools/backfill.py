#!/usr/bin/env python3
"""Dry-run a historical backfill against a local snapshot.

Never contacts Google Sheets and refuses the production spreadsheet id.
``--apply`` writes a local JSON file only. Review the audit before using it.

Snapshot shape::

    {
      "Matches": [ {"clubId": "454058", "matchId": "1775...", ...} ],
      "Player_Match_Stats": [ ... ]
    }

Usage:
    python tools/backfill.py --snapshot sheet.json --audit backfill-audit.json
    python tools/backfill.py --snapshot sheet.json --incoming fresh.json --apply --output filled.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pandametrics.backfill import (  # noqa: E402
    BackfillBlocked,
    apply_plan,
    plan_backfill,
    refuse_live_sheet,
)


def load_sheets(path: str):
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict):
        raise SystemExit("snapshot must be a JSON object of sheet name -> rows")
    return data


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Plan a non-destructive historical backfill.")
    parser.add_argument("--snapshot", required=True, help="Local JSON export. Not read from Google.")
    parser.add_argument("--incoming", help="Optional fresh ingest JSON in the same shape.")
    parser.add_argument("--infer-league", action="store_true",
                        help="Fill a blank matchType with leagueMatch and mark it inferred.")
    parser.add_argument("--no-derive", action="store_true",
                        help="Do not derive position group or appearance status from stored columns.")
    parser.add_argument("--audit", help="Write the plan JSON here.")
    parser.add_argument("--apply", action="store_true",
                        help="Write updated rows to --output. Does not touch Google Sheets.")
    parser.add_argument("--output", help="Local JSON path used only with --apply.")
    parser.add_argument("--spreadsheet-id",
                        help="Rejected when it is the production spreadsheet. Never used to connect.")
    args = parser.parse_args(argv)

    try:
        refuse_live_sheet(args.spreadsheet_id)
    except BackfillBlocked as error:
        print(error, file=sys.stderr)
        return 2

    sheets = load_sheets(args.snapshot)
    incoming = load_sheets(args.incoming) if args.incoming else None
    plan = plan_backfill(sheets, incoming, derive=not args.no_derive, infer_league=args.infer_league)
    plan["applied"] = False
    plan["spreadsheet"] = "local snapshot only"

    if args.apply:
        if not args.output:
            print("--apply needs --output, a local JSON file.", file=sys.stderr)
            return 2
        try:
            updated = apply_plan(sheets, plan)
        except BackfillBlocked as error:
            print(error, file=sys.stderr)
            _write_audit(args.audit, plan)
            return 1
        Path(args.output).write_text(json.dumps(updated, indent=2) + "\n")
        plan["applied"] = True
        plan["mode"] = "local-file"
        plan["output"] = args.output

    text = json.dumps(plan, indent=2)
    _write_audit(args.audit, plan)
    print(text)
    if not plan["ok"]:
        return 1
    return 0


def _write_audit(path, plan) -> None:
    if path:
        Path(path).write_text(json.dumps(plan, indent=2) + "\n")


if __name__ == "__main__":
    sys.exit(main())
