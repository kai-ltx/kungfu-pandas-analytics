# ==========================================
# PANDAMETRICS V2 - MULTI-CLUB DATA SYNC
# ==========================================

import os
import json
import requests

from datetime import datetime, date
from fc_clubs_api import FC27API


# ==========================================
# CONFIGURATION
# ==========================================

CLUBS = {
    454058: "KungFu Pandas",
    451080: "Bamboo Shoots",
    413965: "Torquay"
}

WEBHOOK_URL = os.environ["GOOGLE_WEBHOOK_URL"]
WEBHOOK_TOKEN = os.environ["WEBHOOK_TOKEN"]


# ==========================================
# HELPERS
# ==========================================

def serialize(value):

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if hasattr(value, "item"):
        return value.item()

    raise TypeError(
        f"Cannot serialize {type(value).__name__}"
    )


def to_records(data):

    if hasattr(data, "to_dict"):
        return data.to_dict(orient="records")

    if isinstance(data, list):
        return data

    raise TypeError(
        f"Unexpected data format: {type(data)}"
    )


# ==========================================
# CONNECT TO EA
# ==========================================

print("🐼 PandaMetrics V2")
print("Connecting to EA FC27 API...")

api = FC27API(timezone="Europe/London")

total_matches = 0
total_players = 0


# ==========================================
# SYNC ALL THREE CLUBS
# ==========================================

for club_id, club_name in CLUBS.items():

    print("\n================================")
    print(f"🐼 Syncing {club_name}")
    print(f"Club ID: {club_id}")
    print("================================")

    # Retrieve recent matches.
    matches = to_records(
        api.get_club_matches(club_id)
    )

    # Retrieve detailed player statistics.
    players = to_records(
        api.get_match_players(
            club_id,
            include_events=True
        )
    )

    print(f"Matches retrieved: {len(matches)}")
    print(f"Player records retrieved: {len(players)}")

    # Validate identifiers.
    for record in matches:

        if not record.get("matchId"):
            raise ValueError(
                f"{club_name}: Missing matchId. "
                f"Fields: {list(record.keys())}"
            )

    for record in players:

        if (
            not record.get("matchId")
            or not record.get("playerId")
        ):
            raise ValueError(
                f"{club_name}: Missing player identifiers. "
                f"Fields: {list(record.keys())}"
            )

    # Prepare webhook payload.
    payload = {
        "token": WEBHOOK_TOKEN,
        "clubId": str(club_id),
        "matches": matches,
        "players": players
    }

    # Send to Google Sheets.
    print("Sending data to Google Sheets...")

    response = requests.post(
        WEBHOOK_URL,
        data=json.dumps(
            payload,
            default=serialize
        ),
        headers={
            "Content-Type": "application/json"
        },
        timeout=60
    )

    response.raise_for_status()

    result = response.json()

    if not result.get("success"):
        raise RuntimeError(
            f"{club_name}: "
            f"{result.get('error', 'Unknown error')}"
        )

    matches_added = result.get("matchesAdded", 0)
    players_added = result.get("playersAdded", 0)

    print(f"✅ {club_name} imported!")
    print(f"New matches: {matches_added}")
    print(f"New player records: {players_added}")

    total_matches += matches_added
    total_players += players_added


# ==========================================
# SUMMARY
# ==========================================

print("\n================================")
print("🐼 ALL CLUBS SYNCED")
print("================================")

print(f"Clubs processed: {len(CLUBS)}")
print(f"New matches: {total_matches}")
print(f"New player records: {total_players}")

print("PandaMetrics database updated!")
