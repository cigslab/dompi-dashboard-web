"""Run standalone dashboard tests against an automatically stopped temporary PostgreSQL cluster."""
import os
import sys
from pathlib import Path
import subprocess
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def main():
    binary=Path('/opt/homebrew/opt/postgresql@18/bin')
    root=Path(tempfile.mkdtemp(prefix='dompi-dashboard-test-',dir='/tmp'))
    data=root/'data';sock=root/'socket';sock.mkdir(mode=0o700)
    clean_env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k not in {'DATABASE_URL','DOMPI_DASHBOARD_TEST_DSN'}}
    started=False
    def run(*args): subprocess.run([str(x) for x in args],env=clean_env,check=True)
    old=os.environ.get('DOMPI_DASHBOARD_TEST_DSN')
    try:
        print('TEST ONLY CLUSTER:',root,flush=True)
        run(binary/'initdb','-D',data,'-U','dompi_test','--auth=trust','--no-locale','--encoding=UTF8')
        run(binary/'pg_ctl','-D',data,'-l',root/'server.log','-o',f"-k {sock} -p 55446 -c listen_addresses=''",'-w','start')
        started=True
        os.environ['DOMPI_DASHBOARD_TEST_DSN']=f'host={sock} port=55446 user=dompi_test dbname=postgres'
        suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern='test_dashboard_auth.py')
        result=unittest.TextTestRunner(verbosity=2).run(suite)
        if not result.wasSuccessful(): raise SystemExit(1)
        print('ALL DASHBOARD POSTGRES TESTS PASSED',flush=True)
    finally:
        if old is None: os.environ.pop('DOMPI_DASHBOARD_TEST_DSN',None)
        else: os.environ['DOMPI_DASHBOARD_TEST_DSN']=old
        if started or (data/'postmaster.pid').exists():
            run(binary/'pg_ctl','-D',data,'-m','fast','-w','stop')
        assert not (data/'postmaster.pid').exists()
        print('TEST SERVER STOPPED / NOT RUNNING:',root,flush=True)


if __name__=='__main__': main()
