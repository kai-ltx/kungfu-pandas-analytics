# kungfu-pandas-analytics
FC 27 Pro Clubs performance analytics

## Layout

- `pandametrics/` — EA data ingestion (official matches, position groups, data-quality flags).
- `sync_to_sheets.py` — GitHub Actions importer posting to the Apps Script webhook.
- `apps-script/` — Apps Script project (`clasp`): webhook, dashboard backend, `Stats.js` engine, `Index.html`.
- `docs/` — V4 audit, spec, implementation plan and generated data dictionary.
- `tests/` — pytest (Python) and `node --test` (Apps Script JS) suites with sanitised fixtures.

## Development

```bash
uv venv .venv --python 3.11 && uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/python -m pytest -q
node --test "tests/js/*.test.js"
node tools/build_data_dictionary.js      # after changing apps-script/Stats.js
.venv/bin/python tools/build_js_fixture.py  # after changing pandametrics/ingest.py
```

Raw EA samples (`tools/fetch_samples.py`) go to `samples/`, which is git-ignored because it contains gamertags.
