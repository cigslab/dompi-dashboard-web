"""Historical category projection v2 / taxonomy v2. Never writes stored labels.

Unknown labels remain intact; only approved expense aliases are mapped.
The canonical label is the filter key, preserving compatibility with legacy APIs.
"""
RESOLVER_VERSION = '2'
TAXONOMY_VERSION = '2'
ALIASES = {'Tagihan': 'Tagihan & Utilitas', 'Hiburan': 'Hiburan & Lifestyle',
           'Keuangan': 'Keuangan & Cicilan'}


# Technical classifier failures and legacy review states; never mismatch confirmation.
REVIEW_MARKER = '__needs_category_review__'
REVIEW_LABEL = 'Perlu ditinjau'
EXPENSE_LABELS = ('Makan & Minum', 'Transportasi', 'Belanja', 'Tagihan & Utilitas',
    'Tempat Tinggal', 'Kesehatan', 'Pendidikan', 'Hiburan & Lifestyle',
    'Langganan & Digital', 'Keuangan & Cicilan', 'Rokok & Vape', *ALIASES)
INCOME_LABELS = ('Gaji', 'Usaha / Freelance', 'Bonus / Komisi', 'Investasi / Bunga')


def resolve_category(label, kind):
    label = 'Lainnya' if label is None else label
    if label == REVIEW_MARKER or (kind == 'income' and label in EXPENSE_LABELS) or (kind == 'expense' and label in INCOME_LABELS):
        return REVIEW_LABEL
    return ALIASES.get(label, label) if kind == 'expense' else label


# SQL is built exclusively from source-controlled constants, never request data.
def category_sql():
    branches = ' '.join("WHEN '%s' THEN '%s'" % (old, new) for old, new in ALIASES.items())
    expense = ', '.join("'%s'" % label for label in EXPENSE_LABELS)
    income = ', '.join("'%s'" % label for label in INCOME_LABELS)
    guard = f"WHEN analytics_category = '{REVIEW_MARKER}' OR (type = 'income' AND analytics_category IN ({expense})) OR (type = 'expense' AND analytics_category IN ({income})) THEN '{REVIEW_LABEL}' "
    return "CASE " + guard + "WHEN type = 'expense' THEN CASE COALESCE(analytics_category, 'Lainnya') " + branches + " ELSE COALESCE(analytics_category, 'Lainnya') END ELSE COALESCE(analytics_category, 'Lainnya') END"
