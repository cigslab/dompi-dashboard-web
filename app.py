from checkout_policy import checkout_allowed
import checkout_midtrans
from lifetime_checkout import CheckoutError, offers, reserve_order
from entitlement_reader import read_entitlement, entitlement_status
from category_resolver import category_sql, RESOLVER_VERSION, REVIEW_MARKER
import os
from rupiah import parse_idr_amount, IDR_ONLY_MESSAGE
import hashlib
import hmac
import json
import re
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import parse_qsl

from itsdangerous import URLSafeTimedSerializer, BadSignature

import psycopg2
from flask import Flask, jsonify, render_template, request, g
from flask_cors import CORS


app = Flask(__name__)
# Server-only settings: never pass BOT_TOKEN to templates or API responses.
BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN wajib tersedia untuk autentikasi dashboard")

INIT_DATA_MAX_AGE_SECONDS = int(os.getenv("INIT_DATA_MAX_AGE_SECONDS", "3600"))
if INIT_DATA_MAX_AGE_SECONDS <= 0:
    raise RuntimeError("INIT_DATA_MAX_AGE_SECONDS harus positif")

DASHBOARD_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("DASHBOARD_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
CORS(
    app,
    resources={r"/api/*": {"origins": DASHBOARD_ALLOWED_ORIGINS}},
    methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    supports_credentials=False,
    always_send=False,
)


def integer_amount(value):
    """Normalize database IDR values without truncating fractional amounts."""
    if type(value) not in (int, float, Decimal):
        raise ValueError("Invalid integer IDR amount")
    try:
        amount = int(value)
    except (ValueError, OverflowError):
        raise ValueError("Invalid integer IDR amount") from None
    if value != amount:
        raise ValueError("Fractional IDR amount")
    return amount


class InvalidTelegramAuth(ValueError):
    pass


def verify_telegram_init_data(init_data, *, include_user=False):
    """Validate Telegram Mini App HMAC/age, then return the ID or verified user.

    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    try:
        if not init_data or len(init_data) > 16384:
            raise ValueError("invalid size")
        if re.search(r"%(?![0-9a-fA-F]{2})", init_data):
            raise ValueError("invalid encoding")
        pairs = parse_qsl(
            init_data, keep_blank_values=True, strict_parsing=True,
            errors="strict", max_num_fields=32,
        )
        fields = dict(pairs)
        if len(fields) != len(pairs):
            raise ValueError("duplicate fields")
        received_hash = fields.pop("hash")
        if not re.fullmatch(r"[0-9a-f]{64}", received_hash):
            raise ValueError("invalid hash")

        # Telegram HMAC method: exclude hash ONLY, retain all other fields.
        data_check_string = "\n".join(
            f"{key}={value}" for key, value in sorted(fields.items())
        )
        secret_key = hmac.new(
            b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256
        ).digest()
        expected_hash = hmac.new(
            secret_key, data_check_string.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected_hash, received_hash):
            raise ValueError("invalid signature")

        auth_date = int(fields["auth_date"])
        age = time.time() - auth_date
        if age < -30 or age > INIT_DATA_MAX_AGE_SECONDS:
            raise ValueError("expired or future auth_date")
        user = json.loads(fields["user"])
        if not isinstance(user, dict):
            raise ValueError("invalid user")
        user_id = user.get("id")
        if type(user_id) is not int or user_id <= 0:
            raise ValueError("invalid user ID")
        return user if include_user else user_id
    except (ValueError, KeyError, TypeError, OverflowError, RecursionError):
        # Do not expose or log the incoming credentials.
        raise InvalidTelegramAuth("Invalid Telegram authentication") from None


@app.before_request
def authenticate_dashboard():
    if not request.path.startswith("/api/"):
        return
    if request.method == "OPTIONS":
        # Return directly: preflight must never reach a database handler.
        return "", 204
    scheme, _, init_data = request.headers.get("Authorization", "").partition(" ")
    if scheme != "tma" or not init_data:
        return jsonify(error="unauthorized"), 401
    try:
        g.telegram_user = verify_telegram_init_data(init_data, include_user=True)
        g.user_id = g.telegram_user["id"]
    except InvalidTelegramAuth:
        return jsonify(error="unauthorized"), 401
    # Query-string/body user_id is deliberately never used for authentication.


@app.after_request
def prevent_authenticated_response_caching(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response

DATABASE_URL = os.getenv("DATABASE_URL")


@app.before_request
def require_idr_currency():
    if request.path.startswith("/api/"):
        currency = request.args.get("currency", "IDR")
        if currency.strip().upper() not in {"IDR", "RP"}:
            return jsonify({"error": IDR_ONLY_MESSAGE}), 400


def get_connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL belum tersedia")

    return psycopg2.connect(DATABASE_URL)


@app.route("/")
def home():
    return render_template("dashboard.html")


@app.route("/upgrade")
def upgrade_page():
    return render_template("upgrade.html")


def checkout_error(error):
    payload = dict(error=error.code)
    if error.payment_id:
        payload['payment_id'] = error.payment_id
    return jsonify(payload), error.status


@app.get("/api/checkout/products")
def checkout_products():
    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        result = offers(cursor, g.user_id, now=datetime.now())
        result['checkout_available'] = checkout_allowed(g.user_id) and checkout_midtrans.ready()
        return jsonify(result)
    except CheckoutError as error:
        return checkout_error(error)
    except Exception:
        return jsonify(error="checkout_unavailable"), 503
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.post("/api/checkout/orders")
def checkout_order():
    # Gate before DB/provider work; identity comes only from verified Telegram auth.
    if not checkout_allowed(g.user_id):
        return jsonify(error="lifetime_checkout_disabled"), 403
    # Only an authenticated identity and an allowlisted product code can enter.
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {'product_code'}:
        return jsonify(error="invalid_order_payload"), 400
    if not checkout_midtrans.ready():
        return jsonify(error="checkout_unavailable"), 503
    conn = None
    try:
        conn = get_connection()
        order = reserve_order(conn, g.user_id, data['product_code'])
    except CheckoutError as error:
        return checkout_error(error)
    except Exception:
        return jsonify(error="checkout_unavailable"), 503
    finally:
        if conn:
            conn.close()
    # No transaction/row lock is held during network I/O. Provider failure leaves
    # the committed pending snapshot intact; it never marks an order paid.
    success, result = checkout_midtrans.create_snap_transaction(
        order['payment_id'], order['amount'], order['customer_id'])
    if not success:
        return jsonify(error="checkout_needs_reconciliation", payment_id=order['payment_id']), 502
    return jsonify(payment_id=order['payment_id'], amount=order['amount'],
                   redirect_url=result['redirect_url']), 201


@app.route("/help")
def help_page():
    return render_template("help.html")


@app.route("/privacy")
def privacy_page():
    return render_template("privacy.html")


@app.route("/terms")
def terms_page():
    return render_template("terms.html")


@app.route("/api/profile")
def profile():
    conn = None
    cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        # Only the user object returned by server-side HMAC/age verification
        # may supply identity updates. Never create users or touch account state.
        name = g.telegram_user.get('first_name')
        if isinstance(name, str) and name.strip() and len(name) <= 256 and not any(ord(c) < 32 or ord(c) == 127 for c in name):
            name = name.strip()
            cursor.execute("UPDATE users SET first_name = %s WHERE telegram_id = %s AND (first_name IS NULL OR first_name <> %s)", (name, g.user_id, name))
            if cursor.rowcount:
                conn.commit()
        cursor.execute(
            "SELECT first_name, username FROM users WHERE telegram_id = %s",
            (g.user_id,),
        )
        row = cursor.fetchone()
        names = row if row else ()
        display_name = next(
            (name.strip() for name in names if isinstance(name, str) and name.strip()),
            "User",
        )
        username = row[1].strip() if row and isinstance(row[1], str) and row[1].strip() else None
        return jsonify(display_name=display_name, username=username)
    except Exception:
        if conn:
            conn.rollback()
        app.logger.exception("Profile query failed")
        return jsonify(error="Gagal mengambil profil"), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def configured_free_monthly_limit():
    """Optional display configuration, independent of the bot's quota enforcement."""
    raw = os.environ.get("FREE_MONTHLY_LIMIT", "").strip()
    # Keep the JSON integer exact in the browser and bound parsing work.
    if not re.fullmatch(r"[0-9]{1,16}", raw):
        return None
    value = int(raw)
    return value if 0 < value <= 9007199254740991 else None


@app.route("/api/account")
def account():
    """Read the bot's existing quota ledger; never derive usage from expenses."""
    conn = cursor = None
    try:
        now = datetime.now()  # Same server-local month/expiry convention as the bot.
        month = now.strftime("%Y-%m")
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT plan, pro_until, joined_at FROM users WHERE telegram_id = %s", (g.user_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify(error="Akun belum tersedia"), 404
        plan, pro_until, joined_at = row
        observed = entitlement_status(read_entitlement(
            cursor, g.user_id, now=now, dialect='postgresql'))
        # Keep legacy UI fields stable; new callers opt into entitlement status.
        plan = plan if plan in ("free", "pro") else None
        if plan == "pro" and pro_until:
            try:
                expiry = datetime.strptime(str(pro_until), "%Y-%m-%d %H:%M:%S")
                if now >= expiry:
                    plan = "free"
            except ValueError:
                plan = None
        cursor.execute("SELECT expense_count FROM monthly_usage WHERE user_id = %s AND month = %s", (g.user_id, month))
        usage_row = cursor.fetchone()
        usage = usage_row[0] if usage_row else 0  # Bot also treats an absent month as zero.
        if type(usage) is not int or usage < 0:
            usage = None
        try:
            joined_at = datetime.strptime(str(joined_at), "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d") if joined_at else None
        except ValueError:
            joined_at = None
        return jsonify(entitlement=observed, plan=plan, monthly_usage=usage, usage_month=month,
                       free_monthly_limit=configured_free_monthly_limit(), joined_at=joined_at)
    except Exception:
        app.logger.exception("Account query failed")
        return jsonify(error="Informasi akun belum tersedia"), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route("/api/summary")
def summary():
    user_id = g.user_id
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            COALESCE(
                SUM(
                    CASE
                        WHEN type = 'income' THEN amount
                        ELSE 0
                    END
                ),
                0
            ) AS income,

            COALESCE(
                SUM(
                    CASE
                        WHEN type = 'expense' THEN amount
                        ELSE 0
                    END
                ),
                0
            ) AS expense

        FROM expenses
        WHERE user_id = %s AND currency = 'IDR'
        """,
        (user_id,)
    )

    row = cursor.fetchone()

    cursor.close()
    conn.close()

    income = integer_amount(row[0])
    expense = integer_amount(row[1])
    balance = income - expense

    return jsonify({
        "income": income,
        "expense": expense,
        "balance": balance
    })


@app.route("/api/cashflow")
def cashflow():
    user_id = g.user_id
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                LEFT(date, 10) AS transaction_date,
                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'income' THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS income,
                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'expense' THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS expense

            FROM expenses
            WHERE user_id = %s AND currency = 'IDR'

            GROUP BY LEFT(date, 10)
            ORDER BY LEFT(date, 10)
            """,
            (user_id,)
        )

        rows = cursor.fetchall()

        data = []

        for row in rows:
            data.append({
                "date": row[0],
                "income": integer_amount(row[1]),
                "expense": integer_amount(row[2])
            })

        return jsonify(data)

    except Exception as e:
        print("CASHFLOW ERROR:", repr(e))

        return jsonify({
            "error": "Gagal mengambil cashflow"
        }), 500

    finally:
        if cursor:
            cursor.close()

        if conn:
            conn.close()

