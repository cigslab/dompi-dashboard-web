"""Authenticated account status with disposable fixture; no external DB/providers."""
import os
import unittest
from unittest.mock import patch
import test_dashboard_auth as fixtures
from test_dashboard_auth import signed, api


class AccountEntitlementTests(unittest.TestCase):
    # Reuse fixture setup, not unrelated test methods.
    setUp = fixtures.DashboardAuthTests.setUp
    request = fixtures.DashboardAuthTests.request

    def test_matrix_owner_safe_and_legacy_fields_unchanged(self):
        self.db.execute('ALTER TABLE users ADD COLUMN lifetime_plan TEXT')
        cases = [
            ('free', None, None, 'free', 'free', False, False),
            ('pro', '2099-01-01 00:00:00', None, 'pro', 'pro_legacy', False, False),
            ('pro', '2000-01-01 00:00:00', None, 'free', 'free', False, False),
            ('free', None, 'starter', 'starter', 'starter_lifetime', True, False),
            ('free', None, 'pro', 'pro', 'pro_lifetime', True, False),
            ('pro', '2099-01-01 00:00:00', 'starter', 'pro', 'pro_legacy', True, False),
            ('pro', '2000-01-01 00:00:00', 'starter', 'starter', 'starter_lifetime', True, False),
            ('pro', None, None, None, None, False, True),
            ('pro', 'bad', None, None, None, False, True),
        ]
        month = api.datetime.now().strftime('%Y-%m')
        self.db.execute('INSERT INTO monthly_usage VALUES (?,?,?)', (101, month, 7))
        self.db.execute("UPDATE users SET lifetime_plan='pro' WHERE telegram_id=202")
        for plan, expiry, lifetime, effective, source, is_lifetime, review in cases:
            with self.subTest(plan=plan, expiry=expiry, lifetime=lifetime):
                self.db.execute('UPDATE users SET plan=?,pro_until=?,lifetime_plan=? WHERE telegram_id=101', (plan, expiry, lifetime))
                self.db.commit()
                before = self.db.execute('SELECT * FROM users ORDER BY telegram_id').fetchall()
                with patch.dict(os.environ, {'FREE_MONTHLY_LIMIT': '75'}):
                    response = self.request('GET', '/api/account?user_id=202', signed(), json={'user_id': 202})
                self.assertEqual(response.status_code, 200)
                status = response.json['entitlement']
                self.assertEqual((status['effective_plan'], status['entitlement_source'], status['lifetime'], status['requires_review']), (effective, source, is_lifetime, review))
                self.assertEqual(status['legacy_expires_at'], expiry.replace(' ', 'T') if expiry and expiry != 'bad' else None)
                self.assertEqual(response.json['free_monthly_limit'], 75)
                self.assertEqual(response.json['monthly_usage'], 7)
                self.assertEqual(self.db.execute('SELECT * FROM users ORDER BY telegram_id').fetchall(), before)
                if lifetime and plan == 'free':
                    self.assertEqual(response.json['plan'], 'free')  # UI contract stays unchanged

    def test_pre_migration_and_invalid_auth(self):
        self.db.execute("UPDATE users SET plan='pro',pro_until='2099-01-01' WHERE telegram_id=101")
        self.db.commit()
        response = self.request('GET', '/api/account', signed())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['entitlement']['effective_plan'], 'pro')
        self.assertFalse(response.json['entitlement']['lifetime'])
        self.get_connection.reset_mock()
        for credential in (None, 'invalid'):
            self.assertEqual(self.request('GET', '/api/account', credential).status_code, 401)
        self.get_connection.assert_not_called()

    def test_invalid_lifetime_fails_closed_without_mutation(self):
        self.db.execute('ALTER TABLE users ADD COLUMN lifetime_plan TEXT')
        self.db.execute("UPDATE users SET lifetime_plan='invalid' WHERE telegram_id=101")
        self.db.commit()
        with self.assertLogs(api.app.logger, level='ERROR'):
            self.assertEqual(self.request('GET', '/api/account', signed()).status_code, 500)
        self.assertEqual(self.db.execute('SELECT lifetime_plan FROM users WHERE telegram_id=101').fetchone()[0], 'invalid')
