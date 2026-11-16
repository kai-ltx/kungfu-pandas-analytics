import json
import pathlib

import pytest
import requests

import sync_to_sheets

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeAPI:
    def __init__(self, *args, **kwargs):
        pass

    def get_club_matches(self, club_id, match_type, count):
        return json.loads((FIXTURES / f"matches_{club_id}_{match_type}.json").read_text())


class FakeResponse:
    def __init__(self, body, status=200):
        self._body = body
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(
                "500 Server Error for url: https://script.google.com/macros/s/SECRET/exec",
                response=self,
            )

    def json(self):
        return self._body


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("GOOGLE_WEBHOOK_URL", "https://script.google.com/macros/s/SECRET/exec")
    monkeypatch.setenv("WEBHOOK_TOKEN", "test-token")
    monkeypatch.setattr(sync_to_sheets, "FC27API", FakeAPI)
    monkeypatch.setattr(sync_to_sheets, "RETRY_DELAYS", (0, 0))


def test_payload_shape_matches_deployed_webhook(env, monkeypatch):
    posted = []

    def fake_post(url, data, headers, timeout):
        posted.append(json.loads(data))
        return FakeResponse({"success": True, "matchesAdded": 1, "playersAdded": 2})

    monkeypatch.setattr(sync_to_sheets.requests, "post", fake_post)
    sync_to_sheets.main()

    assert len(posted) == 3
    for body in posted:
        assert set(body) == {"token", "clubId", "matches", "players"}
        assert body["token"] == "test-token"
    bamboo = next(b for b in posted if b["clubId"] == "451080")
    assert sum(m["matchType"] == "playoffMatch" for m in bamboo["matches"]) == 3


def test_one_club_failure_does_not_block_others(env, monkeypatch, capsys):
    calls = []

    def fake_post(url, data, headers, timeout):
        club = json.loads(data)["clubId"]
        calls.append(club)
        if club == "454058":
            return FakeResponse({}, status=500)
        return FakeResponse({"success": True, "matchesAdded": 0, "playersAdded": 0})

    monkeypatch.setattr(sync_to_sheets.requests, "post", fake_post)
    with pytest.raises(SystemExit) as exc:
        sync_to_sheets.main()

    assert exc.value.code == 1
    # A 500 is retried twice before the club is given up on.
    assert calls == ["454058", "454058", "454058", "451080", "413965"]
    out = capsys.readouterr().out
    assert "SECRET" not in out
    assert "status 500" in out


def test_transient_ea_failure_is_retried_and_recovers(env, monkeypatch, capsys):
    from fc_clubs_api.exceptions import FC27ConnectionError

    attempts = {"n": 0}

    class FlakyAPI(FakeAPI):
        def get_club_matches(self, club_id, match_type, count):
            if club_id == 454058 and match_type == "leagueMatch" and attempts["n"] < 1:
                attempts["n"] += 1
                raise FC27ConnectionError("timed out")
            return super().get_club_matches(club_id, match_type, count)

    monkeypatch.setattr(sync_to_sheets, "FC27API", FlakyAPI)
    monkeypatch.setattr(
        sync_to_sheets.requests, "post",
        lambda *a, **k: FakeResponse({"success": True, "matchesAdded": 0, "playersAdded": 0}),
    )
    sync_to_sheets.main()
    assert attempts["n"] == 1
    assert "retrying" in capsys.readouterr().out


def test_permanent_failures_are_not_retried(env, monkeypatch):
    from fc_clubs_api.exceptions import FC27HTTPError

    calls = []

    def blocked():
        calls.append(1)
        raise FC27HTTPError(403, "https://proclubs.ea.com/api/fc/clubs/matches")

    with pytest.raises(FC27HTTPError):
        sync_to_sheets.with_retries(blocked, "EA", delays=(0, 0))
    assert len(calls) == 1
    assert not sync_to_sheets.is_transient(RuntimeError("Unauthorized"))
    assert sync_to_sheets.is_transient(RuntimeError("Lock timeout: another process was holding the lock"))


def test_webhook_rejection_reported(env, monkeypatch, capsys):
    monkeypatch.setattr(
        sync_to_sheets.requests, "post",
        lambda *a, **k: FakeResponse({"success": False, "error": "Unauthorized"}),
    )
    with pytest.raises(SystemExit):
        sync_to_sheets.main()
    assert "Unauthorized" in capsys.readouterr().out