@app.route("/api/analytics/monthly")
def analytics_monthly():
    user_id = g.user_id
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                TO_CHAR(date::timestamp, 'YYYY-MM') AS month,
                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'income'
                            THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS income,
                COALESCE(
                    SUM(
                        CASE
                            WHEN type = 'expense'
                            THEN amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS expense,
                COUNT(*) AS transaction_count
            FROM expenses
            WHERE user_id = %s AND currency = 'IDR'
            GROUP BY TO_CHAR(date::timestamp, 'YYYY-MM')
            ORDER BY month DESC
            """,
            (user_id,)
        )

        rows = cursor.fetchall()

        data = []

        for row in rows:
            data.append({
                "month": row[0],
                "income": integer_amount(row[1]),
                "expense": integer_amount(row[2]),
                "transaction_count": row[3]
            })

        return jsonify(data)

    except Exception as e:
        print("ANALYTICS MONTHLY ERROR:", repr(e))

        return jsonify({
            "error": "Gagal mengambil analytics bulanan"
        }), 500

    finally:
        if cursor:
            cursor.close()

        if conn:
            conn.close()

@app.route("/api/categories")
def categories():
    user_id = g.user_id
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            f"""
            SELECT
                {category_sql()} AS category,
                SUM(amount) AS total

            FROM expenses

            WHERE user_id = %s AND currency = 'IDR'
            AND type = 'expense'

            GROUP BY {category_sql()}
            ORDER BY total DESC
            """,
            (user_id,)
        )

        rows = cursor.fetchall()

        data = []

        for row in rows:
            data.append({
                "category": row[0],
                "total": integer_amount(row[1])
            })

        return jsonify(data)

    except Exception as e:
        print("CATEGORIES ERROR:", repr(e))

        return jsonify({
            "error": "Gagal mengambil kategori"
        }), 500

    finally:
        if cursor:
            cursor.close()

        if conn:
            conn.close()
@app.route("/api/categories/breakdown")
def category_breakdown():
    month = request.args.get("month", "")
    if month and not re.fullmatch(r"[0-9]{4}-(?:0[1-9]|1[0-2])", month):
        return jsonify(error="Periode harus YYYY-MM"), 400
    conn = None
    cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT {category_sql()} AS category,
                   COUNT(*) AS transaction_count, SUM(amount) AS total
            FROM expenses
            WHERE user_id = %s AND currency = 'IDR' AND type = 'expense'
              AND date LIKE %s
            GROUP BY {category_sql()}
            ORDER BY total DESC, category ASC
            """,
            (g.user_id, month + '-%' if month else '%'),
        )
        rows = [(category, count, integer_amount(total))
                for category, count, total in cursor.fetchall()]
        total = sum(row[2] for row in rows)
        items = [{"category": row[0], "transaction_count": row[1], "total": row[2],
                  "percentage": round(float(row[2] / total * 100), 2) if total else 0}
                 for row in rows]
        return jsonify(total_expense=total, category_count=len(items),
                       largest_category=items[0]["category"] if items else None,
                       categories=items)
    except Exception:
        app.logger.exception("Category breakdown failed")
        return jsonify(error="Gagal mengambil kategori"), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route("/api/reports")
def reports():
    period = request.args.get("period", "current")
    try:
        today = date.today()
        if period == "current":
            start, end = today.replace(day=1), today
        elif period == "last":
            end = today.replace(day=1) - timedelta(days=1)
            start = end.replace(day=1)
        elif period == "custom":
            values = [request.args.get(key, "") for key in ("start", "end")]
            if not all(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) for value in values):
                raise ValueError()
            start, end = map(date.fromisoformat, values)
        else:
            raise ValueError()
        if end < start:
            raise ValueError()
        days = (end - start).days + 1
        previous_end = start - timedelta(days=1)
        previous_start = start - timedelta(days=days)
    except (ValueError, OverflowError):
        return jsonify(error="Periode atau rentang tanggal tidak valid"), 400

    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            f"""
            WITH selected AS (
                SELECT type, {category_sql()} AS category,
                       amount,
                       CASE WHEN LEFT(date, 10) >= %s THEN 'current' ELSE 'previous' END AS period
                FROM expenses
                WHERE user_id = %s AND currency = 'IDR'
                  AND type IN ('income', 'expense')
                  AND LEFT(date, 10) BETWEEN %s AND %s
            )
            SELECT period, type, category, COALESCE(SUM(amount), 0), COUNT(*)
            FROM selected GROUP BY period, type, category
            """,
            (start.isoformat(), g.user_id, previous_start.isoformat(), end.isoformat()),
        )
        income = expense = transaction_count = previous_expense = 0
        categories = []
        for bucket, kind, category, total, count in cursor.fetchall():
            total = integer_amount(total)
            if bucket == "previous":
                if kind == "expense":
                    previous_expense += total
                continue
            transaction_count += count
            if kind == "income":
                income += total
            else:
                expense += total
                categories.append({"category": category, "total": total})
        categories.sort(key=lambda item: (-item["total"], item["category"]))
        for item in categories:
            item["percentage"] = round(float(item["total"] / expense * 100), 2) if expense else 0
        change = round(float((expense - previous_expense) / previous_expense * 100), 2) if previous_expense > 0 else None
        return jsonify(
            start=start.isoformat(), end=end.isoformat(), days=days,
            income=income, expense=expense, balance=income-expense,
            average_daily_expense=(expense // days if expense % days == 0
                                   else round(float(expense / days), 2)),
            transaction_count=transaction_count, categories=categories,
            comparison={"start": previous_start.isoformat(), "end": previous_end.isoformat(),
                        "expense": previous_expense, "change_percentage": change},
        )
    except Exception:
        app.logger.exception("Report query failed")
        return jsonify(error="Gagal mengambil laporan"), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


