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
import time

import requests
from fc_clubs_api import FC27API
from fc_clubs_api.exceptions import FC27ConnectionError, FC27HTTPError, FC27ResponseError

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


RETRY_DELAYS = (5, 20)


def is_transient(error):
    """Network blips, EA/Google 5xx and rate limits. Auth and data errors are not retried."""
    if isinstance(error, (FC27ConnectionError, FC27ResponseError, requests.ConnectionError, requests.Timeout)):
        return True
    if isinstance(error, FC27HTTPError):
        return error.status_code >= 500 or error.status_code == 429
    if isinstance(error, requests.HTTPError) and error.response is not None:
        return error.response.status_code >= 500 or error.response.status_code == 429
    # Apps Script answers 200 with success=false when the script lock is busy.
    if isinstance(error, RuntimeError):
        return "lock" in str(error).lower() or "timed out" in str(error).lower()
    return False


def with_retries(action, label, delays=None, sleep=None):
    """Run action(); retry transient failures after each delay. The webhook
    skips rows it already has, so a retried post cannot create duplicates."""
    sleep = sleep or time.sleep
    for delay in (*(RETRY_DELAYS if delays is None else delays), None):
        try:
            return action()
        except Exception as error:
            if delay is None or not is_transient(error):
                raise
            print(f"↻ {label}: {describe_error(error)}; retrying in {delay}s")
            sleep(delay)


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

    # EA returns at most the 10 most recent matches per type, so a missed run
    # on a busy night can lose matches for good. Retries make each run count.
    def fetch(club_id, match_type):
        return with_retries(
            lambda: api.get_club_matches(club_id, match_type=match_type, count=10),
            f"EA {match_type} for {club_id}",
        )

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

            result = with_retries(
                lambda: post_club(webhook_url, webhook_token, club_id, data),
                f"webhook for {club_name}",
            )
        except Exception as error:  # one club failing must not block the others
            print(f"❌ {club_name}: {describe_error(error)}")
            failures.append(club_name)
            continue

        matches_added = result.get("matchesAdded", 0)
        players_added = result.get("playersAdded", 0)
        upgraded = result.get("playersUpgraded", 0)
        print(f"✅ {club_name}: {matches_added} new matches, {players_added} new player records"
              + (f", {upgraded} cut-short event logs completed" if upgraded else ""))
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
