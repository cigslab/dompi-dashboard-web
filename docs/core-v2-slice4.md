# Core v2 Slice 4 — dashboard local checkpoint

This existing isolated dashboard worktree adds `/api/core-v2/overview`, `/usage`,
`/credits` and `/orders`. Existing APIs/auth/paid access are unchanged. Identity
comes exclusively from verified Telegram initData. API responses remain no-store.
Shared business rules live in the bot worktree's `packages/dompi-core` source;
no copy is maintained here. The tracked production wheel/requirements are unchanged.

Flags `DOMPI_CORE_V2_DASHBOARD_ENABLED` and
`DOMPI_CORE_V2_TOPUP_ORDERS_ENABLED` default OFF. The panel/script are absent from
server-rendered HTML when the first flag is OFF. When enabled, the panel fetches
only on an explicit user action. Ordinary requests never create orders. Order
POST accepts exactly product_code and idempotency_key; server policy determines
price/credits. `CORE_V2_LYNK_PRODUCTS` must be configured server-side before even
internal order creation; absent mapping fails closed. Checkout is always false.
No merchant setup, checkout or charging was enabled.

The UI renders untrusted history as text nodes, uses the same request key for
retries, provides bounded history pagination and leaves legacy benefits intact.
The shared settlement path, authoritative Lynk evidence requirement, financial
tests and activation blockers are documented in the canonical package's
`SLICE4.md` in the existing `core-v2-slice1` worktree.

Obtained results: backend 76 PASS plus rendered flag-OFF test 1 PASS; Node v2 UI
PASS, existing account UI 10 groups PASS, auth-client 10 checks PASS; syntax/diff
PASS. Shared PostgreSQL acceptance operator-reported 18 PASS in 2.278 seconds,
cleanup complete. Those results do NOT establish browser acceptance.

Browser checkpoint PASS, reported by the operator on 2026-10-27: Chrome via
Terminal Mac, normal and XSS at 390/430/768/1440 px, all eight scenarios passed
and `MANUAL BROWSER TESTS PASSED`. Slice 4 approved for local acceptance.
For future affected revisions, reuse the existing runner, which now tests
the new panel as well as all existing eight scenarios:

```sh
PYTHON_BIN=../test-env/bin/python BROWSER_TEST_TIMEOUT=900 ./scripts/test_browser_manual.sh
```

Open `http://127.0.0.1:8765/0` and
`http://127.0.0.1:8765/0?normal=1` at widths 390, 430, 768 and 1440; reload each
scenario. All APIs/Telegram are synthetic. PASS requires 8/8 and no failed result.
This browser result is separate from the PostgreSQL acceptance result.

Midtrans is not used by the new feature but still has existing checkout callers.
No production orders were inspected and no legacy code was removed. Cleanup is
a separate review. No production access, commit, push or deployment performed.
