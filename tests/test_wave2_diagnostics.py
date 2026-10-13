"""Injected exceptions with canary secrets must produce only safe diagnostics."""
import sys
import unittest
from contextlib import ExitStack
from unittest.mock import MagicMock, patch
from test_dashboard_auth import api
import checkout_midtrans

SECRET = 'BOT_TOKEN=private-initData-transaction-payment-provider-secret'

class DiagnosticsTests(unittest.TestCase):
    def test_unexpected_route_failures_are_distinguishable_without_payloads(self):
        cases = [
            ('paid_access', '/api/summary', lambda: api.require_paid_dashboard_access(101), 'read_entitlement', 503),
            ('checkout_products', '/api/checkout/products', api.checkout_products, 'offers', 503),
            ('checkout_order', '/api/checkout/orders', api.checkout_order, 'reserve_order', 503),
            ('export_transactions', '/api/export/transactions', lambda: api.export_response(101,'all'), 'read_entitlement', 500),
            ('confirm_type_review', '/api/transactions/1/type-review/confirm', lambda: api.confirm_type_review(1), None, 500),
        ]
        for operation, path, handler, target, status in cases:
            for exception in (RuntimeError, ValueError):
                with self.subTest(operation=operation, exception=exception.__name__), ExitStack() as stack:
                    connection = MagicMock()
                    stack.enter_context(api.app.test_request_context(path, method='POST',
                        json={'fingerprint': SECRET} if target is None else {'product_code':'pro_lifetime'},
                        headers={'Authorization': 'tma ' + SECRET}))
                    api.g.user_id = 101
                    stack.enter_context(patch.object(api, 'get_connection', return_value=connection))
                    stack.enter_context(patch.object(api, 'checkout_allowed', return_value=True))
                    stack.enter_context(patch.object(api.checkout_midtrans, 'ready', return_value=True))
                    if target:
                        stack.enter_context(patch.object(api, target, side_effect=exception(SECRET)))
                    else:
                        connection.cursor.return_value.execute.side_effect = exception(SECRET)
                    with self.assertLogs(level='ERROR') as logs:
                        response, actual_status = handler()
                    self.assertEqual(actual_status, status)
                    self.assertNotIn(SECRET, response.get_data(as_text=True))
                    self.assertEqual([r.getMessage() for r in logs.records],
                        [f'operation={operation} exception_type={exception.__name__}'])
                    self.assertTrue(all(r.exc_info is None and r.stack_info is None for r in logs.records))

    def test_provider_exception_is_logged_without_secret_or_payload(self):
        sdk = MagicMock()
        sdk.Snap.return_value.create_transaction.side_effect = RuntimeError(SECRET)
        with patch.dict(sys.modules, {'midtransclient':sdk}), patch.dict('os.environ', {'MIDTRANS_SERVER_KEY':SECRET}):
            with self.assertLogs(level='ERROR') as logs:
                self.assertEqual(checkout_midtrans.create_snap_transaction('PAY001', 99000, SECRET), (False,None))
        self.assertEqual([r.getMessage() for r in logs.records], ['operation=checkout_provider exception_type=RuntimeError'])
        self.assertTrue(all(r.exc_info is None and r.stack_info is None for r in logs.records))

    def test_expected_denials_are_not_unexpected_errors(self):
        with api.app.test_request_context('/api/checkout/products'), patch.object(api, 'get_connection', return_value=MagicMock()), patch.object(api, 'offers', side_effect=api.CheckoutError('product_not_eligible')):
            api.g.user_id = 101
            with self.assertNoLogs(level='ERROR'):
                self.assertEqual(api.checkout_products()[1],409)

    def test_confirm_connection_failure_is_safe_and_generic(self):
        with api.app.test_request_context('/api/transactions/1/type-review/confirm', method='POST', json={'fingerprint': SECRET}), patch.object(api, 'get_connection', side_effect=RuntimeError(SECRET)):
            api.g.user_id = 101
            with self.assertLogs(level='ERROR') as logs:
                response, status = api.confirm_type_review(1)
            self.assertEqual(status, 500)
            self.assertNotIn(SECRET, response.get_data(as_text=True))
            self.assertEqual([r.getMessage() for r in logs.records], ['operation=confirm_type_review exception_type=RuntimeError'])