reset_serializer = URLSafeTimedSerializer(BOT_TOKEN, salt="dompi-transaction-reset-v1")


@app.route("/api/transactions/reset", methods=["GET", "DELETE"])
def reset_transactions():
    """Confirm an immutable set of internal expense IDs, never reset account/quota."""
    conn = cursor = None
    try:
        if request.method == "DELETE":
            body = request.get_json(silent=True)
            if not isinstance(body, dict) or body.get("confirmation") != "HAPUS":
                return jsonify(error="Konfirmasi HAPUS diperlukan"), 400
            token = body.get("token")
            if not isinstance(token, str) or len(token) > 250000:
                return jsonify(error="Konfirmasi tidak valid"), 400
            try:
                snapshot = reset_serializer.loads(token, max_age=300)
            except BadSignature:
                return jsonify(error="Konfirmasi kedaluwarsa atau tidak valid. Mulai ulang."), 400
            if not isinstance(snapshot, dict) or snapshot.get("owner") != g.user_id:
                return jsonify(error="Konfirmasi tidak valid untuk akun ini"), 403
            ids = snapshot.get("ids")
            if not isinstance(ids, list) or len(ids) > 10000 or any(type(i) is not int or i <= 0 for i in ids):
                return jsonify(error="Konfirmasi tidak valid"), 400
            conn = get_connection()
            cursor = conn.cursor()
            if ids:
                placeholders = ",".join(["%s"] * len(ids))
                cursor.execute("DELETE FROM expenses WHERE user_id = %s AND id IN (" + placeholders + ")", (g.user_id, *ids))
            conn.commit()
            return jsonify(success=True)
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM expenses WHERE user_id = %s ORDER BY id LIMIT 10001", (g.user_id,))
        ids = [row[0] for row in cursor.fetchall()]
        if len(ids) > 10000:
            return jsonify(error="Terlalu banyak transaksi untuk penghapusan mandiri. Hubungi bantuan."), 409
        return jsonify(count=len(ids), token=reset_serializer.dumps({"owner": g.user_id, "ids": ids}))
    except Exception:
        if conn:
            conn.rollback()
        app.logger.exception("Transaction reset failed")
        return jsonify(error="Penghapusan belum dapat dipastikan. Coba lagi dengan konfirmasi yang sama."), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route("/api/transactions")
