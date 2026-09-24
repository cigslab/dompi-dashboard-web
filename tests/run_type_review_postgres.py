"""Disposable PostgreSQL migration + confirmation races. No production URL or provider."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
import argparse
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from type_review_migration import migrate
from type_review import fingerprint


class TypeReviewPostgresTests(unittest.TestCase):
    connect = None

    def setUp(self):
        self.db = self.connect()
        self.addCleanup(self.db.close)
        self.db.autocommit = True
        with self.db.cursor() as c:
            c.execute("""DROP TABLE IF EXISTS expenses;
                CREATE TABLE expenses(id BIGSERIAL PRIMARY KEY, user_id BIGINT,
                    transaction_id INTEGER, category TEXT, note TEXT, type TEXT,
                    date TEXT, amount BIGINT, currency TEXT, analytics_category TEXT);
                INSERT INTO expenses(user_id,transaction_id,category,note,type,date,amount,currency,analytics_category)
                VALUES(101,1,'gaji',NULL,'expense','2026-09-01',5000,'IDR','__needs_category_review__'),
                      (202,9,'gaji',NULL,'expense','2026-09-01',9000,'IDR','Lainnya');""")
        self.pids=[]
        def connect():
            conn=self.connect(); self.pids.append(conn.get_backend_pid()); return conn
        self.patch=patch.object(auth.api,'get_connection',side_effect=connect)
        self.patch.start();self.addCleanup(self.patch.stop)
        clock=patch.object(auth.api.time,'time',return_value=auth.NOW)
        clock.start();self.addCleanup(clock.stop)

    def migration(self):
        conn=self.connect()
        try:migrate(conn)
        finally:conn.close()

    def sql(self, query, params=()):
        with self.db.cursor() as c:
            c.execute(query,params)
            return c.fetchall() if c.description else None

    def request(self, method, path, body=None):
        with auth.api.app.test_client() as client:
            return client.open(path,method=method,json=body,headers={'Authorization':'tma '+auth.signed()})

    def confirm(self):
        return self.request('POST','/api/transactions/1/type-review/confirm',{'fingerprint':fingerprint('expense','gaji',None)})

    def test_migration_twice_preserves_every_existing_value(self):
        before=self.sql('SELECT * FROM expenses ORDER BY id')
        self.migration(); self.migration()
        after=self.sql('SELECT * FROM expenses ORDER BY id')
        self.assertEqual([row[:-1] for row in after],before)
        self.assertEqual([row[-1] for row in after],[None,None])
        self.assertEqual(self.sql("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='expenses' AND column_name='type_review_confirmed_fingerprint'"),[('text','YES',None)])

    def test_persistence_owner_and_technical_marker_separation(self):
        self.migration()
        self.assertEqual(self.confirm().status_code,200)
        self.assertEqual(self.confirm().status_code,200)
        self.assertEqual(self.request('GET','/api/transactions/type-review').json['count'],0)
        self.assertEqual(self.request('GET','/api/categories/review').json['items'][0]['count'],1)
        self.assertEqual(self.request('POST','/api/transactions/9/type-review/confirm',{'fingerprint':fingerprint('expense','gaji',None)}).status_code,404)
        self.assertEqual(self.sql('SELECT type_review_confirmed_fingerprint FROM expenses WHERE user_id=202'),[(None,)])
        self.assertEqual(self.request('PATCH','/api/transactions/1',{'amount':6000,'date':'2026-09-02'}).status_code,200)
        self.assertEqual(self.request('GET','/api/transactions/type-review').json['count'],0)
        self.assertEqual(self.request('PATCH','/api/transactions/1',{'note':'new'}).status_code,200)
        self.assertEqual(self.request('GET','/api/transactions/type-review').json['count'],1)

    def test_concurrent_semantic_edit_rejects_stale_confirmation(self):
        self.migration()
        holder=self.connect(); self.addCleanup(holder.close)
        with holder.cursor() as c:
            c.execute("UPDATE expenses SET category='bonus' WHERE user_id=101")
        with ThreadPoolExecutor(max_workers=1) as pool:
            task=pool.submit(self.confirm)
            try:
                deadline=time.monotonic()+3
                blocked=False
                while time.monotonic()<deadline:
                    if self.pids and holder.get_backend_pid() in self.sql('SELECT pg_blocking_pids(%s)',(self.pids[-1],))[0][0]:
                        blocked=True;break
                    time.sleep(.02)
                self.assertTrue(blocked,'CAS must wait for the concurrent row mutation')
                print('Verified PostgreSQL row lock blocking before CAS recheck.',flush=True)
            finally:holder.commit()
            self.assertEqual(task.result(timeout=10).status_code,409)
        self.assertEqual(self.sql('SELECT category,type_review_confirmed_fingerprint FROM expenses WHERE user_id=101'),[('bonus',None)])

    def test_concurrent_confirmations_idempotent(self):
        self.migration()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.confirm().status_code,range(2)))
        self.assertEqual(results,[200,200])
        self.assertEqual(self.sql('SELECT analytics_category,type_review_confirmed_fingerprint FROM expenses WHERE user_id=101'),[('__needs_category_review__',fingerprint('expense','gaji',None))])

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin',type=Path,default=Path('/opt/homebrew/opt/postgresql@18/bin'))
    args=parser.parse_args()
    for binary in ('initdb','pg_ctl'):
        if not (args.pg_bin/binary).is_file():
            parser.error('Specify --pg-bin "$(brew --prefix postgresql@18)/bin"')
    # Never load .env or pass production libpq settings to any process/connection.
    for key in tuple(os.environ):
        if key.startswith('PG') or key in ('DATABASE_URL','DOMPI_DASHBOARD_TEST_DSN'):
            os.environ.pop(key,None)
    import psycopg2
    global auth
    import test_dashboard_auth as auth
    env=dict(os.environ)
    root=Path(tempfile.mkdtemp(prefix='dompi-type-review-test-',dir='/tmp'))
    data=root/'data';sock=root/'socket';sock.mkdir(mode=0o700)
    log=root/'postgres.log';started=False;handlers={}
    def run(*args):
        subprocess.run([str(a) for a in args],env=env,check=True,timeout=60,stdout=subprocess.DEVNULL)
    def interrupt(*_):
        raise KeyboardInterrupt
    try:
        for sig in (signal.SIGINT,signal.SIGTERM):
            handlers[sig]=signal.signal(sig,interrupt)
        print('Disposable cluster:',root,flush=True)
        run(args.pg_bin/'initdb','-D',data,'-U','dompi_test','--auth=trust','--no-locale','--encoding=UTF8')
        run(args.pg_bin/'pg_ctl','-D',data,'-l',log,'-o',f"-k {sock} -p 55449 -c listen_addresses=''",'-w','start')
        started=True
        TypeReviewPostgresTests.connect=staticmethod(lambda:psycopg2.connect(
            host=str(sock),port=55449,user='dompi_test',dbname='postgres',connect_timeout=5,
            options='-c statement_timeout=10000 -c lock_timeout=5000'))
        result=unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(TypeReviewPostgresTests))
        return 0 if result.wasSuccessful() else 1
    finally:
        for sig in handlers:signal.signal(sig,signal.SIG_IGN)
        try:
            if started or (data/'postmaster.pid').exists():
                try:run(args.pg_bin/'pg_ctl','-D',data,'-m','fast','-w','stop')
                except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
                    run(args.pg_bin/'pg_ctl','-D',data,'-m','immediate','-w','stop')
            if (data/'postmaster.pid').exists():
                raise RuntimeError(f'Cleanup incomplete: {root}')
            shutil.rmtree(root)
            print('Temporary server stopped / not running; cluster removed.',flush=True)
        finally:
            for sig,handler in handlers.items():signal.signal(sig,handler)


if __name__=='__main__':
    sys.exit(main())
