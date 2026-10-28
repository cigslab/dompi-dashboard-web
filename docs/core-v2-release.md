# Core v2 release preparation
Canonical operator runbook: bot repository packages/dompi-core/SLICE6A.md.
Wheel: vendor/dompi_core-0.2.0-py3-none-any.whl
SHA-256: e5e2068b616d3fc182303f387211da8106e4c58f189e69a352b5b51002e53e15
Provenance: vendor/dompi-core-0.2.0.json (working-tree snapshot, not committed HEAD).
Three local compatibility tests PASS; immutable artifact matches bot byte-for-byte.
Existing v1 wheel retained. Railpack vendor directory input unchanged.
All feature flags remain OFF. No API/business logic/UI changes in Slice 6A.
Ubuntu container acceptance: prepared, NOT RUN for v2. Workflow only runs on
review/dompi-core-v2-acceptance and checks out event github.sha. Commit/push
requires separate approval. No cross-repository credential, deploy or publish.
Shared additive schema is applied once by an approved operator, never app startup.
After ledger/linking activity retain schema and a wallet-merge-aware compatible
binary; do not restore old financial data or use pre-linking code for refunds.
Lynk authoritative order verification and combined migration recovery rehearsal
remain gates; checkout/charging stay OFF. Midtrans legacy remains untouched.
