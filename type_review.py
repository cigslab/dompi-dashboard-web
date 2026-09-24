"""Deterministic type review v1; independent of analytics classification failures."""
import hashlib
import json
import re
import unicodedata

RULE_VERSION = '1'
INCOME = re.compile(r'\b(gaji|salary|bonus|komisi|pemasukan)\b')
EXPENSE = re.compile(r'\b(bayar listrik|bayar kos|bayar sewa|beli bensin|beli obat|belanja groceries|pengeluaran)\b')
# Mixed/negated contexts are deliberately not diagnosed with simple keywords.
UNCERTAIN = re.compile(r'\b(bukan|tidak|batal|refund|reimburse|pengembalian|potong|potongan)\b')


def fingerprint(kind, description, note):
    payload = [RULE_VERSION, kind, description or '', note or '']
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def suspected_mismatch(kind, description, note):
    context = unicodedata.normalize('NFKC', f'{description or ""} {note or ""}').casefold()
    context = ' '.join(context.split())
    if UNCERTAIN.search(context):
        return False
    income, expense = bool(INCOME.search(context)), bool(EXPENSE.search(context))
    return (kind == 'expense' and income and not expense) or (kind == 'income' and expense and not income)


def needs_review(kind, description, note, confirmed=None):
    return suspected_mismatch(kind, description, note) and confirmed != fingerprint(kind, description, note)
