"""Discovery and canonical regression tests; production services are forbidden."""
from html.parser import HTMLParser
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree as ET

import os
from flask import Flask
from public_seo import canonical_origin, register_public_seo
from test_dashboard_auth import api


class Metadata(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.canonicals = []
        self.robots = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonicals.append(attrs.get('href'))
        if tag == 'meta' and attrs.get('name', '').lower() in ('robots', 'googlebot'):
            self.robots.append(attrs.get('content', ''))


class PublicSEOTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict(api.app.config, PUBLIC_BASE_URL='https://dompiapp.id/')
        self.config.start()
        self.addCleanup(self.config.stop)
        self.db = patch.object(api, 'get_connection', side_effect=AssertionError('SEO must not use DB'))
        self.connection = self.db.start()
        self.addCleanup(self.db.stop)
        self.client = api.app.test_client()

    def test_sitemap_contains_only_live_indexable_canonical_public_pages(self):
        response = self.client.get('/sitemap.xml')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/xml')
        self.assertTrue(response.data.startswith(b'<?xml'))
        root = ET.fromstring(response.data)
        ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
        self.assertEqual(root.tag, ns + 'urlset')
        urls = [item.find(ns + 'loc').text for item in root]
        self.assertEqual(urls, ['https://dompiapp.id' + path for path in ('/help', '/privacy', '/terms')])
        self.assertEqual(len(urls), len(set(urls)))
        for url in urls:
            page = self.client.get(urlsplit(url).path)
            self.assertEqual(page.status_code, 200)
            self.assertEqual(page.mimetype, 'text/html')
            metadata = Metadata(page.get_data(as_text=True))
            self.assertEqual(metadata.canonicals, [url])
            self.assertNotIn('noindex', ' '.join(metadata.robots).lower())
            self.assertNotIn('noindex', page.headers.get('X-Robots-Tag', '').lower())
        self.connection.assert_not_called()

    def test_robots_references_sitemap_and_allows_public_pages(self):
        response = self.client.get('/robots.txt')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'text/plain')
        robots = RobotFileParser()
        robots.parse(response.get_data(as_text=True).splitlines())
        self.assertEqual(robots.site_maps(), ['https://dompiapp.id/sitemap.xml'])
        for path in ('/', '/?utm_source=test', '/upgrade', '/upgrade?plan=pro',
                     '/help', '/privacy', '/terms', '/static/legal.css', '/static/theme.js'):
            self.assertTrue(robots.can_fetch('Googlebot', path))
        for path in ('/api/transactions', '/downloads/export/token'):
            self.assertFalse(robots.can_fetch('Googlebot', path))

    def test_untrusted_hosts_forwarding_and_query_do_not_change_urls(self):
        for path in ('/sitemap.xml', '/robots.txt', '/help', '/privacy', '/terms'):
            response = self.client.get(path + '?user_id=42&utm_source=bad',
                base_url='http://evil.example', headers={'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http'})
            self.assertEqual(response.status_code, 200)
            text = response.get_data(as_text=True)
            self.assertNotIn('evil.example', text)
            self.assertNotIn('utm_source', text)
            self.assertIn('https://dompiapp.id', text)

    def test_missing_or_invalid_origin_fails_only_discovery_endpoints(self):
        for value in ('', 'http://example.test', 'https://example.test/path',
                      'https://user:secret@example.test', 'https://example.test?x=1',
                      'https://example.test#x', 'https://example.test:99999',
                      'https://example.test\\evil', 'https://exa\nmple.test'):
            with self.subTest(value=value), patch.dict(api.app.config, PUBLIC_BASE_URL=value):
                for path in ('/sitemap.xml', '/robots.txt'):
                    self.assertEqual(self.client.get(path).status_code, 503)
                response = self.client.get('/help')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(Metadata(response.get_data(as_text=True)).canonicals, [])
                self.assertEqual(self.client.get('/health').status_code, 200)

    def test_excluded_pages_do_not_inherit_public_canonical(self):
        for path in ('/', '/upgrade'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(Metadata(response.get_data(as_text=True)).canonicals, [])
        self.assertEqual(self.client.get('/api/transactions').status_code, 401)
        self.assertEqual(self.client.get('/downloads/export/invalid').status_code, 401)
        self.assertEqual(self.client.get('/not-a-public-page').status_code, 404)
        self.connection.assert_not_called()

    def test_discovery_supports_head_but_not_post(self):
        for path in ('/sitemap.xml', '/robots.txt'):
            self.assertEqual(self.client.head(path).status_code, 200)
            self.assertEqual(self.client.head(path).data, b'')
            self.assertEqual(self.client.post(path).status_code, 405)

    def test_origin_normalization(self):
        self.assertEqual(canonical_origin(' https://EXAMPLE.test/ '), 'https://example.test')
        self.assertEqual(canonical_origin('https://example.test:8443'), 'https://example.test:8443')

    def test_noindex_exact_paths_all_relevant_methods_and_queries(self):
        for path in ('/', '/upgrade'):
            for suffix in ('', '?utm_source=test&user_id=42'):
                for method, status in (('GET', 200), ('HEAD', 200), ('OPTIONS', 200), ('POST', 405)):
                    with self.subTest(path=path, suffix=suffix, method=method):
                        response = self.client.open(path + suffix, method=method)
                        self.assertEqual(response.status_code, status)
                        self.assertEqual(response.headers.getlist('X-Robots-Tag'), ['noindex'])
                        if method == 'HEAD':
                            self.assertEqual(response.data, b'')
        self.connection.assert_not_called()

    def test_noindex_does_not_affect_other_responses(self):
        for path, status in (('/help', 200), ('/privacy', 200), ('/terms', 200),
                             ('/sitemap.xml', 200), ('/robots.txt', 200), ('/health', 200),
                             ('/api/account', 401), ('/api/transactions', 401),
                             ('/downloads/export/invalid', 401), ('/upgrade/extra', 404)):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, status)
                self.assertNotIn('X-Robots-Tag', response.headers)
        self.connection.assert_not_called()

    def test_noindex_does_not_depend_on_origin(self):
        for value in ('', 'http://invalid.example', 'https://dompiapp.id'):
            with patch.dict(api.app.config, PUBLIC_BASE_URL=value):
                for path in ('/', '/upgrade'):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers['X-Robots-Tag'], 'noindex')

    def test_response_hook_preserves_body_status_and_existing_headers(self):
        # Isolate the hook to verify handled errors, redirects and cache responses
        # without changing the real routes or mocking their authentication.
        fixture = Flask('seo-response-fixture')
        register_public_seo(fixture)

        @fixture.route('/')
        @fixture.route('/upgrade')
        def page():
            from flask import request, Response
            return Response('original body', status=int(request.args['status']),
                            headers={'X-Existing': 'keep', 'Location': '/help'})

        for path in ('/', '/upgrade'):
            for status in (200, 302, 304, 400, 403, 500, 503):
                response = fixture.test_client().get(path + '?status=' + str(status))
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.headers['X-Robots-Tag'], 'noindex')
                self.assertEqual(response.headers['X-Existing'], 'keep')
                self.assertEqual(response.headers['Location'], '/help')
                self.assertEqual(response.data, b'' if status == 304 else b'original body')

    def test_origin_is_loaded_from_explicit_environment_only(self):
        with patch.dict(os.environ, {'PUBLIC_BASE_URL': 'https://dompiapp.id',
                                     'RAILWAY_PUBLIC_DOMAIN': 'internal.up.railway.app'}):
            fixture = Flask('seo-config-fixture')
            register_public_seo(fixture)
            self.assertEqual(fixture.config['PUBLIC_BASE_URL'], 'https://dompiapp.id')
            response = fixture.test_client().get('/robots.txt', base_url='https://evil.example')
            self.assertIn(b'Sitemap: https://dompiapp.id/sitemap.xml', response.data)
        with patch.dict(os.environ, {}, clear=True):
            fixture = Flask('seo-missing-config-fixture')
            register_public_seo(fixture)
            self.assertEqual(fixture.config['PUBLIC_BASE_URL'], '')
            self.assertEqual(fixture.test_client().get('/robots.txt').status_code, 503)
