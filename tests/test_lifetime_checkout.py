"""Authenticated lifetime checkout with actual snapshot SQL; provider always mocked."""
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import test_dashboard_auth as fixtures
from test_dashboard_auth import api, signed
import checkout_midtrans
from lifetime_checkout import ORDER_ALLOCATOR_LOCK


class CheckoutCursor(fixtures.MemoryCursor):
    def execute(self, query, params=()):
        # SQLite fixture only: PostgreSQL locking verified by separate runner.
        if 'pg_advisory_xact_lock' in query:
            assert params == (ORDER_ALLOCATOR_LOCK,)
            return self.cursor.execute('SELECT 1')
        return super().execute(query.replace(' FOR UPDATE', ''), params)


class CheckoutConnection(fixtures.MemoryConnection):
    def cursor(self):
        return CheckoutCursor(self.db)


class LifetimeCheckoutTests(unittest.TestCase):
    setUpFixture = fixtures.DashboardAuthTests.setUp
    request = fixtures.DashboardAuthTests.request

    def setUp(self):
        self.setUpFixture()
        policy_env = patch.dict(os.environ, {
            'LIFETIME_CHECKOUT_ENABLED': 'true', 'LIFETIME_CHECKOUT_CANARY_IDS': ''})
        policy_env.start(); self.addCleanup(policy_env.stop)
        self.get_connection.return_value = CheckoutConnection(self.db)
        self.db.execute('ALTER TABLE users ADD COLUMN lifetime_plan TEXT')
        self.db.execute('ALTER TABLE users ADD COLUMN customer_id TEXT')
        self.db.execute("UPDATE users SET plan='free',customer_id='C1'")
        self.db.execute("""CREATE TABLE payments(id INTEGER PRIMARY KEY AUTOINCREMENT,
            payment_id TEXT UNIQUE,telegram_id BIGINT,customer_id TEXT,duration INTEGER,
            amount INTEGER,status TEXT,created_at TEXT,paid_at TEXT,product_code TEXT,
            pricing_version TEXT,entitlement_kind TEXT,target_plan TEXT)""")
        self.db.commit()
        self.ready = patch.object(api.checkout_midtrans, 'ready', return_value=True)
        self.ready.start(); self.addCleanup(self.ready.stop)
        self.provider = patch.object(api.checkout_midtrans, 'create_snap_transaction',
            return_value=(True, {'redirect_url': 'https://app.sandbox.midtrans.com/snap/v2/vtweb/test'}))
        self.snap = self.provider.start(); self.addCleanup(self.provider.stop)

    def state(self, lifetime=None, plan='free', expiry=None):
        self.db.execute('UPDATE users SET lifetime_plan=?,plan=?,pro_until=? WHERE telegram_id=101',
                        (lifetime, plan, expiry))
        self.db.commit()

    def post(self, code, **extra):
        return self.request('POST', '/api/checkout/orders', signed(), json={'product_code': code, **extra})

    def test_offer_matrix_uses_underlying_lifetime_and_catalog(self):
        for lifetime, plan, expiry, codes in [
            (None, 'free', None, ['starter_lifetime', 'pro_lifetime']),
            ('starter', 'free', None, ['starter_to_pro_lifetime']),
            ('pro', 'free', None, []),
            (None, 'pro', '2099-01-01', ['starter_lifetime', 'pro_lifetime']),
            ('starter', 'pro', '2099-01-01', ['starter_to_pro_lifetime']),
            ('starter', 'pro', '2000-01-01', ['starter_to_pro_lifetime']),
        ]:
            with self.subTest(lifetime=lifetime, plan=plan, expiry=expiry):
                self.state(lifetime, plan, expiry)
                result=self.request('GET', '/api/checkout/products?user_id=202', signed())
                self.assertEqual(result.status_code, 200)
                self.assertEqual([p['product_code'] for p in result.json['products']], codes)
                prices={'starter_lifetime':99000,'pro_lifetime':129000,'starter_to_pro_lifetime':30000}
                for item in result.json['products']:
                    self.assertEqual(item['amount'], prices[item['product_code']])
                    self.assertEqual(item['pricing_version'], '1')
                self.assertEqual(result.json['lifetime_plan'], lifetime)
        self.snap.assert_not_called()

    def test_eligibility_rechecked_and_invalid_product(self):
        for life, plan, expiry, code in [
            (None,'free',None,'starter_to_pro_lifetime'),
            (None,'pro','2099-01-01','starter_to_pro_lifetime'),
            ('starter','free',None,'starter_lifetime'),
            ('starter','free',None,'pro_lifetime'),
            ('pro','free',None,'starter_lifetime'),
            ('pro','free',None,'pro_lifetime'),
            ('pro','free',None,'starter_to_pro_lifetime'),
            (None,'pro',None,'pro_lifetime')]:
            self.state(life,plan,expiry)
            self.assertEqual(self.post(code).status_code,409)
        self.state()
        for code in ('upgrade_30','upgrade_365','bad',None,[],{}):
            self.assertEqual(self.post(code).status_code,400)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM payments').fetchone()[0],0)
        self.snap.assert_not_called()

    def test_auth_price_and_identity_tampering_rejected(self):
        for field in ('amount','telegram_id','user_id','target_plan','duration','pricing_version'):
            self.assertEqual(self.post('pro_lifetime', **{field:202}).status_code,400)
        self.get_connection.reset_mock()
        for credential in (None,'invalid',signed(age=3601),signed(token='fake')):
            self.assertEqual(self.request('POST','/api/checkout/orders',credential,
                json={'product_code':'pro_lifetime'}).status_code,401)
        self.get_connection.assert_not_called()
        self.snap.assert_not_called()
        self.assertEqual(self.client.get('/api/checkout/orders').status_code,401)
        self.assertEqual(self.request('GET','/api/checkout/orders',signed()).status_code,405)

    def test_snapshot_committed_before_provider_and_owner_from_auth(self):
        def provider(payment, amount, customer):
            self.assertFalse(self.db.in_transaction)
            row=self.db.execute('SELECT telegram_id,product_code,pricing_version,entitlement_kind,target_plan,amount,duration,status FROM payments WHERE payment_id=?',(payment,)).fetchone()
            self.assertEqual(row,(101,'starter_lifetime','1','lifetime','starter',99000,0,'pending'))
            self.assertEqual((amount,customer),(99000,'C1'))
            return True, {'redirect_url':'https://app.sandbox.midtrans.com/snap/v2/vtweb/test'}
        self.snap.side_effect=provider
        response=self.request('POST','/api/checkout/orders?user_id=202',signed(),
            json={'product_code':'starter_lifetime'})
        self.assertEqual(response.status_code,201)
        self.assertEqual(response.json['amount'],99000)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(self.db.execute('SELECT lifetime_plan FROM users WHERE telegram_id=101').fetchone(),(None,))

    def test_successful_product_matrix_and_legacy_order_unchanged(self):
        self.db.execute("""INSERT INTO payments(payment_id,telegram_id,amount,duration,status)
            VALUES('PAY001',202,79000,365,'pending')"""); self.db.commit()
        for life,code,price in [(None,'starter_lifetime',99000),(None,'pro_lifetime',129000),
                                ('starter','starter_to_pro_lifetime',30000)]:
            self.state(life)
            response=self.post(code)
            self.assertEqual(response.status_code,201)
            self.assertEqual(response.json['amount'],price)
        self.assertEqual(self.db.execute('SELECT COUNT(DISTINCT payment_id) FROM payments').fetchone()[0],4)
        self.assertEqual(self.db.execute("SELECT amount,duration,product_code,status FROM payments WHERE payment_id='PAY001'").fetchone(),(79000,365,None,'pending'))

    def test_duplicate_pending_and_provider_failure_preserve_snapshot(self):
        self.snap.return_value=(False,None)
        response=self.post('pro_lifetime')
        self.assertEqual(response.status_code,502)
        self.assertEqual(response.json['error'],'checkout_needs_reconciliation')
        second=self.post('pro_lifetime')
        self.assertEqual(second.status_code,409)
        self.assertEqual(second.json['payment_id'],response.json['payment_id'])
        self.snap.assert_called_once()
        self.assertEqual(self.db.execute('SELECT status,paid_at,amount FROM payments').fetchall(),[('pending',None,129000)])
        self.assertEqual(self.db.execute('SELECT lifetime_plan FROM users WHERE telegram_id=101').fetchone(),(None,))
        # Another owner's pending order is neither reused nor disclosed.
        other=self.request('POST','/api/checkout/orders',signed(user_id=202),json={'product_code':'pro_lifetime'})
        self.assertEqual(other.status_code,502)
        self.assertNotEqual(other.json['payment_id'],response.json['payment_id'])

    def test_schema_or_provider_unavailable_no_auto_migration(self):
        with patch.object(api.checkout_midtrans,'ready',return_value=False):
            self.assertEqual(self.post('pro_lifetime').status_code,503)
        self.db.execute('ALTER TABLE users DROP COLUMN lifetime_plan')
        self.db.commit()
        for method,path in [('GET','/api/checkout/products'),('POST','/api/checkout/orders')]:
            response=self.request(method,path,signed(),json={'product_code':'pro_lifetime'})
            self.assertEqual(response.status_code,503)
        self.snap.assert_not_called()
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM payments').fetchone()[0],0)

    def test_insert_failure_rolls_back_without_provider(self):
        self.db.execute("CREATE TRIGGER reject_order BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test'); END")
        self.db.commit()
        self.assertEqual(self.post('pro_lifetime').status_code,503)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM payments').fetchone()[0],0)
        self.snap.assert_not_called()

    def test_authenticated_post_preflight(self):
        response=self.client.options('/api/checkout/orders',headers={
            'Origin': fixtures.ORIGIN, 'Access-Control-Request-Method':'POST',
            'Access-Control-Request-Headers':'Authorization, Content-Type'})
        self.assertEqual(response.status_code,204)
        self.assertIn('POST',response.headers['Access-Control-Allow-Methods'])


