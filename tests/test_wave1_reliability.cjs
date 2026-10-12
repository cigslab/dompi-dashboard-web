// Execute production inline scripts with controlled responses; no network/services.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('templates/dashboard.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
function element() {
    const children = [], selected = new Map();
    let text = '';
    return {get textContent() {return text;}, set textContent(value) {text = value; children.length = 0;}, style: {}, children, classList: {add() {}, remove() {}, contains() {return false;}},
        dataset: {}, addEventListener() {}, appendChild(item) {children.push(item);},
        replaceChildren(...items) {children.splice(0, children.length, ...items);},
        querySelector(key) {if (!selected.has(key)) selected.set(key, element()); return selected.get(key);},
        querySelectorAll() {return []}, set innerHTML(value) {children.length = 0; this.textContent = value;}};
}
function harness(loader) {
    const nodes = new Map(), calls = [], charts = [];
    const el = id => {if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id);};
    const context = vm.createContext({console: {error() {}}, Intl, Date, Number, URLSearchParams,
        HomeMonth: require('../static/home-month.js'),
        homeMonth: {selected: '2026-10', url(path) {return path + '?month=' + this.selected;}, rows: rows => rows},
        DashboardAccess: {allow: async () => true, isPro: () => true}, DompiTheme: {color: () => '#000'},
        formatRupiah: n => 'Rp' + n,
        document: {getElementById: el,
            createElement: element, addEventListener() {}, querySelectorAll() {return []}},
        apiFetch: url => new Promise((resolve, reject) => calls.push({url, resolve, reject})),
        Chart: class {constructor(canvas, config) {this.config = config; this.destroyed = false; charts.push(this);} destroy() {this.destroyed = true;}}
    });
    let source = scripts.find(s => s.includes('async function ' + loader + '('));
    // Prevent the script's startup call; tests explicitly control every request.
    source = source.replace(new RegExp('^' + loader + '\\(\\);', 'm'), '');
    vm.runInContext(source, context);
    return {context, calls, charts, el, load: () => context[loader]()};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const respond = (call, data) => call.resolve({ok: true, json: async () => data});
function payload(loader, n) {
    if (loader === 'loadSummary') return {income: n, expense: 0, balance: n};
    if (loader === 'loadCategories') return [{category: 'Food', total: n}];
    return [{category: 'Food', amount: n, date: '2026-10-01', type: 'expense', note: ''}];
}
function visible(h, loader) {
    if (loader === 'loadSummary') return h.el('balance').textContent;
    if (loader === 'loadCategories') return h.el('donutTotal').textContent;
    return h.el('transactionList').children[0]?.querySelector('.transaction-amount').textContent || h.el('transactionList').textContent;
}
for (const loader of ['loadSummary', 'loadCategories', 'loadRecentTransactions']) {
    test(loader + ': newest same-month response wins', async () => {
        const h = harness(loader), old = h.load(); await tick();
        const latest = h.load(); await tick();
        respond(h.calls[1], payload(loader, 200)); await latest;
        respond(h.calls[0], payload(loader, 100)); await old;
        assert.match(visible(h, loader), /200/);
    });
    test(loader + ': obsolete failure cannot overwrite newer data', async () => {
        for (const switchMonth of [false, true]) {
            const h = harness(loader), old = h.load(); await tick();
            if (switchMonth) h.context.homeMonth.selected = '2026-11';
            const latest = h.load(); await tick();
            respond(h.calls[1], payload(loader, 200)); await latest;
            h.calls[0].reject(new Error('old failure')); await old;
            assert.match(visible(h, loader), /200/);
        }
    });
}
test('categories: current failure destroys old chart; zero means successful empty only', async () => {
    const h = harness('loadCategories');
    let request = h.load(); await tick(); respond(h.calls[0], payload('loadCategories', 100)); await request;
    const chart = h.charts[0]; assert(chart);
    request = h.load(); await tick(); h.calls[1].reject(new Error('offline')); await request;
    assert.equal(chart.destroyed, true);
    assert.notEqual(h.el('donutTotal').textContent, 'Rp0');
    assert.match(h.el('donutLegend').textContent, /Gagal/);
    request = h.load(); await tick(); respond(h.calls[2], []); await request;
    assert.equal(h.el('donutTotal').textContent, 'Rp0');
    request = h.load(); await tick(); respond(h.calls[3], payload('loadCategories', 200)); await request;
    assert.equal(h.charts.length, 2); assert.equal(h.charts[1].destroyed, false);
});
test('calendar arrows preserve adjacent month on days 29–31 and year boundaries', () => {
    const handlers = {};
    const source = scripts.find(s => s.includes('calendarPrev.addEventListener'));
    const arrows = source.slice(source.indexOf('calendarPrev.addEventListener'), source.indexOf('// Membuat pilihan 3 bulan'));
    const context = vm.createContext({calendarPrev: {addEventListener: (_, fn) => handlers.prev = fn},
        calendarNext: {addEventListener: (_, fn) => handlers.next = fn}, renderCalendar() {}});
    vm.runInContext(arrows, context);
    for (const [y, m, d, direction, expected] of [
        [2026, 0, 29, 'next', [2026, 1]], [2026, 0, 30, 'next', [2026, 1]],
        [2026, 0, 31, 'next', [2026, 1]], [2026, 2, 31, 'prev', [2026, 1]],
        [2026, 11, 31, 'next', [2027, 0]], [2027, 0, 31, 'prev', [2026, 11]],
        [2028, 0, 31, 'next', [2028, 1]]]) {
        context.calendarViewDate = new Date(y, m, d); handlers[direction]();
        assert.deepEqual([context.calendarViewDate.getFullYear(), context.calendarViewDate.getMonth()], expected);
        assert.equal(context.calendarViewDate.getDate(), 1);
    }
});
