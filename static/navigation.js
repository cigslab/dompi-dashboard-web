(() => {
    const pages = ['overview', 'transaction', 'analytics', 'account'];
    const primary = ['overview', 'transaction', 'analytics', 'account'];
    function navigate(name) {
        pages.forEach(key => document.getElementById(key + 'Page').classList.toggle('page-hidden', key !== name));
        const active = name;
        primary.forEach(key => {
            const menu = document.getElementById(key + 'Menu');
            menu.classList.toggle('active', key === active);
            if (key === active) menu.setAttribute('aria-current', 'page');
            else menu.removeAttribute('aria-current');
        });
        if (name === 'analytics') window.loadAnalytics();
        if (name === 'account') loadProfile();
    }
    pages.forEach(key => document.getElementById(key + 'Menu').addEventListener('click', event => {
        event.preventDefault();
        navigate(key);
    }));
    document.getElementById('viewAllTransactions').addEventListener('click', () => navigate('transaction'));
    document.getElementById('overviewMenu').setAttribute('aria-current', 'page');
})();
