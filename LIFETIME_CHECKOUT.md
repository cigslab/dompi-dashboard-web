# Phase 6B — authenticated lifetime checkout

No migration is applied by this code. No bot fulfillment or legacy callbacks are
changed. No provider is invoked at import or by tests.

## Entry points

- Public `GET /upgrade` is an inert shell; no identity/prices are embedded in HTML.
  Telegram SDK supplies initData to authenticated API requests. Opening the page
  outside Telegram shows instructions, not unauthenticated purchase buttons.
- `GET /api/checkout/products` uses the existing verified Telegram identity,
  entitlement reader and backend `plan_contract.py` catalog. It returns the
  effective entitlement, explicit underlying lifetime_plan (needed for Starter
  plus active timed Pro), eligible products, catalog prices/version and readiness.
- `POST /api/checkout/orders` accepts exactly `{"product_code":"…"}`. Any extra
  price, duration, version, target or identity field is rejected. Query identities
  never supply authority. Existing HMAC/expiry authentication remains unchanged.
  API responses are no-store; GET never creates an order.

Free and timed Pro without lifetime receive Starter 99000 / Pro 129000.
Starter, including Starter plus timed Pro, receives only upgrade 30000.
Pro lifetime receives no products. Ambiguous entitlement fails closed with a
reconciliation error; no guessed discounted eligibility.

## Persistence and concurrency

`lifetime_checkout.reserve_order(connection, verified_user_id, product_code)`
is the shared server-side creation primitive. There is one authenticated HTTP
entry point. It uses the same transaction advisory allocator lock (-601990129)
and PAYnnn format as bot phase 6A. It then locks the user and rechecks entitlement.
A pending order for that same user/product returns 409/pending_order_exists and
its own order ID; it is not sent to Snap twice. Other users' orders are not reused.

Snapshot product_code, pricing_version, entitlement_kind=lifetime, target_plan,
amount, duration=0 is committed before any network operation. Prices are read
from the existing server catalog; duration is only a compatibility sentinel.
No entitlement, quota, expense or joined-date fields are written.

Creation never takes a payment row lock after user lock; this avoids reversing
fulfillment's payment → user ordering. Bot phase 6A's allocator lock must be in
the deployed bot revision before enabling dashboard checkout.

## Provider and retries

`checkout_midtrans.py` uses the same Midtrans Snap SDK 1.4.2 and existing
MIDTRANS_SERVER_KEY / MIDTRANS_IS_PRODUCTION convention as bot `midtrans.py`.
Server key is never returned. Snap gross_amount comes from the committed
snapshot. No client key is needed for redirect mode. Connect/read timeouts are
5/20 seconds, no automatic retry or HTTP redirect following.

Only HTTPS /snap/ URLs on the configured official Midtrans host are accepted.
The browser also checks an allowlist and shows an explicit payment link.
Payment redirects/query parameters never grant entitlement. Existing bot webhook
and guarded /markpaid remain the only fulfillment paths.

Provider rejection, timeout, invalid response or a lost HTTP response leaves a
pending snapshot. The UI disables further submissions for that attempt and
directs users to @pakedompi with the order ID when available. No false paid state.

**Deliberate limitation:** existing schema has no persisted Snap token/URL or
provider-attempt record. Pending duplicates return a conflict, not a resumable
checkout URL. There is no automatic expiration/cancel/reissue or refund flow.
An operator must reconcile uncertain pending orders before another attempt;
do not simply delete them or invent a new ID while payment may be in flight.
A user may hold pending orders for different products; fulfillment eligibility
still governs them and can require reconciliation after another grant.

## Rollout prerequisites (not performed here)

- Apply separately approved phase 2 migration only through its approved process.
  Missing metadata/lifetime columns fail with 503, never auto-migrate.
- Deploy reviewed bot phase 6A fulfillment and allocator coordination.
- Ensure dashboard dependencies include midtransclient==1.4.2 and its server key /
  environment match the existing bot merchant/webhook. No environment was changed
  in this task. Missing key disables checkout; it does not create pending orders.
- Verify Midtrans notification/finish configuration and Telegram mobile navigation
  in the intended environment. The server must receive signed notifications;
  returning from checkout is not proof of payment.
- Establish manual handling of pending/reconciliation cases before rollout.
- Keep bot/dashboard plan_contract catalogs aligned (currently byte-identical).
  Never change prices within an issued pricing_version.
- Bot /upgrade UI still offers its legacy timed products. Legacy upgrade_30 and
  upgrade_365 identifiers and pending orders remain untouched. New bot lifetime
  UI is deferred; no lifetime product reuses a legacy callback identifier.
- Export and advanced analytics are explicitly “Belum tersedia”.

Snap redirect integration reference:
https://docs.midtrans.com/docs/snap-snap-integration-guide

## Targeted verification

15 unique Python tests passed (API/persistence/routing + mocked SDK/timeout).
10 frontend renderer checks passed. No live provider call. Prior phase 6A
fulfillment tests are reused as evidence, not replayed.

```sh
cd /Users/bulukucing/dompi-dashboard
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests:. "/Users/bulukucing/Belajar python/.venv/bin/python" -m unittest test_lifetime_checkout test_public_pages -v
node tests/test_upgrade_ui.cjs
git diff --check
```

Local macOS PostgreSQL 18 verification passed all 4 tests, as reported by the
user: allocator concurrency, duplicate pending prevention, entitlement recheck
and rollback passed; server shutdown and cluster removal were confirmed. Tests
were not repeated during checkpoint review. Reproduction command:

```sh
cd /Users/bulukucing/dompi-dashboard
PYTHONDONTWRITEBYTECODE=1 "/Users/bulukucing/Belajar python/.venv/bin/python" tests/run_checkout_postgres.py --pg-bin "$(brew --prefix postgresql@18)/bin"
```

Runner never reads production DATABASE_URL/.env and clears libpq environment.
It creates a private socket-only cluster, tests duplicate concurrent requests,
legacy allocator lock contention, entitlement race, unique IDs and rollback.
Expected: `Ran 4 tests`, `OK`, temporary server stopped and cluster removed.
Cleanup runs in finally, including interrupt handling (not SIGKILL/power loss).
No application startup, schema migration or provider call occurs in this runner.
Visual mobile review of the new page remains a rollout prerequisite; it is not
claimed by this code-review checkpoint.
