"""Short-lived, encrypted export bearer tickets; no files or server-side storage."""
import base64
import hashlib
import hmac
import json
from cryptography.fernet import Fernet, InvalidToken

TTL_SECONDS = 120


class ExportTickets:
    def __init__(self, secret):
        # Domain separation from Telegram auth and other token purposes.
        key = hmac.new(secret.encode(), b'dompi-export-download-v1', hashlib.sha256).digest()
        self.cipher = Fernet(base64.urlsafe_b64encode(key))

    def issue(self, owner, period):
        return self.cipher.encrypt(json.dumps({'owner': owner, 'period': period}).encode()).decode()

    def read(self, token):
        if not isinstance(token, str) or len(token) > 1024:
            raise ValueError('Invalid export ticket')
        try:
            data = json.loads(self.cipher.decrypt(token.encode(), ttl=TTL_SECONDS))
            if (type(data.get('owner')) is not int or data['owner'] <= 0
                    or data.get('period') not in ('current_month', 'last_3_months', 'all')):
                raise ValueError()
            return data
        except (InvalidToken, ValueError, TypeError, KeyError, AttributeError, UnicodeError):
            raise ValueError('Invalid export ticket') from None
