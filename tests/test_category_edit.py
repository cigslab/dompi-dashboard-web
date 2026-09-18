import unittest
import test_dashboard_auth as auth
from test_dashboard_auth import signed
from category_resolver import REVIEW_MARKER, REVIEW_LABEL, resolve_category

class EditCategoryTests(unittest.TestCase):
    setUp = auth.DashboardAuthTests.setUp
    request = auth.DashboardAuthTests.request

    def row(self, owner=101):
        return self.db.execute('SELECT category, amount, note, type, date, analytics_category FROM expenses WHERE user_id=? AND transaction_id=1',(owner,)).fetchone()

    def test_amount_date_preserve(self):
        self.db.execute("UPDATE expenses SET analytics_category='Tagihan' WHERE user_id=101 AND transaction_id=1")
        for body in [{'amount':20},{'date':'2026-09-18'}, {'category':'A expense','note':'A','type':'expense','amount':30}]:
            self.assertEqual(self.request('PATCH','/api/transactions/1',signed(),json=body).status_code,200)
            self.assertEqual(self.row()[5],'Tagihan')
        self.assertEqual(self.row()[4],'2026-09-18')
        data=self.request('GET','/api/categories',signed()).json
        self.assertEqual(data,[{'category':'Tagihan & Utilitas','total':30}])

    def test_semantic_changes(self):
        for body in [{'category':'ganti deskripsi'}, {'note':'ganti catatan'}, {'type':'income'}]:
            self.db.execute("UPDATE expenses SET analytics_category='Makan & Minum' WHERE user_id=101 AND transaction_id=1")
            self.assertEqual(self.request('PATCH','/api/transactions/1',signed(),json=body).status_code,200)
            self.assertEqual(self.row()[5],REVIEW_MARKER)
            self.assertEqual(self.row()[1],10)
            self.assertEqual(resolve_category(self.row()[5],self.row()[3]),REVIEW_LABEL)
        self.assertEqual(self.request('PATCH','/api/transactions/1',signed(),json={'type':'expense'}).status_code,200)
        self.assertEqual(self.row()[5],REVIEW_MARKER)
        self.assertEqual(self.request('GET','/api/categories',signed()).json,[{'category':REVIEW_LABEL,'total':10}])

    def test_owner_auth_and_validation(self):
        before=self.row(202)
        self.assertEqual(self.request('PATCH','/api/transactions/9',signed(),json={'note':'attack','user_id':202}).status_code,404)
        self.assertEqual(self.request('PATCH','/api/transactions/1?user_id=202',signed(),json={'note':'own'}).status_code,200)
        self.assertEqual(self.row(202),before)
        for body in [{'type':'transfer'},{'date':'2026-02-30'},{'amount':1.5},{'category':[]},{}]:
            self.assertEqual(self.request('PATCH','/api/transactions/1',signed(),json=body).status_code,400)
        for credential in [None,signed(age=999999),signed(token='bad')]:
            self.assertEqual(self.request('PATCH','/api/transactions/1',credential,json={'type':'income'}).status_code,401)

    def test_wrong_type_read_only_projection(self):
        self.db.execute("UPDATE expenses SET analytics_category='Gaji' WHERE user_id=101 AND transaction_id=1")
        self.assertEqual(self.request('GET','/api/categories',signed()).json,[{'category':REVIEW_LABEL,'total':10}])
        self.assertEqual(self.row()[5],'Gaji')
        self.assertEqual(resolve_category('Tagihan','income'),REVIEW_LABEL)
        self.assertEqual(resolve_category('Lainnya','income'),'Lainnya')
