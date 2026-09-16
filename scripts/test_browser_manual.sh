#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PYTHON_BIN="${PYTHON_BIN:-python3}"
NODE_BIN="${NODE_BIN:-node}"
command -v "$PYTHON_BIN" >/dev/null || { echo "Python unavailable: $PYTHON_BIN" >&2; exit 1; }
command -v "$NODE_BIN" >/dev/null || { echo "Node unavailable: $NODE_BIN (set NODE_BIN or activate your runtime)" >&2; exit 1; }

echo '== Browser/XSS: interactive browser required =='
# The existing harness serves pages and prints one JSON result per browser run.
# Keep its assertions and fixtures unchanged; collect all documented viewports.
"$PYTHON_BIN" - "$NODE_BIN" <<'PY'
import json
import os
import selectors
import subprocess
import sys
import time

try:
    timeout = int(os.environ.get('BROWSER_TEST_TIMEOUT', '300'))
    if timeout <= 0:
        raise ValueError()
except ValueError:
    raise SystemExit('BROWSER_TEST_TIMEOUT must be a positive integer (seconds)')

expected = {(width, attack) for width in (390, 430, 768, 1440) for attack in (False, True)}
passed = set()
print('Open http://127.0.0.1:8765/0 (XSS) and /0?normal=1 (normal).', flush=True)
print('Reload each URL at widths 390, 430, 768, and 1440; all eight must pass.', flush=True)
print(f'Timeout: {timeout}s. No browser scenarios are skipped.', flush=True)
server = subprocess.Popen(
    [sys.argv[1], 'tests/test_dashboard_xss.cjs'],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
)
selector = selectors.DefaultSelector()
selector.register(server.stdout, selectors.EVENT_READ)
buffer = b''
deadline = time.monotonic() + timeout
try:
    while passed != expected:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SystemExit(f'Browser tests timed out; missing: {sorted(expected - passed)}')
        events = selector.select(min(remaining, 1))
        for key, _ in events:
            chunk = os.read(key.fd, 65536)
            if not chunk:
                raise SystemExit(f'Browser harness exited before completion (code {server.poll()})')
            buffer += chunk
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                text = line.decode('utf-8', errors='replace')
                print(text, flush=True)
                try:
                    result = json.loads(text)
                except ValueError:
                    continue
                if not isinstance(result, dict) or 'pass' not in result:
                    continue
                if result['pass'] is not True:
                    raise SystemExit('Browser/XSS failure; see result above')
                if result.get('index') == 0 and type(result.get('attack')) is bool:
                    scenario = (result.get('width'), result['attack'])
                    if scenario in expected:
                        passed.add(scenario)
    print('Browser/XSS: all 8 scenarios passed.', flush=True)
finally:
    selector.close()
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
    server.stdout.close()
PY

echo 'MANUAL BROWSER TESTS PASSED'