def transactions():
    user_id = g.user_id
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                transaction_id,
                category,
                analytics_category,
                amount,
                note,
                date,
                type,
                currency

            FROM expenses

            WHERE user_id = %s AND currency = 'IDR'

            ORDER BY transaction_id DESC
            LIMIT 10
            """,
            (user_id,)
        )

        rows = cursor.fetchall()

        data = []

        for row in rows:
            data.append({
                "transaction_id": row[0],
                "category": row[1],
                "analytics_category": row[2],
                "amount": integer_amount(row[3]),
                "note": row[4],
                "date": row[5],
                "type": row[6],
                "currency": row[7]
            })

        return jsonify(data)

    except Exception as e:
        print("TRANSACTIONS ERROR:", repr(e))

        return jsonify({
            "error": "Gagal mengambil transaksi"
        }), 500

    finally:
        if cursor:
            cursor.close()

        if conn:
            conn.close()

@app.route(
    "/api/transactions/<int:transaction_id>",
    methods=["DELETE"]
)
def delete_transaction(transaction_id):
    user_id = g.user_id
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            DELETE FROM expenses
            WHERE user_id = %s AND currency = 'IDR'
            AND transaction_id = %s
            """,
            (user_id, transaction_id),
        )

        if cursor.rowcount == 0:
            return {
                "success": False,
                "message": "Transaksi tidak ditemukan."
            }, 404

        conn.commit()

        return {
            "success": True,
            "message": "Transaksi berhasil dihapus."
        }

    except Exception as error:
        if conn:
            conn.rollback()

        print("Delete transaction error:", error)

        return {
            "success": False,
            "message": "Gagal menghapus transaksi."
        }, 500

    finally:
        if cursor:
            cursor.close()

        if conn:
            conn.close()

