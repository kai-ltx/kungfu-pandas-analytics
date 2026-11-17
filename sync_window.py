# Playing hours for the backup GitHub schedule. Europe/London, 17:00–02:59.
# sync-clock/Code.js uses the same window. A workflow_dispatch from that
# clock, or a manual run, always syncs: GitHub's own scheduler is only the spare.

PLAYING_HOURS = tuple(list(range(17, 24)) + [0, 1, 2])


def should_sync(event_name, hour):
    """Scheduled runs are skipped when GitHub delivers them outside playing hours.

    Those late deliveries are the morning dump: the runs were due the evening
    before and the matches are already imported, or no longer in EA's last-10
    window. Manual and clock dispatches are not delayed that way, so they run.
    """
    if event_name != "schedule":
        return True
    return hour in PLAYING_HOURS
