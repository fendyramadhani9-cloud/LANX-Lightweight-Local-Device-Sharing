/**
 * LANX — File Transfer Module
 * Handles: drag & drop, file upload, download, progress, history
 */

const Transfer = {
    activeTransfers: {},

    init() {
        this.setupDropZone();
        this.loadHistory();
    },

    // ─── Drop Zone ───────────────────────────────────────

    setupDropZone() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');

        // Click to browse
        dropZone.addEventListener('click', () => fileInput.click());

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

        dropZone.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                this.handleFiles(files);
            }
        });

        // Prevent page-level drop
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    },

    // ─── File Handling ───────────────────────────────────

    handleFiles(files) {
        // Check if a device is selected
        const device = Devices.getSelectedDevice();
        if (!device) {
            // Show device picker or prompt
            this.showDevicePicker(files);
            return;
        }

        files.forEach(file => this.uploadFile(file, device));
    },

    showDevicePicker(files) {
        const devices = Devices.devices.filter(d => d.online !== false);

        if (devices.length === 0) {
            LANX.showToast('No devices available. Make sure another LANX device is on the same network.', 'error');
            return;
        }

        if (devices.length === 1) {
            // Auto-select only device
            files.forEach(file => this.uploadFile(file, devices[0]));
            return;
        }

        // Create picker overlay
        const overlay = document.createElement('div');
        overlay.className = 'device-picker-overlay';
        overlay.innerHTML = `
            <div class="device-picker">
                <h3>Send to</h3>
                <div class="device-picker-list">
                    ${devices.map(d => `
                        <div class="device-card" data-device-id="${d.id}">
                            <div class="device-card-icon">${Devices.getDeviceIcon(d.name)}</div>
                            <div class="device-card-info">
                                <div class="device-card-name">${LANX.escapeHtml(d.name)}</div>
                                <div class="device-card-status">
                                    <span class="status-dot online"></span> Online
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-ghost" style="width: 100%;" id="cancel-picker">Cancel</button>
            </div>
        `;

        overlay.querySelector('#cancel-picker').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.querySelectorAll('.device-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.deviceId;
                const device = Devices.getDeviceById(id);
                if (device) {
                    files.forEach(file => this.uploadFile(file, device));
                }
                overlay.remove();
            });
        });

        document.body.appendChild(overlay);
    },

    // ─── Upload ──────────────────────────────────────────

    async uploadFile(file, targetDevice) {
        const transferId = this.generateId();

        // Create transfer entry
        this.activeTransfers[transferId] = {
            id: transferId,
            filename: file.name,
            size: file.size,
            loaded: 0,
            percentage: 0,
            status: 'preparing',
            direction: 'sent',
            device: targetDevice.name,
            timestamp: Date.now(),
        };

        this.renderActiveTransfers();

        const formData = new FormData();
        formData.append('file', file);
        formData.append('target_device_id', targetDevice.id);
        formData.append('transfer_id', transferId);

        try {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    this.activeTransfers[transferId].loaded = e.loaded;
                    this.activeTransfers[transferId].percentage = Math.round((e.loaded / e.total) * 100);
                    this.activeTransfers[transferId].status = 'transferring';
                    this.renderActiveTransfers();
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    this.activeTransfers[transferId].status = 'completed';
                    this.activeTransfers[transferId].percentage = 100;
                    LANX.showToast(`${file.name} sent successfully`, 'success');
                } else {
                    this.activeTransfers[transferId].status = 'failed';
                    LANX.showToast(`Failed to send ${file.name}`, 'error');
                }
                this.renderActiveTransfers();
                this.loadHistory();

                // Remove from active after delay
                setTimeout(() => {
                    delete this.activeTransfers[transferId];
                    this.renderActiveTransfers();
                }, 5000);
            });

            xhr.addEventListener('error', () => {
                this.activeTransfers[transferId].status = 'failed';
                LANX.showToast(`Failed to send ${file.name}`, 'error');
                this.renderActiveTransfers();
            });

            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        } catch (e) {
            this.activeTransfers[transferId].status = 'failed';
            this.renderActiveTransfers();
            LANX.showToast(`Failed to send ${file.name}`, 'error');
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
        const sizeStr = LANX.formatSize(transfer.size);
        const loadedStr = LANX.formatSize(transfer.loaded || 0);

        let statusHtml = '';
        let progressHtml = '';

        switch (transfer.status) {
            case 'preparing':
                statusHtml = '<span class="transfer-status">Preparing...</span>';
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
                statusHtml = `<span class="transfer-status failed">Failed</span>`;
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
                </div>
                ${progressHtml}
                ${statusHtml}
                ${!isActive && transfer.direction === 'received' && transfer.download_id ? `
                    <div class="transfer-status">
                        <a href="/api/download/${transfer.download_id}" class="download-btn" download>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download
                        </a>
                    </div>
                ` : ''}
            </div>
        `;
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
                    LANX.showToast(`Received ${msg.filename}`, 'success');

                    setTimeout(() => {
                        delete this.activeTransfers[msg.transfer_id];
                        this.renderActiveTransfers();
                    }, 5000);
                }
                this.loadHistory();
                break;

            case 'transfer_failed':
                if (this.activeTransfers[msg.transfer_id]) {
                    this.activeTransfers[msg.transfer_id].status = 'failed';
                    this.renderActiveTransfers();
                    LANX.showToast(`Transfer failed: ${msg.reason || 'Unknown error'}`, 'error');
                }
                break;
        }
    },

    // ─── Utilities ───────────────────────────────────────

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