@app.route(
    "/api/transactions/<int:transaction_id>",
    methods=["PATCH"]
)
def update_transaction(transaction_id):
    user_id = g.user_id
    conn = None
    cursor = None

    try:
        data = request.get_json()
        if not isinstance(data, dict):
            return {"success": False, "message": "Data transaksi tidak valid."}, 400

        fields = {key: data[key] for key in ('category', 'amount', 'note', 'type', 'date') if key in data}
        if not fields:
            return jsonify(success=False, message='Tidak ada perubahan transaksi.'), 400
        if 'category' in fields and (not isinstance(fields['category'], str) or not fields['category'].strip()):
            return jsonify(success=False, message='Deskripsi transaksi tidak valid.'), 400
        if 'note' in fields and fields['note'] is not None and not isinstance(fields['note'], str):
            return jsonify(success=False, message='Catatan tidak valid.'), 400
        if 'type' in fields and fields['type'] not in ('expense', 'income'):
            return jsonify(success=False, message='Jenis transaksi tidak valid.'), 400
        if 'date' in fields:
            try:
                if not isinstance(fields['date'], str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', fields['date']):
                    raise ValueError()
                date.fromisoformat(fields['date'])
            except ValueError:
                return jsonify(success=False, message='Tanggal tidak valid.'), 400
        currency = data.get('currency', 'IDR')
        if not isinstance(currency, str) or currency.strip().upper() not in {'IDR', 'RP'}:
            return jsonify(success=False, message=IDR_ONLY_MESSAGE), 400
        if 'amount' in fields:
            fields['amount'] = parse_idr_amount(fields['amount'])
            if fields['amount'] is None:
                return jsonify(success=False, message='Nominal harus Rupiah bulat positif.'), 400

        # A single UPDATE compares against the current stored context, avoiding
        # a read/update race. Only server-selected column names enter SQL.
        changes = []
        params = []
        for key in ('category', 'note', 'type'):
            if key in fields:
                changes.append(f"COALESCE({key}, '') <> %s")
                params.append(fields[key] or '')
        assignments = []
        if changes:
            assignments.append('analytics_category = CASE WHEN ' + ' OR '.join(changes) + ' THEN %s ELSE analytics_category END')
            params.append(REVIEW_MARKER)
        for key, value in fields.items():
            assignments.append(f'{key} = %s')
            params.append(value)
        params.extend([user_id, transaction_id])
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE expenses SET ' + ', '.join(assignments) +
                       " WHERE user_id = %s AND currency = 'IDR' AND transaction_id = %s", tuple(params))

        if cursor.rowcount == 0:
            return {
                "success": False,
                "message": "Transaksi tidak ditemukan."
            }, 404

        conn.commit()

        return {
            "success": True,
            "message": "Transaksi berhasil diperbarui."
        }

    except Exception as error:
        if conn:
            conn.rollback()

        print("Update transaction error:", error)

        return {
            "success": False,
            "message": "Gagal memperbarui transaksi."
        }, 500

    finally:
        if cursor:
            cursor.close()

        if conn:
            conn.close()

