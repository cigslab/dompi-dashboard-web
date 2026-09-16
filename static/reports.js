(() => {
    const page = document.getElementById('reportsPage');
    const menu = document.getElementById('reportsMenu');
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
            data.categories.forEach(item => {
                const row = document.createElement('div');
                row.className = 'reports-category-row';
                const name = document.createElement('strong');
                name.textContent = item.category;
                const total = document.createElement('strong');
                total.className = 'reports-category-amount';
                total.textContent = formatRupiah(item.total);
                const percentage = document.createElement('span');
                percentage.textContent = number(item.percentage) + '%';
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
    const otherPages=['overviewPage','transactionPage','analyticsPage','categoriesPage'];
    const otherMenus=['overviewMenu','transactionMenu','analyticsMenu','categoriesMenu'];
    menu.addEventListener('click', event => {
        event.preventDefault();
        otherPages.forEach(id=>document.getElementById(id).classList.add('page-hidden'));
        otherMenus.forEach(id=>document.getElementById(id).classList.remove('active'));
        page.classList.remove('page-hidden'); menu.classList.add('active'); load();
    });
    [...otherMenus,'viewAllTransactions'].forEach(id=>document.getElementById(id).addEventListener('click',()=>{page.classList.add('page-hidden');menu.classList.remove('active');}));
    period.addEventListener('change',()=>{custom.hidden=period.value!=='custom';start.required=end.required=!custom.hidden;load();});
    document.getElementById('reportsFilters').addEventListener('submit',event=>{event.preventDefault();load();});
    retry.addEventListener('click',load);
})();
