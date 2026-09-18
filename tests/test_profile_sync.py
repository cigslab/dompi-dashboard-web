import json
import unittest
import test_dashboard_auth as auth
from test_dashboard_auth import signed

class ProfileSyncTests(unittest.TestCase):
    setUp=auth.DashboardAuthTests.setUp
    request=auth.DashboardAuthTests.request

    def test_sync_idempotent_preserves_account_and_ownership(self):
        self.db.execute("UPDATE users SET plan='pro', pro_until='2099-01-01 00:00:00', joined_at='2020-01-01 00:00:00' WHERE telegram_id=101")
        self.db.execute("INSERT INTO monthly_usage VALUES (101,'2026-09',7)")
        self.db.commit()
        before=self.db.execute('SELECT * FROM expenses').fetchall()
        credential=signed(user=json.dumps({'id':101,'first_name':'Nama Telegram Baru'}))
        for _ in range(2):
            response=self.request('GET','/api/profile?user_id=202',credential,json={'first_name':'Untrusted','user_id':202})
            self.assertEqual(response.json['display_name'],'Nama Telegram Baru')
        self.assertEqual(self.db.execute('SELECT telegram_id,first_name,plan,pro_until,joined_at,username FROM users WHERE telegram_id=101').fetchone(),(101,'Nama Telegram Baru','pro','2099-01-01 00:00:00','2020-01-01 00:00:00','user_a'))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM users').fetchone()[0],2)
        self.assertEqual(self.db.execute('SELECT * FROM expenses').fetchall(),before)
        self.assertEqual(self.db.execute('SELECT expense_count FROM monthly_usage').fetchone()[0],7)
        self.assertEqual(self.db.execute('SELECT first_name FROM users WHERE telegram_id=202').fetchone()[0],'Nama B')

    def test_invalid_names_and_auth_never_overwrite(self):
        for name in ['',None,'  ',123,[], 'a'*257, 'bad\nname']:
            self.assertEqual(self.request('GET','/api/profile',signed(user=json.dumps({'id':101,'first_name':name}))).json['display_name'],'Nama A')
        for credential in [None,signed(token='forged'),signed(age=999999)]:
            self.assertEqual(self.request('GET','/api/profile',credential).status_code,401)
        self.assertEqual(self.db.execute('SELECT first_name FROM users WHERE telegram_id=101').fetchone()[0],'Nama A')
        self.request('GET','/api/profile',signed(303))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM users').fetchone()[0],2)

    def test_header_controls_removed_account_kept(self):
        html=auth.api.app.test_client().get('/').get_data(as_text=True)
        for identifier in ['profileButton','profileDropdown','transactionProfileButton','transactionProfileDropdown','logoutButton']:
            self.assertNotIn(identifier,html)
        self.assertEqual(html.count('data-profile-avatar'),2) # Account DOM + safe renderer selector.
        self.assertIn('class="avatar account-avatar"',html)
        self.assertIn('element.textContent = name',html)
