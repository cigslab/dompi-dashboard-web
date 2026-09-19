"""CSV endpoint tests: authenticated requests, disposable SQLite, no providers."""
import csv
from datetime import datetime, date
from decimal import Decimal
import io
import unittest
from unittest.mock import patch
import test_dashboard_auth as fixtures
from test_dashboard_auth import api, signed
from transaction_export import period_bounds, render_csv


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026,9,19,12)


class ExportTests(unittest.TestCase):
    request = fixtures.DashboardAuthTests.request

    def setUp(self):
        fixtures.DashboardAuthTests.setUp(self)
        clock=patch.object(api,'datetime',FixedDateTime)
        clock.start();self.addCleanup(clock.stop)
        self.db.execute('ALTER TABLE users ADD COLUMN lifetime_plan TEXT')
        self.db.execute("UPDATE users SET plan='free',lifetime_plan='pro'")
        self.db.commit()

    def export(self, period='all', user=101):
        return self.request('GET','/api/export/transactions?period='+period,signed(user_id=user))

    def rows(self, response):
        self.assertEqual(response.status_code,200)
        return list(csv.DictReader(io.StringIO(response.get_data(as_text=True))))

    def test_pro_lifetime_legacy_and_starter_plus_legacy(self):
        for life,plan,expiry in [('pro','free',None),(None,'pro','2099-01-01'),
                                 ('starter','pro','2099-01-01 00:00:00')]:
            self.db.execute('UPDATE users SET lifetime_plan=?,plan=?,pro_until=? WHERE telegram_id=101',(life,plan,expiry))
            self.db.commit()
            self.assertEqual(len(self.rows(self.export())),2)

    def test_free_starter_expired_ambiguous_denied(self):
        for life,plan,expiry in [(None,'free',None),('starter','free',None),
                (None,'pro','2020-01-01'),('starter','pro','2020-01-01'),
                (None,'pro',None),(None,'pro','bad'),('pro','pro','bad')]:
            self.db.execute('UPDATE users SET lifetime_plan=?,plan=?,pro_until=? WHERE telegram_id=101',(life,plan,expiry))
            self.db.commit()
            self.assertEqual(self.export().status_code,403)

    def test_owner_isolation_auth_and_exact_columns(self):
        response=self.request('GET','/api/export/transactions?period=all&user_id=202',signed())
        rows=self.rows(response)
        self.assertEqual(list(rows[0]),['date','type','description','analytics_category','amount','note'])
        self.assertEqual({r['description'] for r in rows},{'A expense','A income'})
        self.assertNotIn('Secret',response.get_data(as_text=True))
        self.assertEqual({r['description'] for r in self.rows(self.export(user=202))},{'B expense','B only'})
        self.get_connection.reset_mock()
        for credential in (None,'invalid',signed(age=3601)):
            self.assertEqual(self.request('GET','/api/export/transactions',credential).status_code,401)
        self.get_connection.assert_not_called()

    def insert(self, when, category='Tagihan', description='item', amount=10, note=''):
        self.db.execute("""INSERT INTO expenses
            (user_id,transaction_id,category,analytics_category,amount,note,date,type,currency)
            VALUES(101,100,?,?,?,?,?,'expense','IDR')""",(description,category,amount,note,when))
        self.db.commit()

    def test_periods_and_more_than_ten_rows(self):
        self.db.execute('DELETE FROM expenses WHERE user_id=101')
        for i in range(15):
            self.insert(f'2026-09-{i+1:02d}')
        for when in ('2026-06-30','2026-07-01','2026-08-31','2026-09-30','2026-10-01'):
            self.insert(when)
        self.assertEqual(len(self.rows(self.export('current_month'))),16)
        self.assertEqual(len(self.rows(self.export('last_3_months'))),18)
        self.assertEqual(len(self.rows(self.export('all'))),20)
        self.assertEqual(self.export('invalid').status_code,400)
        self.assertEqual(period_bounds('last_3_months',date(2026,1,15)),('2025-11-01','2026-02-01'))

    def test_category_projection_and_raw_marker_suppression(self):
        self.db.execute('DELETE FROM expenses WHERE user_id=101')
        for category in ('Tagihan','Hiburan','Keuangan','Lainnya',None,'__needs_category_review__','__remaining__','Gaji'):
            self.insert('2026-09-01',category)
        response=self.export()
        self.assertEqual([r['analytics_category'] for r in self.rows(response)],
            ['Tagihan & Utilitas','Hiburan & Lifestyle','Keuangan & Cicilan','Lainnya','Lainnya',
             'Perlu ditinjau','Perlu ditinjau','Perlu ditinjau'])
        self.assertNotIn('__needs_category_review__',response.get_data(as_text=True))
        self.assertNotIn('__remaining__',response.get_data(as_text=True))

    def test_formula_injection_unicode_and_csv_escaping(self):
        self.db.execute('DELETE FROM expenses WHERE user_id=101')
        for text in ('=1+1','+SUM(A1)','-1+1','@SUM(A1)','  =1','\t=1'):
            self.insert('2026-09-01',category=text,description=text,note=text)
        self.insert('2026-09-01',description='Kopi café, "susu"',note='baris satu\nbaris dua')
        rows=self.rows(self.export())
        for row in rows[:-1]:
            for field in ('description','analytics_category','note'):
                self.assertTrue(row[field].startswith("'"))
        self.assertEqual(rows[-1]['description'],'Kopi café, "susu"')
        self.assertEqual(rows[-1]['note'],'baris satu\nbaris dua')

    def test_integer_and_fraction_failure_no_partial_download(self):
        self.insert('2026-09-01',amount=123.0)
        response=self.export()
        self.assertIn('123',[r['amount'] for r in self.rows(response)])
        self.insert('2026-09-02',amount=123.5)
        response=self.export()
        self.assertEqual(response.status_code,500)
        self.assertNotIn('Content-Disposition',response.headers)
        class Rows:
            def __init__(self,value):self.batch=[('2026-09-01','expense','item','Lainnya',value,None)]
            def fetchmany(self,_):batch,self.batch=self.batch,[];return batch
        self.assertIn(',100,',render_csv(Rows(Decimal('100.000')),api.integer_amount))
        with self.assertRaises(ValueError):
            render_csv(Rows(Decimal('100.01')),api.integer_amount)

    def test_empty_filename_utf8_and_no_mutation(self):
        self.db.execute('DELETE FROM expenses WHERE user_id=101');self.db.commit()
        before=list(self.db.iterdump())
        response=self.export()
        self.assertEqual(self.rows(response),[])
        self.assertEqual(response.get_data(as_text=True),'date,type,description,analytics_category,amount,note\r\n')
        self.assertEqual(response.headers['Content-Disposition'],'attachment; filename="dompi-export-2026-09-19.csv"')
        self.assertIn('charset=utf-8',response.headers['Content-Type'])
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(list(self.db.iterdump()),before)

    def test_pre_migration_legacy_pro(self):
        self.db.execute('ALTER TABLE users DROP COLUMN lifetime_plan')
        self.db.execute("UPDATE users SET plan='pro',pro_until='2099-01-01'");self.db.commit()
        self.assertEqual(self.export().status_code,200)
