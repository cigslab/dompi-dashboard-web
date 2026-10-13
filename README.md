# Dompi Dashboard

Standalone Flask dashboard and API. Requires Python and the packages in `requirements.txt`.
No checkout, import, or runtime process from the bot repository is required.

## Runtime

- `DATABASE_URL`: shared Railway PostgreSQL connection URL.
- `BOT_TOKEN`: same Telegram bot token; backend verification only.
- `INIT_DATA_MAX_AGE_SECONDS`: defaults to `3600`.
- `DASHBOARD_ALLOWED_ORIGINS`: comma-separated allowed frontend origins; no URL paths.
- `PORT`: Railway HTTP port; defaults to `5000` locally.
- `FREE_MONTHLY_LIMIT`: optional dashboard display limit. Set it to the same limit
  used by the bot. Accepts trimmed ASCII decimal digits representing a positive
  integer up to `9007199254740991` (at most 16 digits). Missing, blank, zero,
  negative, fractional, or invalid values yield JSON `null`, with no default.
  This setting does not change bot quota enforcement or write to the database.

Start command: `python app.py` (Waitress, `0.0.0.0:$PORT`).
Health check: `/health` (process health only; does not query the database).
`/` serves the Telegram Mini App. API URLs are same-origin `/api/...`.
The app reads environment variables directly; it does not automatically load `.env`.

## Tests

| Gate | Command | Coverage |
| --- | --- | --- |
| Fast | `./scripts/test_fast.sh` | All `test_*.py` backend tests; auth client, Wave 1/2, account, insights, drilldown, access, export, month, theme, type review, upgrade, and cashflow-target standalone Node suites; whitespace check. |
| Full local | `./scripts/test_all.sh` | Fast gate, then all three disposable PostgreSQL runners; fails on any failure. Browser is separate. |
| PostgreSQL | `python tests/run_dashboard_postgres.py`, `python tests/run_checkout_postgres.py`, `python tests/run_type_review_postgres.py` | Real API connections, checkout locks/rollback, and type-review migration/CAS races. Requires Homebrew PostgreSQL 18. |
| Browser | `./scripts/test_browser_manual.sh` | Normal and XSS fixtures at 390, 430, 768, 1440 px; all eight must pass. |

Override `PYTHON_BIN` and `NODE_BIN` if necessary. A complete checkpoint requires
both full local and browser gates. A PostgreSQL startup failure is a blocked gate,
not a pass. Runners create disposable clusters on private Unix sockets; never
point tests at production or set `DOMPI_DASHBOARD_TEST_DSN` outside its runner.

`test_analytics_ui.cjs`, `test_wave1_browser.cjs`, and `test_wave2_browser.cjs`
are browser helpers loaded by `test_dashboard_xss.cjs`, not standalone Node tests.
The browser harness checks overflow, cell overlap, touch targets, mutations,
auth headers and XSS. Telegram/API responses remain mocked.

Chart.js is pinned to 4.5.1, the exact bundle returned by the previous unversioned
CDN URL when inspected for Wave 3; byte comparison confirmed no library upgrade.
Earlier browser tests mocked Chart.js and did not establish a real-library version.
To run the browser gate with the actual pinned bundle instead of its default mock:

```bash
chart_bundle=$(mktemp)
curl -fsSL https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js -o "$chart_bundle"
CHART_JS_BUNDLE="$chart_bundle" ./scripts/test_browser_manual.sh
rm -f "$chart_bundle"
```

The harness serves that bundle locally and checks its version and a rendered
nonzero-size donut, in addition to the normal regression assertions. Open the
printed URLs at the four required widths. No production requests are made.

Do not change Railway source or remove the API from the bot repository until
this standalone service has passed the separate production verification phase.
