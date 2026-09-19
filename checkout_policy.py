"""Fail-closed lifetime rollout policy. No DB/provider or environment mutation."""
import os
import re


def checkout_allowed(user_id, environ=None):
    config = os.environ if environ is None else environ
    enabled = config.get('LIFETIME_CHECKOUT_ENABLED', 'false')
    raw = config.get('LIFETIME_CHECKOUT_CANARY_IDS', '')
    if not isinstance(enabled, str) or not isinstance(raw, str):
        return False
    enabled = enabled.strip().lower()
    if enabled not in ('true', 'false') or len(raw) > 16384:
        return False
    ids = set()
    if raw.strip():
        for item in raw.split(','):
            item = item.strip()
            if not re.fullmatch(r'[1-9][0-9]{0,15}', item):
                return False
            value = int(item)
            if value > 9007199254740991:
                return False
            ids.add(value)
    if type(user_id) is not int or not 0 < user_id <= 9007199254740991:
        return False
    return enabled == 'true' or user_id in ids
