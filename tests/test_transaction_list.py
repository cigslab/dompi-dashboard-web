"""List filters/keyset pagination on disposable data; default recent contract preserved."""
import unittest
import test_dashboard_auth as fixture
from test_dashboard_auth import signed

class TransactionListTests(unittest.TestCase):
    setUp = fixture.DashboardAuthTests.setUp
    request = fixture.DashboardAuthTests.request

    def seed(self):
        self.db.execute('DELETE FROM expenses')
        for owner in (101, 202):
            self.db.executemany('INSERT INTO expenses (user_id,transaction_id,category,analytics_category,amount,note,date,type,currency) VALUES (?,?,?,?,?,?,?,?,?)', [
                (owner, i, 'kopi' if i % 2 else 'gaji', 'Lainnya', i * 1000, 'diskon 10%_!',
                 '2026-09-01' if i < 6 else '2026-10-01', 'expense' if i % 2 else 'income', 'IDR') for i in range(1, 34)])
        self.db.execute("INSERT INTO expenses(user_id,transaction_id,category,amount,date,type,currency) VALUES(101,99,'kopi',10,'2026-10-01','expense','USD')")
        self.db.commit()

    def get(self, query='', owner=101):
        return self.request('GET', '/api/transactions?view=list' + query, signed(user_id=owner))

    def test_complete_pagination_owner_currency_order_and_old_search(self):
        self.seed()
        ids=[]; cursor=''
        while True:
            result=self.get(cursor).json
            ids.extend(x['transaction_id'] for x in result['items'])
            self.assertTrue(all(x['currency']=='IDR' for x in result['items']))
            if not result['has_more']:
                self.assertIsNone(result['next_cursor']); break
            cursor='&cursor='+result['next_cursor']
        self.assertEqual(ids, list(range(33,0,-1)))
        self.assertEqual([x['transaction_id'] for x in self.get('&month=2026-09&type=expense&q=kopi').json['items']], [5,3,1])
        self.assertEqual(len(self.get(owner=202).json['items']),10)
        self.db.execute("UPDATE expenses SET category='other owner secret' WHERE user_id=202");self.db.commit()
        self.assertEqual(self.get('&q=secret&user_id=202').json['items'],[])

    def test_combined_range_literal_search_and_default_compatibility(self):
        self.seed()
        result=self.get('&month=2026-09&start=2026-09-01&end=2026-09-30&type=income&q=gaji').json
        self.assertEqual([x['transaction_id'] for x in result['items']],[4,2])
        self.assertEqual(self.get('&month=2026-09&start=2026-10-01&end=2026-10-01').json['items'],[])
        self.assertTrue(self.get('&q=10%25_!').json['items'])
        self.assertEqual(self.get('&q=10%25_missing').json['items'],[])
        self.assertEqual(self.get('&q=%27%20OR%201=1--').json['items'],[])
        self.assertEqual(len(self.request('GET','/api/transactions',signed()).json),10)
        self.assertEqual(len(self.request('GET','/api/transactions?month=2026-09',signed()).json),5)

    def test_invalid_filters_auth_and_active_filter_after_mutations(self):
        self.seed()
        for args in ('&month=2026-13','&type=bogus','&start=2026-09-01','&end=2026-09-01','&start=2026-02-30&end=2026-03-01','&start=2026-10-01&end=2026-09-01','&cursor=0','&cursor=-1','&cursor=abc','&cursor=999999999999999999999','&q='+'a'*201):
            self.assertEqual(self.get(args).status_code,400,args)
        self.assertEqual(self.get('&currency=USD').status_code,400)
        self.assertEqual(self.request('GET','/api/transactions?view=list').status_code,401)
        active='&month=2026-09&type=expense&q=kopi'
        self.assertEqual(self.request('PATCH','/api/transactions/5',signed(),json={'category':'teh'}).status_code,200)
        self.assertEqual([x['transaction_id'] for x in self.get(active).json['items']],[3,1])
        self.assertEqual(self.request('DELETE','/api/transactions/3',signed()).status_code,200)
        self.assertEqual([x['transaction_id'] for x in self.get(active).json['items']],[1])
        self.assertEqual([x['transaction_id'] for x in self.get(active,202).json['items']],[5,3,1])

    def test_cursor_stable_when_new_row_inserted_and_prior_row_deleted(self):
        self.seed()
        first=self.get().json
        self.db.execute("INSERT INTO expenses(user_id,transaction_id,category,amount,date,type,currency) VALUES(101,100,'new',10,'2026-10-01','expense','IDR')")
        self.db.execute('DELETE FROM expenses WHERE user_id=101 AND transaction_id=33');self.db.commit()
        next_page=self.get('&cursor='+first['next_cursor']).json
        self.assertEqual([x['transaction_id'] for x in next_page['items']],list(range(23,13,-1)))
