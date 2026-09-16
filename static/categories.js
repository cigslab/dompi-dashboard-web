(() => {
    const page = document.getElementById('categoriesPage');
    const menu = document.getElementById('categoriesMenu');
    const month = document.getElementById('categoriesMonth');
    const status = document.getElementById('categoriesStatus');
    const content = document.getElementById('categoriesContent');
    const colors = ['#67e58a', '#77b9a4', '#719aa8', '#b1bb7b', '#ad92b5', '#d3a578'];
    let requestNumber = 0;
    const now = new Date();
    month.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    async function load() {
        const current = ++requestNumber;
        content.hidden = true;
        status.textContent = 'Memuat kategori…';
        try {
            const response = await apiFetch('/api/categories/breakdown?month=' + encodeURIComponent(month.value));
            if (!response.ok) throw new Error('Category request failed');
            const data = await response.json();
            if (current !== requestNumber) return;
            document.getElementById('categoriesTotal').textContent = formatRupiah(data.total_expense);
            document.getElementById('categoriesCount').textContent = data.category_count;
            document.getElementById('categoriesLargest').textContent = data.largest_category || '—';
            document.getElementById('categoriesDonutTotal').textContent = formatRupiah(data.total_expense);
            const list = document.getElementById('categoriesList');
            list.replaceChildren();
            let cumulative = 0;
            const stops = [];
            data.categories.forEach((item, index) => {
                const color = colors[index % colors.length];
                const row = document.createElement('div');
                row.className = 'categories-row';
                const dot = document.createElement('span');
                dot.className = 'categories-dot';
                dot.style.backgroundColor = color;
                const name = document.createElement('strong');
                name.textContent = item.category;
                const count = document.createElement('span');
                count.className = 'categories-meta';
                count.textContent = `${item.transaction_count} transaksi`;
                const amount = document.createElement('strong');
                amount.className = 'categories-amount';
                amount.textContent = formatRupiah(item.total);
                const percent = document.createElement('span');
                percent.className = 'categories-meta categories-percent';
                percent.textContent = `${Number(item.percentage).toLocaleString('id-ID', {maximumFractionDigits: 2})}%`;
                row.append(dot, name, count, amount, percent);
                list.appendChild(row);
                const share = data.total_expense > 0 ? Number(item.total) / Number(data.total_expense) * 100 : 0;
                const end = cumulative + share;
                stops.push(`${color} ${cumulative}% ${end}%`);
                cumulative = end;
            });
            const donut = document.getElementById('categoriesDonut');
            donut.style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#26302c';
            donut.setAttribute('aria-label', `Distribusi ${data.category_count} kategori. Total ${formatRupiah(data.total_expense)}. Rincian tersedia pada daftar kategori.`);
            status.textContent = data.categories.length ? '' : 'Belum ada pengeluaran pada periode ini.';
            content.hidden = false;
        } catch (error) {
            if (current === requestNumber) status.textContent = 'Gagal memuat kategori. Pilih periode untuk mencoba lagi.';
        }
    }
    menu.addEventListener('click', event => {
        event.preventDefault();
        for (const id of ['overviewPage', 'transactionPage', 'analyticsPage']) document.getElementById(id).classList.add('page-hidden');
        for (const id of ['overviewMenu', 'transactionMenu', 'analyticsMenu']) document.getElementById(id).classList.remove('active');
        page.classList.remove('page-hidden');
        menu.classList.add('active');
        load();
    });
    for (const id of ['overviewMenu', 'transactionMenu', 'analyticsMenu', 'viewAllTransactions']) {
        document.getElementById(id).addEventListener('click', () => {
            page.classList.add('page-hidden');
            menu.classList.remove('active');
        });
    }
    month.addEventListener('change', load);
    document.getElementById('categoriesAllTime').addEventListener('click', () => { month.value = ''; load(); });
})();
