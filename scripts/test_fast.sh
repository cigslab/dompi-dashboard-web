#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PYTHON_BIN="${PYTHON_BIN:-python3}"
NODE_BIN="${NODE_BIN:-node}"
command -v "$PYTHON_BIN" >/dev/null || { echo "Python unavailable: $PYTHON_BIN" >&2; exit 1; }
command -v "$NODE_BIN" >/dev/null || { echo "Node unavailable: $NODE_BIN (set NODE_BIN or activate your runtime)" >&2; exit 1; }

echo '== SQLite/backend regression =='
env -u DOMPI_DASHBOARD_TEST_DSN "$PYTHON_BIN" -m unittest discover -s tests -p 'test_*.py' -v

echo '== Auth client =='
"$NODE_BIN" tests/test_dashboard_auth_client.cjs

echo '== Whitespace check =='
git diff --check
echo 'FAST TESTS PASSED (browser/XSS is a separate required checkpoint gate)'
