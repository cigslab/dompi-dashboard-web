"""Explicit, additive migration. Never connects or migrates on import."""
import sqlite3

COLUMN = 'type_review_confirmed_fingerprint'


def migrate(conn):
    """Caller supplies a dedicated connection. Atomic, nullable, no backfill/default."""
    cursor = conn.cursor()
    try:
        if isinstance(conn, sqlite3.Connection):
            cursor.execute('BEGIN')
            cursor.execute('PRAGMA table_info(expenses)')
            if COLUMN not in {row[1] for row in cursor.fetchall()}:
                cursor.execute(f'ALTER TABLE expenses ADD COLUMN {COLUMN} TEXT')
        else:
            cursor.execute(f'ALTER TABLE expenses ADD COLUMN IF NOT EXISTS {COLUMN} TEXT')
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--sqlite')
    group.add_argument('--pg-service', help='Explicit libpq service; never reads DATABASE_URL')
    args = parser.parse_args()
    if args.sqlite:
        conn = sqlite3.connect(args.sqlite)
    else:
        import psycopg2
        conn = psycopg2.connect(service=args.pg_service)
    try:
        migrate(conn)
        print('Additive type review migration complete; no backfill.')
    finally:
        conn.close()
