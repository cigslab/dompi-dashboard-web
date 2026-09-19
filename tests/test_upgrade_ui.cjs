// Actual upgrade renderer, no browser/provider network; unsafe HTML sinks fail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/upgrade.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../templates/upgrade.html'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
class Element {
    constructor(tag = 'div') {
        this.tag = tag; this.hidden = false; this.disabled = false;
        this.children = []; this.listeners = {}; this.textContent = '';
    }
    set innerHTML(_) { throw new Error('Unsafe HTML sink'); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) {
        assert(!this.listeners[name], 'Duplicate listener');
        this.listeners[name] = callback;
    }
    querySelectorAll(tag) {
        return this.children.flatMap(child => [
            ...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)
        ]);
    }
    click() { return this.listeners.click?.(); }
}
const products = {
    starter_lifetime: {product_code: 'starter_lifetime', amount: 99000},
    pro_lifetime: {product_code: 'pro_lifetime', amount: 129000},
    starter_to_pro_lifetime: {product_code: 'starter_to_pro_lifetime', amount: 30000}
};
function offer(lifetime = null, source = 'free', codes = ['starter_lifetime', 'pro_lifetime']) {
    return {lifetime_plan: lifetime, entitlement: {entitlement_source: source,
        effective_plan: source === 'starter_lifetime' ? 'starter' : source === 'free' ? 'free' : 'pro',
        legacy_expires_at: source === 'pro_legacy' ? '2099-01-01T00:00:00' : null},
        products: codes.map(code => products[code]), checkout_available: true};
}
function setup(data = offer(), opts = {}) {
    const elements = new Map();
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
        elements.set(id, new Element());
    }
    elements.get('checkoutLink').hidden = true;
    elements.get('upgradeRetry').hidden = true;
    const calls = [];
    const context = vm.createContext({
        Intl, Date, Number, URL,
        window: {Telegram: {WebApp: {initData: opts.noAuth ? '' : 'signed-init-data'}}},
        document: {getElementById: id => elements.get(id), createElement: tag => new Element(tag)},
        fetch: async (url, options) => {
            calls.push([url, options]);
            assert.equal(options.headers.Authorization, 'tma signed-init-data');
            assert.equal(options.credentials, 'omit');
            if (url === '/api/checkout/products') {
                if (opts.loading) await opts.loading;
                return {ok: !opts.fail, status: opts.fail || 200,
                    json: async () => opts.fail ? {error: 'unavailable'} : data};
            }
            assert.equal(url, '/api/checkout/orders');
            assert.equal(options.method, 'POST');
            assert.deepEqual(Object.keys(JSON.parse(options.body)), ['product_code']);
            if (opts.saving) await opts.saving;
            return {ok: !opts.orderFail, status: opts.orderFail || 201,
                json: async () => opts.orderFail
                    ? {error: 'pending_order_exists', payment_id: '<img src=x onerror=alert(1)>'}
                    : {payment_id: 'PAY001', redirect_url: opts.redirect || 'https://app.sandbox.midtrans.com/snap/v2/vtweb/test'}};
        }
    });
    vm.runInContext(source, context);
    return {el: id => elements.get(id), calls,
        buttons: () => elements.get('upgradeProducts').querySelectorAll('button')};
}
let checks = 0;
(async () => {
    assert(!source.includes('initDataUnsafe'));
    assert(!source.includes('innerHTML'));
    let resolveLoad;
    let s = setup(offer(), {loading: new Promise(resolve => {resolveLoad = resolve;})});
    assert.match(s.el('upgradeStatus').textContent, /Memuat/);
    assert.equal(s.buttons().length, 0);
    resolveLoad(); await flush();
    assert.equal(s.buttons().length, 2);
    assert.deepEqual(s.el('upgradeProducts').children.map(c => c.children[1].textContent.replace(/\s/g, '')), ['Rp99.000', 'Rp129.000']);
    checks++;

    s = setup(offer('starter', 'starter_lifetime', ['starter_to_pro_lifetime']));
    await flush();
    assert.equal(s.el('upgradeStatus').textContent, 'Starter Lifetime aktif');
    assert.equal(s.buttons().length, 1);
    assert.equal(s.buttons()[0].textContent, 'Upgrade ke Pro');
    assert.equal(s.el('upgradeProducts').children[0].children[1].textContent.replace(/\s/g, ''), 'TambahRp30.000');
    assert.match(s.el('upgradeProducts').children[0].children[2].textContent, /Selisih harga/);
    await s.buttons()[0].click();
    assert.deepEqual(JSON.parse(s.calls[1][1].body), {product_code: 'starter_to_pro_lifetime'});
    checks++;

    s = setup(offer('pro', 'pro_lifetime', [])); await flush();
    assert.equal(s.buttons().length, 0);
    assert.equal(s.el('upgradeStatus').textContent, 'Kamu sudah menggunakan Pro Lifetime');
    checks++;

    s = setup(offer(null, 'pro_legacy')); await flush();
    assert.match(s.el('upgradeStatus').textContent, /Pro aktif sampai 1 Jan 2099/);
    assert.equal(s.buttons().length, 2);
    s = setup(offer('starter', 'pro_legacy', ['starter_to_pro_lifetime'])); await flush();
    assert.match(s.el('upgradeStatus').textContent, /Starter Lifetime · Pro aktif/);
    assert.equal(s.buttons().length, 1);
    assert.equal(s.buttons()[0].textContent, 'Upgrade ke Pro'); checks++;

    // A legacy-only account never gets the differential upgrade offer.
    s = setup(offer(null, 'pro_legacy')); await flush();
    assert(!s.buttons().some(button => button.textContent === 'Upgrade ke Pro'));
    assert.deepEqual(s.el('upgradeProducts').children.map(c => c.children[1].textContent.replace(/\s/g, '')), ['Rp99.000', 'Rp129.000']);
    // Expired legacy follows the API resolver; no client-side lifetime conversion.
    s = setup(offer(null, 'free')); await flush();
    assert.equal(s.el('upgradeStatus').textContent, 'Paket Free');
    s = setup(offer('starter', 'starter_lifetime', ['starter_to_pro_lifetime']));
    await flush();
    assert.equal(s.el('upgradeStatus').textContent, 'Starter Lifetime aktif'); checks++;

    s = setup({...offer('starter', 'starter_lifetime', ['starter_to_pro_lifetime']), checkout_available: false});
    await flush();
    assert.equal(s.buttons().length, 1);
    assert(s.buttons()[0].disabled);
    assert.equal(s.buttons()[0].textContent, 'Checkout belum tersedia'); checks++;

    s = setup(offer(), {noAuth: true}); await flush();
    assert.equal(s.calls.length, 0);
    assert.equal(s.buttons().length, 0);
    assert.match(s.el('upgradeStatus').textContent, /Telegram/); checks++;

    for (const fail of [401, 409, 503]) {
        s = setup(offer(), {fail}); await flush();
        assert.equal(s.buttons().length, 0);
        assert.equal(s.el('upgradeRetry').hidden, fail === 401);
        if (fail !== 401) { await s.el('upgradeRetry').click(); assert.equal(s.calls.length, 2); }
    }
    checks++;

    let release;
    s = setup(offer(), {saving: new Promise(resolve => {release = resolve;})}); await flush();
    const button = s.buttons()[0];
    const first = button.click(); const second = button.click();
    assert.equal(s.calls.filter(c => c[0].endsWith('/orders')).length, 1);
    assert(s.buttons().every(b => b.disabled));
    release(); await first; await second;
    assert.equal(s.el('checkoutLink').hidden, false);
    assert.equal(s.el('checkoutLink').href, 'https://app.sandbox.midtrans.com/snap/v2/vtweb/test');
    assert.deepEqual(JSON.parse(s.calls[1][1].body), {product_code: 'starter_lifetime'});
    await button.click();
    assert.equal(s.calls.length, 2); checks++;

    for (const redirect of ['javascript:alert(1)', 'https://evil.test/snap/a', 'https://app.midtrans.com@evil.test/snap/a']) {
        s = setup(offer(), {redirect}); await flush(); await s.buttons()[0].click();
        assert.equal(s.el('checkoutLink').hidden, true);
        assert.match(s.el('checkoutStatus').textContent, /belum dapat/);
    }
    checks++;

    s = setup(offer(), {orderFail: 409}); await flush(); await s.buttons()[0].click();
    assert.equal(s.el('checkoutLink').hidden, true);
    assert.match(s.el('checkoutStatus').textContent, /<img/); // inert text, never HTML
    await s.buttons()[0].click(); assert.equal(s.calls.length, 2); checks++;

    s = setup({...offer(), checkout_available: false}); await flush();
    assert(s.buttons().every(b => b.disabled));
    assert.match(html, /Export Data CSV/);
    assert.match(html, /Analitik lanjutan belum tersedia/);
    assert.doesNotMatch(html, /Export dan analitik lanjutan belum tersedia/);
    assert.match(html, /setelah pembayaran diverifikasi/); checks++;
    console.log(checks + ' upgrade UI checks passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
