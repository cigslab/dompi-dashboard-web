"""Run: python -m unittest discover -s tests -p 'test_dashboard_auth.py' -v.

Uses Flask's real test client and a disposable in-memory SQL adapter, not
production PostgreSQL or database.py (which performs migrations on import).
"""
import ast
import asyncio
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import types
import unittest
import rupiah
import psycopg2
from unittest.mock import patch, AsyncMock
from urllib.parse import urlencode, parse_qsl

ROOT = Path(__file__).resolve().parents[1]
TOKEN = '123456:local-test-token-not-a-real-credential'
NOW = 1800000000
ORIGIN = 'https://dashboard.example.test'
with patch.dict(os.environ, {'BOT_TOKEN': TOKEN,
                             'INIT_DATA_MAX_AGE_SECONDS': '3600',
                             'DASHBOARD_ALLOWED_ORIGINS': ORIGIN}):
    spec = importlib.util.spec_from_file_location('dashboard_auth_test_api', ROOT / 'app.py')
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
api.app.config['TESTING'] = True


def signed(user_id=101, age=0, token=TOKEN, **extra):
    data = {'query_id': 'test-query', 'auth_date': str(NOW - age),
            'user': json.dumps({'id': user_id, 'first_name': 'Cigs & café + /'}, ensure_ascii=False)}
    data.update(extra)
    key = hmac.digest(b'WebAppData', token.encode(), 'sha256')
    message = '\n'.join(f'{k}={data[k]}' for k in sorted(data)).encode()
    data['hash'] = hmac.digest(key, message, 'sha256').hex()
    return urlencode(data)


READS = ['/api/summary', '/api/cashflow', '/api/analytics/monthly',
         '/api/categories', '/api/transactions']
ENDPOINTS = [('GET', p) for p in READS] + [('GET', '/api/profile'), ('GET', '/api/categories/breakdown')] + [
    ('PATCH', '/api/transactions/1'), ('DELETE', '/api/transactions/1')]
PAYLOAD = {'category': 'updated', 'amount': 15, 'note': 'test', 'type': 'expense'}


class MemoryCursor:
    def __init__(self, db):
        self.cursor = db.cursor()

    def execute(self, query, params):
        query = query.replace('%s', '?').replace('LEFT(date, 10)', 'substr(date, 1, 10)')
        query = query.replace("TO_CHAR(date::timestamp, 'YYYY-MM')", "strftime('%Y-%m', date)")
        return self.cursor.execute(query, params)

    def __getattr__(self, name):
        return getattr(self.cursor, name)


class MemoryConnection:
    def __init__(self, db):
        self.db = db

    def cursor(self):
        return MemoryCursor(self.db)

    def commit(self):
        self.db.commit()

    def rollback(self):
        self.db.rollback()

    def close(self):
        pass  # retain the disposable fixture across requests


class PostgresFixture:
    """Synthetic fixture administration only; API gets independent real connections."""
    def __init__(self, dsn):
        self.conn = psycopg2.connect(dsn)
        self.conn.autocommit = True
        self.cursors = []
    def execute(self, sql, params=()):
        cursor = self.conn.cursor()
        self.cursors.append(cursor)
        cursor.execute(sql.replace('?', '%s'), params)
        return cursor
    def executemany(self, sql, rows):
        cursor = self.conn.cursor()
        self.cursors.append(cursor)
        cursor.executemany(sql.replace('?', '%s'), rows)
    def commit(self): self.conn.commit()
    def close(self):
        for cursor in self.cursors: cursor.close()
        self.conn.close()


