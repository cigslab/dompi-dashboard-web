"""Same Snap SDK/environment contract as the bot; no live calls at import."""
import os
from urllib.parse import urlsplit


def ready():
    return bool(os.getenv('MIDTRANS_SERVER_KEY', '').strip())


def valid_redirect(url):
    if not isinstance(url, str):
        return False
    parsed = urlsplit(url)
    host = ('app.midtrans.com' if os.getenv('MIDTRANS_IS_PRODUCTION', 'false').lower() == 'true'
            else 'app.sandbox.midtrans.com')
    return (parsed.scheme == 'https' and parsed.netloc == host
            and parsed.path.startswith('/snap/'))


class BoundedTransport:
    @staticmethod
    def request(*args, **kwargs):
        import requests
        kwargs['timeout'] = (5, 20)
        kwargs['allow_redirects'] = False
        return requests.request(*args, **kwargs)


def create_snap_transaction(payment_id, amount, customer_id):
    if not ready():
        return False, None
    try:
        import midtransclient
        snap = midtransclient.Snap(
            is_production=os.getenv('MIDTRANS_IS_PRODUCTION', 'false').lower() == 'true',
            server_key=os.environ['MIDTRANS_SERVER_KEY'])
        snap.http_client.http_client = BoundedTransport()
        transaction = snap.create_transaction({
            'transaction_details': {'order_id': payment_id, 'gross_amount': amount},
            'customer_details': {'first_name': customer_id or 'Dompi'}})
        url = transaction.get('redirect_url')
        if not valid_redirect(url):
            return False, None
        return True, {'redirect_url': url}
    except Exception:
        # Provider exception strings can contain sensitive request/config data.
        return False, None
