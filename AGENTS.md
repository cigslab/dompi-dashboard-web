# Dompi Dashboard

## Project
Dompi adalah Telegram expense-tracking app.
Dashboard berfungsi sebagai Telegram Mini App untuk melihat dan mengelola data.

## Stack
- Flask
- PostgreSQL production
- SQLite test
- Vanilla JavaScript
- HTML/CSS
- Telegram Mini App

## Main navigation
- Beranda
- Transaksi
- Analitik
- Akun

## Important files
- app.py
- templates/dashboard.html
- static/navigation.js
- static/analytics.js
- static/style.css
- tests/test_dashboard_auth.py
- tests/test_dashboard_auth_client.cjs
- tests/test_dashboard_xss.cjs
- tests/run_dashboard_postgres.py

## Important rules
- Dompi is IDR-only.
- Monetary API values that are integer-like must be returned as JSON integers.
- Do not silently truncate or round invalid fractional Rupiah values.
- Do not weaken Telegram auth, ownership, or XSS protections.
- Do not change database schema unless explicitly requested.
- Do not change transaction behavior unless explicitly requested.
- Do not commit, push, or deploy unless explicitly requested.
- Do not fix unrelated technical debt automatically. Report it instead.

## Architecture rules
- Kategori and Laporan are not primary navigation pages.
- Category/report logic may still be used internally by Analitik and Beranda.
- Analytics must use aggregate endpoints, not the 10-row transaction list.
- Backend endpoints should remain stable unless explicitly requested.

## Testing
For frontend/refactor tasks, run relevant tests first.

Development (non-interactive): `./scripts/test_fast.sh`
Full automated regression (non-interactive): `./scripts/test_all.sh`
Browser/security checkpoint gate: `./scripts/test_browser_manual.sh`

`test_fast.sh` runs SQLite/backend regression, auth client, and
`git diff --check`. `test_all.sh` runs those checks followed by the existing
disposable PostgreSQL runner (Homebrew PostgreSQL 18 on macOS). Neither command
starts a browser server or waits for manual viewport verification.

A full checkpoint requires BOTH `test_all.sh` and `test_browser_manual.sh`
to pass on the same application revision. A successful test_all alone does
not establish browser/XSS coverage. Do not skip the browser gate for frontend
or security changes.

Run from the repository root. Install requirements.txt dependencies and Node.js
first. Override runtimes when needed with `PYTHON_BIN` and `NODE_BIN`.

`test_browser_manual.sh` preserves the existing browser harness and all eight
scenarios: open http://127.0.0.1:8765/0 (XSS) and
http://127.0.0.1:8765/0?normal=1 (normal) at widths 390, 430, 768, and 1440,
reloading each URL at each viewport. It fails on any failed result or timeout,
requires all eight passing results, and stops its fixture server on exit.
Default timeout: 300 seconds; override with `BROWSER_TEST_TIMEOUT`.
Port 8765 must be available. Telegram/API/Chart.js remain mocked; this is not
a live Telegram integration test.

Headless launch could not be validated in the current sandbox (installed
Chrome aborted at launch). Browser automation is therefore not a claimed
capability of these helpers; no unverified headless dependency is required.

SQLite checks explicitly unset DOMPI_DASHBOARD_TEST_DSN. PostgreSQL uses only
the existing disposable-cluster runner; do not point tests at production.
Manual PostgreSQL verification: `python3 tests/run_dashboard_postgres.py`

## Working style
For substantial changes:
1. Audit/plan first.
2. Implement only the approved scope.
3. Run relevant tests.
4. Review diff.
5. Do not commit until explicitly requested.

If unrelated issues are discovered, list them separately instead of expanding scope.