/**
 * LANX — Clipboard & Text Sharing Module
 * Handles: text sharing, clipboard read/write, received items
 */

const Clipboard = {
    receivedTexts: [],
    receivedClipboards: [],

    init() {
        this.setupTextSharing();
        this.setupClipboardSharing();
        this.checkClipboardPermission();
    },

    // ─── Text Sharing ────────────────────────────────────

    setupTextSharing() {
        const input = document.getElementById('text-input');
        const select = document.getElementById('text-device-select');
        const sendBtn = document.getElementById('btn-send-text');

        const updateBtn = () => {
            sendBtn.disabled = !select.value || !input.value.trim();
        };

        input.addEventListener('input', updateBtn);
        select.addEventListener('change', updateBtn);

        sendBtn.addEventListener('click', () => this.sendText());
    },

    async sendText() {
        const input = document.getElementById('text-input');
        const select = document.getElementById('text-device-select');
        const text = input.value.trim();
        const deviceId = select.value;

        if (!text || !deviceId) return;

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
                LANX.showToast('Text sent', 'success');
                input.value = '';
            } else {
                const data = await res.json();
                LANX.showToast(data.error || 'Failed to send text', 'error');
            }
        } catch (e) {
            LANX.showToast('Failed to send text', 'error');
        }
    },

    // ─── Clipboard Sharing ───────────────────────────────

    setupClipboardSharing() {
        const input = document.getElementById('clipboard-input');
        const select = document.getElementById('clipboard-device-select');
        const sendBtn = document.getElementById('btn-send-clipboard');
        const pasteBtn = document.getElementById('btn-paste-clipboard');

        const updateBtn = () => {
            sendBtn.disabled = !select.value || !input.value.trim();
        };

        input.addEventListener('input', updateBtn);
        select.addEventListener('change', updateBtn);

        sendBtn.addEventListener('click', () => this.sendClipboard());
        pasteBtn.addEventListener('click', () => this.pasteFromClipboard());
    },

    async pasteFromClipboard() {
        const input = document.getElementById('clipboard-input');

        try {
            const text = await navigator.clipboard.readText();
            input.value = text;
            input.dispatchEvent(new Event('input'));
        } catch (e) {
            // Show notice about clipboard permission
            document.getElementById('clipboard-notice').style.display = 'flex';
            LANX.showToast('Clipboard access denied by browser', 'error');
        }
    },

    async checkClipboardPermission() {
        try {
            const result = await navigator.permissions.query({ name: 'clipboard-read' });
            if (result.state === 'denied') {
                document.getElementById('clipboard-notice').style.display = 'flex';
            }
        } catch (e) {
            // Permissions API not supported — clipboard may still work on user gesture
        }
    },

    async sendClipboard() {
        const input = document.getElementById('clipboard-input');
        const select = document.getElementById('clipboard-device-select');
        const text = input.value.trim();
        const deviceId = select.value;

        if (!text || !deviceId) return;

        try {
            const res = await fetch('/api/clipboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: text,
                    target_device_id: deviceId,
                }),
            });

            if (res.ok) {
                LANX.showToast('Clipboard sent', 'success');
                input.value = '';
            } else {
                const data = await res.json();
                LANX.showToast(data.error || 'Failed to send clipboard', 'error');
            }
        } catch (e) {
            LANX.showToast('Failed to send clipboard', 'error');
        }
    },

    // ─── Received Text ───────────────────────────────────

    handleTextReceived(msg) {
        this.receivedTexts.unshift({
            from: msg.from_device || 'Unknown',
            content: msg.text,
            timestamp: Date.now(),
        });

        // Keep max 20
        if (this.receivedTexts.length > 20) this.receivedTexts.pop();

        this.renderReceivedTexts();
        LANX.showToast(`Text received from ${msg.from_device || 'Unknown'}`, 'info');
    },

    renderReceivedTexts() {
        const section = document.getElementById('received-texts-section');
        const container = document.getElementById('received-texts');

        if (this.receivedTexts.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = this.receivedTexts.map(item => `
            <div class="received-item">
                <div class="received-item-header">
                    <span class="received-item-from">From ${LANX.escapeHtml(item.from)}</span>
                    <span class="received-item-time">${LANX.formatTime(item.timestamp)}</span>
                </div>
                <div class="received-item-content">${LANX.escapeHtml(item.content)}</div>
                <div class="received-item-actions">
                    <button class="btn btn-ghost btn-sm" onclick="Clipboard.copyToClipboard('${LANX.escapeHtml(item.content.replace(/'/g, "\\'"))}')">
                        Copy
                    </button>
                </div>
            </div>
        `).join('');
    },

    // ─── Received Clipboard ──────────────────────────────

    handleClipboardReceived(msg) {
        this.receivedClipboards.unshift({
            from: msg.from_device || 'Unknown',
            content: msg.content,
            timestamp: Date.now(),
        });

        if (this.receivedClipboards.length > 20) this.receivedClipboards.pop();

        this.renderReceivedClipboards();

        // Auto-copy to clipboard if possible
        this.copyToClipboard(msg.content, true);

        LANX.showToast(`Clipboard synced from ${msg.from_device || 'Unknown'}`, 'info');
    },

    renderReceivedClipboards() {
        const section = document.getElementById('received-clipboard-section');
        const container = document.getElementById('received-clipboard');

        if (this.receivedClipboards.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = this.receivedClipboards.map(item => `
            <div class="received-item">
                <div class="received-item-header">
                    <span class="received-item-from">From ${LANX.escapeHtml(item.from)}</span>
                    <span class="received-item-time">${LANX.formatTime(item.timestamp)}</span>
                </div>
                <div class="received-item-content">${LANX.escapeHtml(item.content)}</div>
                <div class="received-item-actions">
                    <button class="btn btn-ghost btn-sm" onclick="Clipboard.copyToClipboard(\`${LANX.escapeHtml(item.content.replace(/`/g, '\\`'))}\`)">
                        Copy
                    </button>
                </div>
            </div>
        `).join('');
    },

    // ─── Copy to Clipboard ───────────────────────────────

    async copyToClipboard(text, silent = false) {
        try {
            await navigator.clipboard.writeText(text);
            if (!silent) {
                LANX.showToast('Copied to clipboard', 'success');
            }
        } catch (e) {
            if (!silent) {
                LANX.showToast('Failed to copy — clipboard permission denied', 'error');
            }
        }
    },
};
