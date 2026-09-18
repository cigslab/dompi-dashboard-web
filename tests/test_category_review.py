import unittest
from urllib.parse import urlencode
import test_dashboard_auth as auth
from test_dashboard_auth import signed
from category_resolver import REVIEW_MARKER

class ReviewTests(unittest.TestCase):
    setUp=auth.DashboardAuthTests.setUp
    request=auth.DashboardAuthTests.request

    def test_marker_only_owner_and_period(self):
        self.db.executemany('INSERT INTO expenses (user_id,transaction_id,category,analytics_category,amount,note,date,type,currency) VALUES (?,?,?,?,?,?,?,?,?)',[
            (101,10,'review',REVIEW_MARKER,20,'note','2026-09-10','expense','IDR'),
            (202,10,'secret',REVIEW_MARKER,999,'secret','2026-09-10','expense','IDR'),
            (101,11,'old',REVIEW_MARKER,40,'note','2026-08-10','expense','IDR'),
            (101,12,'wrong type','Gaji',50,'note','2026-09-10','expense','IDR'),
            (101,13,'real other','Lainnya',60,'note','2026-09-10','expense','IDR')])
        self.db.commit()
        summary=self.request('GET','/api/categories/review?month=2026-09&user_id=202',signed())
        self.assertEqual(summary.json,{'items':[{'type':'expense','count':1,'total':20}]})
        path='/api/categories/transactions?'+urlencode({'category':'Perlu ditinjau','type':'expense','month':'2026-09','review':'1','user_id':202})
        result=self.request('GET',path,signed())
        self.assertEqual([r['description'] for r in result.json['items']],['review'])
        self.assertNotIn(REVIEW_MARKER,result.get_data(as_text=True))
        other='/api/categories/transactions?'+urlencode({'category':'Lainnya','type':'expense','month':'2026-09'})
        self.assertEqual(self.request('GET',other,signed()).json['items'][0]['description'],'real other')
        for credential in [None,signed(age=999999),signed(token='bad')]:
            self.assertEqual(self.request('GET','/api/categories/review',credential).status_code,401)
