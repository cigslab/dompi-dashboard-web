(() => {
    'use strict';
    const panel = document.getElementById('coreV2Panel');
    if (!panel) return;
    const el = suffix => document.getElementById('coreV2' + suffix);
    let busy = false, usageCursor = null, creditCursor = null;
    const keys = new Map();
    const text = (tag, value) => {
        const node = document.createElement(tag);
        node.textContent = String(value);
        return node;
    };
    async function read(path, options) {
        const response = await apiFetch('/api/core-v2/' + path, options);
        if (!response.ok) throw new Error('request_failed');
        return response.json();
    }
    function rows(suffix, values, format, append = false) {
        if (!append) el(suffix).replaceChildren();
        for (const value of values) el(suffix).appendChild(text('li', format(value)));
    }
    async function history(kind, more = false) {
        const cursor = kind === 'usage' ? usageCursor : creditCursor;
        const result = await read(kind + (more && cursor ? '?before=' + encodeURIComponent(cursor) : ''));
        if (kind === 'usage') {
            rows('Usage', result.items || [], r => `${r.created_at} · ${r.feature} · ${r.state} · ${r.funding} · ${r.credits} kredit`, more);
            usageCursor = result.next_cursor; el('MoreUsage').hidden = !usageCursor;
        } else {
            rows('Credits', result.items || [], r => `${r.created_at} · ${r.kind} · ${r.amount} kredit`, more);
            creditCursor = result.next_cursor; el('MoreCredits').hidden = !creditCursor;
        }
    }
    async function load() {
        el('Balance').textContent = ''; el('OrderForm').hidden = true;
        for (const list of ['Quota','Usage','Credits','Orders']) el(list).replaceChildren();
        el('MoreUsage').hidden = el('MoreCredits').hidden = true;
        const result = await read('overview');
        if (result.cohort === 'legacy') {
            el('Status').textContent = 'Hak paket lama tetap berlaku. Akun ini belum menggunakan kuota atau kredit v2.';
            return;
        }
        el('Balance').textContent = `${result.available} kredit tersedia · ${result.reserved} ditahan · saldo ${result.balance}`;
        rows('Quota', result.quotas, q => `${q.feature}: ${q.used}/${q.included} terpakai, ${q.reserved} ditahan, ${q.remaining} tersedia (${result.channel})`);
        await history('usage'); await history('credits');
        const orders = await read('orders');
        rows('Orders', orders.items, r => `${r.id} · Rp${r.price_idr} · ${r.credits} kredit · ${r.status}`);
        el('Product').replaceChildren();
        for (const product of result.products) {
            const option = text('option', `${product.credits} kredit — Rp${product.price_idr}`);
            option.value = product.code; el('Product').appendChild(option);
        }
        el('OrderForm').hidden = result.orders_enabled !== true;
        el('Status').textContent = `Periode kuota ${result.period_start} sampai ${result.period_end}. Saldo top-up tidak direset bulanan.`;
    }
    async function perform(action) {
        if (busy) return;
        busy = true; el('Refresh').disabled = el('OrderSubmit').disabled = true;
        el('Status').textContent = 'Memuat…';
        try { await action(); }
        catch (_) { el('Status').textContent = 'Belum dapat memuat hasil. Coba lagi dengan permintaan yang sama; jangan membayar ulang.'; }
        finally { busy = false; el('Refresh').disabled = el('OrderSubmit').disabled = false; }
    }
    el('Refresh').addEventListener('click', () => perform(load));
    el('MoreUsage').addEventListener('click', () => perform(async () => {
        await history('usage', true); el('Status').textContent = 'Histori pemakaian diperbarui.';
    }));
    el('MoreCredits').addEventListener('click', () => perform(async () => {
        await history('credits', true); el('Status').textContent = 'Histori kredit diperbarui.';
    }));
    el('OrderForm').addEventListener('submit', event => {
        event.preventDefault();
        if (el('OrderForm').hidden) return;
        perform(async () => {
            const code = el('Product').value;
            if (!keys.has(code)) keys.set(code, crypto.randomUUID());
            await read('orders', {method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({product_code:code,idempotency_key:keys.get(code)})});
            await load();
        });
    });
})();
