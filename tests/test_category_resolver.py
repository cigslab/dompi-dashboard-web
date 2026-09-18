import unittest
from urllib.parse import urlencode
import test_dashboard_auth as auth
from test_dashboard_auth import signed
from category_resolver import resolve_category

class CategoryTests(unittest.TestCase):
    setUp = auth.DashboardAuthTests.setUp
    request = auth.DashboardAuthTests.request

    def seed(self):
        self.db.executemany('INSERT INTO expenses (user_id,transaction_id,category,analytics_category,amount,note,date,type,currency) VALUES (?,?,?,?,?,?,?,?,?)', [
            (101, i+10, '<img src=x onerror=alert(1)>', 'Tagihan' if i%2 else 'Tagihan & Utilitas', 10, '<script>bad</script>', '2026-09-15', 'expense','IDR') for i in range(30)] + [
            (202,99,'secret','Tagihan',999,'secret','2026-09-15','expense','IDR'),
            (101,99,'old','Tagihan',50,'','2026-08-15','expense','IDR'),
            (101,100,'other','Lainnya',5,'','2026-09-15','expense','IDR'),
            (101,101,'income','Tagihan',60,'','2026-09-15','income','IDR')])
        self.db.commit()

    def test_mapping(self):
        for old,new in [('Tagihan','Tagihan & Utilitas'),('Hiburan','Hiburan & Lifestyle'),('Keuangan','Keuangan & Cicilan'),('Lainnya','Lainnya'),('Food','Food'),('Makan & Minum','Makan & Minum')]:
            self.assertEqual(resolve_category(old,'expense'),new)
            self.assertEqual(resolve_category(new,'expense'),new)
        self.assertEqual(resolve_category('Tagihan','income'),'Tagihan')

    def test_aggregates_and_no_rewrite(self):
        self.seed()
        data=self.request('GET','/api/categories/breakdown?month=2026-09',signed()).json
        self.assertEqual(data['total_expense'],315)
        self.assertEqual(next(c for c in data['categories'] if c['category']=='Tagihan & Utilitas')['total'],300)
        overview=self.request('GET','/api/categories',signed()).json
        self.assertEqual(sum(c['total'] for c in overview),365)
        report=self.request('GET','/api/reports?period=custom&start=2026-09-01&end=2026-09-30',signed()).json
        self.assertEqual(report['expense'],315)
        self.assertEqual(sum(c['total'] for c in report['categories']),315)
        self.assertEqual(len([c for c in report['categories'] if c['category']=='Tagihan & Utilitas']),1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM expenses WHERE analytics_category='Tagihan'").fetchone()[0],18)

    def test_drilldown_pagination_owner_period(self):
        self.seed()
        query=urlencode({'category':'Tagihan & Utilitas','type':'expense','month':'2026-09','user_id':202})
        path='/api/categories/transactions?'+query
        first=self.request('GET',path,signed()).json
        second=self.request('GET',path+'&page=2',signed()).json
        self.assertEqual(len(first['items']),25)
        self.assertTrue(first['has_more'])
        self.assertEqual(len(second['items']),5)
        self.assertFalse(second['has_more'])
        self.assertEqual(sum(i['amount'] for i in first['items']+second['items']),300)
        self.assertEqual(len({i['transaction_id'] for i in first['items']+second['items']}),30)
        self.assertEqual(self.request('GET',path,signed(202)).json['items'][0]['description'],'secret')
        for auth in [None,signed(age=999999),signed(token='bad')]:
            self.assertEqual(self.request('GET',path,auth).status_code,401)
        ranged='/api/categories/transactions?'+urlencode({'category':'Tagihan & Utilitas','type':'expense','start':'2026-08-01','end':'2026-08-31'})
        self.assertEqual(self.request('GET',ranged,signed()).json['items'][0]['description'],'old')
        income='/api/categories/transactions?'+urlencode({'category':'Tagihan','type':'income','month':'2026-09'})
        self.assertEqual(len(self.request('GET',income,signed()).json['items']),1)
        for extra in ['&page=0','&month=bad','&type=transfer','&start=bad']:
            # Replace existing values rather than append duplicate arguments.
            values={'category':'Tagihan','type':'expense','month':'2026-09'}
            k,v=extra[1:].split('='); values[k]=v
            self.assertEqual(self.request('GET','/api/categories/transactions?'+urlencode(values),signed()).status_code,400)

    def test_semantic_other_remains_real_category(self):
        self.seed()
        self.db.execute("INSERT INTO expenses (user_id,transaction_id,category,amount,date,type,currency) VALUES (101,120,'missing',7,'2026-09-15','expense','IDR')")
        self.db.commit()
        data=self.request('GET','/api/categories/breakdown?month=2026-09',signed()).json
        other=next(c for c in data['categories'] if c['category']=='Lainnya')
        self.assertEqual(other['total'],12)
        self.assertEqual(other['transaction_count'],2)
        self.assertNotIn('Kategori lain',[c['category'] for c in data['categories']])
        path='/api/categories/transactions?'+urlencode({'category':'Lainnya','type':'expense','month':'2026-09'})
        items=self.request('GET',path,signed()).json['items']
        self.assertEqual(sum(i['amount'] for i in items),12)
