"""Targeted additive category-range contract checks; disposable fixtures only."""
import unittest
from urllib.parse import urlencode
import test_dashboard_auth as fixtures
from test_dashboard_auth import signed
from category_resolver import REVIEW_MARKER

class AnalyticsPeriodTests(unittest.TestCase):
    setUp = fixtures.DashboardAuthTests.setUp
    request = fixtures.DashboardAuthTests.request

    def test_range_owner_resolver_review_and_drill_match(self):
        self.db.executemany('INSERT INTO expenses (user_id,transaction_id,category,analytics_category,amount,note,date,type,currency) VALUES (?,?,?,?,?,?,?,?,?)',[
            (101,30,'July bill','Tagihan',30,'','2026-07-01','expense','IDR'),
            (101,31,'June bill','Tagihan',99,'','2026-06-30','expense','IDR'),
            (101,32,'August review',REVIEW_MARKER,20,'','2026-08-01','expense','IDR'),
            (101,33,'income review',REVIEW_MARKER,50,'','2026-09-01','income','IDR'),
            (202,30,'secret',REVIEW_MARKER,999,'','2026-08-01','expense','IDR')])
        self.db.commit()
        query='start=2026-07-01&end=2026-09-30&user_id=202'
        data=self.request('GET','/api/categories/breakdown?'+query,signed()).json
        self.assertEqual(data['total_expense'],60)  # existing 10 + 30 + review 20
        self.assertEqual(sum(i['total'] for i in data['categories']),60)
        self.assertIn('Tagihan & Utilitas',[i['category'] for i in data['categories']])
        review=self.request('GET','/api/categories/review?'+query,signed()).json
        self.assertEqual({r['type']:(r['count'],r['total']) for r in review['items']},{'expense':(1,20),'income':(1,50)})
        for kind in ('expense','income'):
            drill=self.request('GET','/api/categories/transactions?'+query+'&'+urlencode({'category':'Perlu ditinjau','type':kind,'review':'1'}),signed()).json
            self.assertEqual(len(drill['items']),1)
            self.assertEqual(drill['items'][0]['amount'],20 if kind=='expense' else 50)

    def test_invalid_filters_fail_before_database_and_auth(self):
        self.get_connection.reset_mock()
        for endpoint in ('breakdown','review'):
            for query in ('start=2026-02-30&end=2026-03-01','start=2026-10-01&end=2026-01-01','start=2026-01-01','month=2026-09&start=2026-01-01&end=2026-09-30','month=2026-13'):
                self.assertEqual(self.request('GET','/api/categories/'+endpoint+'?'+query,signed()).status_code,400)
            self.assertEqual(self.request('GET','/api/categories/'+endpoint+'?start=2026-01-01&end=2026-09-30').status_code,401)
        self.get_connection.assert_not_called()

    def test_legacy_month_and_all_time_unchanged(self):
        for endpoint in ('breakdown','review'):
            month=self.request('GET','/api/categories/'+endpoint+'?month=2026-09',signed())
            ranged=self.request('GET','/api/categories/'+endpoint+'?start=2026-09-01&end=2026-09-30',signed())
            all_time=self.request('GET','/api/categories/'+endpoint,signed())
            self.assertEqual(month.json,ranged.json)
            self.assertEqual(month.json,all_time.json)
