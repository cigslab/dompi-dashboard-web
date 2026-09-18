(() => {
let monthlyRequest = 0;

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
            const response = await apiFetch('/api/categories/transactions?' + query);
            if (!response.ok) throw new Error('Drill-down failed');
            const data = await response.json();
            if (closed || current !== request) return;
            page = target;
            for (const item of data.items) {
                const row = document.createElement('article');
                for (const value of [item.description || '—', item.date, formatRupiah(item.amount), item.note || '—', item.category]) {
                    const text = document.createElement('p');
                    text.textContent = value;
                    row.append(text);
                }
                const edit = document.createElement('button');
                edit.type = 'button';
                edit.textContent = 'Edit transaksi';
                edit.addEventListener('click', () => {
                    dialog.close();
                    openTransactionEditor({...item, type: item.type || kind});
                });
                row.append(edit);
                list.append(row);
            }
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

                function shiftMonth(monthKey, offset) {
                    const [year, month] = monthKey.split("-").map(Number);

                    const date = new Date(
                        year,
                        month - 1 + offset,
                        1
                    );

                    return `${date.getFullYear()}-${String(
                        date.getMonth() + 1
                    ).padStart(2, "0")}`;
                }


                function shortMonthLabel(monthKey) {
                    const [year, month] = monthKey.split("-");

                    return new Date(
                        Number(year),
                        Number(month) - 1,
                        1
                    ).toLocaleDateString("id-ID", {
                        month: "short",
                        year: "numeric"
                    });
                }


                function getMonthlyRecord(data, monthKey) {
                    return data.find(
                        item => item.month === monthKey
                    ) || {
                        month: monthKey,
                        income: 0,
                        expense: 0,
                        transaction_count: 0
                    };
                }


                function getChange(current, previous) {
                    if (previous === 0) {
                        return "—";
                    }

                    const percentage =
                        ((current - previous) / previous) * 100;

                    if (percentage > 0) {
                        return `↑ ${Math.abs(percentage).toFixed(1)}%`;
                    }

                    if (percentage < 0) {
                        return `↓ ${Math.abs(percentage).toFixed(1)}%`;
                    }

                    return "0%";
                }


                function renderMonthlyComparisons(monthlyData) {
                    const container =
                        document.getElementById("monthlyComparisonList");

                    try {
                        if (!monthlyData.length) {
                            container.innerHTML = `
                                <div class="monthly-comparison-placeholder">
                                    Belum ada data bulanan.
                                </div>
                            `;
                            return;
                        }

                        const latestMonth =
                            monthlyData[0].month;

                        const comparisons = [0, 1, 2].map(offset => {
                            const currentKey =
                                shiftMonth(latestMonth, -offset);

                            const previousKey =
                                shiftMonth(latestMonth, -(offset + 1));

                            return {
                                current:
                                    getMonthlyRecord(
                                        monthlyData,
                                        currentKey
                                    ),

                                previous:
                                    getMonthlyRecord(
                                        monthlyData,
                                        previousKey
                                    )
                            };
                        });

                        container.replaceChildren(
                            ...comparisons.map(({ current, previous }) => {

                                const currentNet =
                                    current.income - current.expense;

                                const previousNet =
                                    previous.income - previous.expense;

                                // Collapse only when BOTH compared months have no metric values.
                                // Keep a zero current month visible when the previous month had activity.
                                if ([current, previous].every(record =>
                                    ['income', 'expense', 'transaction_count'].every(key => record[key] === 0))) {
                                    const empty = document.createElement('div');
                                    empty.className = 'monthly-comparison-row monthly-comparison-empty';
                                    const heading = document.createElement('div');
                                    heading.className = 'monthly-comparison-title';
                                    heading.textContent = `${shortMonthLabel(current.month)} vs ${shortMonthLabel(previous.month)}`;
                                    const message = document.createElement('p');
                                    message.textContent = 'Belum ada aktivitas pada kedua bulan ini.';
                                    empty.append(heading, message);
                                    return empty;
                                }

                                const template = document.createElement("template");
                                template.innerHTML = `
                                    <div class="monthly-comparison-row">

                                        <div class="monthly-comparison-title">

                                            <span>vs</span>

                                        </div>
                                        <div class="monthly-comparison-metrics">
                                            <div class="monthly-comparison-metric">

                                                <div class="monthly-comparison-content">
                                                    <span>Pemasukan</span>
                                                    <strong>

                                                    </strong>
                                                    <small>

                                                    </small>
                                                </div>
                                            </div>

                                            <div class="monthly-comparison-metric">

                                                <div class="monthly-comparison-content">
                                                    <span>Pengeluaran</span>
                                                    <strong>

                                                    </strong>
                                                    <small>

                                                    </small>
                                                </div>
                                            </div>

                                            <div class="monthly-comparison-metric">

                                                <div class="monthly-comparison-content">
                                                    <span>Net Cashflow</span>
                                                    <strong>

                                                    </strong>
                                                    <small>

                                                    </small>
                                                </div>
                                            </div>

                                            <div class="monthly-comparison-metric">

                                                <div class="monthly-comparison-content">
                                                    <span>Transaksi</span>
                                                    <strong>

                                                    </strong>
                                                    <small>

                                                    </small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                `;
                                const row = template.content.firstElementChild;
                                const title = row.querySelector(".monthly-comparison-title");
                                title.prepend(document.createTextNode(shortMonthLabel(current.month) + " "));
                                title.append(document.createTextNode(" " + shortMonthLabel(previous.month)));
                                const values = [
                                    [formatRupiah(current.income), getChange(current.income, previous.income)],
                                    [formatRupiah(current.expense), getChange(current.expense, previous.expense)],
                                    [formatRupiah(currentNet), getChange(currentNet, previousNet)],
                                    [current.transaction_count, getChange(current.transaction_count, previous.transaction_count)],
                                ];
                                row.querySelectorAll(".monthly-comparison-content").forEach((metric, index) => {
                                    metric.querySelector("strong").textContent = values[index][0];
                                    metric.querySelector("small").textContent = values[index][1];
                                });
                                return row;
                            })
                        );

                    } catch (error) {
                        console.error(
                            "Monthly comparison error:",
                            error
                        );

                        container.innerHTML = `
                            <div class="monthly-comparison-placeholder">
                                Data perbandingan gagal dimuat.
                            </div>
                        `;
                    }
                }




function renderTrend(data) {
const monthlyCashflow = Object.fromEntries(data.map(item => [item.month, item]));
        const analyticsPeriod =
            document.getElementById("analyticsPeriod");

        const selectedPeriod =
            Number(analyticsPeriod.value);

        const selectedMonths = [];

        const today = new Date();

        for (let i = selectedPeriod - 1; i >= 0; i--) {
            const date = new Date(
                today.getFullYear(),
                today.getMonth() - i,
                1
            );

            const key =
                `${date.getFullYear()}-${String(
                    date.getMonth() + 1
                ).padStart(2, "0")}`;

            const label =
                date.toLocaleDateString("id-ID", {
                    month: "short",
                    year: "numeric"
                });

            selectedMonths.push({
                key: key,
                label: label,
                income: monthlyCashflow[key]?.income || 0,
                expense: monthlyCashflow[key]?.expense || 0
            });
        }
        const cashflowChartArea =
            document.getElementById("cashflowChartArea");

        const maxCashflowValue = Math.max(
            ...selectedMonths.map(month => month.income),
            ...selectedMonths.map(month => month.expense),
            1
        );

        cashflowChartArea.innerHTML = `
            <div class="cashflow-chart-wrapper">

                <div class="cashflow-y-axis">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span>Rp0</span>
                </div>

                <div
                    class="cashflow-chart"

                >

                    <div class="cashflow-grid-lines">
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>



                </div>

            </div>
        `;
        cashflowChartArea.querySelectorAll(".cashflow-y-axis span").forEach((label, index) => {
            if (index < 4) label.textContent = formatRupiah(maxCashflowValue * [1, 0.75, 0.5, 0.25][index]);
        });
        const cashflowBars = cashflowChartArea.querySelector(".cashflow-chart");
        cashflowBars.style.gridTemplateColumns = `repeat(${selectedMonths.length}, minmax(0, 1fr))`;
        selectedMonths.forEach(month => {
            const incomeHeight = (month.income / maxCashflowValue) * 100;
            const expenseHeight = (month.expense / maxCashflowValue) * 100;
            const template = document.createElement("template");
            template.innerHTML = `
                            <div class="cashflow-month">

                                <div class="cashflow-bars">

                                    <div
                                        class="cashflow-bar income-bar"
                                    ></div>

                                    <div
                                        class="cashflow-bar expense-bar"
                                    ></div>

                                </div>

                                <span class="cashflow-month-label">

                                </span>

                            </div>
                        `;
            const row = template.content.firstElementChild;
            const incomeBar = row.querySelector(".income-bar");
            const expenseBar = row.querySelector(".expense-bar");
            incomeBar.style.height = `${incomeHeight}%`;
            expenseBar.style.height = `${expenseHeight}%`;
            incomeBar.title = "Pemasukan: " + formatRupiah(month.income);
            expenseBar.title = "Pengeluaran: " + formatRupiah(month.expense);
            row.querySelector(".cashflow-month-label").textContent = month.label;
            cashflowBars.appendChild(row);
        });
}
async function loadMonthly() {
    const request = ++monthlyRequest;
    document.getElementById('cashflowChartArea').textContent = 'Memuat tren…';
    document.getElementById('monthlyComparisonList').textContent = 'Memuat perbandingan…';
    try {
        const response = await apiFetch('/api/analytics/monthly');
        if (!response.ok) throw new Error('Monthly analytics failed');
        const data = await response.json();
        if (request !== monthlyRequest) return;
        renderTrend(data);
        renderMonthlyComparisons(data);
    } catch (error) {
        if (request !== monthlyRequest) return;
        document.getElementById('cashflowChartArea').textContent = 'Gagal memuat tren. Silakan coba lagi.';
        document.getElementById('monthlyComparisonList').textContent = 'Gagal memuat perbandingan.';
    }
}
function setupCategoryBreakdown() {
    const month = document.getElementById('analyticsCategoryMonth');
    const status = document.getElementById('categoriesStatus');
    const content = document.getElementById('categoriesContent');
    const attention = document.createElement('section');
    attention.className = 'category-review-attention';
    content.before(attention);
    const colors = ['#67e58a', '#77b9a4', '#719aa8', '#b1bb7b', '#ad92b5', '#d3a578'];
    let requestNumber = 0;
    const retry = document.getElementById('categoriesRetry');
    const now = new Date();
    month.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    async function load() {
        const current = ++requestNumber;
        content.hidden = true;
        retry.hidden = true;
        attention.replaceChildren();
        status.textContent = 'Memuat kategori…';
        try {
            const response = await apiFetch('/api/categories/breakdown?month=' + encodeURIComponent(month.value));
            if (!response.ok) throw new Error('Category request failed');
            const data = await response.json();
            const reviewResponse = await apiFetch('/api/categories/review?month=' + encodeURIComponent(month.value));
            if (!reviewResponse.ok) throw new Error('Review request failed');
            const reviews = await reviewResponse.json();
            if (current !== requestNumber) return;
            for (const item of reviews.items) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'category-review-badge';
                button.textContent = `Perlu ditinjau · ${item.count} ${item.type === 'income' ? 'pemasukan' : 'pengeluaran'} · ${formatRupiah(item.total)}`;
                button.addEventListener('click', () => openCategoryTransactions('Perlu ditinjau', {month: month.value, review: '1'}, item.type));
                attention.append(button);
            }
            const ordinary = data.categories.filter(item => item.category !== 'Perlu ditinjau');
            const ordinaryTotal = ordinary.reduce((sum, item) => sum + Number(item.total), 0);
            const explanation = document.createElement('p');
            explanation.textContent = 'Donut dan persentase hanya mencakup kategori biasa. Perlu ditinjau tidak termasuk; total pengeluaran tetap mencakup semuanya.';
            attention.append(explanation);
            document.getElementById('categoriesTotal').textContent = formatRupiah(data.total_expense);
            document.getElementById('categoriesCount').textContent = ordinary.length;
            document.getElementById('categoriesLargest').textContent = ordinary[0]?.category || '—';
            document.getElementById('categoriesDonutTotal').textContent = formatRupiah(ordinaryTotal);
            const list = document.getElementById('categoriesList');
            list.replaceChildren();
            let cumulative = 0;
            const stops = [];
            ordinary.forEach((item, index) => {
                const color = colors[index % colors.length];
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'categories-row category-drill-trigger';
                row.addEventListener('click', () => openCategoryTransactions(item.category, {month: month.value}));
                const dot = document.createElement('span');
                dot.className = 'categories-dot';
                dot.style.backgroundColor = color;
                const name = document.createElement('strong');
                name.className = 'analytics-category-name';
                name.textContent = item.category;
                const count = document.createElement('span');
                count.className = 'categories-meta';
                count.textContent = `${item.transaction_count} transaksi`;
                const amount = document.createElement('strong');
                amount.className = 'categories-amount';
                amount.textContent = formatRupiah(item.total);
                const percent = document.createElement('span');
                percent.className = 'categories-meta categories-percent';
                percent.textContent = `${(ordinaryTotal ? Number(item.total) / ordinaryTotal * 100 : 0).toLocaleString('id-ID', {maximumFractionDigits: 2})}%`;
                row.append(dot, name, count, amount, percent);
                list.appendChild(row);
                const share = ordinaryTotal > 0 ? Number(item.total) / ordinaryTotal * 100 : 0;
                const end = cumulative + share;
                stops.push(`${color} ${cumulative}% ${end}%`);
                cumulative = end;
            });
            const donut = document.getElementById('categoriesDonut');
            donut.style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#26302c';
            donut.setAttribute('aria-label', `Distribusi ${ordinary.length} kategori biasa. Total ${formatRupiah(ordinaryTotal)}. Rincian tersedia pada daftar kategori.`);
            status.textContent = data.categories.length ? '' : 'Belum ada pengeluaran pada periode ini.';
            content.hidden = false;
        } catch (error) {
            if (current !== requestNumber) return;
            status.textContent = 'Gagal memuat kategori. Silakan coba lagi.';
            retry.hidden = false;
        }
    }
    retry.addEventListener('click', load);
    month.addEventListener('change', load);
    document.getElementById('categoriesAllTime').addEventListener('click', () => { month.value = ''; load(); });
    return load;
}

function setupPeriodReport() {
    const period = document.getElementById('reportsPeriod');
    const custom = document.getElementById('reportsCustom');
    const start = document.getElementById('reportsStart');
    const end = document.getElementById('reportsEnd');
    const content = document.getElementById('reportsContent');
    const status = document.getElementById('reportsStatus');
    const retry = document.getElementById('reportsRetry');
    let requestNumber = 0;
    const today = new Date();
    const iso = value => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    start.value = iso(new Date(today.getFullYear(), today.getMonth(), 1));
    end.value = iso(today);
    const displayDate = value => new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric'});
    const range = (a,b) => `${displayDate(a)} – ${displayDate(b)}`;
    const number = value => Number(value).toLocaleString('id-ID', {maximumFractionDigits:2});
    function text(id, value) { document.getElementById(id).textContent = value; }
    async function load() {
        const current = ++requestNumber;
        content.hidden = true;
        retry.hidden = true;
        if (period.value === 'custom' && (!start.value || !end.value || start.value > end.value)) {
            status.textContent = 'Pilih rentang tanggal yang valid.';
            return;
        }
        status.textContent = 'Memuat laporan…';
        const query = new URLSearchParams({period: period.value});
        if (period.value === 'custom') { query.set('start',start.value); query.set('end',end.value); }
        try {
            const response = await apiFetch('/api/reports?' + query);
            if (!response.ok) throw new Error('Report request failed');
            const data = await response.json();
            if (current !== requestNumber) return;
            text('reportsIncome',formatRupiah(data.income));
            text('reportsExpense',formatRupiah(data.expense));
            text('reportsBalance',formatRupiah(data.balance));
            text('reportsActivePeriod',range(data.start,data.end));
            text('reportsAverage','Rp' + number(data.average_daily_expense));
            text('reportsCount',number(data.transaction_count));
            text('reportsAverageNote',`Rata-rata dibagi ${data.days} hari kalender, termasuk hari tanpa transaksi. Bulan ini dihitung sampai hari ini.`);
            const comparison = data.comparison;
            if (comparison.change_percentage === null) {
                text('reportsInsight','Belum ada pengeluaran pada periode pembanding untuk menghitung perubahan.');
            } else {
                const change = comparison.change_percentage;
                text('reportsInsight', change === 0 ? 'Pengeluaran sama dengan periode pembanding.' : `Pengeluaran ${change > 0 ? 'naik' : 'turun'} ${number(Math.abs(change))}% dibanding periode sebelumnya.`);
            }
            text('reportsComparisonPeriod',`Pembanding: ${range(comparison.start,comparison.end)} (${data.days} hari), pengeluaran ${formatRupiah(comparison.expense)}.`);
            const list = document.getElementById('reportsCategories');
            list.replaceChildren();
            const ordinaryReportTotal = data.categories.filter(item => item.category !== 'Perlu ditinjau').reduce((sum, item) => sum + Number(item.total), 0);
            const categoryNote = document.createElement('p');
            categoryNote.textContent = 'Persentase kategori tidak mencakup Perlu ditinjau. Nilai Perlu ditinjau dapat mencakup label historical yang tidak sesuai jenis; klik membuka transaksi dengan penanda review setelah edit.';
            list.append(categoryNote);
            [...data.categories].sort((a, b) => Number(b.category === 'Perlu ditinjau') - Number(a.category === 'Perlu ditinjau')).forEach(item => {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'reports-category-row category-drill-trigger';
                row.addEventListener('click', () => openCategoryTransactions(item.category, {start: data.start, end: data.end, ...(item.category === 'Perlu ditinjau' ? {review: '1'} : {})}));
                if (item.category === 'Perlu ditinjau') row.classList.add('category-review-badge');
                const name = document.createElement('strong');
                name.textContent = item.category;
                const total = document.createElement('strong');
                total.className = 'reports-category-amount';
                total.textContent = formatRupiah(item.total);
                const percentage = document.createElement('span');
                percentage.textContent = item.category === 'Perlu ditinjau' ? 'Perlu pemeriksaan' : number(ordinaryReportTotal ? Number(item.total) / ordinaryReportTotal * 100 : 0) + '%';
                row.append(name,total,percentage);
                list.appendChild(row);
            });
            if (!data.categories.length) { const empty = document.createElement('p'); empty.className='reports-muted'; empty.textContent='Belum ada pengeluaran pada periode ini.'; list.appendChild(empty); }
            status.textContent = data.transaction_count ? '' : 'Belum ada transaksi pada periode ini.';
            content.hidden = false;
        } catch (error) {
            if (current !== requestNumber) return;
            status.textContent = 'Gagal memuat laporan. Silakan coba lagi.';
            retry.hidden = false;
        }
    }

    period.addEventListener('change',()=>{custom.hidden=period.value!=='custom';start.required=end.required=!custom.hidden;load();});
    document.getElementById('reportsFilters').addEventListener('submit',event=>{event.preventDefault();load();});
    retry.addEventListener('click',load);
    return load;
}

const loadCategory = setupCategoryBreakdown();
const loadReport = setupPeriodReport();
window.loadAnalytics = () => Promise.all([loadMonthly(), loadCategory(), loadReport()]);
document.getElementById('analyticsPeriod').addEventListener('change', loadMonthly);
document.getElementById('analyticsRetry').addEventListener('click', window.loadAnalytics);
window.loadAnalytics();
})();
