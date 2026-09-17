/**
 * LANX — Device Discovery Module
 * Handles: nearby device display, device selection, polling
 */

const Devices = {
    devices: [],
    selectedDevice: null,
    pollTimer: null,

    init() {
        this.loadDevices();
        // Poll for device changes every 10 seconds
        this.pollTimer = setInterval(() => this.loadDevices(), 10000);
    },

    async loadDevices() {
        try {
            const res = await fetch('/api/devices');
            if (res.ok) {
                this.devices = await res.json();
                this.render();
                this.updateSelects();
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

        if (!visible || visible.length === 0) {
            grid.innerHTML = '';
            grid.appendChild(empty);
            empty.style.display = 'flex';
            this.setupEmptyState();
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = visible.map(d => this.renderCard(d)).join('');

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
        const isSelected = this.selectedDevice === device.id;

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
        if (this.selectedDevice === id) {
            this.selectedDevice = null;
        } else {
            this.selectedDevice = id;
        }
        this.render();
        this.updateSelects();
    },

    updateSelects() {
        const selects = document.querySelectorAll('.device-select');
        const visible = this.getVisibleDevices();

        selects.forEach(select => {
            const currentVal = select.value;
            const options = ['<option value="">Select a device</option>'];

            visible.forEach(d => {
                if (d.online !== false) {
                    options.push(`<option value="${d.id}" ${d.id === currentVal ? 'selected' : ''}>${LANX.escapeHtml(d.name)}</option>`);
                }
            });

            select.innerHTML = options.join('');

            // If only 1 peer device is available, auto-select it
            if (visible.length === 1 && !currentVal) {
                select.value = visible[0].id;
            }

            // If a device is selected via card, update selects
            if (this.selectedDevice) {
                select.value = this.selectedDevice;
            }
        });

        // Update send buttons state
        this.updateSendButtons();
    },

    updateSendButtons() {
        const textSelect = document.getElementById('text-device-select');
        const textBtn = document.getElementById('btn-send-text');
        const textInput = document.getElementById('text-input');
        if (textBtn && textSelect && textInput) {
            textBtn.disabled = !textSelect.value || !textInput.value.trim();
        }
    },

    getDeviceById(id) {
        return this.devices.find(d => d.id === id);
    },

    getSelectedDevice() {
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
    },

    setDeviceOffline(deviceId) {
        const idx = this.devices.findIndex(d => d.id === deviceId);
        if (idx >= 0) {
            this.devices[idx].online = false;
            LANX.showToast(`${this.devices[idx].name} went offline`, 'info');
            this.render();
            this.updateSelects();
        }
    },
};
