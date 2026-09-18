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
            if (typeof Devices !== 'undefined') {
                Devices.updateSendButtons();
            } else {
                sendBtn.disabled = !select.value || !input.value.trim();
            }
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

        // Check if All Devices mode is active
        if (typeof Devices !== 'undefined' && (Devices.sendMode === 'all' || Devices.selectedDevice === 'all')) {
            deviceId = 'all';
        } else if (!deviceId && typeof Devices !== 'undefined') {
            if (Devices.selectedDevice) {
                deviceId = Devices.selectedDevice;
            } else {
                const onlineDevs = Devices.getVisibleDevices().filter(d => d.online !== false);
                if (onlineDevs.length === 1) {
                    deviceId = onlineDevs[0].id;
                    if (select) select.value = deviceId;
                }
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
                    sender_id: LANX.clientId || '',
                    sender_name: LANX.clientName || 'Perangkat Ini',
                }),
            });

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                let toastMsg = deviceId === 'all' ? 'Teks berhasil disiarkan ke Semua Perangkat!' : 'Teks berhasil terkirim!';
                if (data.offline_queued) {
                    toastMsg = '📬 Teks tersimpan di server! Akan otomatis masuk saat perangkat online.';
                }
                LANX.showToast(toastMsg, 'success');
                input.value = '';
                const sendBtn = document.getElementById('btn-send-text');
                if (sendBtn) sendBtn.disabled = true;
            } else {
                const data = await res.json().catch(() => ({}));
                LANX.showToast(data.error || 'Gagal mengirim teks', 'error');
            }
        } catch (e) {
            LANX.showToast('Gagal mengirim teks', 'error');
        }
    },

    // ─── Received Items ──────────────────────────────────

    handleTextReceived(msg) {
        const isBroadcast = msg.target_device_id === 'all';
        const senderName = msg.from_device || 'Perangkat Lain';
        const isOffline = !!msg.is_offline_queue;
        const suffix = isOffline ? ' (Kotak Masuk)' : (isBroadcast ? ' (Siaran)' : '');
        this.addReceivedItem(senderName + suffix, msg.text);
        if (isOffline) {
            LANX.showToast(`📬 Pesan dari ${senderName} (dikirim saat Anda offline)`, 'info');
        } else {
            LANX.showToast(`Pesan baru dari ${senderName}${isBroadcast ? ' [Semua Perangkat]' : ''}`, 'info');
        }
    },

    handleClipboardReceived(msg) {
        const isBroadcast = msg.target_device_id === 'all';
        const senderName = msg.from_device || 'Perangkat Lain';
        this.addReceivedItem(senderName + (isBroadcast ? ' (Siaran)' : ''), msg.content);
        LANX.showToast(`Papan klip baru dari ${senderName}${isBroadcast ? ' [Semua Perangkat]' : ''}`, 'info');
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
