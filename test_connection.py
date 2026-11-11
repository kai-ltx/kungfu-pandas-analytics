from fc_clubs_api import FC27API

api = FC27API(timezone="Europe/London")

CLUBS = {
    454058: "KungFu Pandas",
    451080: "Bamboo Shoots",
    413965: "Torquay"
}

for club_id, club_name in CLUBS.items():

    print(f"\n🐼 {club_name}")

    members = api.get_member_stats(
        club_id,
        all_columns=True
    )

    for player in members:
        print({
            "name": player.get("name"),
            "proName": player.get("proName"),
            "proOverall": player.get("proOverall"),
            "proPos": player.get("proPos"),
            "proHeight": player.get("proHeight"),
            "proNationality": player.get("proNationality"),
            "proStyle": player.get("proStyle")
        })
