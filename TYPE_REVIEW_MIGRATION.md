# Transaction-type review v1

Schema change (explicit migration only):

```sql
ALTER TABLE expenses ADD COLUMN type_review_confirmed_fingerprint TEXT;
```

The column is nullable, without default or backfill. The migration is transactional
and idempotent for SQLite/PostgreSQL. No migration runs at application import/startup.
Apply and verify the migration **before deploying** the new dashboard: its review
reader/PATCH now require this column. Production migration is not performed by tests.
Use a dedicated connection with autocommit disabled when calling
`type_review_migration.migrate(conn)`. An explicit CLI is available via `--sqlite`
or `--pg-service`; it does not read `DATABASE_URL`. Existing rows remain unchanged.
Rollback of application code can leave the additive column in place; do not drop
confirmation data automatically.

## Contract

- Rule version `1`, deterministic, no provider. Case-insensitive word/phrase rules
  examine display description (`expenses.category`) and note, with explicit type.
- Strong income cues: gaji, salary, bonus, komisi, pemasukan. Strong expense cues:
  bayar listrik/kos/sewa, beli bensin/obat, belanja groceries, pengeluaran.
- Mixed or negated/refund/reimbursement contexts abstain. These conservative rules
  are suspicion hints, not a replacement classifier, and cannot cover all language.
- SHA-256 fingerprint over JSON `[rule_version, type, description, note]` generated
  on the server. NULL/empty description/note normalize to empty string. Amount/date
  are excluded. Actual semantic changes clear confirmation; identical values don't.
- Technical/legacy `analytics_category` markers are never cleared by confirmation.
  Ordinary semantic edits no longer create these markers. Cross-type category labels
  become `Lainnya` on type edit; a technical/legacy marker remains untouched.

## Endpoints

- `GET /api/transactions/type-review`: authenticated owner, optional `month` or
  `start` + `end`, `page` (25 rows). Returns `items`, `count`, `page`, `has_more`.
  Each item includes an opaque fingerprint to detect stale confirmation attempts.
- `POST /api/transactions/<transaction_id>/type-review/confirm` with only
  `{"fingerprint":"<value returned by the reader>"}`. Verified Telegram identity
  determines owner. Server recomputes fingerprint; stale state returns 409.
  Conditional UPDATE rechecks semantic fields after any concurrent row lock wait.
  Duplicate confirmation is idempotent; technical marker is not mutated.
- Existing `/api/categories/review` remains the separate technical/legacy path.

The reader evaluates all owner transactions in the selected period before paging;
there is no 10-row list dependency. This linear scan is an MVP limitation for very
large histories. No historical rewrite or new classifier wiring is included.

## Targeted verification

```sh
cd /Users/bulukucing/dompi-dashboard
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests:. \
  '/Users/bulukucing/Belajar python/.venv/bin/python' \
  -m unittest test_type_review test_category_edit test_category_review -v
node tests/test_type_review_ui.cjs
node tests/test_category_drilldown.cjs
node tests/test_analytics_insights.cjs
```

Focused browser fixture: `node tests/test_dashboard_xss.cjs`, then
`http://127.0.0.1:8765/0?type-review=1` (all APIs mocked).

PostgreSQL 18 on macOS, **disposable only**:

```sh
cd /Users/bulukucing/dompi-dashboard
PYTHONDONTWRITEBYTECODE=1 \
  '/Users/bulukucing/Belajar python/.venv/bin/python' \
  tests/run_type_review_postgres.py \
  --pg-bin "$(brew --prefix postgresql@18)/bin"
```

Runner strips production/libpq environment settings, uses a temporary Unix socket
(no TCP listener), and always stops/removes its cluster in `finally`. Expected:
4 tests OK, PostgreSQL blocking verified, temporary server stopped/cluster removed.
Tests cover migration twice without rewrite, persistence/owner isolation, technical
marker separation, stale concurrent edit rejection, and duplicate confirmation.
