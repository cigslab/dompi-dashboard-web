"""Only mobile ticket authorization tests; no repeat of CSV regression suite."""
import unittest
from unittest.mock import patch
import test_dashboard_auth as fixtures
from test_dashboard_auth import api, signed
from export_ticket import ExportTickets


class ExportTicketTests(unittest.TestCase):
    request = fixtures.DashboardAuthTests.request

    def setUp(self):
        fixtures.DashboardAuthTests.setUp(self)
        self.db.execute('ALTER TABLE users ADD COLUMN lifetime_plan TEXT')
        self.db.execute("UPDATE users SET plan='free', lifetime_plan='pro'")
        self.db.commit()

    def issue(self, user=101, **extra):
        return self.request('POST', '/api/export/ticket', signed(user_id=user),
                            json={'period':'all', **extra})

    def test_verified_auth_and_payload_only_period(self):
        self.get_connection.reset_mock()
        for auth in (None, 'bad', signed(age=3601)):
            self.assertEqual(self.request('POST','/api/export/ticket',auth,json={'period':'all'}).status_code,401)
        self.get_connection.assert_not_called()
        self.assertEqual(self.issue(user_id=202).status_code,400)
        self.assertEqual(self.issue(period='invalid').status_code,400)
        self.assertEqual(self.client.get('/api/export/ticket').status_code,401)

    def test_ticket_owner_bound_and_period_not_overridden(self):
        issued=self.issue().get_json()
        self.assertEqual(issued['expires_in'],120)
        # A token is opaque authenticated ciphertext, not a readable signed JWT.
        token=issued['path'].split('/')[-1]
        self.assertEqual(ExportTickets(api.BOT_TOKEN).read(token),{'owner':101,'period':'all'})
        result=self.request('GET',issued['path']+'?user_id=202&period=invalid',signed(user_id=202))
        self.assertEqual(result.status_code,200)
        self.assertIn('A expense',result.text)
        self.assertNotIn('B expense',result.text)
        self.assertEqual(result.headers['Cache-Control'],'no-store')
        self.assertEqual(result.headers['Referrer-Policy'],'no-referrer')
        self.assertEqual(result.headers['Access-Control-Allow-Origin'],'https://web.telegram.org')
        own_b=self.client.get(self.issue(user=202).get_json()['path'])
        self.assertIn('B expense',own_b.text)
        self.assertNotIn('A expense',own_b.text)

    def test_missing_tampered_expired_wrong_key_no_database(self):
        path=self.issue().get_json()['path']
        self.get_connection.reset_mock()
        self.assertEqual(self.client.get('/downloads/export/invalid').status_code,401)
        self.assertEqual(self.client.get(path[:-10]+'abcdefghij').status_code,401)
        with patch('time.time',return_value=fixtures.NOW+121):
            self.assertEqual(self.client.get(path).status_code,401)
        with patch.object(api,'export_tickets',ExportTickets('different-key')):
            self.assertEqual(self.client.get(path).status_code,401)
        self.get_connection.assert_not_called()

    def test_pro_rechecked_issue_and_download(self):
        path=self.issue().get_json()['path']
        for plan,life,expiry in [('free',None,None),('free','starter',None),('pro',None,'bad')]:
            self.db.execute('UPDATE users SET plan=?,lifetime_plan=?,pro_until=? WHERE telegram_id=101',(plan,life,expiry))
            self.db.commit()
            self.assertEqual(self.issue().status_code,403)
            self.assertEqual(self.client.get(path).status_code,403)
        self.db.execute("UPDATE users SET plan='pro',lifetime_plan=NULL,pro_until='2099-01-01' WHERE telegram_id=101")
        self.db.commit()
        self.assertEqual(self.issue().status_code,200)

    def test_download_retry_until_expiry_is_read_only(self):
        path=self.issue().get_json()['path']
        before=list(self.db.iterdump())
        for _ in range(2):
            self.assertEqual(self.client.get(path).status_code,200)
        self.assertEqual(list(self.db.iterdump()),before)

if __name__=='__main__':
    unittest.main()
