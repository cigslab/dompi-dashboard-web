"""Real dashboard auth middleware + injected synthetic commerce boundary."""
import unittest
from unittest.mock import Mock,patch
import test_dashboard_auth as fixture

api=fixture.api
signed=fixture.signed


class CoreDashboardTests(unittest.TestCase):
    def setUp(self):
        self.base=fixture.DashboardAuthTests();self.base.setUp();self.addCleanup(self.base.doCleanups)
        self.service=Mock();self.service.identity.return_value='alice'
        self.service.overview.return_value={'cohort':'v2_purchase','balance':100,'checkout_available':False}
        self.service.history.return_value={'items':[],'next_cursor':None}
        self.service.credits.return_value={'items':[],'next_cursor':None}
        self.service.orders.return_value=[]
        self.service.order.return_value={'id':'DTC-test','price_idr':10000,'credits':100,'status':'pending'}
        extension=patch.dict(api.app.extensions,{'core_v2_commerce':self.service})
        extension.start();self.addCleanup(extension.stop)
        flags=patch.dict('os.environ',{'DOMPI_CORE_V2_DASHBOARD_ENABLED':'1','DOMPI_CORE_V2_TOPUP_ORDERS_ENABLED':'0'})
        flags.start();self.addCleanup(flags.stop)
        config=patch.dict(api.app.config,{'CORE_V2_LYNK_PRODUCTS':{'topup_100':'test_product'}})
        config.start();self.addCleanup(config.stop)

    def request(self,path='overview',method='GET',**kwargs):
        return self.base.request(method,'/api/core-v2/'+path,credential=signed(),**kwargs)

    def test_auth_and_ownership_ignore_request_identity(self):
        for path in ['overview','usage','credits','orders']:
            self.assertEqual(self.base.request('GET','/api/core-v2/'+path).status_code,401)
        self.service.identity.assert_not_called()
        self.assertEqual(self.request('overview?user_id=202').status_code,200)
        self.service.identity.assert_called_once_with(101)

    def test_flags_off_do_not_touch_commerce(self):
        with patch.dict('os.environ',{'DOMPI_CORE_V2_DASHBOARD_ENABLED':'0'}):
            self.assertEqual(self.request().status_code,404)
        self.service.identity.assert_not_called()
        self.assertEqual(self.request('orders','POST',json={}).status_code,403)
        self.service.order.assert_not_called()

    def test_legacy_unchanged_no_order_or_enrollment(self):
        self.service.identity.return_value=None
        result=self.request().get_json()
        self.assertEqual(result,dict(cohort='legacy',checkout_available=False,orders_enabled=False))
        self.service.overview.assert_not_called()

    def test_order_strict_server_price_and_client_key(self):
        with patch.dict('os.environ',{'DOMPI_CORE_V2_TOPUP_ORDERS_ENABLED':'1'}):
            good={'product_code':'topup_100','idempotency_key':'same_key'}
            for field in ['price_idr','credits','user_id','policy_version','provider']:
                self.assertEqual(self.request('orders','POST',json=dict(good,**{field:1})).status_code,400)
            result=self.request('orders','POST',json=good)
            self.assertEqual(result.status_code,200);self.assertFalse(result.get_json()['checkout_available'])
            self.service.order.assert_called_once_with('alice','topup_100','same_key',product_reference='test_product')

    def test_no_store_and_bounded_cursor_contract(self):
        response=self.request('usage?before=some_id&limit=5')
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.service.history.assert_called_once_with('alice',before='some_id',limit=5)
        self.assertEqual(self.request('credits?before=not_integer').status_code,400)

    def test_unavailable_database_does_not_expose_exception(self):
        self.service.overview.side_effect=RuntimeError('private connection data')
        response=self.request()
        self.assertEqual(response.status_code,503);self.assertNotIn('private',response.get_data(as_text=True))

    def test_existing_paid_gate_still_blocks_free_accounts(self):
        self.base.db.execute("UPDATE users SET plan='free',pro_until=NULL WHERE telegram_id=101")
        self.base.db.commit()
        self.assertEqual(self.request().status_code,403)
        self.service.identity.assert_not_called()

    def test_panel_and_script_absent_with_flag_off(self):
        with patch.dict('os.environ',{'DOMPI_CORE_V2_DASHBOARD_ENABLED':'0'}):
            html=self.base.client.get('/').get_data(as_text=True)
        self.assertNotIn('id="coreV2Panel"',html)
        self.assertNotIn('/static/core-v2.js',html)
        html=self.base.client.get('/').get_data(as_text=True)
        self.assertIn('id="coreV2Panel"',html)
        self.service.identity.assert_not_called()
