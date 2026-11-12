import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import build_js_fixture  # noqa: E402


def test_js_fixture_matches_current_ingester():
    current = (ROOT / "tests" / "fixtures" / "appearances.json").read_text()
    assert current == build_js_fixture.render(), (
        "tests/fixtures/appearances.json is stale; run python tools/build_js_fixture.py"
    )