@app.route("/health")
def health():
    return jsonify(ok=True), 200


@app.route('/api/categories/transactions')
def category_transactions():
    category = request.args.get('category', '')
    kind = request.args.get('type', '')
    month = request.args.get('month', '')
    start, end = request.args.get('start', ''), request.args.get('end', '')
    try:
        if not category or len(category) > 200 or kind not in ('expense', 'income'):
            raise ValueError()
        page_text = request.args.get('page', '1')
        if not re.fullmatch(r'[1-9][0-9]{0,5}', page_text):
            raise ValueError()
        page = int(page_text)
        if month and (start or end):
            raise ValueError()
        if month and not re.fullmatch(r'[0-9]{4}-(?:0[1-9]|1[0-2])', month):
            raise ValueError()
        if start or end:
            if not all(re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', v) for v in (start, end)):
                raise ValueError()
            if date.fromisoformat(start) > date.fromisoformat(end):
                raise ValueError()
    except ValueError:
        return jsonify(error='Filter kategori tidak valid'), 400
    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        where = f"user_id = %s AND currency = 'IDR' AND type = %s AND ({category_sql()}) = %s"
        params = [g.user_id, kind, category]
        if request.args.get('review') == '1':
            where += ' AND analytics_category = %s'
            params.append(REVIEW_MARKER)
        if month:
            where += ' AND date LIKE %s'
            params.append(month + '-%')
        if start:
            where += ' AND LEFT(date, 10) BETWEEN %s AND %s'
            params.extend([start, end])
        cursor.execute(f"SELECT transaction_id, category, date, amount, note, {category_sql()} FROM expenses WHERE {where} ORDER BY date DESC, id DESC LIMIT %s OFFSET %s", tuple(params + [26, (page - 1) * 25]))
        rows = cursor.fetchall()
        return jsonify(items=[dict(transaction_id=r[0], description=r[1], date=r[2],
                            amount=integer_amount(r[3]), note=r[4], category=r[5], type=kind) for r in rows[:25]],
                       page=page, has_more=len(rows) > 25, resolver_version=RESOLVER_VERSION)
    except Exception:
        app.logger.exception('Category transactions failed')
        return jsonify(error='Gagal memuat transaksi kategori'), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route('/api/categories/review')
def category_review():
    month = request.args.get('month', '')
    if month and not re.fullmatch(r'[0-9]{4}-(?:0[1-9]|1[0-2])', month):
        return jsonify(error='Periode tidak valid'), 400
    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT type, COUNT(*), SUM(amount) FROM expenses WHERE user_id = %s AND currency = 'IDR' AND analytics_category = %s AND type IN ('expense', 'income') AND date LIKE %s GROUP BY type", (g.user_id, REVIEW_MARKER, month + '-%' if month else '%'))
        return jsonify(items=[dict(type=r[0], count=r[1], total=integer_amount(r[2])) for r in cursor.fetchall()])
    except Exception:
        app.logger.exception('Review summary failed')
        return jsonify(error='Gagal memuat perhatian kategori'), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


if __name__ == "__main__":
    from waitress import serve
    serve(app, host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
