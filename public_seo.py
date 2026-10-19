"""SEO discovery for explicitly approved, static public pages only."""
import os
import re
from urllib.parse import urlsplit
from xml.etree.ElementTree import Element, SubElement, tostring

from flask import Response, request, url_for


PUBLIC_ENDPOINTS = ('help_page', 'privacy_page', 'terms_page')


def canonical_origin(value):
    """Accept an HTTPS origin, never a request-derived host or URL prefix."""
    value = value.strip()
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment
                or re.search(r'[\s\\?#]', value)
                or not re.fullmatch(r'[A-Za-z0-9.-]+(?::[0-9]+)?', parsed.netloc)
                or parsed.port == 0):
            return None
    except ValueError:
        return None
    return 'https://' + parsed.netloc.lower()


def register_public_seo(app):
    app.config['PUBLIC_BASE_URL'] = os.getenv('PUBLIC_BASE_URL', '')

    def public_url(endpoint):
        origin = canonical_origin(app.config['PUBLIC_BASE_URL'])
        return origin + url_for(endpoint, _external=False) if origin else None

    @app.after_request
    def noindex_account_pages(response):
        # Exact paths also cover HEAD, query strings and method/error responses.
        # This changes metadata only; route handlers and authentication are intact.
        if request.path in ('/', '/upgrade'):
            response.headers['X-Robots-Tag'] = 'noindex'
        return response

    @app.context_processor
    def public_canonical():
        return {'public_canonical_url': public_url(request.endpoint)
                if request.endpoint in PUBLIC_ENDPOINTS else None}

    @app.get('/sitemap.xml')
    def public_sitemap():
        if not canonical_origin(app.config['PUBLIC_BASE_URL']):
            return Response('PUBLIC_BASE_URL is not configured correctly.\n',
                            status=503, mimetype='text/plain')
        root = Element('urlset', xmlns='http://www.sitemaps.org/schemas/sitemap/0.9')
        for endpoint in PUBLIC_ENDPOINTS:
            SubElement(SubElement(root, 'url'), 'loc').text = public_url(endpoint)
        return Response(tostring(root, encoding='utf-8', xml_declaration=True),
                        mimetype='application/xml')

    @app.get('/robots.txt')
    def public_robots():
        sitemap = public_url('public_sitemap')
        if not sitemap:
            return Response('PUBLIC_BASE_URL is not configured correctly.\n',
                            status=503, mimetype='text/plain')
        return Response('User-agent: *\nDisallow: /api/\n'
                        'Disallow: /downloads/\n\nSitemap: ' + sitemap + '\n',
                        mimetype='text/plain')
