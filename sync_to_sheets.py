# ==========================================
# PANDAMETRICS V4 - MULTI-CLUB DATA SYNC
# ==========================================
#
# Fetches official matches (league + playoffs) for every club, normalises
# them with pandametrics.ingest and posts them to the Apps Script webhook.
# The payload shape ({token, clubId, matches, players}) is unchanged from V2,
# so the deployed webhook keeps working; new V4 columns are additive.

import json
import os
import sys

import requests
from fc_clubs_api import FC27API

from pandametrics.config import CLUBS, OFFICIAL_MATCH_TYPES, TIMEZONE
from pandametrics.ingest import collect_club, quality_summary


def post_club(url, token, club_id, data):
    payload = {
        "token": token,
        "clubId": str(club_id),
        "matches": data["matches"],
        "players": data["players"],
    }

    response = requests.post(
        url,
        data=json.dumps(payload),
        headers={"Content-Type": "application/json"},
        timeout=60,
    )
    response.raise_for_status()

    result = response.json()
    if not result.get("success"):
        raise RuntimeError(result.get("error", "Unknown error"))
    return result


def describe_error(error):
    # requests includes the full URL in HTTP error text; the webhook URL is a secret.
    if isinstance(error, requests.HTTPError) and error.response is not None:
        return f"HTTPError: status {error.response.status_code}"
    if isinstance(error, requests.RequestException):
        return type(error).__name__
    return f"{type(error).__name__}: {error}"


def main():
    webhook_url = os.environ["GOOGLE_WEBHOOK_URL"]
    webhook_token = os.environ["WEBHOOK_TOKEN"]

    print("🐼 PandaMetrics V4")
    print("Connecting to EA FC27 API...")

    api = FC27API(timezone=TIMEZONE, output="raw", timeout=20)

    def fetch(club_id, match_type):
        return api.get_club_matches(club_id, match_type=match_type, count=10)

    total_matches = 0
    total_players = 0
    failures = []

    for club_id, club_name in CLUBS.items():
        print("\n================================")
        print(f"🐼 Syncing {club_name} ({club_id})")
        print("================================")

        try:
            data = collect_club(fetch, club_id, OFFICIAL_MATCH_TYPES)

            for match_type, count in data["perType"].items():
                print(f"{match_type}: {count} matches")
            print(f"Player appearances: {len(data['players'])}")
            if data["duplicatesDropped"]:
                print(f"Duplicates dropped: {data['duplicatesDropped']}")
            flags = quality_summary(data["players"])
            if flags:
                print(f"Data-quality flags: {flags}")

            result = post_club(webhook_url, webhook_token, club_id, data)
        except Exception as error:  # one club failing must not block the others
            print(f"❌ {club_name}: {describe_error(error)}")
            failures.append(club_name)
            continue

        matches_added = result.get("matchesAdded", 0)
        players_added = result.get("playersAdded", 0)
        print(f"✅ {club_name}: {matches_added} new matches, {players_added} new player records")
        total_matches += matches_added
        total_players += players_added

    print("\n================================")
    print("🐼 SYNC SUMMARY")
    print("================================")
    print(f"Clubs processed: {len(CLUBS) - len(failures)}/{len(CLUBS)}")
    print(f"New matches: {total_matches}")
    print(f"New player records: {total_players}")

    if failures:
        print(f"Failed clubs: {', '.join(failures)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
