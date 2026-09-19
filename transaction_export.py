"""CSV projection only; no writes, provider calls or entitlement mutation."""
import csv
import io
from datetime import date
from category_resolver import resolve_category, REVIEW_MARKER, REVIEW_LABEL

HEADERS = ('date', 'type', 'description', 'analytics_category', 'amount', 'note')


def period_bounds(period, today):
    if period == 'all':
        return None
    if period not in ('current_month', 'last_3_months'):
        raise ValueError('Invalid export period')
    month_index = today.year * 12 + today.month - 1
    first = month_index - (2 if period == 'last_3_months' else 0)
    end = month_index + 1
    return (date(first // 12, first % 12 + 1, 1).isoformat(),
            date(end // 12, end % 12 + 1, 1).isoformat())


def safe_text(value):
    text = '' if value is None else str(value)
    text = text.replace(REVIEW_MARKER, REVIEW_LABEL).replace('__remaining__', REVIEW_LABEL)
    # Quoting alone does not prevent spreadsheet formulas. Protect whitespace-
    # prefixed payloads too, while preserving the original text after the prefix.
    if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        text = "'" + text
    return text


def render_csv(cursor, normalize_amount):
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    while True:
        rows = cursor.fetchmany(500)
        if not rows:
            break
        for when, kind, description, category, amount, note in rows:
            writer.writerow((safe_text(when), safe_text(kind), safe_text(description),
                safe_text(resolve_category(category, kind)), normalize_amount(amount), safe_text(note)))
    # Build completely before returning: invalid fractional IDR must not yield
    # a partially downloaded CSV. MVP keeps the completed export in memory.
    return output.getvalue()
