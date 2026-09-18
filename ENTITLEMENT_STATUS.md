# Read-only entitlement status (phase 3)

`/api/account` adds `entitlement` from the bot's pure contract and read adapter.
Its fields are effective_plan, entitlement_source, legacy_expires_at, lifetime,
and requires_review. Unknown/ambiguous legacy records may have null plan/source.
Lifetime means an explicit underlying grant exists: Starter + active timed Pro
has lifetime=true with source=pro_legacy; expiry returns its effective plan to Starter.

Legacy API fields and frontend behavior are unchanged. Consumers must not use
this addition to introduce access rules until the feature-gating phase is approved.
FREE_MONTHLY_LIMIT, ledger usage, identity/auth and ownership remain unchanged.

A missing lifetime_plan column is detected through SELECT result metadata without
attempting a missing-column query or DDL. Only legacy plan/pro_until are resolved
then; no lifetime grant is assumed. Invalid lifetime data fails the request instead
of silently granting access. No production migration is applied automatically.

plan_contract.py and entitlement_reader.py are byte-identical vendored copies from
the Dompi bot repository (phase 3). The bot files are the source of truth; synchronize
both copies when changing the contract. This avoids runtime sibling-repo dependencies.
No capability resolver or pricing catalog is consumed by the dashboard.

Targeted tests (disposable SQLite, no external services):
`env -u DOMPI_DASHBOARD_TEST_DSN PYTHONPATH=tests:. python -m unittest test_account_entitlement.AccountEntitlementTests`

PostgreSQL reader verification is provided by the bot repository at
`tests/run_entitlement_status_postgres.py`. It verifies baseline/lifetime schemas
inside READ ONLY transactions on a disposable cluster. See the bot
`ENTITLEMENT_MIGRATION.md` for the macOS command. Dashboard contract/reader copies
must remain byte-identical to those tested in the bot repository.
