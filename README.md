# kungfu-pandas-analytics
FC 27 Pro Clubs performance analytics

## Layout

- `pandametrics/` — EA data ingestion (official matches, position groups, data-quality flags).
- `sync_to_sheets.py` — GitHub Actions importer posting to the Apps Script webhook.
- `apps-script/` — Apps Script project (`clasp`): webhook (`Code.js`), dashboard backend (`Dashboard.js`), `Stats.js` engine, `Index.html` template and the generated `ClientLib.html`.
- `client/` — browser-only dashboard code (`Insights.js` view models, `App.js` rendering). Never pushed as server files; inlined into `ClientLib.html`.
- `docs/` — V4 audit, spec, implementation plan, Panda Score review, data quality, security notes and generated data dictionary.
- `tests/` — pytest (Python) and `node --test` (Apps Script and client JS) suites with sanitised fixtures.

## Development

```bash
uv venv .venv --python 3.11 && uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/python -m pytest -q
node --test "tests/js/*.test.js"
node tools/build_client.js               # after changing Stats.js or anything in client/
node tools/build_data_dictionary.js      # after changing apps-script/Stats.js
.venv/bin/python tools/build_js_fixture.py  # after changing pandametrics/ingest.py
node tools/score_distribution.js         # anonymised Panda Score distribution from samples/
python tools/backfill.py --snapshot sheet.json --audit backfill-audit.json
```

Local dashboard preview (sanitised fixture data, no Google services):

```bash
node tools/preview.js && python3 -m http.server -b 127.0.0.1 -d preview 8765
```

Raw EA samples (`tools/fetch_samples.py`) go to `samples/`, which is git-ignored because it contains gamertags.
