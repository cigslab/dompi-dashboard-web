#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PYTHON_BIN="${PYTHON_BIN:-python3}"

./scripts/test_fast.sh

echo '== Disposable PostgreSQL regression =='
for runner in dashboard checkout type_review; do
    "$PYTHON_BIN" "tests/run_${runner}_postgres.py"
done
echo 'NON-INTERACTIVE TESTS PASSED; run ./scripts/test_browser_manual.sh before checkpoint'
