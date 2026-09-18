"""Historical category projection v1 / taxonomy v2. Never writes stored labels.

Unknown labels remain intact; only approved expense aliases are mapped.
The canonical label is the filter key, preserving compatibility with legacy APIs.
"""
RESOLVER_VERSION = '1'
TAXONOMY_VERSION = '2'
ALIASES = {'Tagihan': 'Tagihan & Utilitas', 'Hiburan': 'Hiburan & Lifestyle',
           'Keuangan': 'Keuangan & Cicilan'}


def resolve_category(label, kind):
    label = 'Lainnya' if label is None else label
    return ALIASES.get(label, label) if kind == 'expense' else label


# SQL is built exclusively from source-controlled constants, never request data.
def category_sql():
    branches = ' '.join("WHEN '%s' THEN '%s'" % (old, new) for old, new in ALIASES.items())
    return "CASE WHEN type = 'expense' THEN CASE COALESCE(analytics_category, 'Lainnya') " + branches + " ELSE COALESCE(analytics_category, 'Lainnya') END ELSE COALESCE(analytics_category, 'Lainnya') END"
