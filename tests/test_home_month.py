import unittest
from test_dashboard_auth import DashboardAuthTests, signed

class HomeMonthTests(unittest.TestCase):
    setUp=DashboardAuthTests.setUp
    request=DashboardAuthTests.request
    def paid(self):
        self.db.execute("UPDATE users SET plan='pro',pro_until='2099-01-01' WHERE telegram_id=101")
        self.db.commit()
    def test_october_empty_no_september_fallback(self):
        self.paid()
        self.assertEqual(self.request('GET','/api/summary?month=2026-10',signed()).json,dict(income=0,expense=0,balance=0))
        for path in ('cashflow','categories'):
            r=self.request('GET',f'/api/{path}?month=2026-10',signed());self.assertEqual(r.status_code,200);self.assertEqual(r.json,[])
        self.assertEqual(self.request('GET','/api/summary?month=2026-09',signed()).json['expense'],10)
    def test_october_only_then_september_and_year_boundary(self):
        self.paid()
        self.db.execute("INSERT INTO expenses(user_id,transaction_id,category,analytics_category,amount,note,date,type,currency) VALUES(101,3,'Food','Food',25,'','2026-10-01','expense','IDR')");self.db.commit()
        self.assertEqual(self.request('GET','/api/summary?month=2026-10',signed()).json,dict(income=0,expense=25,balance=-25))
        cash=self.request('GET','/api/cashflow?month=2026-10',signed()).json
        self.assertEqual(cash,[dict(date='2026-10-01',income=0,expense=25)])
        cats=self.request('GET','/api/categories?month=2026-10',signed()).json
        self.assertEqual(sum(x['total'] for x in cats),25)
        self.assertEqual(self.request('GET','/api/summary?month=2026-09',signed()).json['expense'],10)
        for month in ('2026-12','2027-01'):
            self.assertEqual(self.request('GET','/api/summary?month='+month,signed()).json['expense'],0)
    def test_invalid_month_rejected_and_legacy_no_month_preserved(self):
        self.paid()
        for path in ('summary','cashflow','categories'):
            self.assertEqual(self.request('GET',f'/api/{path}?month=2026-13',signed()).status_code,400)
        self.assertEqual(self.request('GET','/api/summary',signed()).json['expense'],10)

    def test_recent_month_filter_before_limit(self):
        self.paid()
        for i in range(12):
            self.db.execute("INSERT INTO expenses(user_id,transaction_id,category,amount,date,type,currency) VALUES(101,?,'Food',1,'2026-10-01','expense','IDR')",(i+10,))
        self.db.commit()
        for month,count in [('2026-09',2),('2026-10',10),('2027-01',0)]:
            response=self.request('GET','/api/transactions?month='+month,signed())
            self.assertEqual(response.status_code,200)
            self.assertEqual(len(response.json),count)
            self.assertTrue(all(row['date'].startswith(month) for row in response.json))
