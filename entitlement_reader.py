"""Read-only adapters, explicitly passed cursors. Status-only production integration; never enforce access or mutate data."""
from dataclasses import dataclass
from plan_contract import resolve_entitlement


def entitlement_from_row(row, *, now):
    """Mapping input; absent lifetime key supports pre-migration snapshots."""
    return resolve_entitlement(lifetime=row.get('lifetime_plan'),
        legacy_plan=row.get('plan'), pro_until=row.get('pro_until'), now=now)


def read_entitlement(cursor, telegram_id, *, now, dialect):
    placeholder = _placeholder(dialect)
    # Inspect result metadata without selecting private fields or triggering a
    # missing-column error (which would abort a PostgreSQL transaction).
    cursor.execute('SELECT * FROM users WHERE 1 = 0', ())
    available = {column[0] for column in cursor.description}
    fields = ['plan', 'pro_until']
    if 'lifetime_plan' in available:
        fields.append('lifetime_plan')
    cursor.execute(f"SELECT {', '.join(fields)} FROM users WHERE telegram_id = {placeholder}", (telegram_id,))
    row = cursor.fetchone()
    return None if row is None else entitlement_from_row(dict(zip(fields, row)), now=now)


def entitlement_status(entitlement):
    """JSON-safe observation only. Unresolved is null, never an inferred Free.

    lifetime means an explicit underlying lifetime grant exists; a Starter grant
    may coexist with effective timed Pro. source describes the effective grant.
    """
    if entitlement is None:
        return None
    plans = {'free': ('free', 'free'),
             'starter_lifetime': ('starter', 'starter_lifetime'),
             'pro_legacy_active': ('pro', 'pro_legacy'),
             'pro_lifetime': ('pro', 'pro_lifetime')}
    plan, source = plans.get(entitlement.effective, (None, None))
    return {'effective_plan': plan, 'entitlement_source': source,
            'legacy_expires_at': entitlement.legacy_expires_at.isoformat() if entitlement.legacy_expires_at else None,
            'lifetime': entitlement.lifetime is not None,
            'requires_review': entitlement.requires_review}



def _placeholder(dialect):
    if dialect not in ('sqlite','postgresql'):
        raise ValueError('Explicit dialect required')
    return '?' if dialect == 'sqlite' else '%s'


def audit_legacy(cursor, *, now):
    """Yield IDs/reasons only; no repairs or extra personal data. Post-migration."""
    cursor.execute('SELECT telegram_id, plan, pro_until, lifetime_plan FROM users ORDER BY telegram_id')
    while True:
        rows = cursor.fetchmany(500)
        if not rows:
            break
        for user_id, plan, expiry, lifetime in rows:
            try:
                value = entitlement_from_row({'plan':plan,'pro_until':expiry,'lifetime_plan':lifetime},now=now)
            except ValueError:
                yield {'telegram_id':user_id,'reason':'invalid_lifetime'}
                continue
            if value.requires_review:
                yield {'telegram_id':user_id,'reason':'ambiguous_legacy'}


@dataclass(frozen=True)
class PaymentSnapshot:
    payment_id: str
    amount: int
    duration: int
    product_code: str | None
    pricing_version: str | None
    entitlement_kind: str | None
    target_plan: str | None
    interpretation: str
    requires_review: bool


def payment_from_row(row):
    names = ('product_code','pricing_version','entitlement_kind','target_plan')
    metadata = tuple(row.get(name) for name in names)
    if all(value is None for value in metadata):
        # Preserve old amount/duration exactly; never look up current catalog.
        interpretation = 'legacy_timed_pro'
        review = type(row['duration']) is not int or row['duration'] <= 0
    else:
        interpretation = 'snapshot'
        review = (not all(isinstance(v,str) and v for v in metadata)
                  or row.get('entitlement_kind') not in ('timed','lifetime')
                  or row.get('target_plan') not in ('starter','pro'))
    review = review or type(row['amount']) is not int or row['amount'] <= 0
    return PaymentSnapshot(row['payment_id'], row['amount'], row['duration'],
                           *metadata, interpretation, review)


def read_payment_snapshot(cursor, payment_id, *, dialect):
    fields = ('payment_id','amount','duration','product_code','pricing_version','entitlement_kind','target_plan')
    cursor.execute(f"SELECT {', '.join(fields)} FROM payments WHERE payment_id = {_placeholder(dialect)}",(payment_id,))
    row = cursor.fetchone()
    return None if row is None else payment_from_row(dict(zip(fields,row)))
