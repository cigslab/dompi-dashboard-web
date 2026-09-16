#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PYTHON_BIN="${PYTHON_BIN:-python3}"

./scripts/test_fast.sh

echo '== Disposable PostgreSQL regression =='
"$PYTHON_BIN" tests/run_dashboard_postgres.py
echo 'NON-INTERACTIVE TESTS PASSED; run ./scripts/test_browser_manual.sh before checkpoint'
