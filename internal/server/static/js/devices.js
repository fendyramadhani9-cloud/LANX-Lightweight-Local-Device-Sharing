/**
 * LANX — Device Discovery Module
 * Handles: nearby device display, device selection, send mode (1-per-1 vs All Devices), polling
 */

const Devices = {
    devices: [],
    selectedDevice: 'all',
    sendMode: 'all', // 'all' or 'single'
    pollTimer: null,

    init() {
        // Restore saved mode if exists, default to 'all'
        const savedMode = localStorage.getItem('lanx_send_mode');
        if (savedMode === 'single' || savedMode === 'all') {
            this.sendMode = savedMode;
            if (this.sendMode === 'all') {
                this.selectedDevice = 'all';
            }
        }

        this.setupModeSwitch();
        this.loadDevices();
        // Poll for device changes every 10 seconds
        this.pollTimer = setInterval(() => this.loadDevices(), 10000);
    },

    setupModeSwitch() {
        const btnSingle = document.getElementById('btn-mode-single');
        const btnAll = document.getElementById('btn-mode-all');

        if (btnSingle) {
            btnSingle.addEventListener('click', () => this.setSendMode('single'));
        }
        if (btnAll) {
            btnAll.addEventListener('click', () => this.setSendMode('all'));
        }

        this.updateModeButtons();
        this.updateTargetDisplay();
    },

    setSendMode(mode) {
        this.sendMode = mode;
        localStorage.setItem('lanx_send_mode', mode);

        if (mode === 'all') {
            this.selectedDevice = 'all';
        } else {
            // Mode single: if currently 'all', unselect or pick first visible device
            if (this.selectedDevice === 'all') {
                const visible = this.getVisibleDevices().filter(d => d.online !== false);
                this.selectedDevice = visible.length > 0 ? visible[0].id : null;
            }
        }

        this.updateModeButtons();
        this.render();
        this.updateSelects();
        this.updateTargetDisplay();
        this.updateSendButtons();
    },

    updateModeButtons() {
        const btnSingle = document.getElementById('btn-mode-single');
        const btnAll = document.getElementById('btn-mode-all');

        if (btnSingle) {
            btnSingle.classList.toggle('active', this.sendMode === 'single');
        }
        if (btnAll) {
            btnAll.classList.toggle('active', this.sendMode === 'all');
        }
    },

    updateTargetDisplay() {
        const dropTarget = document.getElementById('drop-target-name');
        const descTarget = document.getElementById('mode-target-desc');
        const visible = this.getVisibleDevices().filter(d => d.online !== false);

        if (this.sendMode === 'all' || this.selectedDevice === 'all') {
            const countText = visible.length > 0 ? ` (${visible.length} perangkat online)` : '';
            if (dropTarget) dropTarget.textContent = `📢 Semua Perangkat (All Devices)${countText}`;
            if (descTarget) descTarget.innerHTML = `Target: <strong>📢 Semua Perangkat (Siaran Massal)${countText}</strong>`;
        } else if (this.selectedDevice) {
            const dev = this.getDeviceById(this.selectedDevice);
            const name = dev ? dev.name : '1 Perangkat';
            if (dropTarget) dropTarget.textContent = `🎯 ${name}`;
            if (descTarget) descTarget.innerHTML = `Target: <strong>🎯 ${LANX.escapeHtml(name)}</strong>`;
        } else {
            if (dropTarget) dropTarget.textContent = 'Pilih perangkat tujuan di bawah';
            if (descTarget) descTarget.innerHTML = `Target: <em>Belum dipilih (Klik perangkat di bawah)</em>`;
        }
    },

    async loadDevices() {
        try {
            const res = await fetch('/api/devices');
            if (res.ok) {
                this.devices = await res.json();
                this.render();
                this.updateSelects();
                this.updateTargetDisplay();
            }
        } catch (e) {
            // Silently fail — will retry on next poll
        }
    },

    getVisibleDevices() {
        const myId = LANX.clientId || (LANX.deviceInfo && LANX.deviceInfo.id);
        return (this.devices || []).filter(d => d.id !== myId);
    },

    render() {
        const grid = document.getElementById('devices-grid');
        const empty = document.getElementById('devices-empty');
        const visible = this.getVisibleDevices();
        const onlineDevices = visible.filter(d => d.online !== false);

        if (!visible || visible.length === 0) {
            grid.innerHTML = '';
            grid.appendChild(empty);
            empty.style.display = 'flex';
            this.setupEmptyState();
            return;
        }

        empty.style.display = 'none';

        // Render Broadcast Card first, followed by individual devices
        const isAllSelected = this.sendMode === 'all' || this.selectedDevice === 'all';
        const broadcastCardHtml = `
            <div class="device-card broadcast-card ${isAllSelected ? 'selected' : ''}" data-device-id="all">
                <div class="device-card-icon">📢</div>
                <div class="device-card-info">
                    <div class="device-card-name">Semua Perangkat (All)</div>
                    <div class="device-card-status">
                        <span class="status-dot online"></span>
                        ${onlineDevices.length} perangkat online
                    </div>
                    <span class="broadcast-badge-pill">Mode Siaran</span>
                </div>
            </div>
        `;

        const deviceCardsHtml = visible.map(d => this.renderCard(d)).join('');
        grid.innerHTML = broadcastCardHtml + deviceCardsHtml;

        // Attach click handlers
        grid.querySelectorAll('.device-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.deviceId;
                this.selectDevice(id);
            });
        });
    },

    setupEmptyState() {
        const urlEl = document.getElementById('display-lan-url');
        if (urlEl) {
            urlEl.textContent = window.location.origin;
        }
        const copyBtn = document.getElementById('btn-copy-url');
        if (copyBtn && !copyBtn.dataset.bound) {
            copyBtn.dataset.bound = 'true';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(window.location.origin)
                    .then(() => LANX.showToast('Tautan disalin ke papan klip', 'success'))
                    .catch(() => LANX.showToast(window.location.origin, 'info'));
            });
        }
        const pairBtn = document.getElementById('btn-empty-pair');
        if (pairBtn && !pairBtn.dataset.bound) {
            pairBtn.dataset.bound = 'true';
            pairBtn.addEventListener('click', () => {
                if (LANX.openPairing) LANX.openPairing();
            });
        }
    },

    renderCard(device) {
        const icon = this.getDeviceIcon(device.name);
        const isOnline = device.online !== false;
        const isSelected = this.sendMode === 'single' && this.selectedDevice === device.id;

        return `
            <div class="device-card ${isSelected ? 'selected' : ''}" data-device-id="${device.id}">
                <div class="device-card-icon">${icon}</div>
                <div class="device-card-info">
                    <div class="device-card-name">${LANX.escapeHtml(device.name)}</div>
                    <div class="device-card-status">
                        <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                        ${isOnline ? 'Online' : 'Offline'}
                    </div>
                </div>
            </div>
        `;
    },

    getDeviceIcon(name) {
        const lower = (name || '').toLowerCase();
        if (lower.includes('phone') || lower.includes('mobile') || lower.includes('android') || lower.includes('iphone')) {
            return '📱';
        }
        if (lower.includes('tablet') || lower.includes('ipad')) {
            return '📱';
        }
        if (lower.includes('server')) {
            return '🖥️';
        }
        return '💻';
    },

    selectDevice(id) {
        if (id === 'all') {
            this.setSendMode('all');
            return;
        }

        // Selecting a specific device switches to single mode
        this.sendMode = 'single';
        if (this.selectedDevice === id) {
            // Clicking again toggles off
            this.selectedDevice = null;
        } else {
            this.selectedDevice = id;
        }

        this.updateModeButtons();
        this.render();
        this.updateSelects();
        this.updateTargetDisplay();
        this.updateSendButtons();
    },

    updateSelects() {
        const selects = document.querySelectorAll('.device-select');
        const visible = this.getVisibleDevices();

        selects.forEach(select => {
            const currentVal = select.value;
            const options = [
                `<option value="all" ${this.sendMode === 'all' || this.selectedDevice === 'all' ? 'selected' : ''}>📢 Semua Perangkat (All Devices)</option>`,
                '<option disabled>──────────</option>'
            ];

            visible.forEach(d => {
                if (d.online !== false) {
                    const isSelected = (this.sendMode === 'single' && this.selectedDevice === d.id);
                    options.push(`<option value="${d.id}" ${isSelected ? 'selected' : ''}>${LANX.escapeHtml(d.name)}</option>`);
                }
            });

            select.innerHTML = options.join('');

            // Bind change event once
            if (!select.dataset.bound) {
                select.dataset.bound = 'true';
                select.addEventListener('change', (e) => {
                    const val = e.target.value;
                    if (val === 'all') {
                        this.setSendMode('all');
                    } else if (val) {
                        this.sendMode = 'single';
                        this.selectedDevice = val;
                        this.updateModeButtons();
                        this.render();
                        this.updateTargetDisplay();
                        this.updateSendButtons();
                    }
                });
            }
        });

        // Update send buttons state
        this.updateSendButtons();
    },

    updateSendButtons() {
        const textBtn = document.getElementById('btn-send-text');
        const textInput = document.getElementById('text-input');
        if (textBtn && textInput) {
            const hasText = !!textInput.value.trim();
            if (this.sendMode === 'all') {
                textBtn.disabled = !hasText;
            } else {
                const textSelect = document.getElementById('text-device-select');
                const target = textSelect ? textSelect.value : this.selectedDevice;
                textBtn.disabled = !target || !hasText;
            }
        }
    },

    getDeviceById(id) {
        if (id === 'all') {
            return { id: 'all', name: 'Semua Perangkat (All Devices)' };
        }
        return this.devices.find(d => d.id === id);
    },

    getSelectedDevice() {
        if (this.sendMode === 'all' || this.selectedDevice === 'all') {
            return { id: 'all', name: 'Semua Perangkat (All Devices)' };
        }
        if (this.selectedDevice) {
            return this.getDeviceById(this.selectedDevice);
        }
        return null;
    },

    handleEvent(msg) {
        const myId = LANX.clientId || (LANX.deviceInfo && LANX.deviceInfo.id);
        switch (msg.type) {
            case 'device_online':
                if (msg.device && msg.device.id !== myId) {
                    this.addOrUpdateDevice(msg.device, true);
                    LANX.showToast(`${msg.device.name} terhubung`, 'info');
                }
                break;
            case 'device_offline':
                if (msg.device_id && msg.device_id !== myId) {
                    this.setDeviceOffline(msg.device_id);
                }
                break;
            case 'device_update':
                if (msg.device && msg.device.id !== myId) {
                    this.addOrUpdateDevice(msg.device, true);
                }
                break;
        }
    },

    addOrUpdateDevice(device, online) {
        const idx = this.devices.findIndex(d => d.id === device.id);
        if (idx >= 0) {
            this.devices[idx] = { ...this.devices[idx], ...device, online };
        } else {
            this.devices.push({ ...device, online });
        }
        this.render();
        this.updateSelects();
        this.updateTargetDisplay();
    },

    setDeviceOffline(deviceId) {
        const idx = this.devices.findIndex(d => d.id === deviceId);
        if (idx >= 0) {
            this.devices[idx].online = false;
            LANX.showToast(`${this.devices[idx].name} went offline`, 'info');
            if (this.selectedDevice === deviceId) {
                this.selectedDevice = null;
            }
            this.render();
            this.updateSelects();
            this.updateTargetDisplay();
        }
    },
};
