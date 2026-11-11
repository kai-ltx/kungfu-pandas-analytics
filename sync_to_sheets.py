import os
import json
import requests
from datetime import datetime, date
from fc_clubs_api import FC27API

# ==========================================
# KUNGFU PANDAS - FC27 DATA SYNC
# ==========================================

CLUB_ID = 454058

WEBHOOK_URL = os.environ["GOOGLE_WEBHOOK_URL"]
WEBHOOK_TOKEN = os.environ["WEBHOOK_TOKEN"]


def serialize(value):
    """Convert dates and other values to JSON."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if hasattr(value, "item"):
        return value.item()

    raise TypeError(
        f"Cannot serialize {type(value).__name__}"
    )


def to_records(data):
    """Convert supported library outputs into dictionaries."""
    if hasattr(data, "to_dict"):
        return data.to_dict(orient="records")

    if isinstance(data, list):
        return data

    raise TypeError(f"Unexpected data format: {type(data)}")


print("KungFu Pandas FC27 Analytics")
print("Connecting to EA API...")

api = FC27API(timezone="Europe/London")

# Retrieve matches and detailed player statistics
matches = to_records(api.get_club_matches(CLUB_ID))

players = to_records(
    api.get_match_players(
        CLUB_ID,
        include_events=True
    )
)

print(f"Retrieved {len(matches)} matches")
print(f"Retrieved {len(players)} player records")

# Ensure the webhook has the identifiers required
# to prevent duplicate rows.
for record in matches:
    if not record.get("matchId"):
        raise ValueError(
            "Match record missing matchId. "
            f"Available fields: {list(record.keys())}"
        )

for record in players:
    if not record.get("matchId") or not record.get("playerId"):
        raise ValueError(
            "Player record missing matchId or playerId. "
            f"Available fields: {list(record.keys())}"
        )

payload = {
    "token": WEBHOOK_TOKEN,
    "clubId": str(CLUB_ID),
    "matches": matches,
    "players": players
}

print("Sending data to Google Sheets...")

response = requests.post(
    WEBHOOK_URL,
    data=json.dumps(payload, default=serialize),
    headers={"Content-Type": "application/json"},
    timeout=60
)

response.raise_for_status()

result = response.json()

if not result.get("success"):
    raise RuntimeError(
        f"Webhook error: {result.get('error', 'Unknown error')}"
    )

print("Import successful!")
print("Matches added:", result.get("matchesAdded"))
print("Player records added:", result.get("playersAdded"))
