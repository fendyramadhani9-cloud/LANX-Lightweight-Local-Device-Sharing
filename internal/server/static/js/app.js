/**
 * LANX — Main Application Controller
 * Handles: tabs, theme, settings, WebSocket, toasts
 */

const LANX = {
    ws: null,
    wsReconnectTimer: null,
    wsReconnectDelay: 1000,
    deviceInfo: null,
    settings: null,
    clientId: null,
    clientName: null,
    platform: 'desktop',

    /** Initialize the application */
    async init() {
        // Load device info
        await this.loadDeviceInfo();

        // Initialize client identity
        this.initClientIdentity();

        // Load settings & apply theme
        await this.loadSettings();

        // Setup UI handlers
        this.setupTabs();
        this.setupSettings();
        this.setupPairing();
        this.setupModals();

        // Connect WebSocket
        this.connectWebSocket();

        // Initialize sub-modules
        if (typeof Devices !== 'undefined') Devices.init();
        if (typeof Transfer !== 'undefined') Transfer.init();
        if (typeof Clipboard !== 'undefined') Clipboard.init();
    },

    initClientIdentity() {
        let id = localStorage.getItem('lanx_client_id');
        if (!id) {
            id = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
            localStorage.setItem('lanx_client_id', id);
        }
        this.clientId = id;

        let name = localStorage.getItem('lanx_client_name');
        if (!name) {
            const ua = navigator.userAgent;
            if (/iPhone/i.test(ua)) {
                name = 'iPhone';
                this.platform = 'mobile';
            } else if (/iPad/i.test(ua)) {
                name = 'iPad';
                this.platform = 'tablet';
            } else if (/Android/i.test(ua)) {
                name = /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
                this.platform = 'mobile';
            } else if (/Macintosh|Mac OS X/i.test(ua)) {
                name = 'Mac';
                this.platform = 'desktop';
            } else if (/Windows/i.test(ua)) {
                name = 'Windows PC';
                this.platform = 'desktop';
            } else {
                name = 'Browser Client';
                this.platform = 'browser';
            }
            localStorage.setItem('lanx_client_name', name);
        } else {
            if (/iPhone|Android|Mobile/i.test(navigator.userAgent)) {
                this.platform = 'mobile';
            }
        }
        this.clientName = name;
    },

    // ─── Device Info ─────────────────────────────────────

    async loadDeviceInfo() {
        try {
            const res = await fetch('/api/device');
            this.deviceInfo = await res.json();
        } catch (e) {
            console.error('Failed to load device info:', e);
        }
    },

    // ─── Tabs ────────────────────────────────────────────

    setupTabs() {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                // Deactivate all
                tabs.forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                // Activate target
                tab.classList.add('active');
                const panel = document.getElementById(`panel-${target}`);
                if (panel) panel.classList.add('active');
            });
        });
    },

    // ─── Settings ────────────────────────────────────────

    async loadSettings() {
        try {
            const res = await fetch('/api/settings');
            this.settings = await res.json();
            this.applyTheme(this.settings.theme || 'light');
        } catch (e) {
            console.error('Failed to load settings:', e);
            // Apply saved theme from localStorage as fallback
            const saved = localStorage.getItem('lanx-theme') || 'light';
            this.applyTheme(saved);
        }
    },

    setupSettings() {
        const btnOpen = document.getElementById('btn-settings');
        const btnClose = document.getElementById('btn-close-settings');
        const btnSave = document.getElementById('btn-save-settings');
        const modal = document.getElementById('settings-modal');

        btnOpen.addEventListener('click', () => this.openSettings());
        btnClose.addEventListener('click', () => this.closeModal(modal));
        btnSave.addEventListener('click', () => this.saveSettings());

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal(modal);
        });
    },

    openSettings() {
        const modal = document.getElementById('settings-modal');
        const nameInput = document.getElementById('setting-device-name');
        const pairingInput = document.getElementById('setting-pairing');
        const versionSpan = document.getElementById('settings-version');

        if (this.settings) {
            nameInput.value = this.settings.device_name || '';
            pairingInput.checked = this.settings.pairing_required;
        }
        if (this.deviceInfo) {
            versionSpan.textContent = this.deviceInfo.version || '1.0.0';
        }

        // Theme radios
        const theme = this.settings?.theme || localStorage.getItem('lanx-theme') || 'light';
        const radio = document.getElementById(`theme-${theme}`);
        if (radio) radio.checked = true;

        modal.style.display = 'flex';
    },

    async saveSettings() {
        const name = document.getElementById('setting-device-name').value.trim();
        const pairing = document.getElementById('setting-pairing').checked;
        const theme = document.querySelector('input[name="theme"]:checked')?.value || 'light';

        try {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_name: name,
                    pairing_required: pairing,
                    theme: theme,
                }),
            });
            if (res.ok) {
                this.settings = await res.json();
                this.applyTheme(theme);
                localStorage.setItem('lanx-theme', theme);
                this.closeModal(document.getElementById('settings-modal'));
                this.showToast('Settings saved', 'success');
            }
        } catch (e) {
            this.showToast('Failed to save settings', 'error');
        }
    },

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('lanx-theme', theme);
    },

    // ─── Pairing ─────────────────────────────────────────

    setupPairing() {
        const btnPair = document.getElementById('btn-pair');
        const btnClose = document.getElementById('btn-close-pair');
        const modal = document.getElementById('pair-modal');

        btnPair.addEventListener('click', () => this.openPairing());
        btnClose.addEventListener('click', () => this.closeModal(modal));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal(modal);
        });

        // Pair request modal
        document.getElementById('btn-accept-pair').addEventListener('click', () => {
            this.respondPairRequest(true);
        });
        document.getElementById('btn-reject-pair').addEventListener('click', () => {
            this.respondPairRequest(false);
        });
    },

    async openPairing() {
        const modal = document.getElementById('pair-modal');
        const container = document.getElementById('qr-container');
        const urlEl = document.getElementById('pair-url');

        container.innerHTML = '<div class="qr-loading">Generating QR code...</div>';
        modal.style.display = 'flex';

        try {
            const res = await fetch('/api/pair/qr');
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                container.innerHTML = `<img src="${url}" alt="QR Code" width="200" height="200">`;

                // Show URL
                const host = window.location.host;
                urlEl.textContent = `http://${host}`;
            } else {
                container.innerHTML = '<div class="qr-loading">Failed to generate QR code</div>';
            }
        } catch (e) {
            container.innerHTML = '<div class="qr-loading">Failed to generate QR code</div>';
        }
    },

    currentPairToken: null,

    showPairRequest(deviceName, token) {
        this.currentPairToken = token;
        document.getElementById('pair-request-device').textContent = deviceName;
        document.getElementById('pair-request-modal').style.display = 'flex';
    },

    async respondPairRequest(accept) {
        const modal = document.getElementById('pair-request-modal');
        try {
            await fetch('/api/pair/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: this.currentPairToken,
                    accepted: accept,
                }),
            });
            this.showToast(accept ? 'Device paired' : 'Pair request rejected', accept ? 'success' : 'info');
        } catch (e) {
            this.showToast('Failed to respond to pair request', 'error');
        }
        this.closeModal(modal);
    },

    // ─── Modals ──────────────────────────────────────────

    setupModals() {
        // Escape key closes modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay').forEach(m => {
                    if (m.style.display === 'flex') {
                        this.closeModal(m);
                    }
                });
            }
        });
    },

    closeModal(modal) {
        modal.style.display = 'none';
    },

    // ─── WebSocket ───────────────────────────────────────

    connectWebSocket() {
        if (this.ws) {
            this.ws.close();
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws`;

        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.wsReconnectDelay = 1000;
                console.log('[LANX] WebSocket connected');
                this.registerWithHub();
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this.handleWSMessage(msg);
                } catch (e) {
                    console.error('[LANX] Invalid WS message:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('[LANX] WebSocket disconnected, reconnecting...');
                this.scheduleReconnect();
            };

            this.ws.onerror = () => {
                // onclose will fire after this
            };
        } catch (e) {
            this.scheduleReconnect();
        }
    },

    registerWithHub() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'register',
                id: this.clientId,
                name: this.clientName,
                platform: this.platform,
            }));
        }
    },

    scheduleReconnect() {
        if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = setTimeout(() => {
            this.connectWebSocket();
        }, this.wsReconnectDelay);
        // Exponential backoff, max 30s
        this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 1.5, 30000);
    },

    handleWSMessage(msg) {
        switch (msg.type) {
            case 'device_online':
            case 'device_offline':
            case 'device_update':
                if (typeof Devices !== 'undefined') Devices.handleEvent(msg);
                break;

            case 'transfer_complete':
                if (typeof Transfer !== 'undefined') Transfer.handleEvent(msg);
                const myId = this.clientId || (this.deviceInfo && this.deviceInfo.id);
                if (msg.target_device_id && msg.target_device_id === myId && msg.download_url) {
                    this.showFileReceivedToast(msg);
                }
                break;

            case 'transfer_progress':
            case 'transfer_failed':
            case 'transfer_started':
                if (typeof Transfer !== 'undefined') Transfer.handleEvent(msg);
                break;

            case 'text_received':
                const curId = this.clientId || (this.deviceInfo && this.deviceInfo.id);
                if (!msg.target_device_id || msg.target_device_id === curId) {
                    if (typeof Clipboard !== 'undefined') Clipboard.handleTextReceived(msg);
                }
                break;

            case 'clipboard_received':
                const curClipId = this.clientId || (this.deviceInfo && this.deviceInfo.id);
                if (!msg.target_device_id || msg.target_device_id === curClipId) {
                    if (typeof Clipboard !== 'undefined') Clipboard.handleClipboardReceived(msg);
                }
                break;

            case 'pair_request':
                this.showPairRequest(msg.device_name, msg.token);
                break;

            case 'incoming_file':
                this.showIncomingFile(msg);
                break;

            default:
                console.log('[LANX] Unknown WS message type:', msg.type);
        }
    },

    showFileReceivedToast(msg) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast success';
        toast.innerHTML = `
            <div style="margin-bottom: 6px;">
                <strong>Berkas Masuk:</strong> ${this.escapeHtml(msg.filename)} (${this.formatSize(msg.size)})
            </div>
            <a href="${msg.download_url}" download="${this.escapeHtml(msg.filename)}" class="btn btn-sm btn-primary" style="display: inline-block; padding: 4px 10px; text-decoration: none; color: #fff; border-radius: 4px; font-weight: 500;">
                Unduh Berkas
            </a>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 15000);
    },

    showIncomingFile(msg) {
        const modal = document.getElementById('incoming-modal');
        const title = document.getElementById('incoming-title');
        const body = document.getElementById('incoming-body');

        title.textContent = 'Incoming File';
        body.innerHTML = `
            <p style="text-align: center; margin-bottom: 8px;">
                <strong>${msg.device_name || 'Unknown'}</strong> wants to send you a file.
            </p>
            <p style="text-align: center; color: var(--color-text-secondary); font-size: var(--font-size-sm);">
                ${this.escapeHtml(msg.filename)} · ${this.formatSize(msg.size)}
            </p>
        `;

        document.getElementById('btn-accept-incoming').onclick = () => {
            this.closeModal(modal);
            // Accept handled by server
        };
        document.getElementById('btn-reject-incoming').onclick = () => {
            this.closeModal(modal);
        };

        modal.style.display = 'flex';
    },

    // ─── Toast ───────────────────────────────────────────

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    },

    // ─── Utilities ───────────────────────────────────────

    formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    },

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

        const isToday = date.toDateString() === now.toDateString();
        const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (isToday) return `Today, ${time}`;
        return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => LANX.init());
