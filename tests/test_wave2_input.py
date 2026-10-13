"""Input errors and partial edits through real signed auth; disposable DB only."""
import unittest
from unittest.mock import patch
import test_dashboard_auth as fixtures
from test_dashboard_auth import api, signed


class InputIntegrityTests(unittest.TestCase):
    setUp = fixtures.DashboardAuthTests.setUp
    request = fixtures.DashboardAuthTests.request

    def test_malformed_json_and_media_type_are_client_errors(self):
        before = list(self.db.iterdump())
        for body, content_type, status in [('{', 'application/json', 400),
                ('', 'application/json', 400), ('{"amount":20}', 'text/plain', 415),
                ('{"amount":20}', None, 415), ('null', 'application/json', 400),
                ('[]', 'application/json', 400)]:
            with self.subTest(body=body, content_type=content_type):
                response = self.request('PATCH', '/api/transactions/1', signed(),
                    data=body, content_type=content_type, json=None)
                self.assertEqual(response.status_code, status)
                self.assertFalse(response.json['success'])
                self.assertEqual(list(self.db.iterdump()), before)

    def test_json_suffix_supported_and_internal_failure_remains_generic(self):
        response = self.request('PATCH', '/api/transactions/1', signed(),
            data='{"amount":20}', content_type='application/merge-patch+json', json=None)
        self.assertEqual(response.status_code, 200)
        with patch.object(api, 'get_connection', side_effect=[fixtures.MemoryConnection(self.db), RuntimeError('private DB detail')]):
            response = self.request('PATCH', '/api/transactions/1', signed(), json={'amount':30})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('private DB detail', response.text)

    def test_amount_only_preserves_exact_other_fields_and_other_owner(self):
        for note in ('-', '  spasi\nbaris\t☕  ', '', None):
            self.db.execute("UPDATE expenses SET category=?,note=?,analytics_category=?,type_review_confirmed_fingerprint=? WHERE user_id=101 AND transaction_id=1",
                ('  deskripsi\ncopy  ', note, 'Gaji', 'retained-fingerprint'))
            self.db.commit()
            before = self.db.execute('SELECT * FROM expenses ORDER BY user_id,transaction_id').fetchall()
            result = self.request('PATCH', '/api/transactions/1?user_id=202', signed(), json={'amount':27})
            self.assertEqual(result.status_code, 200)
            after = self.db.execute('SELECT * FROM expenses ORDER BY user_id,transaction_id').fetchall()
            expected = list(before[0]); expected[4] = 27
            self.assertEqual(after, [tuple(expected), *before[1:]])
