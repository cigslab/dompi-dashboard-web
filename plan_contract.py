"""Pure, opt-in plan contract v1. No DB, environment, clock, or provider access.

Status readers may use this contract; capability/payment enforcement is not wired.
Callers must supply the existing Free capability policy
and `now` in the same server-local, naive time convention as legacy pro_until.
Unresolved legacy records require reconciliation; never persist a downgrade or
infer lifetime from missing expiry. Date-only legacy expiry means midnight at
that date, matching the existing expiry comparison (now >= expiry).
"""
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType

CONTRACT_VERSION = '1'
PRICING_VERSION = '1'

@dataclass(frozen=True)
class Product:
    code: str
    amount: int
    target_lifetime: str
    required_lifetime: str | None = None
    currency: str = 'IDR'
    entitlement_kind: str = 'lifetime'

PRICING_CATALOG = MappingProxyType({
    'starter_lifetime': Product('starter_lifetime', 99000, 'starter'),
    'pro_lifetime': Product('pro_lifetime', 129000, 'pro'),
    'starter_to_pro_lifetime': Product('starter_to_pro_lifetime', 30000, 'pro', 'starter'),
})

@dataclass(frozen=True)
class Entitlement:
    effective: str | None
    lifetime: str | None
    legacy_status: str
    legacy_expires_at: datetime | None
    requires_review: bool
    contract_version: str = CONTRACT_VERSION

@dataclass(frozen=True)
class Capabilities:
    manual_recording: bool
    receipt: bool
    export: bool
    advanced_analytics: bool
    monthly_limit: int | None

    def __post_init__(self):
        for value in (self.manual_recording, self.receipt, self.export, self.advanced_analytics):
            if type(value) is not bool:
                raise ValueError('Capabilities must be explicit booleans')
        if self.monthly_limit is not None and (type(self.monthly_limit) is not int or self.monthly_limit < 0):
            raise ValueError('monthly_limit must be a nonnegative integer or None')


def _legacy(plan, expiry, now):
    if plan in (None, 'free'):
        return ('none', None) if expiry in (None, '') else ('ambiguous', None)
    if plan != 'pro':
        return 'ambiguous', None
    if not isinstance(expiry, str) or not expiry:
        return 'ambiguous', None
    parsed = None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            candidate = datetime.strptime(expiry, fmt)
            if candidate.strftime(fmt) == expiry:
                parsed = candidate
                break
        except ValueError:
            pass
    if parsed is None:
        return 'ambiguous', None
    return ('active' if now < parsed else 'expired'), parsed


def resolve_entitlement(*, lifetime=None, legacy_plan=None, pro_until=None, now):
    """Resolve explicit lifetime and independent legacy timed grant.

    lifetime is None/'starter'/'pro'. effective=None means unresolved, not Free.
    A proven lifetime grant remains the minimum entitlement even if legacy data
    is ambiguous; requires_review instructs callers not to assume absence of Pro.
    """
    if lifetime not in (None, 'starter', 'pro'):
        raise ValueError('Unknown lifetime entitlement')
    if not isinstance(now, datetime) or now.tzinfo is not None:
        raise ValueError('now must be explicit naive server-local datetime')
    status, expiry = _legacy(legacy_plan, pro_until, now)
    if lifetime == 'pro':
        effective = 'pro_lifetime'
    elif status == 'active':
        effective = 'pro_legacy_active'
    elif lifetime == 'starter':
        effective = 'starter_lifetime'
    elif status == 'ambiguous':
        effective = None
    else:
        effective = 'free'
    return Entitlement(effective, lifetime, status, expiry, status == 'ambiguous')


def resolve_capabilities(entitlement, *, free_policy):
    """Never infer Free policy or downgrade an ambiguous legacy entitlement.

    free_policy must describe existing deployed behavior; this module deliberately
    does not import config.py or assign new Free export/analytics restrictions.
    """
    if not isinstance(free_policy, Capabilities):
        raise ValueError('Explicit Free compatibility policy required')
    if entitlement.effective == 'pro_lifetime':
        return Capabilities(True, True, True, True, None)
    if entitlement.requires_review or entitlement.effective is None:
        raise ValueError('Legacy entitlement requires reconciliation')
    if entitlement.effective == 'pro_legacy_active':
        return Capabilities(True, True, True, True, None)
    if entitlement.effective == 'starter_lifetime':
        return Capabilities(True, False, False, False, 150)
    if entitlement.effective == 'free':
        return free_policy
    raise ValueError('Unknown effective entitlement')


def get_product(code):
    """Catalog lookup only: not checkout eligibility, an order, or activation.

    Future orders must snapshot price/version; never reprice historical orders
    with this catalog. Upgrade eligibility and payment fulfillment are out of scope.
    """
    return PRICING_CATALOG[code]
