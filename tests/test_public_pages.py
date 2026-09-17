"""Targeted public routing checks; no database fixtures required."""
import unittest
from unittest.mock import patch
from test_dashboard_auth import api


class PublicPageTests(unittest.TestCase):
    def test_public_legal_pages_without_auth_or_database(self):
        with patch.object(api, 'get_connection') as connection:
            for route, title in (('/privacy', 'Kebijakan Privasi'), ('/terms', 'Syarat &amp; Ketentuan'), ('/help', 'Bantuan &amp; Feedback')):
                with self.subTest(route=route):
                    response = api.app.test_client().get(route)
                    self.assertEqual(response.status_code, 200)
                    html = response.get_data(as_text=True)
                    self.assertIn('<h1>' + title + '</h1>', html)
                    self.assertIn('lang="id"', html)
                    self.assertIn('/static/legal.css', html)
                    self.assertNotIn('<script', html)
                    self.assertNotIn('test-init-data', html)
            connection.assert_not_called()

    def test_help_feedback_uses_support_not_transaction_bot(self):
        html = api.app.test_client().get('/help').get_data(as_text=True)
        self.assertIn('href="https://t.me/pakedompi"', html)
        self.assertIn('href="https://t.me/catetexpbot"', html)
        self.assertNotIn('<form', html)

    def test_account_api_still_requires_auth(self):
        with patch.object(api, 'get_connection') as connection:
            self.assertEqual(api.app.test_client().get('/api/account').status_code, 401)
            connection.assert_not_called()
