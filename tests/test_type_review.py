import sqlite3
import unittest
import test_dashboard_auth as auth
from test_dashboard_auth import signed
from type_review import fingerprint, needs_review, suspected_mismatch
from type_review_migration import migrate
from category_resolver import REVIEW_MARKER


class RuleTests(unittest.TestCase):
    def test_strong_conflicts_and_ambiguity(self):
        for word in ('gaji 5jt','salary','bonus','komisi','pemasukan'):
            self.assertTrue(needs_review('expense', word, None))
            self.assertFalse(needs_review('income', word, None))
        self.assertTrue(needs_review('income','bayar listrik',None))
        for text in ('ganti deskripsi', 'pengembalian gaji', 'bukan gaji', 'gaji untuk bayar listrik'):
            self.assertFalse(suspected_mismatch('expense',text,None))
        self.assertNotEqual(fingerprint('expense','gaji','a'),fingerprint('expense','gaji','b'))

    def test_additive_sqlite_migration_twice_no_rewrite(self):
        db=sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.execute('CREATE TABLE expenses(id INTEGER PRIMARY KEY, category TEXT)')
        db.execute("INSERT INTO expenses VALUES(1,'gaji')"); db.commit()
        migrate(db); migrate(db)
        self.assertEqual(db.execute('SELECT * FROM expenses').fetchall(),[(1,'gaji',None)])
        column=db.execute('PRAGMA table_info(expenses)').fetchall()[-1]
        self.assertEqual((column[1],column[3],column[4]),('type_review_confirmed_fingerprint',0,None))


class TypeReviewTests(unittest.TestCase):
    setUp = auth.DashboardAuthTests.setUp
    request = auth.DashboardAuthTests.request

    def mismatch(self):
        self.db.execute("UPDATE expenses SET category='gaji 5jt',note=NULL,analytics_category='Lainnya' WHERE user_id=101 AND transaction_id=1")
        self.db.commit()

    def listing(self):
        response=self.request('GET','/api/transactions/type-review?month=2026-09',signed())
        self.assertEqual(response.status_code,200)
        return response.json

    def confirm(self, fp=None, tid=1, credential=None):
        return self.request('POST',f'/api/transactions/{tid}/type-review/confirm',credential or signed(),json={'fingerprint':fp or self.listing()['items'][0]['fingerprint']})

    def test_confirm_reload_and_amount_date_keep_confirmation(self):
        self.mismatch(); self.assertEqual(self.listing()['count'],1)
        fp=self.listing()['items'][0]['fingerprint']
        self.assertEqual(self.confirm(fp).status_code,200)
        self.assertEqual(self.confirm(fp).status_code,200)  # idempotent retry
        self.assertEqual(self.listing()['count'],0)
        self.assertEqual(self.request('PATCH','/api/transactions/1',signed(),json={'amount':25,'date':'2026-09-20'}).status_code,200)
        self.assertEqual(self.listing()['count'],0)
        self.assertEqual(self.db.execute('SELECT type_review_confirmed_fingerprint FROM expenses WHERE user_id=101 AND transaction_id=1').fetchone()[0],fp)

    def test_semantic_edit_invalidates_and_type_correction(self):
        self.mismatch(); old=self.listing()['items'][0]['fingerprint']; self.confirm(old)
        for body in ({'note':'konteks baru'},{'category':'bonus 500k'}):
            self.assertEqual(self.request('PATCH','/api/transactions/1',signed(),json=body).status_code,200)
            self.assertEqual(self.listing()['count'],1)
            self.assertEqual(self.confirm().status_code,200)
        self.request('PATCH','/api/transactions/1',signed(),json={'type':'income'})
        self.assertEqual(self.listing()['count'],0)
        self.assertEqual(self.confirm(old).status_code,409)
        self.request('PATCH','/api/transactions/1',signed(),json={'type':'expense'})
        self.assertEqual(self.listing()['count'],1)

    def test_technical_marker_remains_and_normal_edits_not_review(self):
        self.mismatch()
        self.db.execute('UPDATE expenses SET analytics_category=? WHERE user_id=101 AND transaction_id=1',(REVIEW_MARKER,))
        self.assertEqual(self.confirm().status_code,200)
        self.assertEqual(self.listing()['count'],0)
        technical=self.request('GET','/api/categories/review?month=2026-09',signed()).json
        self.assertEqual(technical['items'][0]['count'],1)
        self.assertEqual(self.db.execute('SELECT analytics_category FROM expenses WHERE user_id=101 AND transaction_id=1').fetchone()[0],REVIEW_MARKER)
        self.request('PATCH','/api/transactions/1',signed(),json={'category':'kopi','note':'catatan biasa'})
        self.assertEqual(self.listing()['count'],0)

    def test_owner_auth_stale_and_period_pagination(self):
        self.mismatch(); fp=self.listing()['items'][0]['fingerprint']
        self.assertEqual(self.confirm(fp,9).status_code,404)
        for credential in (None,signed(age=999999),signed(token='invalid')):
            result=self.request('POST','/api/transactions/1/type-review/confirm',credential,json={'fingerprint':fp})
            self.assertEqual(result.status_code,401)
        self.assertEqual(self.request('GET','/api/transactions/1/type-review/confirm',signed()).status_code,405)
        self.assertEqual(self.request('POST','/api/transactions/1/type-review/confirm',signed(),json={'fingerprint':fp,'user_id':202}).status_code,400)
        self.request('PATCH','/api/transactions/1',signed(),json={'note':'changed'})
        self.assertEqual(self.confirm(fp).status_code,409)
        for i in range(30):
            self.db.execute("INSERT INTO expenses(user_id,transaction_id,category,amount,date,type,currency) VALUES(101,?,'gaji',1,'2026-09-01','expense','IDR')",(10+i,))
        self.assertEqual(len(self.listing()['items']),25)
        self.assertEqual(self.listing()['count'],31)
        page=self.request('GET','/api/transactions/type-review?month=2026-09&page=2',signed()).json
        self.assertEqual(len(page['items']),6);self.assertFalse(page['has_more'])
        self.assertEqual(self.request('GET','/api/transactions/type-review?month=2026-08',signed()).json['count'],0)
        self.assertEqual(self.request('GET','/api/transactions/type-review',signed(user_id=202)).json['count'],0)
