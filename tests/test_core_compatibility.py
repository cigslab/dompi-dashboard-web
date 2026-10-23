"""Shared-wheel identity and provenance acceptance; no application startup."""
from pathlib import Path
import importlib.util
import unittest
import plan_contract
from dompi_core import entitlements

ROOT = Path(__file__).resolve().parents[1]


class CoreCompatibility(unittest.TestCase):
    def test_legacy_exports_have_same_identity(self):
        for name in ('Entitlement', 'Capabilities', '_legacy', 'resolve_entitlement',
                     'resolve_capabilities', 'CONTRACT_VERSION'):
            self.assertIs(getattr(plan_contract, name), getattr(entitlements, name))

    def test_artifact_matches_manifest_and_canonical_source_when_present(self):
        spec = importlib.util.spec_from_file_location('verify_core', ROOT / 'scripts/verify_dompi_core.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        source = ROOT / 'packages/dompi-core'
        verifier.verify(ROOT, source if source.exists() else None)

    def test_corrupt_wheel_rejected_before_install(self):
        import shutil
        import tempfile
        spec = importlib.util.spec_from_file_location('verify_core', ROOT / 'scripts/verify_dompi_core.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shutil.copytree(ROOT / 'vendor', root / 'vendor')
            shutil.copyfile(ROOT / 'requirements.txt', root / 'requirements.txt')
            wheel = root / 'vendor/dompi_core-0.1.0-py3-none-any.whl'
            wheel.write_bytes(wheel.read_bytes() + b'corrupt')
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                verifier.verify(root)
