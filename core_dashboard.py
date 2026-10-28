"""Additive v2 APIs; existing Telegram HMAC and paid-access middleware applies."""
import os
from flask import g,request,jsonify


def enabled():
    return os.getenv('DOMPI_CORE_V2_DASHBOARD_ENABLED','')=='1'


def orders_enabled():
    return os.getenv('DOMPI_CORE_V2_TOPUP_ORDERS_ENABLED','')=='1'


def register(app,connect):
    @app.context_processor
    def core_context():
        return {'core_v2_dashboard_enabled':enabled()}

    def run(action):
        if not enabled(): return jsonify(error='not_found'),404
        try:
            from dompi_core.storage.commerce import PostgresCommerce
            from dompi_core.errors import CoreError,ErrorCode
            service=app.extensions.get('core_v2_commerce')
            if service is None: service=PostgresCommerce(connect)
            identity=service.identity(g.user_id)
            if identity is None: return jsonify(cohort='legacy',checkout_available=False,orders_enabled=False)
            try: return action(service,identity)
            except CoreError as error:
                if error.code==ErrorCode.LEGACY_POLICY_REQUIRED:
                    return jsonify(cohort='legacy',checkout_available=False,orders_enabled=False)
                return jsonify(error=error.code.value),503 if error.code==ErrorCode.TEMPORARILY_UNAVAILABLE else 409
        except (ValueError,TypeError): return jsonify(error='invalid_request'),400
        except Exception: return jsonify(error='core_unavailable'),503

    @app.get('/api/core-v2/overview')
    def core_overview():
        def view(service,identity):
            result=service.overview(identity)
            result['orders_enabled']=orders_enabled()
            return jsonify(result)
        return run(view)

    @app.get('/api/core-v2/usage')
    def core_usage():
        return run(lambda s,i:jsonify(s.history(i,before=request.args.get('before'),limit=int(request.args.get('limit','25')))))

    @app.get('/api/core-v2/credits')
    def core_credits():
        return run(lambda s,i:jsonify(s.credits(i,before=int(request.args['before']) if 'before' in request.args else None,
                                            limit=int(request.args.get('limit','25')))))

    @app.route('/api/core-v2/orders',methods=['GET','POST'])
    def core_orders():
        def action(service,identity):
            if request.method=='GET': return jsonify(items=service.orders(identity))
            if not orders_enabled(): return jsonify(error='orders_disabled'),403
            data=request.get_json(silent=True)
            if (not isinstance(data,dict) or set(data)!={'product_code','idempotency_key'} or
                    not isinstance(data['product_code'],str) or not isinstance(data['idempotency_key'],str)):
                return jsonify(error='invalid_request'),400
            reference=app.config.get('CORE_V2_LYNK_PRODUCTS',{}).get(data['product_code'])
            if not reference: return jsonify(error='provider_product_unavailable'),503
            order=service.order(identity,data['product_code'],data['idempotency_key'],product_reference=reference)
            return jsonify(order=order,checkout_available=False)
        return run(action)
