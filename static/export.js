(() => {
    'use strict';
    const form = document.getElementById('accountExportControls');
    const button = document.getElementById('accountExportDownload');
    const message = document.getElementById('accountExportMessage');
    const picker = document.getElementById('accountExportPeriod');
    let busy = false;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || form.hidden) return;
        const period = picker.value;
        if (!['current_month', 'last_3_months', 'all'].includes(period)) return;
        busy = true;
        button.disabled = true;
        picker.disabled = true;
        button.textContent = 'Menyiapkan CSV…';
        message.textContent = 'Menyiapkan CSV…';
        let objectURL;
        try {
            const telegram = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
            if (telegram && ['ios', 'android'].includes(telegram.platform)) {
                if (window.location.protocol !== 'https:') throw new Error('HTTPS required');
                const ticketResponse = await apiFetch('/api/export/ticket', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({period})
                });
                if (!ticketResponse.ok) {
                    message.textContent = ticketResponse.status === 403
                        ? 'Export tersedia untuk Pro. Muat ulang informasi akun.'
                        : 'Export gagal. Silakan coba lagi.';
                    return;
                }
                const ticket = await ticketResponse.json();
                if (!/^\/downloads\/export\/[A-Za-z0-9_-]+=*$/.test(ticket.path)
                        || !/^dompi-export-\d{4}-\d{2}-\d{2}\.csv$/.test(ticket.filename)) {
                    throw new Error('Invalid download ticket');
                }
                const url = window.location.origin + ticket.path;
                if (typeof telegram.downloadFile === 'function' && telegram.isVersionAtLeast?.('8.0')) {
                    message.textContent = 'Konfirmasi unduhan pada dialog Telegram.';
                    telegram.downloadFile({url, file_name: ticket.filename}, accepted => {
                        message.textContent = accepted
                            ? 'Unduhan CSV diminta. Periksa folder unduhan perangkat.'
                            : 'Unduhan dibatalkan. Tekan Unduh CSV untuk mencoba lagi.';
                    });
                } else {
                    // Older Telegram: a same-origin HTTPS attachment, not a Blob
                    // or auth-bearing URL. No new tab or permanent file required.
                    const link = document.createElement('a');
                    link.hidden = true;
                    link.href = url;
                    link.download = ticket.filename;
                    link.rel = 'noreferrer';
                    document.body.appendChild(link);
                    try { link.click(); } finally { link.remove(); }
                    message.textContent = 'Unduhan CSV diminta. Jika tidak muncul, perbarui Telegram lalu coba lagi.';
                }
                return;
            }
            const response = await apiFetch('/api/export/transactions?period=' + encodeURIComponent(period));
            if (!response.ok) {
                message.textContent = response.status === 403
                    ? 'Export tersedia untuk Pro. Muat ulang informasi akun.'
                    : 'Export gagal. Silakan coba lagi.';
                return;
            }
            const disposition = response.headers.get('Content-Disposition') || '';
            const filename = /filename="(dompi-export-\d{4}-\d{2}-\d{2}\.csv)"/.exec(disposition)?.[1];
            if (!filename || !response.headers.get('Content-Type')?.startsWith('text/csv')) {
                throw new Error('Invalid export response');
            }
            objectURL = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.hidden = true;
            link.href = objectURL;
            link.download = filename;
            document.body.appendChild(link);
            try { link.click(); } finally { link.remove(); }
            message.textContent = 'Unduhan CSV diminta. Periksa folder unduhan perangkat.';
        } catch (_) {
            message.textContent = 'Export gagal. Periksa sesi Telegram lalu coba lagi.';
        } finally {
            if (objectURL) setTimeout(() => URL.revokeObjectURL(objectURL), 30000);
            busy = false;
            button.disabled = false;
            picker.disabled = false;
            button.textContent = 'Unduh CSV';
        }
    });
})();
