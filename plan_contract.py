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

from dompi_core.entitlements import (
    CONTRACT_VERSION, Entitlement, Capabilities, _legacy,
    resolve_entitlement, resolve_capabilities,
)
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

def get_product(code):
    """Catalog lookup only: not checkout eligibility, an order, or activation.

    Future orders must snapshot price/version; never reprice historical orders
    with this catalog. Upgrade eligibility and payment fulfillment are out of scope.
    """
    return PRICING_CATALOG[code]
