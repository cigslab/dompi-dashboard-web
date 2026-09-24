(() => {
let analyticsRequest = 0;

function openCategoryTransactions(category, period, kind = 'expense') {
    const dialog = document.createElement('dialog');
    dialog.className = 'category-drill';
    const title = document.createElement('h2');
    title.id = 'categoryDrillTitle';
    title.textContent = category;
    dialog.setAttribute('aria-labelledby', title.id);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Tutup';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const list = document.createElement('div');
    const previous = document.createElement('button');
    previous.textContent = 'Sebelumnya';
    const next = document.createElement('button');
    next.textContent = 'Berikutnya';
    const retry = document.createElement('button');
    retry.textContent = 'Coba lagi';
    for (const button of [previous, next, retry]) button.type = 'button';
    let page = 1;
    let request = 0;
    let closed = false;
    dialog.addEventListener('close', () => { closed = true; ++request; dialog.remove(); });
    close.addEventListener('click', () => dialog.close());
    async function load(target) {
        const current = ++request;
        previous.disabled = next.disabled = true;
        retry.hidden = true;
        list.replaceChildren();
        status.textContent = 'Memuat transaksi…';
        try {
            const query = new URLSearchParams({...period, category, type: kind, page: String(target)});
            const response = await apiFetch((kind === 'mismatch' ? '/api/transactions/type-review?' : '/api/categories/transactions?') + query);
            if (!response.ok) throw new Error('Drill-down failed');
            const data = await response.json();
            if (closed || current !== request) return;
            page = target;
            for (const item of data.items) {
                const row = document.createElement('article');
                for (const value of [item.description || '—', item.date, formatRupiah(item.amount), item.note || '—', kind === 'mismatch' ? (item.type === 'income' ? 'Jenis: Pemasukan' : 'Jenis: Pengeluaran') : item.category]) {
                    const text = document.createElement('p');
                    text.textContent = value;
                    row.append(text);
                }
                const edit = document.createElement('button');
                edit.type = 'button';
                edit.textContent = kind === 'mismatch' ? 'Perbaiki transaksi' : 'Edit transaksi';
                edit.addEventListener('click', () => {
                    dialog.close();
                    openTransactionEditor({...item, type: item.type || kind});
                });
                row.append(edit);
                if (kind === 'mismatch') {
                    const confirm = document.createElement('button');
                    confirm.type = 'button';
                    confirm.textContent = 'Sudah benar';
                    confirm.addEventListener('click', async () => {
                        if (confirm.disabled) return;
                        confirm.disabled = edit.disabled = true;
                        status.textContent = 'Menyimpan konfirmasi…';
                        try {
                            const result = await apiFetch(`/api/transactions/${item.transaction_id}/type-review/confirm`, {
                                method: 'POST', headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({fingerprint: item.fingerprint})
                            });
                            if (!result.ok) throw new Error('Confirmation failed');
                            row.remove();
                            await window.loadAnalytics();
                            if (!closed) await load(page);
                        } catch (_) {
                            if (closed) return;
                            status.textContent = 'Gagal mengonfirmasi. Muat ulang atau coba lagi.';
                            confirm.disabled = edit.disabled = false;
                            retry.hidden = false;
                            retry.onclick = () => load(page);
                        }
                    });
                    row.append(confirm);
                }
                list.append(row);
            }
            if (kind === 'mismatch' && data.count === 0) { dialog.close(); return; }
            if (kind === 'mismatch' && !data.items.length && page > 1) { await load(page - 1); return; }
            status.textContent = data.items.length ? `Halaman ${page}` : 'Tidak ada transaksi pada halaman ini.';
            previous.disabled = page <= 1;
            next.disabled = !data.has_more;
        } catch (error) {
            if (closed || current !== request) return;
            status.textContent = 'Gagal memuat transaksi. Silakan coba lagi.';
            retry.hidden = false;
            retry.onclick = () => load(target);
            previous.disabled = page <= 1;
        }
    }
    previous.addEventListener('click', () => load(page - 1));
    next.addEventListener('click', () => load(page + 1));
    dialog.append(title, close, status, list, previous, next, retry);
    document.body.append(dialog);
    dialog.showModal();
    load(1);
}

function shiftMonth(month, offset) {
    const [year, number] = month.split('-').map(Number);
    const value = new Date(year, number - 1 + offset, 1);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(month, long = false) {
    return new Date(month + '-01T00:00:00').toLocaleDateString('id-ID', {month: long ? 'long' : 'short', year: 'numeric'});
}
function selectedPeriod() {
    const count = Number(document.getElementById('analyticsPeriod').value);
    if (![1, 3, 6, 12].includes(count)) throw new Error('Invalid period');
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const months = Array.from({length: count}, (_, index) => shiftMonth(current, index - count + 1));
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return {months, current, start: months[0] + '-01', end: current + '-' + lastDay};
}
function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}
const text = (id, value) => { document.getElementById(id).textContent = value; };
function renderSummary(months, data) {
    const selected = data.filter(item => months.includes(item.month));
    const income = selected.reduce((total, item) => total + item.income, 0);
    const expense = selected.reduce((total, item) => total + item.expense, 0);
    text('analyticsIncome', formatRupiah(income));
    text('analyticsExpense', formatRupiah(expense));
    text('analyticsBalance', formatRupiah(income - expense));
}
function renderTrend(months, data) {
    const container = document.getElementById('cashflowChartArea');
    container.replaceChildren();
    const records = months.map(month => data.find(item => item.month === month) || {month, income: 0, expense: 0});
    const max = Math.max(1, ...records.flatMap(item => [item.income, item.expense]));
    if (records.every(item => !item.income && !item.expense)) {
        container.append(node('p', 'analytics-empty', 'Belum ada cashflow pada periode ini.'));
        return;
    }
    const chart = node('div', 'cashflow-chart');
    chart.style.gridTemplateColumns = `repeat(${months.length}, minmax(0, 1fr))`;
    const dense = months.length > 6;
    chart.classList.toggle('cashflow-dense', dense);
    records.forEach((item, index) => {
        const group = node('div', 'cashflow-month');
        group.tabIndex = 0;
        const label = `${monthLabel(item.month, true)}. Pemasukan ${formatRupiah(item.income)}. Pengeluaran ${formatRupiah(item.expense)}.`;
        group.setAttribute('role', 'img');
        group.setAttribute('aria-label', label);
        group.title = label;
        const bars = node('div', 'cashflow-bars');
        for (const [kind, name] of [['income', 'Pemasukan'], ['expense', 'Pengeluaran']]) {
            const bar = node('div', 'cashflow-bar ' + kind + '-bar');
            bar.style.height = `${Math.max(0, Math.min(100, item[kind] / max * 100))}%`;
            bar.title = name + ': ' + formatRupiah(item[kind]);
            bars.append(bar);
        }
        const monthText = new Date(item.month + '-01T00:00:00').toLocaleDateString('id-ID', {month: 'short'});
        const tick = node('span', 'cashflow-month-label', monthText);
        tick.setAttribute('aria-hidden', 'true');
        if (dense && index % 2 === 1 && index !== months.length - 1) tick.classList.add('cashflow-tick-muted');
        group.append(bars, tick);
        group.addEventListener('click', () => text('cashflowDetail', label));
        group.addEventListener('focus', () => text('cashflowDetail', label));
        chart.append(group);
    });
    container.append(node('p', 'analytics-muted cashflow-scale', 'Skala maksimum ' + formatRupiah(max)), chart,
        Object.assign(node('p', 'analytics-muted cashflow-detail', 'Ketuk bulan untuk melihat nominal.'), {id: 'cashflowDetail'}));
}
const categoryIcons = {'Makan & Minum': '☕', 'Transportasi': '↗', 'Belanja': '▣', 'Tagihan & Utilitas': 'ϟ',
    'Tempat Tinggal': '⌂', 'Kesehatan': '+', 'Pendidikan': '▤', 'Hiburan & Lifestyle': '♫',
    'Langganan & Digital': '▣', 'Keuangan & Cicilan': '↔', 'Rokok & Vape': '≈', 'Lainnya': '•••'};
function renderCategories(data, period) {
    const list = document.getElementById('categoriesList');
    list.replaceChildren();
    const ordinary = data.categories.filter(item => !['Perlu ditinjau', '__remaining__'].includes(item.category));
    ordinary.sort((a, b) => b.total - a.total);
    const total = ordinary.reduce((sum, item) => sum + item.total, 0);
    const colors = ['#88b9a4', '#8baec7', '#b9a5c9', '#c6b186', '#b88991', '#8eb4b6'];
    ordinary.forEach((item, index) => {
        const share = total > 0 ? item.total / total * 100 : 0;
        const row = node('button', 'category-ranking-row category-drill-trigger');
        row.type = 'button';
        row.addEventListener('click', () => openCategoryTransactions(item.category, {start: period.start, end: period.end}));
        const icon = node('span', 'category-ranking-icon', categoryIcons[item.category] || '◈');
        icon.setAttribute('aria-hidden', 'true');
        icon.style.color = colors[index % colors.length];
        const name = node('span', 'analytics-category-name', item.category);
        const amount = node('strong', 'categories-amount', formatRupiah(item.total));
        const percent = node('span', 'categories-percent', share.toLocaleString('id-ID', {maximumFractionDigits: 1}) + '%');
        const track = node('span', 'category-track');
        track.setAttribute('aria-hidden', 'true');
        const fill = node('span');
        fill.style.width = `${Math.max(0, Math.min(100, share))}%`;
        fill.style.backgroundColor = colors[index % colors.length];
        track.append(fill);
        row.append(icon, name, amount, track, percent);
        list.append(row);
    });
    text('categoriesStatus', ordinary.length ? '' : 'Belum ada pengeluaran terklasifikasi pada periode ini.');
}
function renderComparison(data, currentMonth) {
    const target = document.getElementById('monthlyComparisonList');
    target.replaceChildren();
    const current = data.find(item => item.month === currentMonth);
    const previousMonth = shiftMonth(currentMonth, -1);
    const previous = data.find(item => item.month === previousMonth);
    text('monthlyComparisonPeriod', `${monthLabel(currentMonth)} vs ${monthLabel(previousMonth)} · bulan berjalan dibanding bulan sebelumnya`);
    if (!current || !previous) {
        target.append(node('p', 'analytics-empty', 'Data dua bulan belum cukup untuk dibandingkan.'));
        return;
    }
    for (const [kind, label] of [['income', 'Pemasukan'], ['expense', 'Pengeluaran']]) {
        const highlight = node('div', 'comparison-highlight');
        if (!previous[kind]) {
            highlight.append(node('span', 'analytics-muted', label + ': belum ada nilai pembanding.'));
        } else {
            const change = (current[kind] - previous[kind]) / previous[kind] * 100;
            const percentage = (change > 0 ? '+' : '') + change.toLocaleString('id-ID', {maximumFractionDigits: 1}) + '%';
            const direction = change > 0 ? 'meningkat' : change < 0 ? 'menurun' : 'tetap';
            highlight.append(node('strong', '', percentage), node('span', 'analytics-muted', label + ' ' + direction));
        }
        target.append(highlight);
    }
}
function monthlyInsights(monthly, categories, period) {
    const insights = [];
    // The ranking is for the selected range: never label a multi-month share
    // as a current-month fact, and never fetch extra data just for this copy.
    if (period.months.length === 1) {
        const ordinary = categories.categories.filter(item =>
            !['Perlu ditinjau', '__remaining__'].includes(item.category) && Number.isFinite(item.total) && item.total > 0);
        const total = ordinary.reduce((sum, item) => sum + item.total, 0);
        const largest = [...ordinary].sort((a, b) => b.total - a.total)[0];
        if (largest && total > 0) {
            const percent = (largest.total / total * 100).toLocaleString('id-ID', {maximumFractionDigits: 1});
            insights.push(`${largest.category} merupakan kategori terbesar: ${percent}% dari pengeluaran terklasifikasi bulan ini.`);
        }
    }
    const current = monthly.find(item => item.month === period.current);
    const previous = monthly.find(item => item.month === shiftMonth(period.current, -1));
    for (const [kind, label] of [['income', 'Pemasukan'], ['expense', 'Pengeluaran']]) {
        if (!current || !previous || !Number.isFinite(current[kind]) || current[kind] < 0
                || !Number.isFinite(previous[kind]) || previous[kind] <= 0) continue;
        const change = (current[kind] - previous[kind]) / previous[kind] * 100;
        if (change === 0) {
            insights.push(`${label} bulan berjalan sama dengan bulan lalu.`);
        } else {
            const percent = Math.abs(change).toLocaleString('id-ID', {maximumFractionDigits: 1});
            insights.push(`${label} bulan berjalan ${change > 0 ? 'meningkat' : 'menurun'} ${percent}% dibanding bulan lalu.`);
        }
    }
    return insights.slice(0, 3);
}
function renderInsights(monthly, categories, period) {
    const insights = monthlyInsights(monthly, categories, period);
    document.getElementById('analyticsInsightsList').replaceChildren(
        ...insights.map(value => node('li', '', value)));
    document.getElementById('analyticsInsights').hidden = !insights.length;
}
function renderReviews(data, period) {
    const section = document.getElementById('analyticsReview');
    const actions = document.getElementById('analyticsReviewActions');
    actions.replaceChildren();
    const items = data.items.filter(item => item.count > 0 && ['expense', 'income'].includes(item.type));
    section.hidden = !items.length;
    text('analyticsReviewCount', items.reduce((sum, item) => sum + item.count, 0) + ' transaksi dengan kategori perlu diperiksa');
    for (const item of items) {
        const button = node('button', 'category-review-badge', `Tinjau ${item.count} ${item.type === 'income' ? 'pemasukan' : 'pengeluaran'} →`);
        button.type = 'button';
        button.addEventListener('click', () => openCategoryTransactions('Perlu ditinjau', {start: period.start, end: period.end, review: '1'}, item.type));
        actions.append(button);
    }
}
function renderTypeReviews(data, period) {
    const section = document.getElementById('analyticsTypeReview');
    const actions = document.getElementById('analyticsTypeReviewActions');
    actions.replaceChildren();
    section.hidden = !(data.count > 0);
    text('analyticsTypeReviewCount', `${data.count} transaksi perlu diperiksa`);
    if (data.count > 0) {
        const button = node('button', 'category-review-badge', 'Periksa transaksi →');
        button.type = 'button';
        button.addEventListener('click', () => openCategoryTransactions('Perlu ditinjau', {start: period.start, end: period.end}, 'mismatch'));
        actions.append(button);
    }
}
async function loadAnalytics() {
    const request = ++analyticsRequest;
    const period = selectedPeriod();
    const query = new URLSearchParams({start: period.start, end: period.end});
    text('analyticsRange', period.months.length === 1 ? monthLabel(period.current, true) : `${monthLabel(period.months[0])} – ${monthLabel(period.current)}`);
    text('analyticsStatus', 'Memuat analitik…');
    document.getElementById('analyticsRetry').hidden = true;
    document.getElementById('analyticsReview').hidden = true;
    document.getElementById('analyticsTypeReview').hidden = true;
    document.getElementById('analyticsInsights').hidden = true;
    document.getElementById('analyticsInsightsList').replaceChildren();
    for (const id of ['analyticsIncome', 'analyticsExpense', 'analyticsBalance']) text(id, '—');
    for (const id of ['cashflowChartArea', 'categoriesList', 'monthlyComparisonList', 'monthlyComparisonPeriod', 'categoriesStatus']) text(id, '');
    try {
        const [monthly, categories, reviews, typeReviews] = await Promise.all([
            '/api/analytics/monthly', '/api/categories/breakdown?' + query, '/api/categories/review?' + query, '/api/transactions/type-review?' + query
        ].map(async url => {
            const response = await apiFetch(url);
            if (!response.ok) throw new Error('Analytics request failed');
            return response.json();
        }));
        if (request !== analyticsRequest) return;
        renderSummary(period.months, monthly);
        renderTrend(period.months, monthly);
        renderCategories(categories, period);
        renderComparison(monthly, period.current);
        renderInsights(monthly, categories, period);
        renderReviews(reviews, period);
        renderTypeReviews(typeReviews, period);
        text('analyticsStatus', '');
    } catch (_) {
        if (request !== analyticsRequest) return;
        text('analyticsStatus', 'Gagal memuat analitik. Silakan coba lagi.');
        document.getElementById('analyticsRetry').hidden = false;
    }
}
window.loadAnalytics = loadAnalytics;
document.getElementById('analyticsPeriod').addEventListener('change', loadAnalytics);
document.getElementById('analyticsRetry').addEventListener('click', loadAnalytics);
loadAnalytics();
})();
