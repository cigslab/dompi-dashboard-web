/* Same local calendar convention as existing transaction navigation. */
(function (root) {
    function key(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    function shift(month, offset) {
        const [year, number] = month.split('-').map(Number);
        return key(new Date(year, number - 1 + offset, 1));
    }
    function create(now = new Date()) {
        return {
            selected: key(now),
            url(path) { return `${path}?month=${this.selected}`; },
            rows(rows, month = this.selected) { return rows.filter(row => String(row.date).startsWith(month + '-')); },
            options() { return Array.from({length: 14}, (_, i) => shift(this.selected, 1 - i)); }
        };
    }
    root.HomeMonth = {key, shift, create};
    if (typeof module !== 'undefined') module.exports = root.HomeMonth;
})(typeof window !== 'undefined' ? window : globalThis);
