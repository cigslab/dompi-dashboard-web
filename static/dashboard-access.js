/* UI gating only. API authorization remains enforced by the server. */
(() => {
    let data = null;
    let pending = null;
    let state = 'loading';
    let generation = 0;
    function classify(entitlement) {
        if (entitlement?.requires_review !== false) return 'unknown';
        if (entitlement.effective_plan === 'starter' && entitlement.entitlement_source === 'starter_lifetime') return 'starter';
        if (entitlement.effective_plan === 'pro' && entitlement.entitlement_source === 'pro_lifetime') return 'pro';
        if (entitlement.effective_plan === 'pro' && entitlement.entitlement_source === 'pro_legacy'
            && typeof entitlement.legacy_expires_at === 'string'
            && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(entitlement.legacy_expires_at)
            && Number.isFinite(Date.parse(entitlement.legacy_expires_at))) return 'pro';
        return 'unknown';
    }
    function render() {
        if (state !== 'pro') ['analyticsInsights', 'analyticsReview', 'analyticsTypeReview'].forEach(id => { const element = document.getElementById(id); if (element) element.hidden = true; });
        document.querySelectorAll('[data-pro-content]').forEach(element => { element.hidden = state !== 'pro'; });
        document.querySelectorAll('[data-pro-state]').forEach(element => {
            element.hidden = state === 'pro';
            element.querySelector('[role="status"]').textContent = state === 'starter' ? 'Tersedia untuk Pro'
                : state === 'loading' ? 'Memeriksa akses paket…' : 'Akses fitur belum dapat dipastikan. Coba lagi.';
            element.querySelector('button').hidden = !['unknown', 'error'].includes(state);
        });
    }
    function account(refresh = false) {
        if (pending && !refresh) return pending;
        if (!refresh && data) return Promise.resolve(data);
        if (!refresh && state === 'error') return Promise.reject(new Error('Account unavailable'));
        const current = ++generation;
        state = 'loading'; render();
        pending = (async () => {
            try {
                const response = await apiFetch('/api/account');
                if (!response.ok) throw new Error('Account unavailable');
                const result = await response.json();
                if (current === generation) { data = result; state = classify(data.entitlement); }
                return result;
            } catch (error) {
                if (current === generation) { data = null; state = 'error'; }
                throw error;
            } finally { if (current === generation) { pending = null; render(); } }
        })();
        return pending;
    }
    async function allow() {
        try { await account(); } catch (_) { return false; }
        return state === 'pro';
    }
    window.DashboardAccess = {account, allow, classify, isPro: () => state === 'pro'};
    document.addEventListener('click', async event => {
        if (!event.target.closest('[data-pro-retry]')) return;
        await loadAccountUsage();
        await Promise.allSettled([loadCategories(), loadCashflowChart(), window.loadAnalytics()]);
    });
})();