class SnapAdapterTests(unittest.TestCase):
    def test_transport_timeout_without_retry_or_redirect(self):
        with patch('requests.request', side_effect=TimeoutError) as request:
            with self.assertRaises(TimeoutError):
                checkout_midtrans.BoundedTransport.request('post', 'https://test.invalid', allow_redirects=True)
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.kwargs['timeout'], (5, 20))
            self.assertFalse(request.call_args.kwargs['allow_redirects'])

    def test_mocked_sdk_exact_amount_and_redirect_allowlist(self):
        sdk=MagicMock()
        with patch.dict(sys.modules,{'midtransclient':sdk}), patch.dict(os.environ,{
            'MIDTRANS_SERVER_KEY':'test-key','MIDTRANS_IS_PRODUCTION':'false'}):
            sdk.Snap.return_value.create_transaction.return_value={'redirect_url':'https://app.sandbox.midtrans.com/snap/v2/vtweb/test'}
            self.assertTrue(checkout_midtrans.create_snap_transaction('PAY123',129000,'C1')[0])
            sdk.Snap.return_value.create_transaction.assert_called_with({
                'transaction_details':{'order_id':'PAY123','gross_amount':129000},
                'customer_details':{'first_name':'C1'}})
            for url in ('javascript:alert(1)','https://evil.test/snap/a','https://app.midtrans.com/snap/a',
                        'https://app.sandbox.midtrans.com.evil.test/snap/a'):
                sdk.Snap.return_value.create_transaction.return_value={'redirect_url':url}
                self.assertEqual(checkout_midtrans.create_snap_transaction('PAY123',129000,'C1'),(False,None))
            sdk.Snap.return_value.create_transaction.side_effect=TimeoutError('secret')
            self.assertEqual(checkout_midtrans.create_snap_transaction('PAY123',129000,'C1'),(False,None))
