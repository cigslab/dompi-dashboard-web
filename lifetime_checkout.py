"""Lifetime order creation only. No fulfillment, migration or provider at import."""
from datetime import datetime
import re
from entitlement_reader import read_entitlement, entitlement_status
from plan_contract import PRICING_CATALOG, PRICING_VERSION

FIELDS = {'product_code', 'pricing_version', 'entitlement_kind', 'target_plan'}
# Same allocator lock as bot database._lock_payment_creation.
ORDER_ALLOCATOR_LOCK = -601990129


class CheckoutError(ValueError):
    def __init__(self, code, status=409, payment_id=None):
        super().__init__(code)
        self.code, self.status, self.payment_id = code, status, payment_id


def available_products(entitlement):
    if entitlement is None:
        raise CheckoutError('account_missing', 404)
    if entitlement.lifetime == 'pro':
        return []
    if entitlement.requires_review:
        raise CheckoutError('entitlement_requires_review')
    if entitlement.lifetime == 'starter':
        return ['starter_to_pro_lifetime']
    return ['starter_lifetime', 'pro_lifetime']


def require_schema(cursor):
    # Metadata inspection avoids aborting pre-migration PostgreSQL transactions.
    for table, required in (('users', {'lifetime_plan'}), ('payments', FIELDS)):
        cursor.execute(f'SELECT * FROM {table} WHERE 1 = 0', ())
        if not required <= {col[0] for col in cursor.description}:
            raise CheckoutError('lifetime_schema_required', 503)


def offers(cursor, user_id, *, now):
    require_schema(cursor)
    entitlement = read_entitlement(cursor, user_id, now=now, dialect='postgresql')
    codes = available_products(entitlement)
    return dict(entitlement=entitlement_status(entitlement),
                lifetime_plan=entitlement.lifetime,
                products=[dict(product_code=code, amount=PRICING_CATALOG[code].amount,
                               pricing_version=PRICING_VERSION, currency='IDR')
                          for code in codes])


def reserve_order(connection, user_id, product_code, *, now=None):
    """Commit a complete snapshot before returning to the provider caller.

    Serialized with bot PAYnnn creation. Pending duplicates are never re-sent
    to Snap; uncertain provider outcomes require reconciliation, not new orders.
    """
    if not isinstance(product_code, str) or product_code not in PRICING_CATALOG:
        raise CheckoutError('invalid_product_code', 400)
    cursor = connection.cursor()
    try:
        require_schema(cursor)
        cursor.execute('SELECT pg_advisory_xact_lock(%s)', (ORDER_ALLOCATOR_LOCK,))
        cursor.execute('SELECT telegram_id FROM users WHERE telegram_id = %s FOR UPDATE', (user_id,))
        if cursor.fetchone() is None:
            raise CheckoutError('account_missing', 404)
        entitlement = read_entitlement(cursor, user_id, now=now or datetime.now(), dialect='postgresql')
        if product_code not in available_products(entitlement):
            raise CheckoutError('already_pro' if entitlement.lifetime == 'pro' else 'product_not_eligible')
        # No payment lock here: fulfillment locks payment then user. Taking a
        # payment lock after user here would invert that ordering.
        cursor.execute("""SELECT payment_id FROM payments WHERE telegram_id = %s
            AND product_code = %s AND status = 'pending' ORDER BY id LIMIT 1""",
            (user_id, product_code))
        pending = cursor.fetchone()
        if pending:
            raise CheckoutError('pending_order_exists', payment_id=pending[0])
        cursor.execute('SELECT payment_id FROM payments WHERE payment_id IS NOT NULL ORDER BY id DESC LIMIT 1', ())
        last = cursor.fetchone()
        if last and not re.fullmatch(r'PAY[0-9]+', last[0]):
            raise CheckoutError('order_id_requires_review', 503)
        payment_id = f"PAY{int(last[0][3:]) + 1 if last else 1:03d}"
        product = PRICING_CATALOG[product_code]
        cursor.execute('SELECT customer_id FROM users WHERE telegram_id = %s', (user_id,))
        customer_id = cursor.fetchone()[0]
        cursor.execute("""INSERT INTO payments
            (payment_id, customer_id, telegram_id, duration, amount, status, created_at,
             product_code, pricing_version, entitlement_kind, target_plan)
            VALUES (%s, %s, %s, 0, %s, 'pending', %s, %s, %s, 'lifetime', %s)""",
            (payment_id, customer_id, user_id, product.amount,
             (now or datetime.now()).strftime('%Y-%m-%d %H:%M:%S'),
             product.code, PRICING_VERSION, product.target_lifetime))
        # Read the persisted snapshot; provider parameters never come from client.
        cursor.execute('SELECT payment_id, amount, customer_id FROM payments WHERE payment_id = %s', (payment_id,))
        order_id, amount, customer_id = cursor.fetchone()
        connection.commit()
        return dict(payment_id=order_id, amount=amount, customer_id=customer_id)
    except BaseException:
        connection.rollback()
        raise
    finally:
        cursor.close()
