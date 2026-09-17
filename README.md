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

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
node tests/test_dashboard_auth_client.cjs
node tests/test_dashboard_xss.cjs
```

For browser tests, open `http://127.0.0.1:8765/0` (XSS) and
`http://127.0.0.1:8765/0?normal=1` (normal fixtures). Each reports pass/fail.
Test both URLs at 390, 430, 768, and 1440px widths. Assertions cover overflow,
transaction cell overlap, mobile action sizes, search, edit/delete, auth headers,
and XSS. Telegram, API responses, and Chart.js are mocked; real Telegram/Chart.js
integration remains a separate smoke test.

On macOS with Homebrew PostgreSQL 18 already installed:

```bash
python tests/run_dashboard_postgres.py
```

This creates synthetic tables in a new temporary `/tmp/dompi-dashboard-test-*`
cluster on a private Unix socket, disables TCP, runs the API tests with real
PostgreSQL connections, then stops the server in `finally`. It does not load
production credentials or use `DATABASE_URL`. Leave `DOMPI_DASHBOARD_TEST_DSN`
unset outside that runner. The test guard rejects non-test connection targets.

Do not change Railway source or remove the API from the bot repository until
this standalone service has passed the separate production verification phase.
