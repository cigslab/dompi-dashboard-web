"""Verify vendored Core without importing application code or contacting services."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(root, source=None):
    manifest = json.loads((root / 'vendor/dompi-core-0.1.0.json').read_text())
    name = 'dompi_core-0.1.0-py3-none-any.whl'
    if manifest['version'] != '0.1.0' or manifest['wheel'] != name:
        raise ValueError('Unexpected Core version/artifact')
    wheel = root / 'vendor' / name
    if sha(wheel.read_bytes()) != manifest['sha256']:
        raise ValueError('Core wheel SHA-256 mismatch')
    if './vendor/' + name not in (root / 'requirements.txt').read_text().splitlines():
        raise ValueError('Requirements do not reference the verified wheel')
    files = manifest['source_files_sha256']
    if sha(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()) != manifest['source_fingerprint_sha256']:
        raise ValueError('Source manifest fingerprint mismatch')
    with zipfile.ZipFile(wheel) as archive:
        expected = {'dompi_core/__init__.py', 'dompi_core/entitlements.py',
                    *('dompi_core-0.1.0.dist-info/' + n for n in ('METADATA', 'WHEEL', 'top_level.txt', 'RECORD'))}
        if set(archive.namelist()) != expected:
            raise ValueError('Unexpected wheel contents')
        for name in ('dompi_core/__init__.py', 'dompi_core/entitlements.py'):
            if sha(archive.read(name)) != files['src/' + name]:
                raise ValueError('Wheel does not match source provenance')
        metadata = archive.read('dompi_core-0.1.0.dist-info/METADATA').decode()
        if 'Requires-Dist:' in metadata or '\nVersion: 0.1.0\n' not in metadata:
            raise ValueError('Unexpected package metadata/dependencies')
    if source:
        actual_names = {'pyproject.toml', 'build-requirements.txt',
                        *(str(p.relative_to(source)) for p in source.glob('src/**/*.py'))}
        if actual_names != set(files):
            raise ValueError('Canonical source inventory mismatch')
        for name, expected in files.items():
            if sha((source / name).read_bytes()) != expected:
                raise ValueError(f'Canonical source changed: {name}')
    return manifest['sha256']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    print(verify(Path(__file__).resolve().parents[1], args.source))
