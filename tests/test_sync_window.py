from sync_window import PLAYING_HOURS, should_sync


def test_scheduled_run_outside_playing_hours_is_skipped():
    for hour in range(24):
        expected = hour in PLAYING_HOURS
        assert should_sync("schedule", hour) is expected


def test_manual_and_clock_dispatches_always_run():
    for event in ("workflow_dispatch", "workflow_call"):
        assert should_sync(event, 10) is True
        assert should_sync(event, 22) is True