class DashboardAuthTests(unittest.TestCase):
    def setUp(self):
        self.clock = patch.object(api.time, 'time', return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.client = api.app.test_client()
        dsn = os.getenv('DOMPI_DASHBOARD_TEST_DSN')
        if dsn:
            from psycopg2.extensions import parse_dsn
            options = parse_dsn(dsn)
            if not (options.get('host', '').startswith('/tmp/dompi-dashboard-test-')
                    and options.get('user') == 'dompi_test'
                    and options.get('dbname') == 'postgres'
                    and options.get('port') == '55446'):
                raise RuntimeError('Only the disposable dashboard cluster is allowed')
            self.db = PostgresFixture(dsn)
            self.db.execute('DROP TABLE IF EXISTS expenses')
            self.db.execute('DROP TABLE IF EXISTS users')
        else:
            self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE users (telegram_id BIGINT PRIMARY KEY, first_name TEXT, username TEXT)')
        self.db.executemany('INSERT INTO users VALUES (?,?,?)', [(101, 'Nama A', 'user_a'), (202, 'Nama B', 'user_b')])
        self.db.execute('CREATE TABLE expenses (user_id INTEGER, transaction_id INTEGER, category TEXT, analytics_category TEXT, amount INTEGER, note TEXT, date TEXT, type TEXT, currency TEXT)')
        self.db.executemany('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,?)', [
            (101, 1, 'A expense', 'Food', 10, 'A', '2026-09-14', 'expense', 'IDR'),
            (101, 2, 'A income', 'Salary', 100, 'A', '2026-09-14', 'income', 'IDR'),
            (202, 1, 'B expense', 'Secret', 999, 'B', '2026-09-14', 'expense', 'IDR'),
            (202, 9, 'B only', 'Secret', 555, 'B', '2026-09-14', 'expense', 'IDR'),
        ])
        self.db.commit()
        self.connection = (patch.object(api, 'get_connection', side_effect=lambda: psycopg2.connect(dsn))
                           if dsn else patch.object(api, 'get_connection', return_value=MemoryConnection(self.db)))
        self.get_connection = self.connection.start()
        self.addCleanup(self.connection.stop)

    def request(self, method, path, credential=None, **kwargs):
        headers = kwargs.pop('headers', {})
        if credential is not None:
            headers['Authorization'] = 'tma ' + credential
        if method == 'PATCH' and 'json' not in kwargs:
            kwargs['json'] = PAYLOAD
        return self.client.open(path, method=method, headers=headers, **kwargs)

    def test_category_breakdown_period_ownership_percentages(self):
        self.db.executemany('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,?)', [
            (101, 3, 'Bus', 'Transportasi', 30, '', '2026-09-15', 'expense', 'IDR'),
            (101, 4, 'Old', 'Food', 90, '', '2026-08-14', 'expense', 'IDR'),
            (101, 5, 'Foreign', 'Food', 9999, '', '2026-09-14', 'expense', 'USD'),
        ])
        self.db.commit()
        response = self.request('GET', '/api/categories/breakdown?month=2026-09&user_id=202', signed())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'total_expense': 40, 'category_count': 2, 'largest_category': 'Transportasi',
            'categories': [{'category': 'Transportasi', 'transaction_count': 1, 'total': 30, 'percentage': 75.0},
                           {'category': 'Food', 'transaction_count': 1, 'total': 10, 'percentage': 25.0}]})
        other = self.request('GET', '/api/categories/breakdown?month=2026-09', signed(202)).json
        self.assertEqual(other['total_expense'], 1554)
        self.assertEqual(other['largest_category'], 'Secret')
        self.assertEqual(self.request('GET', '/api/categories/breakdown?month=2026-08', signed()).json['total_expense'], 90)
        self.assertEqual(self.request('GET', '/api/categories/breakdown', signed()).json['total_expense'], 130)

    def test_category_breakdown_empty_and_invalid_period(self):
        self.assertEqual(self.request('GET', '/api/categories/breakdown?month=2000-01', signed()).json,
                         {'categories': [], 'total_expense': 0, 'category_count': 0, 'largest_category': None})
        self.get_connection.reset_mock()
        for month in ['2026-13', 'bad', '2026-1']:
            self.assertEqual(self.request('GET', '/api/categories/breakdown?month='+month, signed()).status_code, 400)
        self.get_connection.assert_not_called()

    def test_profile_user_a_uses_database_name(self):
        response = self.request('GET', '/api/profile?user_id=202', signed(), json={'user_id': 202})
        self.assertEqual(response.json, {'display_name': 'Nama A'})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_profile_user_b_uses_database_name(self):
        self.assertEqual(self.request('GET', '/api/profile', signed(202)).json,
                         {'display_name': 'Nama B'})

    def test_profile_falls_back_to_username(self):
        self.db.execute("UPDATE users SET first_name='  ' WHERE telegram_id=101")
        self.db.commit()
        self.assertEqual(self.request('GET', '/api/profile', signed()).json,
                         {'display_name': 'user_a'})

    def test_profile_falls_back_to_user(self):
        self.db.execute("UPDATE users SET first_name=NULL, username=NULL WHERE telegram_id=101")
        self.db.commit()
        self.assertEqual(self.request('GET', '/api/profile', signed()).json,
                         {'display_name': 'User'})
        self.assertEqual(self.request('GET', '/api/profile', signed(303)).json,
                         {'display_name': 'User'})

    def test_runtime_honors_port_and_has_no_bot_imports(self):
        import runpy
        for file in ['app.py', 'rupiah.py']:
            tree = ast.parse((ROOT / file).read_text())
            imports = {n.module.split('.')[0] for n in ast.walk(tree)
                       if isinstance(n, ast.ImportFrom) and n.module}
            imports |= {a.name.split('.')[0] for n in ast.walk(tree)
                        if isinstance(n, ast.Import) for a in n.names}
            self.assertFalse(imports & {'bot', 'database', 'handlers', 'utils', 'receipt_ocr', 'config'})
        with patch.dict(os.environ, {'BOT_TOKEN': TOKEN, 'PORT': '9876'}), patch('waitress.serve') as serve:
            runpy.run_path(str(ROOT / 'app.py'), run_name='__main__')
            self.assertEqual(serve.call_args.kwargs, {'host': '0.0.0.0', 'port': 9876})

    def test_health_and_home_without_database_or_token_exposure(self):
        self.assertEqual(self.client.get('/health').json, {'ok': True})
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(TOKEN, response.text)
        self.assertNotIn('dompi-dashboard-production.up.railway.app', response.text)
        self.assertIn('/api/transactions', response.text)
        self.get_connection.assert_not_called()

    def test_idr_parser_contract(self):
        for value, expected in [('18.000', 18000), ('18rb', 18000), ('18k', 18000),
                                ('1.5jt', 1500000), ('Rp 18000', 18000), (18000, 18000)]:
            self.assertEqual(rupiah.parse_idr_amount(value), expected)
        for value in [True, 1.5, '12.50', '18 USD', 0, -1, '9' * 65]:
            self.assertIsNone(rupiah.parse_idr_amount(value))

    def test_idr_filters_and_legacy_mutations(self):
        self.db.executemany('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,?)', [
            (101, 20, 'Legacy', 'Food', 1250, 'legacy', '2026-09-14', 'expense', currency)
            for currency in ['USD', None]
        ])
        self.db.commit()
        self.assertEqual(self.request('GET', '/api/summary', signed()).json,
                         {'income': 100, 'expense': 10, 'balance': 90})
        for route in ['/api/cashflow', '/api/analytics/monthly']:
            row = self.request('GET', route, signed()).json[0]
            self.assertEqual((row['income'], row['expense']), (100, 10))
        self.assertEqual(self.request('GET', '/api/categories', signed()).json,
                         [{'category': 'Food', 'total': 10}])
        self.assertEqual(len(self.request('GET', '/api/transactions', signed()).json), 2)
        for method in ['PATCH', 'DELETE']:
            self.assertEqual(self.request(method, '/api/transactions/20', signed()).status_code, 404)
        for code in ['USD', 'JPY', 'EUR', 'KRW']:
            self.assertEqual(self.request('GET', '/api/summary?currency=' + code, signed()).status_code, 400)
            self.assertEqual(self.request('PATCH', '/api/transactions/1', signed(),
                                          json={**PAYLOAD, 'currency': code}).status_code, 400)
        for value in [True, 1.5, '12.50', 0]:
            self.assertEqual(self.request('PATCH', '/api/transactions/1', signed(),
                                          json={**PAYLOAD, 'amount': value}).status_code, 400)

    def test_latest_receipt_with_older_date_is_first_and_limit_remains_ten(self):
        self.db.executemany('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,?)', [
            (101, i, 'Manual', 'Food', 18000, 'Manual',
             '2026-09-15 12:00:00', 'expense', 'IDR')
            for i in range(3, 13)
        ] + [
            (101, 13, 'Metro Coffee', 'Food', 18000, 'Foto struk',
             '2026-09-14', 'expense', 'IDR'),
            (202, 99, 'Other user', 'Food', 18000, 'Private',
             '2026-09-16', 'expense', 'IDR'),
            (101, 100, 'Foreign', 'Food', 12, 'Legacy',
             '2026-09-16', 'expense', 'USD'),
        ])
        self.db.commit()
        response = self.request('GET', '/api/transactions', signed())
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['transaction_id'] for item in response.json],
                         list(range(13, 3, -1)))
        self.assertEqual(response.json[0]['category'], 'Metro Coffee')
        self.assertEqual(response.json[0]['date'], '2026-09-14')
        self.assertEqual(response.json[0]['note'], 'Foto struk')

    def test_all_endpoints_reject_missing_forged_expired_and_malformed_without_db(self):
        invalid = [None, '', 'broken', signed(token='wrong'), signed(age=3601),
                   signed(age=-31), signed() + '&user=forged', signed().replace('hash=', 'hash=0'),
                   signed(user='[]'), signed(user='not-json'), signed(user='{}'),
                   signed(user_id=True), signed(user_id=-1), signed(user_id='101'),
                   signed(auth_date='bad'), signed() + '&x=%ZZ', 'x' * 16385]
        for method, endpoint in ENDPOINTS:
            for credential in invalid:
                with self.subTest(method=method, endpoint=endpoint, credential=invalid.index(credential)):
                    response = self.request(method, endpoint, credential)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.json, {'error': 'unauthorized'})
        self.get_connection.assert_not_called()

    def test_hash_detects_tampering_after_signing(self):
        data = dict(parse_qsl(signed()))
        data['user'] = json.dumps({'id': 202})
        self.assertEqual(self.request('GET', READS[0], urlencode(data)).status_code, 401)
        self.get_connection.assert_not_called()

    def test_signature_field_included_in_hmac_and_constant_time_comparison(self):
        with patch.object(api.hmac, 'compare_digest', wraps=hmac.compare_digest) as compare:
            self.assertEqual(api.verify_telegram_init_data(signed(signature='extra-signed-field')), 101)
            compare.assert_called_once()
        data = dict(parse_qsl(signed(signature='original')))
        data['signature'] = 'tampered'
        with self.assertRaises(api.InvalidTelegramAuth):
            api.verify_telegram_init_data(urlencode(data))

    def test_lifetime_config_and_future_tolerance(self):
        self.assertEqual(api.verify_telegram_init_data(signed(age=3600)), 101)
        self.assertEqual(api.verify_telegram_init_data(signed(age=-30)), 101)
        with patch.object(api, 'INIT_DATA_MAX_AGE_SECONDS', 60):
            with self.assertRaises(api.InvalidTelegramAuth):
                api.verify_telegram_init_data(signed(age=61))

    def test_reads_only_authenticated_user_and_ignores_query_and_body_user_id(self):
        expected = [
            {'income': 100, 'expense': 10, 'balance': 90},
            [{'date': '2026-09-14', 'income': 100, 'expense': 10}],
            [{'month': '2026-09', 'income': 100, 'expense': 10, 'transaction_count': 2}],
            [{'category': 'Food', 'total': 10}],
        ]
        for index, endpoint in enumerate(READS):
            response = self.request('GET', endpoint + '?user_id=202', signed(), json={'user_id': 202})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            if index < 4:
                self.assertEqual(response.json, expected[index])
            else:
                self.assertEqual({row['category'] for row in response.json}, {'A expense', 'A income'})
        b = self.request('GET', '/api/summary', signed(202))
        self.assertEqual(b.json['expense'], 1554)

    def test_patch_same_transaction_number_only_changes_owner(self):
        response = self.request('PATCH', '/api/transactions/1?user_id=202', signed(),
                                json={**PAYLOAD, 'user_id': 202, 'transaction_id': 9})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.execute('SELECT amount FROM expenses WHERE user_id=101 AND transaction_id=1').fetchone()[0], 15)
        self.assertEqual(self.db.execute('SELECT amount FROM expenses WHERE user_id=202 AND transaction_id=1').fetchone()[0], 999)

    def test_delete_same_transaction_number_only_deletes_owner(self):
        response = self.request('DELETE', '/api/transactions/1?user_id=202', signed(), json={'user_id': 202})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM expenses WHERE user_id=101 AND transaction_id=1').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM expenses WHERE user_id=202 AND transaction_id=1').fetchone()[0], 1)

    def test_cannot_mutate_other_users_transaction(self):
        for method in ['PATCH', 'DELETE']:
            response = self.request(method, '/api/transactions/9', signed())
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.db.execute('SELECT amount FROM expenses WHERE user_id=202 AND transaction_id=9').fetchone()[0], 555)

    def test_legacy_routes_are_closed(self):
        old = [('GET', p + '/202') for p in READS] + [
            ('PATCH', '/api/transactions/202/1'), ('DELETE', '/api/transactions/202/1')]
        for method, path in old:
            self.assertEqual(self.request(method, path).status_code, 401)
            self.assertIn(self.request(method, path, signed()).status_code, [404, 405])
        self.get_connection.assert_not_called()
        self.assertFalse(any('user_id' in rule.arguments for rule in api.app.url_map.iter_rules()))

    def test_preflight_never_queries_and_cors_is_restricted(self):
        for method, path in ENDPOINTS:
            response = self.request('OPTIONS', path, headers={
                'Origin': ORIGIN, 'Access-Control-Request-Method': method,
                'Access-Control-Request-Headers': 'Authorization, Content-Type'})
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.headers['Access-Control-Allow-Origin'], ORIGIN)
            self.assertIn('Authorization', response.headers['Access-Control-Allow-Headers'])
            self.assertNotIn('Access-Control-Allow-Credentials', response.headers)
        response = self.request('OPTIONS', READS[0], headers={
            'Origin': 'https://evil.example.test', 'Access-Control-Request-Method': 'GET'})
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        self.get_connection.assert_not_called()

    def test_empty_token_fails_startup(self):
        with patch.dict(os.environ, {'BOT_TOKEN': ''}):
            with self.assertRaisesRegex(RuntimeError, 'BOT_TOKEN'):
                spec.loader.exec_module(importlib.util.module_from_spec(spec))

    def test_missing_signed_fields_and_duplicate_hash_rejected(self):
        for missing in ['hash', 'user', 'auth_date']:
            fields = dict(parse_qsl(signed()))
            del fields[missing]
            with self.assertRaises(api.InvalidTelegramAuth):
                api.verify_telegram_init_data(urlencode(fields))
        with self.assertRaises(api.InvalidTelegramAuth):
            api.verify_telegram_init_data(signed() + '&hash=' + '0' * 64)



if __name__ == '__main__':
    unittest.main()
