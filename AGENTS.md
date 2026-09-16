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

Before checkpoint:
- SQLite regression
- auth client tests
- browser/XSS tests
- git diff --check

PostgreSQL verification command:
python3 tests/run_dashboard_postgres.py

## Working style
For substantial changes:
1. Audit/plan first.
2. Implement only the approved scope.
3. Run relevant tests.
4. Review diff.
5. Do not commit until explicitly requested.

If unrelated issues are discovered, list them separately instead of expanding scope.