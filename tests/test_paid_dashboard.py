"""Paid guard only; real signed auth and disposable database, no provider calls."""
import unittest
from unittest.mock import patch
from test_dashboard_auth import DashboardAuthTests, api, signed, ENDPOINTS

class PaidDashboardTests(unittest.TestCase):
    setUp=DashboardAuthTests.setUp
    request=DashboardAuthTests.request
    def test_unpaid_all_feature_reads_and_writes_denied(self):
        before=list(self.db.iterdump())
        for method,path in ENDPOINTS + [('POST','/api/export/ticket'),('POST','/api/transactions/1/type-review/confirm')]:
            result=self.request(method,path,signed(),json={})
            self.assertEqual(result.status_code,403,(method,path))
            self.assertEqual(result.json['error'],'payment_required')
        self.assertEqual(list(self.db.iterdump()),before)
    def test_missing_and_expired_users_denied(self):
        self.assertEqual(self.request('GET','/api/summary',signed(user_id=999)).status_code,403)
        self.db.execute("UPDATE users SET plan='pro', pro_until='2000-01-01'");self.db.commit()
        self.assertEqual(self.request('GET','/api/summary',signed()).status_code,403)
    def test_starter_pro_and_active_legacy_pass(self):
        self.db.execute('ALTER TABLE users ADD COLUMN lifetime_plan TEXT')
        for plan,expiry,lifetime in [('free',None,'starter'),('free',None,'pro'),('pro','2099-01-01',None)]:
            self.db.execute('UPDATE users SET plan=?,pro_until=?,lifetime_plan=? WHERE telegram_id=101',(plan,expiry,lifetime));self.db.commit()
            self.assertEqual(self.request('GET','/api/summary',signed()).status_code,200)
    def test_auth_still_required_and_owner_not_spoofable(self):
        for credential in (None,'invalid'):
            self.assertEqual(self.request('GET','/api/summary',credential).status_code,401)
        self.get_connection.assert_not_called()
        self.db.execute("UPDATE users SET plan='pro',pro_until='2099-01-01' WHERE telegram_id=202");self.db.commit()
        self.assertEqual(self.request('GET','/api/summary?user_id=202',signed()).status_code,403)
    def test_unpaid_export_ticket_cannot_bypass(self):
        token=api.export_tickets.issue(101,'current_month')
        self.assertEqual(self.client.get('/downloads/export/'+token).status_code,403)
    def test_database_failure_fails_closed(self):
        with patch.object(api,'get_connection',side_effect=RuntimeError('test')):
            self.assertEqual(self.request('GET','/api/summary',signed()).status_code,503)
    def test_public_shell_no_data_and_health_preserved(self):
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertEqual(self.client.get('/health').status_code,200)
        self.assertEqual(self.client.options('/api/summary').status_code,204)
        self.get_connection.assert_not_called()
