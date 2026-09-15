import re
from decimal import Decimal, InvalidOperation, localcontext

IDR_ONLY_MESSAGE = "Saat ini Dompi hanya mendukung Rupiah (IDR)."

def parse_idr_amount(value):
    """Whole positive Rupiah within BIGINT; separators must full-match."""
    if type(value) is int:
        return value if 0 < value <= 9223372036854775807 else None
    if not isinstance(value, str) or len(value) > 64:
        return None
    text = re.sub(r"^(?:rp|idr)\s*", "", value.strip(), flags=re.I)
    suffix = re.fullmatch(r"([0-9]+(?:[.,][0-9]+)?)(k|rb|jt)", text, flags=re.I)
    if suffix:
        try:
            with localcontext() as ctx:
                ctx.prec = 80
                amount = Decimal(suffix[1].replace(",", ".")) * {
                    "k": 1000, "rb": 1000, "jt": 1000000
                }[suffix[2].lower()]
                if amount != amount.to_integral_value():
                    return None
                return parse_idr_amount(int(amount))
        except (InvalidOperation, ValueError):
            return None
    patterns = (
        r"[0-9]+",
        r"[1-9][0-9]{0,2}(?:\.[0-9]{3})+",
        r"[1-9][0-9]{0,2}(?:,[0-9]{3})+",
        r"(?:[0-9]+|[1-9][0-9]{0,2}(?:\.[0-9]{3})+),00",
    )
    if not any(re.fullmatch(pattern, text) for pattern in patterns):
        return None
    if text.endswith(",00"):
        text = text[:-3]
    return parse_idr_amount(int(text.replace(".", "").replace(",", "")))
