"""Policy and real authenticated routes; no live DB/provider."""
import os
import unittest
from unittest.mock import patch
from checkout_policy import checkout_allowed
import test_lifetime_checkout as fixtures
from test_dashboard_auth import signed


class PolicyTests(unittest.TestCase):
    def test_config_matrix_fail_closed(self):
        cases = [
            ({}, False),
            ({'LIFETIME_CHECKOUT_ENABLED':'true'}, True),
            ({'LIFETIME_CHECKOUT_CANARY_IDS':'101,202'}, True),
            ({'LIFETIME_CHECKOUT_CANARY_IDS':'202'}, False),
            ({'LIFETIME_CHECKOUT_ENABLED':' FALSE ', 'LIFETIME_CHECKOUT_CANARY_IDS':' 101, 202 '},True),
            ({'LIFETIME_CHECKOUT_ENABLED':'yes','LIFETIME_CHECKOUT_CANARY_IDS':'101'},False),
            ({'LIFETIME_CHECKOUT_ENABLED':''},False),
        ]
        for config,expected in cases:
            with self.subTest(config=config):
                self.assertEqual(checkout_allowed(101,config),expected)
        for raw in ('101,','101,,202','101,bad','0','-1','+101','00101','1.0','1e2',
                    '9007199254740992','101\n202','1'*16385):
            for enabled in ('true','false'):
                self.assertFalse(checkout_allowed(101, {
                    'LIFETIME_CHECKOUT_ENABLED':enabled,'LIFETIME_CHECKOUT_CANARY_IDS':raw}))
        for user in (True,'101',None,0,-1):
            self.assertFalse(checkout_allowed(user,{'LIFETIME_CHECKOUT_ENABLED':'true'}))


class GateRouteTests(unittest.TestCase):
    setUp = fixtures.LifetimeCheckoutTests.setUp
    request = fixtures.LifetimeCheckoutTests.request
    setUpFixture = fixtures.LifetimeCheckoutTests.setUpFixture
    post = fixtures.LifetimeCheckoutTests.post
    state = fixtures.LifetimeCheckoutTests.state

    def configure(self, enabled=None, ids=None):
        os.environ.pop('LIFETIME_CHECKOUT_ENABLED',None)
        os.environ.pop('LIFETIME_CHECKOUT_CANARY_IDS',None)
        if enabled is not None: os.environ['LIFETIME_CHECKOUT_ENABLED']=enabled
        if ids is not None: os.environ['LIFETIME_CHECKOUT_CANARY_IDS']=ids

    def test_default_off_and_direct_bypass_denied_before_db(self):
        self.configure()
        result=self.request('GET','/api/checkout/products',signed())
        self.assertEqual(result.status_code,200)
        self.assertFalse(result.json['checkout_available'])
        self.get_connection.reset_mock()
        for path,payload in [
            ('/api/checkout/orders',{'product_code':'pro_lifetime'}),
            ('/api/checkout/orders?user_id=202&LIFETIME_CHECKOUT_ENABLED=true',
             {'product_code':'pro_lifetime','telegram_id':202,'enabled':True})]:
            result=self.request('POST',path,signed(),json=payload)
            self.assertEqual(result.status_code,403)
            self.assertEqual(result.json['error'],'lifetime_checkout_disabled')
        self.get_connection.assert_not_called()
        self.snap.assert_not_called()

    def test_canary_and_non_canary_use_verified_identity(self):
        self.configure('false','101')
        self.assertTrue(self.request('GET','/api/checkout/products',signed()).json['checkout_available'])
        self.assertFalse(self.request('GET','/api/checkout/products',signed(user_id=202)).json['checkout_available'])
        result=self.request('POST','/api/checkout/orders?user_id=101',signed(user_id=202),
                            json={'product_code':'pro_lifetime'})
        self.assertEqual(result.status_code,403)
        self.assertEqual(self.post('pro_lifetime').status_code,201)
        self.snap.assert_called_once()

    def test_global_enabled_still_enforces_product_eligibility(self):
        self.configure('true')
        self.assertTrue(self.request('GET','/api/checkout/products',signed()).json['checkout_available'])
        self.assertEqual(self.post('starter_to_pro_lifetime').status_code,409)
        self.assertEqual(self.post('starter_lifetime').status_code,201)

    def test_invalid_config_even_global_true_denies(self):
        for enabled,ids in [('true','101,bad'),('garbage','101'),('true','101,')]:
            self.configure(enabled,ids)
            self.assertFalse(self.request('GET','/api/checkout/products',signed()).json['checkout_available'])
            self.get_connection.reset_mock()
            self.assertEqual(self.post('pro_lifetime').status_code,403)
            self.get_connection.assert_not_called()
        self.snap.assert_not_called()

    def test_kill_switch_after_offer_before_purchase(self):
        self.configure('true')
        self.assertTrue(self.request('GET','/api/checkout/products',signed()).json['checkout_available'])
        self.configure('false','')
        self.assertEqual(self.post('pro_lifetime').status_code,403)
        self.snap.assert_not_called()

    def test_canary_does_not_bypass_auth_or_provider_readiness(self):
        self.configure('false','101')
        self.assertEqual(self.request('POST','/api/checkout/orders','invalid',
            json={'product_code':'pro_lifetime'}).status_code,401)
        with patch('checkout_midtrans.ready',return_value=False):
            self.assertFalse(self.request('GET','/api/checkout/products',signed()).json['checkout_available'])
            self.assertEqual(self.post('pro_lifetime').status_code,503)
        self.snap.assert_not_called()
