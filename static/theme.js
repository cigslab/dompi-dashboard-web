/* Runs synchronously before CSS; unavailable storage always defaults to light. */
(function () {
    const key = 'dompi-theme';
    let initial = 'light';
    try { if (localStorage.getItem(key) === 'dark') initial = 'dark'; } catch (_) {}
    document.documentElement.dataset.theme = initial;
    function color(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
    function refreshCharts() {
        if (!window.Chart?.instances) return;
        for (const chart of Object.values(window.Chart.instances)) {
            if (chart.options.plugins?.legend?.labels) chart.options.plugins.legend.labels.color = color('--text');
            for (const scale of Object.values(chart.options.scales || {})) {
                if (scale.ticks) scale.ticks.color = color('--muted');
                if (scale.grid) scale.grid.color = color('--border');
            }
            if (chart.options.plugins?.tooltip) {
                chart.options.plugins.tooltip.backgroundColor = color('--surface');
                chart.options.plugins.tooltip.titleColor = color('--text');
                chart.options.plugins.tooltip.bodyColor = color('--text');
                chart.options.plugins.tooltip.borderColor = color('--border');
                chart.options.plugins.tooltip.borderWidth = 1;
            }
            chart.update('none');
        }
    }
    function sync() {
        const button = document.getElementById('themeToggle');
        const dark = document.documentElement.dataset.theme === 'dark';
        if (button) {
            button.textContent = dark ? '🌙 Gelap' : '☀️ Terang';
            button.setAttribute('aria-pressed', String(dark));
            button.setAttribute('aria-label', dark ? 'Aktifkan tema terang' : 'Aktifkan tema gelap');
        }
    }
    function set(theme) {
        document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
        try { localStorage.setItem(key, document.documentElement.dataset.theme); } catch (_) {}
        sync(); refreshCharts();
    }
    window.DompiTheme = {color, set, refreshCharts};
    document.addEventListener('DOMContentLoaded', () => {
        sync();
        document.getElementById('themeToggle')?.addEventListener('click', () => set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
        if (window.Chart?.register) window.Chart.register({id:'dompiTheme', beforeUpdate(chart) {
            const tooltip=chart.options.plugins?.tooltip;
            if (tooltip) Object.assign(tooltip,{backgroundColor:color('--surface'),titleColor:color('--text'),bodyColor:color('--text'),borderColor:color('--border'),borderWidth:1});
        }});
        refreshCharts();
    });
})();
