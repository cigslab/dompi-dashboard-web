/* Prices and eligibility are returned only by the authenticated server. */
(() => {
    'use strict';
    const app = window.Telegram?.WebApp;
    const status = document.getElementById('upgradeStatus');
    const products = document.getElementById('upgradeProducts');
    const retry = document.getElementById('upgradeRetry');
    const checkoutStatus = document.getElementById('checkoutStatus');
    const link = document.getElementById('checkoutLink');
    const names = {
        starter_lifetime: 'Starter Lifetime',
        pro_lifetime: 'Pro Lifetime',
        starter_to_pro_lifetime: 'Upgrade ke Pro'
    };
    let busy = false;
    let finishedAttempt = false;
    async function api(path, options = {}) {
        if (!app?.initData) throw new Error('unauthorized');
        const response = await fetch(path, {
            ...options, credentials: 'omit', cache: 'no-store',
            headers: {'Authorization': `tma ${app.initData}`, 'Content-Type': 'application/json'}
        });
        const data = await response.json();
        if (!response.ok) {
            const error = new Error(response.status === 401 ? 'unauthorized' : data.error);
            error.paymentId = data.payment_id;
            throw error;
        }
        return data;
    }
    function safeRedirect(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password &&
                !url.port && ['app.midtrans.com', 'app.sandbox.midtrans.com'].includes(url.hostname) &&
                url.pathname.startsWith('/snap/');
        } catch (_) { return false; }
    }
    function setDisabled(value) {
        products.querySelectorAll('button').forEach(button => { button.disabled = value; });
    }
    async function buy(code) {
        if (busy || finishedAttempt) return;
        busy = true;
        setDisabled(true);
        checkoutStatus.textContent = 'Menyiapkan pembayaran…';
        try {
            const order = await api('/api/checkout/orders', {
                method: 'POST', body: JSON.stringify({product_code: code})
            });
            if (!safeRedirect(order.redirect_url)) throw new Error('invalid_redirect');
            link.href = order.redirect_url;
            link.hidden = false;
            checkoutStatus.textContent = `Order ${order.payment_id} siap. Lanjutkan pembayaran melalui tombol di bawah.`;
        } catch (error) {
            checkoutStatus.textContent = error.message === 'unauthorized'
                ? 'Sesi berakhir. Buka ulang Dompi dari Telegram.'
                : `Checkout belum dapat dilanjutkan.${error.paymentId ? ' Order ' + error.paymentId + '.' : ''} Periksa status atau hubungi @pakedompi sebelum mencoba pembayaran lagi.`;
        } finally {
            // A lost response can still mean a committed order; no blind retry.
            busy = false;
            finishedAttempt = true;
        }
    }
    async function load() {
        retry.hidden = true;
        products.replaceChildren();
        status.textContent = 'Memuat paket akun…';
        try {
            const data = await api('/api/checkout/products');
            const entitlement = data.entitlement;
            if (data.lifetime_plan === 'pro') {
                status.textContent = 'Kamu sudah menggunakan Pro Lifetime';
                return;
            }
            status.textContent = data.lifetime_plan === 'starter' ? 'Starter Lifetime' : 'Paket Free';
            if (entitlement.entitlement_source === 'pro_legacy' && entitlement.legacy_expires_at) {
                const expiry = new Date(entitlement.legacy_expires_at);
                const formatted = Number.isNaN(expiry.getTime()) ? '' :
                    expiry.toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'});
                status.textContent = (data.lifetime_plan === 'starter' ? 'Starter Lifetime · ' : '') +
                    'Pro aktif sampai ' + formatted;
            }
            for (const product of data.products) {
                if (!Object.hasOwn(names, product.product_code)) continue;
                const card = document.createElement('div');
                const title = document.createElement('h2');
                title.textContent = names[product.product_code];
                const price = document.createElement('p');
                price.textContent = new Intl.NumberFormat('id-ID', {
                    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
                }).format(product.amount);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'upgrade-cta';
                button.textContent = data.checkout_available ? 'Pilih ' + names[product.product_code] : 'Checkout belum tersedia';
                button.disabled = !data.checkout_available || finishedAttempt;
                button.addEventListener('click', () => buy(product.product_code));
                card.append(title, price, button);
                products.append(card);
            }
        } catch (error) {
            status.textContent = error.message === 'unauthorized'
                ? 'Buka Dompi melalui Telegram untuk melihat paket dan melanjutkan pembayaran.'
                : 'Paket belum dapat dimuat. Coba lagi atau hubungi @pakedompi.';
            retry.hidden = error.message === 'unauthorized';
        }
    }
    retry.addEventListener('click', load);
    load();
})();
