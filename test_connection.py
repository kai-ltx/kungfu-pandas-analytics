from fc_clubs_api import FC27API

CLUB_ID = 454058

print("🐼 KungFu Pandas FC 27 Analytics")
print("Connecting to EA...")

try:
    api = FC27API(timezone="Europe/London")

    # Club information
    club = api.get_club_details(CLUB_ID)
    print("\n✅ CLUB INFORMATION")
    print(club)

    # Recent matches
    matches = api.get_club_matches(CLUB_ID)

    print("\n✅ RECENT MATCHES")
    print(f"Matches retrieved: {len(matches)}")

    for match in matches[:3]:
        print(match)

    # Player statistics including decoded match events
    players = api.get_match_players(
        CLUB_ID,
        include_events=True
    )

    print("\n✅ PLAYER STATISTICS")
    print(f"Player-match records: {len(players)}")

    if players:
        print("\nAvailable statistics:")
        print(list(players[0].keys()))

        print("\nExample player:")
        print(players[0])

    print("\n🐼 CONNECTION TEST COMPLETE!")

except Exception as error:
    print(f"\n❌ ERROR: {error}")
    raise
