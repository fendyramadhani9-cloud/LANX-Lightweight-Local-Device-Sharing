/**
 * LANX — Text & Note Sharing Module
 * Handles: sending text/notes/links, receiving messages, and reliable copying
 */

const Clipboard = {
    receivedTexts: [],

    init() {
        this.setupTextSharing();
    },

    // ─── Text Sharing ────────────────────────────────────

    setupTextSharing() {
        const input = document.getElementById('text-input');
        const select = document.getElementById('text-device-select');
        const sendBtn = document.getElementById('btn-send-text');

        if (!input || !sendBtn) return;

        const updateBtn = () => {
            sendBtn.disabled = !select.value || !input.value.trim();
        };

        input.addEventListener('input', updateBtn);
        if (select) {
            select.addEventListener('change', updateBtn);
        }

        // Support Ctrl+Enter / Cmd+Enter to send
        input.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!sendBtn.disabled) {
                    this.sendText();
                }
            }
        });

        sendBtn.addEventListener('click', () => this.sendText());
    },

    async sendText() {
        const input = document.getElementById('text-input');
        const select = document.getElementById('text-device-select');
        const text = input.value.trim();
        let deviceId = select ? select.value : '';

        // Auto-select single available device if not selected
        if (!deviceId && typeof Devices !== 'undefined') {
            const onlineDevs = Devices.getVisibleDevices().filter(d => d.online !== false);
            if (onlineDevs.length === 1) {
                deviceId = onlineDevs[0].id;
                if (select) select.value = deviceId;
            }
        }

        if (!text) {
            LANX.showToast('Teks tidak boleh kosong', 'error');
            return;
        }

        if (!deviceId) {
            LANX.showToast('Pilih perangkat tujuan terlebih dahulu', 'error');
            return;
        }

        try {
            const res = await fetch('/api/text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    target_device_id: deviceId,
                }),
            });

            if (res.ok) {
                LANX.showToast('Teks berhasil terkirim!', 'success');
                input.value = '';
                const sendBtn = document.getElementById('btn-send-text');
                if (sendBtn) sendBtn.disabled = true;
            } else {
                const data = await res.json();
                LANX.showToast(data.error || 'Gagal mengirim teks', 'error');
            }
        } catch (e) {
            LANX.showToast('Gagal mengirim teks', 'error');
        }
    },

    // ─── Received Items ──────────────────────────────────

    handleTextReceived(msg) {
        this.addReceivedItem(msg.from_device || 'Perangkat Lain', msg.text);
        LANX.showToast(`Pesan baru dari ${msg.from_device || 'Perangkat Lain'}`, 'info');
    },

    handleClipboardReceived(msg) {
        this.addReceivedItem(msg.from_device || 'Perangkat Lain', msg.content);
        LANX.showToast(`Pesan baru dari ${msg.from_device || 'Perangkat Lain'}`, 'info');
    },

    addReceivedItem(from, content) {
        if (!content) return;
        this.receivedTexts.unshift({
            from: from,
            content: content,
            timestamp: Date.now(),
        });

        // Keep last 30 messages
        if (this.receivedTexts.length > 30) {
            this.receivedTexts.pop();
        }

        this.renderReceivedTexts();
    },

    renderReceivedTexts() {
        const section = document.getElementById('received-texts-section');
        const container = document.getElementById('received-texts');

        if (!section || !container) return;

        if (this.receivedTexts.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = this.receivedTexts.map((item, idx) => `
            <div class="received-item">
                <div class="received-item-header">
                    <span class="received-item-from">Dari: <strong>${LANX.escapeHtml(item.from)}</strong></span>
                    <span class="received-item-time">${LANX.formatTime(item.timestamp)}</span>
                </div>
                <div class="received-item-content">${LANX.escapeHtml(item.content)}</div>
                <div class="received-item-actions">
                    <button class="btn btn-ghost btn-sm btn-copy-text" data-index="${idx}">
                        📋 Salin Teks
                    </button>
                </div>
            </div>
        `).join('');

        // Attach click handlers to copy buttons
        container.querySelectorAll('.btn-copy-text').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(btn.dataset.index, 10);
                const item = this.receivedTexts[idx];
                if (item) {
                    this.copyToClipboard(item.content);
                }
            });
        });
    },

    // ─── Copy to Clipboard (Safe with Fallback) ───────────

    copyToClipboard(text) {
        if (!text) return;

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(() => {
                    LANX.showToast('Teks berhasil disalin ke papan klip!', 'success');
                })
                .catch(() => {
                    this.fallbackCopy(text);
                });
        } else {
            this.fallbackCopy(text);
        }
    },

    fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();

        try {
            const success = document.execCommand('copy');
            if (success) {
                LANX.showToast('Teks berhasil disalin ke papan klip!', 'success');
            } else {
                LANX.showToast('Gagal menyalin teks', 'error');
            }
        } catch (err) {
            LANX.showToast('Gagal menyalin teks', 'error');
        }

        document.body.removeChild(ta);
    },
};
