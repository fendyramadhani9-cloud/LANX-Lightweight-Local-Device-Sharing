/**
 * LANX — File Transfer Module
 * Handles: drag & drop, folder upload, camera quick shot, file upload/download, speedometer, ETA, history
 */

const Transfer = {
    activeTransfers: {},

    init() {
        this.setupDropZone();
        this.setupFolderInput();
        this.setupCameraInput();
        this.setupPreviewClickListener();
        this.loadHistory();
    },

    // ─── Drop Zone & Action Buttons ──────────────────────

    setupDropZone() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const btnPickFile = document.getElementById('btn-pick-file');
        const btnPickFolder = document.getElementById('btn-pick-folder');
        const btnQuickCamera = document.getElementById('btn-quick-camera');
        const folderInput = document.getElementById('folder-input');
        const cameraInput = document.getElementById('camera-input');

        // Click to browse file
        dropZone.addEventListener('click', (e) => {
            // If user clicked inside drop-zone-actions, let the specific button handler run
            if (e.target.closest('#drop-zone-actions')) return;
            fileInput.click();
        });

        if (btnPickFile) {
            btnPickFile.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput.click();
            });
        }

        if (btnPickFolder) {
            btnPickFolder.addEventListener('click', (e) => {
                e.stopPropagation();
                if (folderInput) folderInput.click();
            });
        }

        if (btnQuickCamera) {
            btnQuickCamera.addEventListener('click', (e) => {
                e.stopPropagation();
                if (cameraInput) cameraInput.click();
            });
        }

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFiles(Array.from(e.target.files));
                fileInput.value = '';
            }
        });

        // Drag events
        ['dragenter', 'dragover'].forEach(event => {
            dropZone.addEventListener(event, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(event => {
            dropZone.addEventListener(event, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-over');
            });
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');

            const dataTransfer = e.dataTransfer;
            if (!dataTransfer) return;

            // Check if directory was dropped using webkitGetAsEntry
            if (dataTransfer.items && dataTransfer.items.length > 0 && dataTransfer.items[0].webkitGetAsEntry) {
                const entries = [];
                for (let i = 0; i < dataTransfer.items.length; i++) {
                    const entry = dataTransfer.items[i].webkitGetAsEntry();
                    if (entry) entries.push(entry);
                }

                const hasDir = entries.some(entry => entry.isDirectory);
                if (hasDir) {
                    // Extract all files with relative paths
                    const allFiles = [];
                    let topFolderName = '';

                    for (const entry of entries) {
                        if (entry.isDirectory && !topFolderName) {
                            topFolderName = entry.name;
                        }
                        await this.traverseFileTree(entry, '', allFiles);
                    }

                    if (allFiles.length > 0) {
                        this.handleFolder(topFolderName || 'Folder_Transfer', allFiles);
                        return;
                    }
                }
            }

            // Fallback to normal files
            const files = Array.from(dataTransfer.files);
            if (files.length > 0) {
                this.handleFiles(files);
            }
        });

        // Prevent page-level drop
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    },

    async traverseFileTree(item, path, fileList) {
        path = path || '';
        if (item.isFile) {
            return new Promise((resolve) => {
                item.file((file) => {
                    file.customRelativePath = (path ? path + '/' : '') + file.name;
                    fileList.push(file);
                    resolve();
                }, () => resolve());
            });
        } else if (item.isDirectory) {
            const dirReader = item.createReader();
            const readEntries = () => new Promise((resolve) => {
                dirReader.readEntries(async (entries) => {
                    if (!entries.length) {
                        resolve();
                    } else {
                        for (const child of entries) {
                            await this.traverseFileTree(child, (path ? path + '/' : '') + item.name, fileList);
                        }
                        await readEntries();
                        resolve();
                    }
                }, () => resolve());
            });
            await readEntries();
        }
    },

    // ─── Folder Input ────────────────────────────────────

    setupFolderInput() {
        const folderInput = document.getElementById('folder-input');
        if (!folderInput) return;

        folderInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) {
                // Determine root folder name
                let folderName = 'Folder_Transfer';
                if (files[0].webkitRelativePath) {
                    folderName = files[0].webkitRelativePath.split('/')[0] || folderName;
                }
                this.handleFolder(folderName, files);
                folderInput.value = '';
            }
        });
    },

    // ─── Camera Quick Shot ───────────────────────────────

    setupCameraInput() {
        const cameraInput = document.getElementById('camera-input');
        if (!cameraInput) return;

        cameraInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) {
                const now = new Date();
                const pad = n => String(n).padStart(2, '0');
                const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                
                const renamedFiles = files.map(file => {
                    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
                    const newName = `Foto_LANX_${timeStr}.${ext}`;
                    return new File([file], newName, { type: file.type });
                });

                this.handleFiles(renamedFiles);
                cameraInput.value = '';
            }
        });
    },

    // ─── File & Folder Handling ──────────────────────────

    handleFiles(files) {
        const device = Devices.getSelectedDevice();
        if (!device) {
            this.showDevicePicker(files, false);
            return;
        }

        files.forEach(file => this.uploadFile(file, device));
    },

    handleFolder(folderName, files) {
        const device = Devices.getSelectedDevice();
        if (!device) {
            this.showDevicePicker(files, true, folderName);
            return;
        }

        this.uploadFolder(folderName, files, device);
    },

    showDevicePicker(files, isFolder = false, folderName = '') {
        const visible = (typeof Devices !== 'undefined') ? Devices.getVisibleDevices() : [];
        const onlineDevices = visible.filter(d => d.online !== false);
        const offlineDevices = visible.filter(d => d.online === false);

        const overlay = document.createElement('div');
        overlay.className = 'device-picker-overlay';
        overlay.innerHTML = `
            <div class="device-picker">
                <h3>Kirim ${isFolder ? 'Folder' : 'Berkas'} ke:</h3>
                <div class="device-picker-broadcast-btn" id="btn-picker-broadcast">
                    <div class="device-card-icon" style="background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;">📢</div>
                    <div>
                        <div class="device-picker-broadcast-title">Kirim ke Semua Perangkat (All)</div>
                        <div class="device-picker-broadcast-desc">Siarkan ${isFolder ? 'folder' : 'berkas'} ini ke seluruh perangkat yang terhubung</div>
                    </div>
                </div>
                ${onlineDevices.length > 0 ? `
                    <div style="font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text-secondary); margin: 8px 0 6px 0; text-transform: uppercase;">Perangkat Online (${onlineDevices.length}):</div>
                    <div class="device-picker-list">
                        ${onlineDevices.map(d => `
                            <div class="device-card" data-device-id="${d.id}">
                                <div class="device-card-icon">${Devices.getDeviceIcon(d.name, d.platform)}</div>
                                <div class="device-card-info">
                                    <div class="device-card-name">${LANX.escapeHtml(d.name)}</div>
                                    <div class="device-card-status">
                                        <span class="status-dot online"></span> Online
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${offlineDevices.length > 0 ? `
                    <div style="font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text-secondary); margin: 12px 0 6px 0; text-transform: uppercase;">📬 Kotak Masuk Offline (${offlineDevices.length}):</div>
                    <div class="device-picker-list">
                        ${offlineDevices.map(d => `
                            <div class="device-card offline-device" data-device-id="${d.id}">
                                <div class="device-card-icon">${Devices.getDeviceIcon(d.name, d.platform)}</div>
                                <div class="device-card-info">
                                    <div class="device-card-name">${LANX.escapeHtml(d.name)}</div>
                                    <div class="device-card-status">
                                        <span class="status-dot offline"></span> Offline
                                        <span class="mailbox-pill">📬 Kotak Masuk</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${visible.length === 0 ? `
                    <p style="text-align: center; color: var(--color-text-tertiary); font-size: var(--font-size-sm); margin: 16px 0;">Belum ada perangkat lain terdaftar. Anda tetap dapat menyiarkan ke Semua Perangkat.</p>
                ` : ''}
                <button class="btn btn-ghost" style="width: 100%; margin-top: 12px;" id="cancel-picker">Batal</button>
            </div>
        `;

        const broadcastBtn = overlay.querySelector('#btn-picker-broadcast');
        if (broadcastBtn) {
            broadcastBtn.addEventListener('click', () => {
                const target = { id: 'all', name: 'Semua Perangkat (All Devices)' };
                if (isFolder) {
                    this.uploadFolder(folderName, files, target);
                } else {
                    files.forEach(file => this.uploadFile(file, target));
                }
                overlay.remove();
            });
        }

        overlay.querySelector('#cancel-picker').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.querySelectorAll('.device-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.deviceId;
                const device = Devices.getDeviceById(id);
                if (device) {
                    if (isFolder) {
                        this.uploadFolder(folderName, files, device);
                    } else {
                        files.forEach(file => this.uploadFile(file, device));
                    }
                }
                overlay.remove();
            });
        });

        document.body.appendChild(overlay);
    },

    // ─── Upload Single File with Speedometer ─────────────

    async uploadFile(file, targetDevice) {
        const transferId = this.generateId();
        const isAll = targetDevice.id === 'all';
        const targetDisplayName = isAll ? '📢 Semua Perangkat' : targetDevice.name;

        this.activeTransfers[transferId] = {
            id: transferId,
            filename: file.name,
            size: file.size,
            loaded: 0,
            percentage: 0,
            status: 'preparing',
            direction: 'sent',
            device: targetDisplayName,
            timestamp: Date.now(),
            startTime: Date.now(),
            lastTime: Date.now(),
            lastLoaded: 0,
            speed: 0,
            eta: null,
        };

        this.renderActiveTransfers();

        const formData = new FormData();
        formData.append('file', file);
        formData.append('target_device_id', targetDevice.id);
        formData.append('transfer_id', transferId);
        formData.append('sender_id', LANX.clientId || '');
        formData.append('sender_name', LANX.clientName || 'Perangkat Ini');

        try {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const item = this.activeTransfers[transferId];
                    if (item) {
                        item.loaded = e.loaded;
                        item.percentage = Math.round((e.loaded / e.total) * 100);
                        item.status = 'transferring';

                        // Calculate speed & ETA
                        const now = Date.now();
                        const timeDelta = (now - item.lastTime) / 1000;
                        if (timeDelta >= 0.25 || item.speed === 0) {
                            const bytesDelta = e.loaded - item.lastLoaded;
                            const instantSpeed = bytesDelta / (timeDelta || 1);
                            item.speed = item.speed === 0 ? instantSpeed : (0.35 * instantSpeed + 0.65 * item.speed);
                            item.lastLoaded = e.loaded;
                            item.lastTime = now;

                            if (item.speed > 0) {
                                const remainingBytes = e.total - e.loaded;
                                item.eta = Math.max(0, Math.round(remainingBytes / item.speed));
                            }
                        }

                        this.renderActiveTransfers();
                    }
                }
            });

            xhr.addEventListener('load', () => {
                const item = this.activeTransfers[transferId];
                if (xhr.status >= 200 && xhr.status < 300) {
                    let resData = null;
                    try { resData = JSON.parse(xhr.responseText); } catch (e) {}

                    if (item) {
                        item.status = 'completed';
                        item.percentage = 100;
                        item.speed = 0;
                        item.eta = null;
                    }

                    if (resData && resData.offline_queued) {
                        LANX.showToast(`📦 Berkas tersimpan di server! Akan otomatis masuk saat ${targetDisplayName} online.`, 'info');
                    } else {
                        LANX.showToast(`${file.name} berhasil terkirim`, 'success');
                    }
                } else {
                    if (item) item.status = 'failed';
                    LANX.showToast(`Gagal mengirim ${file.name}`, 'error');
                }
                this.renderActiveTransfers();
                this.loadHistory();

                setTimeout(() => {
                    delete this.activeTransfers[transferId];
                    this.renderActiveTransfers();
                }, 4000);
            });

            xhr.addEventListener('error', () => {
                if (this.activeTransfers[transferId]) this.activeTransfers[transferId].status = 'failed';
                LANX.showToast(`Gagal mengirim ${file.name}`, 'error');
                this.renderActiveTransfers();
            });

            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        } catch (e) {
            if (this.activeTransfers[transferId]) this.activeTransfers[transferId].status = 'failed';
            this.renderActiveTransfers();
            LANX.showToast(`Gagal mengirim ${file.name}`, 'error');
        }
    },

    // ─── Upload Folder Auto-Zip with Speedometer ─────────

    async uploadFolder(folderName, files, targetDevice) {
        const transferId = this.generateId();
        const isAll = targetDevice.id === 'all';
        const targetDisplayName = isAll ? '📢 Semua Perangkat' : targetDevice.name;
        const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
        const displayZipName = folderName.endsWith('.zip') ? folderName : `${folderName}.zip`;

        this.activeTransfers[transferId] = {
            id: transferId,
            filename: displayZipName,
            size: totalSize,
            loaded: 0,
            percentage: 0,
            status: 'preparing',
            direction: 'sent',
            device: targetDisplayName,
            timestamp: Date.now(),
            startTime: Date.now(),
            lastTime: Date.now(),
            lastLoaded: 0,
            speed: 0,
            eta: null,
            isFolder: true,
        };

        this.renderActiveTransfers();

        const formData = new FormData();
        formData.append('folder_name', folderName);
        formData.append('target_device_id', targetDevice.id);
        formData.append('transfer_id', transferId);
        formData.append('sender_id', LANX.clientId || '');
        formData.append('sender_name', LANX.clientName || 'Perangkat Ini');

        files.forEach(file => {
            formData.append('files', file);
            const relPath = file.webkitRelativePath || file.customRelativePath || file.name;
            formData.append('paths', relPath);
        });

        try {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const item = this.activeTransfers[transferId];
                    if (item) {
                        item.loaded = e.loaded;
                        item.percentage = Math.round((e.loaded / e.total) * 100);
                        item.status = 'transferring';

                        const now = Date.now();
                        const timeDelta = (now - item.lastTime) / 1000;
                        if (timeDelta >= 0.25 || item.speed === 0) {
                            const bytesDelta = e.loaded - item.lastLoaded;
                            const instantSpeed = bytesDelta / (timeDelta || 1);
                            item.speed = item.speed === 0 ? instantSpeed : (0.35 * instantSpeed + 0.65 * item.speed);
                            item.lastLoaded = e.loaded;
                            item.lastTime = now;

                            if (item.speed > 0) {
                                const remainingBytes = e.total - e.loaded;
                                item.eta = Math.max(0, Math.round(remainingBytes / item.speed));
                            }
                        }

                        this.renderActiveTransfers();
                    }
                }
            });

            xhr.addEventListener('load', () => {
                const item = this.activeTransfers[transferId];
                if (xhr.status >= 200 && xhr.status < 300) {
                    let resData = null;
                    try { resData = JSON.parse(xhr.responseText); } catch (e) {}

                    if (item) {
                        item.status = 'completed';
                        item.percentage = 100;
                        item.speed = 0;
                        item.eta = null;
                    }

                    if (resData && resData.offline_queued) {
                        LANX.showToast(`📦 Folder "${folderName}" tersimpan di server! Akan otomatis masuk saat ${targetDisplayName} online.`, 'info');
                    } else {
                        LANX.showToast(`Folder "${folderName}" berhasil dikemas & dikirim!`, 'success');
                    }
                } else {
                    if (item) item.status = 'failed';
                    LANX.showToast(`Gagal mengirim folder ${folderName}`, 'error');
                }
                this.renderActiveTransfers();
                this.loadHistory();

                setTimeout(() => {
                    delete this.activeTransfers[transferId];
                    this.renderActiveTransfers();
                }, 4000);
            });

            xhr.addEventListener('error', () => {
                if (this.activeTransfers[transferId]) this.activeTransfers[transferId].status = 'failed';
                LANX.showToast(`Gagal mengirim folder ${folderName}`, 'error');
                this.renderActiveTransfers();
            });

            xhr.open('POST', '/api/upload-folder');
            xhr.send(formData);
        } catch (e) {
            if (this.activeTransfers[transferId]) this.activeTransfers[transferId].status = 'failed';
            this.renderActiveTransfers();
            LANX.showToast(`Gagal mengirim folder ${folderName}`, 'error');
        }
    },

    // ─── Active Transfers UI ─────────────────────────────

    renderActiveTransfers() {
        const section = document.getElementById('active-transfers-section');
        const container = document.getElementById('active-transfers');
        const transfers = Object.values(this.activeTransfers);

        if (transfers.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = transfers.map(t => this.renderTransferItem(t, true)).join('');
    },

    renderTransferItem(transfer, isActive = false) {
        const icon = this.getFileIcon(transfer.filename);
        const sizeStr = LANX.formatSize(transfer.size || 0);
        const loadedStr = LANX.formatSize(transfer.loaded || 0);

        let statusHtml = '';
        let progressHtml = '';

        switch (transfer.status) {
            case 'preparing':
                statusHtml = '<span class="transfer-status">Menyiapkan...</span>';
                break;
            case 'transferring':
                progressHtml = `
                    <div class="transfer-progress-bar">
                        <div class="transfer-progress-fill" style="width: ${transfer.percentage}%"></div>
                    </div>
                `;
                statusHtml = `<span class="transfer-status">${transfer.percentage}%</span>`;
                break;
            case 'completed':
                statusHtml = `
                    <span class="transfer-status completed">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </span>
                `;
                break;
            case 'failed':
                statusHtml = `<span class="transfer-status failed">Gagal</span>`;
                break;
        }

        const direction = transfer.direction === 'sent' ? '↑' : '↓';

        let metaStr = '';
        if (isActive && transfer.status === 'transferring') {
            metaStr = `${loadedStr} / ${sizeStr}`;
        } else {
            metaStr = sizeStr;
        }

        const timeStr = transfer.timestamp ? LANX.formatTime(transfer.timestamp) : '';

        // Speedometer and ETA row
        let speedHtml = '';
        if (isActive && transfer.status === 'transferring' && transfer.speed > 0) {
            speedHtml = `
                <div class="transfer-speed-row">
                    <span class="speed-badge">⚡ ${this.formatSpeed(transfer.speed)}</span>
                    ${transfer.eta !== null ? `<span class="eta-badge">⏱️ ${this.formatETA(transfer.eta)}</span>` : ''}
                </div>
            `;
        }

        // Preview button if received and previewable
        const canPreview = this.isPreviewable(transfer.filename);
        const downloadId = transfer.download_id;

        return `
            <div class="transfer-item">
                <div class="transfer-icon">${icon}</div>
                <div class="transfer-info">
                    <div class="transfer-name">${LANX.escapeHtml(transfer.filename)}</div>
                    <div class="transfer-meta">
                        <span class="transfer-direction">${direction} ${transfer.device || ''}</span>
                        <span>${metaStr}</span>
                        ${timeStr ? `<span>${timeStr}</span>` : ''}
                    </div>
                    ${speedHtml}
                </div>
                ${progressHtml}
                ${statusHtml}
                ${!isActive && transfer.direction === 'received' && downloadId ? `
                    <div class="transfer-status" style="gap: 6px;">
                        ${canPreview ? `
                            <button type="button" class="preview-btn btn-trigger-preview"
                                data-id="${downloadId}"
                                data-filename="${LANX.escapeHtml(transfer.filename)}"
                                data-size="${transfer.size || 0}"
                                data-from="${LANX.escapeHtml(transfer.device || '')}">
                                👁️ Pratinjau
                            </button>
                        ` : ''}
                        <a href="/api/download/${downloadId}" class="download-btn" download>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Unduh
                        </a>
                    </div>
                ` : ''}
            </div>
        `;
    },

    // ─── Preview Trigger Click Listener ──────────────────

    setupPreviewClickListener() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-trigger-preview');
            if (btn) {
                const id = btn.dataset.id;
                const filename = btn.dataset.filename;
                const size = parseInt(btn.dataset.size || '0', 10);
                const from = btn.dataset.from;
                if (id && filename) {
                    LANX.openMediaPreview(filename, id, size, from);
                }
            }
        });
    },

    // ─── History ─────────────────────────────────────────

    async loadHistory() {
        try {
            const res = await fetch('/api/transfers');
            if (res.ok) {
                const history = await res.json();
                this.renderHistory(history);
            }
        } catch (e) {
            // Silent fail
        }
    },

    renderHistory(items) {
        const container = document.getElementById('transfer-history');
        const empty = document.getElementById('history-empty');

        if (!items || items.length === 0) {
            container.innerHTML = '';
            container.appendChild(empty);
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        container.innerHTML = items.map(t => this.renderTransferItem(t, false)).join('');
    },

    // ─── WebSocket Events ────────────────────────────────

    handleEvent(msg) {
        switch (msg.type) {
            case 'transfer_started':
                if (msg.direction === 'receiving') {
                    this.activeTransfers[msg.transfer_id] = {
                        id: msg.transfer_id,
                        filename: msg.filename,
                        size: msg.total_size,
                        loaded: 0,
                        percentage: 0,
                        status: 'transferring',
                        direction: 'received',
                        device: msg.from_device,
                        timestamp: Date.now(),
                    };
                    this.renderActiveTransfers();
                }
                break;

            case 'transfer_progress':
                if (this.activeTransfers[msg.transfer_id]) {
                    this.activeTransfers[msg.transfer_id].loaded = msg.bytes;
                    this.activeTransfers[msg.transfer_id].percentage = Math.round(msg.percentage);
                    this.activeTransfers[msg.transfer_id].status = 'transferring';
                    this.renderActiveTransfers();
                }
                break;

            case 'transfer_complete':
                if (this.activeTransfers[msg.transfer_id]) {
                    this.activeTransfers[msg.transfer_id].status = 'completed';
                    this.activeTransfers[msg.transfer_id].percentage = 100;
                    this.activeTransfers[msg.transfer_id].download_id = msg.download_id;
                    this.renderActiveTransfers();
                    LANX.showToast(`Menerima ${msg.filename}`, 'success');

                    setTimeout(() => {
                        delete this.activeTransfers[msg.transfer_id];
                        this.renderActiveTransfers();
                    }, 4000);
                }
                this.loadHistory();
                break;

            case 'transfer_failed':
                if (this.activeTransfers[msg.transfer_id]) {
                    this.activeTransfers[msg.transfer_id].status = 'failed';
                    this.renderActiveTransfers();
                    LANX.showToast(`Transfer gagal: ${msg.reason || 'Kesalahan jaringan'}`, 'error');
                }
                break;
        }
    },

    // ─── Utilities ───────────────────────────────────────

    formatSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
        if (bytesPerSec >= 1024 * 1024) {
            return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
        }
        if (bytesPerSec >= 1024) {
            return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
        }
        return Math.round(bytesPerSec) + ' B/s';
    },

    formatETA(seconds) {
        if (seconds === null || seconds === undefined || seconds < 0 || !isFinite(seconds)) return '';
        if (seconds < 60) return `sisa ${seconds} dtk`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `sisa ${mins}m ${secs}d`;
    },

    isPreviewable(filename) {
        if (!filename) return false;
        const ext = filename.split('.').pop().toLowerCase();
        const previewable = [
            'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
            'mp4', 'webm', 'mov', 'mkv',
            'mp3', 'wav', 'ogg', 'm4a', 'flac',
            'txt', 'md', 'json', 'log', 'pdf', 'csv', 'js', 'html', 'css', 'go'
        ];
        return previewable.includes(ext);
    },

    getFileIcon(filename) {
        if (!filename) return '📄';
        const ext = filename.split('.').pop().toLowerCase();

        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'];
        const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
        const archiveExts = ['zip', 'rar', 'tar', 'gz', '7z', 'bz2'];
        const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'];
        const codeExts = ['js', 'ts', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml'];

        if (imageExts.includes(ext)) return '🖼️';
        if (videoExts.includes(ext)) return '🎬';
        if (audioExts.includes(ext)) return '🎵';
        if (archiveExts.includes(ext)) return '📦';
        if (docExts.includes(ext)) return '📄';
        if (codeExts.includes(ext)) return '💻';

        return '📄';
    },

    generateId() {
        return 'tf_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    },
};
