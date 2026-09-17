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
    methods=["GET", "PATCH", "DELETE", "OPTIONS"],
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


def verify_telegram_init_data(init_data):
    """Validate Telegram Mini App HMAC, then return its authenticated user ID.

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
        return user_id
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
        g.user_id = verify_telegram_init_data(init_data)
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


@app.route("/api/profile")
def profile():
    conn = None
    cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
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
        return jsonify(plan=plan, monthly_usage=usage, usage_month=month,
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
            """
            SELECT
                COALESCE(analytics_category, 'Lainnya') AS category,
                SUM(amount) AS total

            FROM expenses

            WHERE user_id = %s AND currency = 'IDR'
            AND type = 'expense'

            GROUP BY COALESCE(analytics_category, 'Lainnya')
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
            """
            SELECT COALESCE(analytics_category, 'Lainnya') AS category,
                   COUNT(*) AS transaction_count, SUM(amount) AS total
            FROM expenses
            WHERE user_id = %s AND currency = 'IDR' AND type = 'expense'
              AND date LIKE %s
            GROUP BY COALESCE(analytics_category, 'Lainnya')
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
            """
            WITH selected AS (
                SELECT type, COALESCE(analytics_category, 'Lainnya') AS category,
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

        category = data.get("category")
        amount = data.get("amount")
        note = data.get("note")
        transaction_type = data.get("type")

        if not category or amount is None or not transaction_type:
            return {
                "success": False,
                "message": "Data transaksi tidak lengkap."
            }, 400

        currency = data.get("currency", "IDR")
        if not isinstance(currency, str) or currency.strip().upper() not in {"IDR", "RP"}:
            return {"success": False, "message": IDR_ONLY_MESSAGE}, 400
        amount = parse_idr_amount(amount)
        if amount is None:
            return {"success": False, "message": "Nominal harus Rupiah bulat positif."}, 400

        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            UPDATE expenses
            SET
                category = %s,
                amount = %s,
                note = %s,
                type = %s
            WHERE user_id = %s AND currency = 'IDR'
            AND transaction_id = %s
            """,
            (
                category,
                amount,
                note,
                transaction_type,
                user_id,
                transaction_id,
            ),
        )

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


if __name__ == "__main__":
    from waitress import serve
    serve(app, host="0.0.0.0", port=int(os.getenv("PORT", "5000")))