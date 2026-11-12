"""Shared PandaMetrics configuration."""

CLUBS = {
    454058: "KungFu Pandas",
    451080: "Bamboo Shoots",
    413965: "Torquay",
}

# Official matches only; friendlies are excluded by product decision.
OFFICIAL_MATCH_TYPES = ("leagueMatch", "playoffMatch")

# clubs[*].matchType codes observed in raw EA responses (Nov 2026 samples):
# every leagueMatch request returned "1", every playoffMatch request "3".
EA_MATCH_TYPE_CODES = {
    "leagueMatch": "1",
    "playoffMatch": "3",
}

TIMEZONE = "Europe/London"
