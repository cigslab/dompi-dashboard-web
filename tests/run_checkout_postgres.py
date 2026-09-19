"""Phase 6B only: disposable PostgreSQL create-order races, no provider or app startup."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
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
from lifetime_checkout import reserve_order, CheckoutError, ORDER_ALLOCATOR_LOCK


class CheckoutPostgresTests(unittest.TestCase):
    connect = None

    def setUp(self):
        self.db = self.connect()
        self.addCleanup(self.db.close)
        self.db.autocommit = True
        self.sql("""DROP TABLE IF EXISTS payments, users;
            CREATE TABLE users(telegram_id BIGINT PRIMARY KEY, customer_id TEXT,
                plan TEXT, pro_until TEXT, lifetime_plan TEXT);
            CREATE TABLE payments(id BIGSERIAL PRIMARY KEY, payment_id TEXT UNIQUE,
                customer_id TEXT, telegram_id BIGINT, duration INTEGER, amount BIGINT,
                status TEXT, created_at TEXT, paid_at TEXT, product_code TEXT,
                pricing_version TEXT, entitlement_kind TEXT, target_plan TEXT);
            INSERT INTO users VALUES(101,'C1','free',NULL,NULL),(202,'C2','free',NULL,NULL);""")

    def sql(self, query, params=()):
        with self.db.cursor() as c:
            c.execute(query, params)
            return c.fetchall() if c.description else None

    def create(self, user=101, code='pro_lifetime', pids=None):
        conn=self.connect()
        if pids is not None:
            pids.append(conn.get_backend_pid())
        try:
            return reserve_order(conn, user, code, now=datetime(2026,9,19))
        except CheckoutError as error:
            return error.code
        finally:
            conn.close()

    def blocked(self, holder, pids):
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            if pids:
                evidence=self.sql('SELECT pg_blocking_pids(%s)',(pids[0],))[0][0]
                if holder in evidence:
                    print('Verified PostgreSQL blocking:',pids[0],'<-',evidence,flush=True)
                    return
            time.sleep(.02)
        self.fail('Expected real PostgreSQL blocking')

    def test_same_user_product_concurrent_only_one_pending(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.create(),range(2)))
        self.assertEqual(sum(isinstance(r,dict) for r in results),1)
        self.assertIn('pending_order_exists',results)
        self.assertEqual(self.sql('SELECT amount,status,product_code FROM payments'),
                         [(129000,'pending','pro_lifetime')])

    def test_allocator_coordinates_with_legacy_lock_and_preserves_snapshot(self):
        self.sql("""INSERT INTO payments(payment_id,telegram_id,duration,amount,status)
                    VALUES('PAY042',202,365,79000,'pending')""")
        holder=self.connect();self.addCleanup(holder.close)
        with holder.cursor() as c:
            c.execute('SELECT pg_advisory_xact_lock(%s)',(ORDER_ALLOCATOR_LOCK,))
        pids=[]
        with ThreadPoolExecutor(max_workers=1) as pool:
            task=pool.submit(self.create,101,'starter_lifetime',pids)
            try:self.blocked(holder.get_backend_pid(),pids)
            finally:holder.commit()
            self.assertEqual(task.result(timeout=10)['payment_id'],'PAY043')
        self.assertEqual(self.sql("SELECT amount,duration,product_code FROM payments WHERE payment_id='PAY042'"),
                         [(79000,365,None)])
        self.assertEqual(self.sql("SELECT amount,duration,product_code,pricing_version,target_plan,entitlement_kind FROM payments WHERE payment_id='PAY043'"),
                         [(99000,0,'starter_lifetime','1','starter','lifetime')])

    def test_entitlement_race_rechecked_after_user_lock(self):
        holder=self.connect();self.addCleanup(holder.close)
        with holder.cursor() as c:
            c.execute("UPDATE users SET lifetime_plan='pro' WHERE telegram_id=101")
        pids=[]
        with ThreadPoolExecutor(max_workers=1) as pool:
            task=pool.submit(self.create,101,'pro_lifetime',pids)
            try:self.blocked(holder.get_backend_pid(),pids)
            finally:holder.commit()
            self.assertEqual(task.result(timeout=10),'already_pro')
        self.assertEqual(self.sql('SELECT COUNT(*) FROM payments'),[(0,)])

    def test_different_users_unique_ids_and_rollback(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda user:self.create(user),[101,202]))
        self.assertEqual(len({r['payment_id'] for r in results}),2)
        self.sql("""CREATE OR REPLACE FUNCTION fail_order() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture rollback'; END $$;
            CREATE TRIGGER fail_insert BEFORE INSERT ON payments
                FOR EACH ROW EXECUTE FUNCTION fail_order();""")
        with self.assertRaises(Exception):
            self.create(101,'starter_lifetime')
        self.assertEqual(self.sql('SELECT COUNT(*) FROM payments'),[(2,)])
        self.assertEqual(self.sql('SELECT lifetime_plan FROM users'),[(None,),(None,)])


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
    env=dict(os.environ)
    root=Path(tempfile.mkdtemp(prefix='dompi-checkout-test-',dir='/tmp'))
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
        run(args.pg_bin/'pg_ctl','-D',data,'-l',log,'-o',f"-k {sock} -p 55448 -c listen_addresses=''",'-w','start')
        started=True
        CheckoutPostgresTests.connect=staticmethod(lambda:psycopg2.connect(
            host=str(sock),port=55448,user='dompi_test',dbname='postgres',connect_timeout=5,
            options='-c statement_timeout=10000 -c lock_timeout=5000'))
        result=unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(CheckoutPostgresTests))
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
