// Real DOM checks run within all eight existing browser/XSS/layout scenarios.
module.exports = async function wave1Checks() {
    let checks = 0;
    const check = (value, label) => {if (!value) throw Error('Wave 1: ' + label); checks++;};
    const originalFetch = window.fetch;
    const originalMonth = homeMonth.selected;
    const originalCalendar = calendarViewDate;
    const pending = [];
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const response = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});
    try {
        await Promise.all([loadSummary(), loadCategories(), loadRecentTransactions()]);
        window.fetch = url => new Promise((resolve, reject) => pending.push({url, resolve, reject}));
        for (const [load, value, payload] of [
            [loadSummary, () => document.getElementById('balance').textContent, n => ({income: n, expense: 0, balance: n})],
            [loadCategories, () => document.getElementById('donutTotal').textContent, n => [{category: 'Food', total: n}]],
            [loadRecentTransactions, () => document.getElementById('transactionList').textContent,
                n => [{category: 'Food', amount: n, date: originalMonth + '-01', type: 'expense', note: ''}]]
        ]) {
            let start = pending.length;
            const old = load(); await tick();
            const latest = load(); await tick();
            pending[start + 1].resolve(response(payload(200))); await latest;
            pending[start].resolve(response(payload(100))); await old;
            check(value().includes('200') && !value().includes('100'), 'latest response wins');
            start = pending.length;
            const failure = load(); await tick();
            const success = load(); await tick();
            pending[start + 1].resolve(response(payload(300))); await success;
            pending[start].reject(new Error('old request failure')); await failure;
            check(value().includes('300'), 'obsolete failure ignored');
        }
        let start = pending.length;
        const failedCategories = loadCategories(); await tick();
        pending[start].reject(new Error('offline')); await failedCategories;
        check(expenseDonutChartInstance === null, 'error disposes donut');
        check(document.getElementById('donutTotal').textContent === 'Tidak tersedia', 'error is not zero');
        document.getElementById('overviewMenu').click();
        const total = document.getElementById('donutTotal');
        const bounds = total.getBoundingClientRect();
        const wrapper = total.parentElement.getBoundingClientRect();
        check(bounds.width > 0 && bounds.left >= wrapper.left && bounds.right <= wrapper.right + 1, 'error label fits donut');
        check(document.documentElement.scrollWidth <= innerWidth, 'error state does not overflow viewport');
        start = pending.length;
        const empty = loadCategories(); await tick(); pending[start].resolve(response([])); await empty;
        check(total.textContent === 'Rp0', 'successful empty remains zero');
        for (const [y, m, d, arrow, expectedYear, expectedMonth] of [
            [2026, 0, 29, 'calendarNext', 2026, 1], [2026, 0, 30, 'calendarNext', 2026, 1],
            [2026, 0, 31, 'calendarNext', 2026, 1], [2026, 2, 31, 'calendarPrev', 2026, 1],
            [2026, 11, 31, 'calendarNext', 2027, 0], [2027, 0, 31, 'calendarPrev', 2026, 11]
        ]) {
            calendarViewDate = new Date(y, m, d);
            document.getElementById(arrow).click();
            check(calendarViewDate.getFullYear() === expectedYear && calendarViewDate.getMonth() === expectedMonth
                && calendarViewDate.getDate() === 1, 'adjacent calendar month and year');
        }
        return checks;
    } finally {
        window.fetch = originalFetch;
        homeMonth.selected = originalMonth;
        calendarViewDate = originalCalendar;
        await Promise.all([loadSummary(), loadCategories(), loadRecentTransactions()]);
    }
};
