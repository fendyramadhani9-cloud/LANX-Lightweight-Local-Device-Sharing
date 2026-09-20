/**
 * LANX — Device Discovery Module
 * Handles: nearby device display, device selection, send mode (1-per-1 vs All Devices), polling, device rename
 */

const Devices = {
    devices: [],
    selectedDevice: 'all',
    sendMode: 'all', // 'all' or 'single'
    pollTimer: null,

    init() {
        // Restore saved mode if exists, default to 'all'
        let savedMode = null;
        try { savedMode = localStorage.getItem('lanx_send_mode'); } catch (e) {}
        if (savedMode === 'single' || savedMode === 'all') {
            this.sendMode = savedMode;
            if (this.sendMode === 'all') {
                this.selectedDevice = 'all';
            }
        }

        this.setupModeSwitch();
        this.setupRenameModal();
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

    setupRenameModal() {
        const modal = document.getElementById('rename-modal');
        const btnClose = document.getElementById('btn-close-rename');
        const btnCancel = document.getElementById('btn-cancel-rename');
        const btnSave = document.getElementById('btn-save-rename');

        const closeIt = () => {
            if (modal) modal.style.display = 'none';
        };

        if (btnClose) btnClose.addEventListener('click', closeIt);
        if (btnCancel) btnCancel.addEventListener('click', closeIt);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeIt();
            });
        }

        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const id = document.getElementById('rename-device-id')?.value;
                const input = document.getElementById('rename-device-input');
                const newName = input ? input.value.trim() : '';

                if (!id || !newName) {
                    LANX.showToast('Nama perangkat tidak boleh kosong', 'error');
                    return;
                }

                try {
                    let res;
                    if (id === LANX.clientId && !LANX.isAdmin) {
                        res = await fetch('/api/device/profile', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: id,
                                name: newName,
                                platform: LANX.platform || 'browser',
                            }),
                        });
                    } else {
                        res = await fetch(`/api/devices/${encodeURIComponent(id)}`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Admin-Token': LANX.adminToken || '',
                            },
                            body: JSON.stringify({ name: newName }),
                        });
                    }

                    if (res.ok) {
                        const updated = await res.json();
                        if (id === LANX.clientId) {
                            LANX.clientName = newName;
                            localStorage.setItem('lanx_client_name', newName);
                            if (LANX.updateHeaderProfileBadge) LANX.updateHeaderProfileBadge();
                        }
                        this.addOrUpdateDevice(updated, updated.online);
                        closeIt();
                        LANX.showToast(`Nama perangkat diubah menjadi "${newName}"`, 'success');
                    } else {
                        const err = await res.json();
                        LANX.showToast(err.error || 'Gagal mengubah nama perangkat', 'error');
                    }
                } catch (e) {
                    LANX.showToast('Gagal mengubah nama perangkat', 'error');
                }
            });
        }

        const nameInput = document.getElementById('rename-device-input');
        if (nameInput) {
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (btnSave) btnSave.click();
                }
            });
        }
    },

    openRenameModal(deviceId) {
        const dev = this.getDeviceById(deviceId);
        if (!dev) return;

        const modal = document.getElementById('rename-modal');
        const idInput = document.getElementById('rename-device-id');
        const nameInput = document.getElementById('rename-device-input');

        if (idInput) idInput.value = deviceId;
        if (nameInput) {
            nameInput.value = dev.name;
            nameInput.placeholder = dev.name;
        }

        if (modal) {
            modal.style.display = 'flex';
            if (nameInput) {
                nameInput.focus();
                nameInput.select();
            }
        }
    },

    setSendMode(mode) {
        this.sendMode = mode;
        localStorage.setItem('lanx_send_mode', mode);

        if (mode === 'all') {
            this.selectedDevice = 'all';
        } else {
            // Mode single: if currently 'all', unselect or pick first visible device
            if (this.selectedDevice === 'all') {
                const visible = this.getVisibleDevices();
                const online = visible.filter(d => d.online !== false);
                this.selectedDevice = online.length > 0 ? online[0].id : (visible.length > 0 ? visible[0].id : null);
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
            const countText = visible.length > 0 ? ` (${visible.length} online)` : '';
            if (dropTarget) dropTarget.textContent = `Semua Perangkat${countText}`;
            if (descTarget) descTarget.innerHTML = `Target: <strong>Semua Perangkat${countText}</strong>`;
        } else if (this.selectedDevice) {
            const dev = this.getDeviceById(this.selectedDevice);
            const isOnline = dev && dev.online !== false;
            const name = dev ? dev.name : '1 Perangkat';
            if (isOnline) {
                if (dropTarget) dropTarget.textContent = `${name}`;
                if (descTarget) descTarget.innerHTML = `Target: <strong>${LANX.escapeHtml(name)}</strong>`;
            } else {
                if (dropTarget) dropTarget.textContent = `${name} (Server)`;
                if (descTarget) descTarget.innerHTML = `Target: <strong>${LANX.escapeHtml(name)}</strong> <span class="offline-target-note">(Offline — Masuk saat online)</span>`;
            }
        } else {
            if (dropTarget) dropTarget.textContent = 'Pilih perangkat tujuan';
            if (descTarget) descTarget.innerHTML = `Target: <em>Belum dipilih</em>`;
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
        const myId = LANX.clientId;
        const hostId = LANX.deviceInfo && LANX.deviceInfo.id;
        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        return (this.devices || []).filter(d => {
            if (d.id === myId) return false;
            if (isLocalHost && hostId && d.id === hostId) return false;
            return true;
        });
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
                <div class="device-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.93 19.07A10 10 0 0 1 12 2a10 10 0 0 1 7.07 17.07"/><path d="M7.76 16.24A6 6 0 0 1 12 6a6 6 0 0 1 4.24 10.24"/><circle cx="12" cy="12" r="2"/></svg></div>
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

        if (typeof LANX !== 'undefined' && LANX.updateSidebarCounters) {
            LANX.updateSidebarCounters();
        }

        // Attach click handlers
        grid.querySelectorAll('.device-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // Ignore if clicked on rename or promote button
                if (e.target.closest('.device-card-rename-btn') || e.target.closest('.device-promote-admin-btn')) return;
                const id = card.dataset.deviceId;
                this.selectDevice(id);
            });
        });

        // Attach rename button click handlers
        grid.querySelectorAll('.device-card-rename-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.renameId;
                this.openRenameModal(id);
            });
        });

        // Attach promote button click handlers
        grid.querySelectorAll('.device-promote-admin-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.deviceId;
                const cur = btn.dataset.currentRole;
                const newRole = cur === 'admin' ? 'user' : 'admin';
                const actionText = newRole === 'admin' ? 'jadikan Admin' : 'kembalikan ke User biasa';
                
                const ok = (typeof LANX !== 'undefined' && LANX.confirm)
                    ? await LANX.confirm({
                        title: 'Ubah Hak Akses Perangkat',
                        message: `Apakah Anda yakin ingin ${actionText} perangkat ini?`,
                        confirmText: newRole === 'admin' ? 'Jadikan Admin' : 'Jadikan User',
                        danger: false,
                    })
                    : confirm(`Apakah Anda yakin ingin ${actionText} perangkat ini?`);
                if (!ok) return;

                try {
                    const res = await fetch(`/api/devices/${encodeURIComponent(id)}/role`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Admin-Token': LANX.adminToken || '',
                        },
                        body: JSON.stringify({ role: newRole }),
                    });
                    if (res.ok) {
                        const updated = await res.json();
                        this.addOrUpdateDevice(updated, updated.online);
                        LANX.showToast('Status admin perangkat berhasil diperbarui!', 'success');
                    } else {
                        const err = await res.json();
                        LANX.showToast(err.error || 'Gagal mengubah status admin', 'error');
                    }
                } catch (err) {
                    LANX.showToast('Gagal mengubah status admin perangkat', 'error');
                }
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
                if (typeof LANX !== 'undefined' && LANX.copyToClipboard) {
                    LANX.copyToClipboard(window.location.origin, 'Tautan disalin ke papan klip');
                } else if (navigator.clipboard) {
                    navigator.clipboard.writeText(window.location.origin);
                }
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
        const icon = this.getDeviceIcon(device.name, device.platform);
        const isOnline = device.online !== false;
        const isSelected = this.sendMode === 'single' && this.selectedDevice === device.id;
        const isAdminDevice = device.role === 'admin' || device.is_host;
        const canPromote = LANX.isAdmin && !device.is_host && device.id !== LANX.clientId;
        const canRename = LANX.isAdmin || device.id === LANX.clientId;

        return `
            <div class="device-card ${isSelected ? 'selected' : ''} ${!isOnline ? 'offline-device' : ''}" data-device-id="${device.id}">
                <div class="device-card-icon">${icon}</div>
                <div class="device-card-info">
                    <div class="device-card-name" title="${LANX.escapeHtml(device.name)}">
                        ${LANX.escapeHtml(device.name)}
                        ${isAdminDevice ? '<span class="admin-badge" title="Perangkat ini berstatus Admin">Admin</span>' : ''}
                    </div>
                    <div class="device-card-status">
                        <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                        ${isOnline ? 'Online' : 'Offline'}
                        ${!isOnline ? '<span class="mailbox-pill" title="Berkas/pesan disimpan di server dan otomatis masuk saat komputer ini online">Kotak Masuk</span>' : ''}
                    </div>
                    ${canPromote ? `
                        <div>
                            <button type="button" class="device-promote-admin-btn" data-device-id="${device.id}" data-current-role="${device.role || 'user'}" title="${device.role === 'admin' ? 'Cabut Akses Admin' : 'Jadikan Admin'}">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                ${device.role === 'admin' ? 'Cabut Admin' : 'Jadikan Admin'}
                            </button>
                        </div>
                    ` : ''}
                </div>
                ${canRename ? `
                <button class="device-card-rename-btn" data-rename-id="${device.id}" title="Ubah nama / alias perangkat ini">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                ` : ''}
            </div>
        `;
    },

    getDeviceIcon(name, platform) {
        const svgPhone = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
        const svgTablet = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
        const svgDesktop = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
        const svgServer = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>';

        if (platform === 'mobile') return svgPhone;
        if (platform === 'tablet') return svgTablet;
        if (platform === 'desktop') return svgDesktop;

        const lower = (name || '').toLowerCase();
        if (lower.includes('phone') || lower.includes('mobile') || lower.includes('android') || lower.includes('iphone') || lower.includes('hp')) {
            return svgPhone;
        }
        if (lower.includes('tablet') || lower.includes('ipad')) {
            return svgTablet;
        }
        if (lower.includes('server')) {
            return svgServer;
        }
        return svgDesktop;
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
        const onlineDevs = visible.filter(d => d.online !== false);
        const offlineDevs = visible.filter(d => d.online === false);

        selects.forEach(select => {
            const options = [
                `<option value="all" ${this.sendMode === 'all' || this.selectedDevice === 'all' ? 'selected' : ''}>Semua Perangkat</option>`,
                '<option disabled>──────────</option>'
            ];

            if (onlineDevs.length > 0) {
                options.push(`<optgroup label="Perangkat Online (${onlineDevs.length})">`);
                onlineDevs.forEach(d => {
                    const isSelected = (this.sendMode === 'single' && this.selectedDevice === d.id);
                    options.push(`<option value="${d.id}" ${isSelected ? 'selected' : ''}>${LANX.escapeHtml(d.name)}</option>`);
                });
                options.push('</optgroup>');
            }

            if (offlineDevs.length > 0) {
                options.push(`<optgroup label="Kotak Masuk Offline (${offlineDevs.length})">`);
                offlineDevs.forEach(d => {
                    const isSelected = (this.sendMode === 'single' && this.selectedDevice === d.id);
                    options.push(`<option value="${d.id}" ${isSelected ? 'selected' : ''}>${LANX.escapeHtml(d.name)} (Offline)</option>`);
                });
                options.push('</optgroup>');
            }

            select.innerHTML = options.join('');

            // Explicitly sync select value
            const targetVal = (this.sendMode === 'all' || this.selectedDevice === 'all') ? 'all' : (this.selectedDevice || 'all');
            select.value = targetVal;

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
                        localStorage.setItem('lanx_send_mode', 'single');
                        this.updateModeButtons();
                        this.render();
                        this.updateSelects();
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
        if (!id || id === 'all') {
            return { id: 'all', name: 'Semua Perangkat' };
        }
        const found = (this.devices || []).find(d => d.id === id);
        if (found) return found;
        return { id: id, name: 'Perangkat (' + (id.length > 8 ? id.substring(0, 8) + '...' : id) + ')' };
    },

    getSelectedDevice() {
        if (this.sendMode === 'all' || this.selectedDevice === 'all') {
            return { id: 'all', name: 'Semua Perangkat' };
        }
        if (this.selectedDevice) {
            return this.getDeviceById(this.selectedDevice);
        }
        // If single mode but no device explicitly selected yet, pick first available
        const visible = this.getVisibleDevices();
        if (visible && visible.length > 0) {
            const online = visible.find(d => d.online !== false);
            const chosen = online || visible[0];
            this.selectedDevice = chosen.id;
            return chosen;
        }
        return { id: 'all', name: 'Semua Perangkat' };
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
            // Keep device selected if it was selected so user can still queue files/messages
            this.render();
            this.updateSelects();
            this.updateTargetDisplay();
        }
    },
};
