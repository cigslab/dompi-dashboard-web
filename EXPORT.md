# Export Data MVP

`GET /api/export/transactions?period=current_month` uses the existing verified
Telegram API authentication. Export is restricted server-side to Pro capability;
Free, Starter and ambiguous entitlements are denied (403).

Periods: `current_month`, `last_3_months` (current calendar month and two previous
months), and `all`. Calendar boundaries follow the dashboard server's existing
local date convention. The query selects all matching IDR transactions owned by
the authenticated user, independently of transaction-list pagination.

CSV columns, in order: `date,type,description,analytics_category,amount,note`.
The stored transaction description is the existing `expenses.category` field.
Output is UTF-8 CSV, with filename `dompi-export-YYYY-MM-DD.csv`. Categories use
the read-time canonical resolver; internal review markers become `Perlu ditinjau`.
Text that could be interpreted as a spreadsheet formula receives an apostrophe
prefix. Amounts must be exact integer Rupiah; invalid fractional amounts reject
the whole export. An empty export contains only the header.

The MVP builds the complete file in memory before returning it, preventing a
partial file on validation failure. Very large exports may require a future
bounded-memory design. Desktop downloads use an authenticated fetch followed by a local Blob download.
Telegram mobile uses the short-lived HTTPS ticket flow described below.
Actual Telegram iOS/Android device file saving remains a rollout check.

Targeted tests: `tests/test_transaction_export.py`, `tests/test_export_ui.cjs`,
`tests/test_account_ui.cjs`, and `tests/test_dashboard_auth_client.cjs`.

## Frontend finishing verification

Run `node tests/test_dashboard_xss.cjs`, then open
`http://127.0.0.1:8765/0?export=1` (XSS payload) and
`http://127.0.0.1:8765/0?export=1&normal=1` (normal data).
This targeted mode checks Export account states, layout, period controls,
loading/error/retry and inert XSS payloads; it does not replace the full harness.
Verified at widths 320, 390, 430, 768 and 1440 (21 checks per scenario).

The full existing harness currently stops on a pre-existing profile-name assertion
expecting four elements after header avatars were removed (two remain).
That assertion has not been changed as part of Export finishing.

The browser requests a Blob download using a temporary hidden anchor, removes
the anchor immediately, and revokes the object URL after 30 seconds. The picker
and button are disabled during fetching and restored on every completion/error.
No new tab is opened. The UI reports a download request, not confirmed file saving.
The in-app desktop browser reached that state but its download-event wait timed
out; successful device file saving is not yet verified.

## Telegram mobile HTTPS fallback

- Desktop keeps `GET /api/export/transactions` and its existing Blob behavior.
- iOS/Android Telegram calls authenticated `POST /api/export/ticket` with only
  `{"period":"current_month|last_3_months|all"}`. The API checks effective Pro
  capability and returns `path`, `filename`, and `expires_in: 120`.
- `GET /downloads/export/<token>` accepts only the ticket's owner and period,
  rechecks effective Pro capability, and renders CSV on demand. There are no
  stored export files, database writes or schema changes. It reuses the CSV
  projection and response path of the existing endpoint.
- The ticket uses standard Fernet authenticated encryption (`cryptography`),
  with a domain-separated key derived from the existing server-only BOT_TOKEN.
  Telegram IDs inside it are encrypted, not readable base64 claims. No initData,
  payment information or Telegram credentials enter the download URL.
- Tickets expire after 120 seconds, work across workers with the same BOT_TOKEN,
  and are invalidated by changing that secret. Download clients may repeat GET
  until expiry; tickets are not single-use because download retries are normal.
- A ticket is a limited bearer credential: anyone possessing it can download
  that owner's selected-period CSV until expiry, subject to the Pro recheck.
  Do not share or log ticket URLs; redact `/downloads/export/*` in infrastructure
  access logs. Responses use no-store and no-referrer. Query-string user_id or
  period cannot override the encrypted claims.
- Telegram 8.0+ uses `WebApp.downloadFile` with a same-origin HTTPS URL and reports
  accepted/cancelled, never claiming that a file has finished saving. Older
  Telegram uses a temporary same-origin HTTPS attachment anchor, without a new
  tab. HTTP pages are rejected on the mobile path; local testing uses mocks.
- The download endpoint adds Telegram's documented CORS origin
  `https://web.telegram.org`, attachment and nosniff headers. It is the only route
  using ticket authorization; other API endpoints retain Telegram header auth.

Targeted mobile tests: `tests/test_export_ticket.py` and
`node tests/test_export_ui.cjs` (desktop Blob, iOS/Android native, old-client HTTPS,
cancelled/failed requests, and cleanup). No live Telegram/provider calls.
Native file saving still requires real iOS/Android verification, especially on
older clients. The previous desktop in-app browser download-event timeout does
not establish compatibility or failure of Telegram's native download API.
Reference: https://core.telegram.org/bots/webapps#downloadfileparams
