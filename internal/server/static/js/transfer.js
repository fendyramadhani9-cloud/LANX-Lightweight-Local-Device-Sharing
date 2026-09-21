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
        this.setupSendConfirmModal();
        this.setupPreviewClickListener();
        this.setupRowSelectionListener();
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
            // If user clicked inside actions, desc box, or input/textarea, do not trigger file picker
            if (e.target.closest('#drop-zone-actions, .drop-zone-desc-box, .transfer-desc-input, button, input, textarea, label')) return;
            fileInput.click();
        });

        const descInput = document.getElementById('transfer-desc-input');
        if (descInput) {
            const autoResize = () => {
                descInput.style.height = 'auto';
                descInput.style.height = Math.min(descInput.scrollHeight, 140) + 'px';
            };
            descInput.addEventListener('input', autoResize);
            descInput.addEventListener('click', (e) => e.stopPropagation());
            descInput.addEventListener('keydown', (e) => e.stopPropagation());
        }

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
                
                const renamedFiles = files.map((file, idx) => {
                    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
                    const suffix = files.length > 1 ? `_${idx + 1}` : '';
                    const newName = `Foto_LANX_${timeStr}${suffix}.${ext}`;
                    return new File([file], newName, { type: file.type });
                });

                this.handleFiles(renamedFiles);
                cameraInput.value = '';
            }
        });
    },

    // ─── File & Folder Handling ──────────────────────────

    handleFiles(files) {
        if (!files || files.length === 0) return;
        const descInput = document.getElementById('transfer-desc-input');
        const description = descInput ? descInput.value.trim() : '';
        this.openSendConfirmation({ files, isFolder: false, folderName: '', description });
    },

    handleFolder(folderName, files) {
        if (!files || files.length === 0) return;
        const descInput = document.getElementById('transfer-desc-input');
        const description = descInput ? descInput.value.trim() : '';
        this.openSendConfirmation({ files, isFolder: true, folderName, description });
    },

    // ─── Send Verification & Confirmation Modal ──────────

    setupSendConfirmModal() {
        const modal = document.getElementById('send-confirm-modal');
        const btnExecute = document.getElementById('btn-execute-send');
        const btnCancel = document.getElementById('btn-cancel-send-confirm');
        const btnClose = document.getElementById('btn-close-send-confirm');
        const descInput = document.getElementById('send-confirm-desc');

        if (btnExecute) {
            btnExecute.addEventListener('click', () => this.executeSendConfirmation());
        }

        if (btnCancel) {
            btnCancel.addEventListener('click', () => this.closeSendConfirmation());
        }

        if (btnClose) {
            btnClose.addEventListener('click', () => this.closeSendConfirmation());
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeSendConfirmation();
            });
        }

        if (descInput) {
            descInput.addEventListener('input', () => {
                descInput.style.height = 'auto';
                descInput.style.height = Math.min(descInput.scrollHeight, 140) + 'px';
            });
            descInput.addEventListener('keydown', (e) => e.stopPropagation());
        }
    },

    openSendConfirmation({ files, isFolder = false, folderName = '', description = '' }) {
        if (!files || files.length === 0) return;

        // Clean up previous staging object URLs if any
        if (this.stagedData && this.stagedData.objectUrls) {
            this.stagedData.objectUrls.forEach(url => {
                try { URL.revokeObjectURL(url); } catch (e) {}
            });
        }

        this.stagedData = {
            files: [...files],
            isFolder,
            folderName,
            objectUrls: []
        };

        const modal = document.getElementById('send-confirm-modal');
        if (!modal) return;

        // Populate Destination Selector
        const targetSelect = document.getElementById('send-confirm-target');
        if (targetSelect) {
            targetSelect.innerHTML = '';

            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = '🌐 Semua Perangkat (Siaran Langsung)';
            targetSelect.appendChild(optAll);

            const visible = (typeof Devices !== 'undefined') ? Devices.getVisibleDevices() : [];
            const onlineDevices = visible.filter(d => d.online !== false);
            const offlineDevices = visible.filter(d => d.online === false);

            if (onlineDevices.length > 0) {
                const groupOnline = document.createElement('optgroup');
                groupOnline.label = 'Perangkat Online';
                onlineDevices.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = `🟢 ${d.name} (${d.platform || 'Online'})`;
                    groupOnline.appendChild(opt);
                });
                targetSelect.appendChild(groupOnline);
            }

            if (offlineDevices.length > 0) {
                const groupOffline = document.createElement('optgroup');
                groupOffline.label = 'Kotak Masuk Offline';
                offlineDevices.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = `📦 ${d.name} (Offline - Simpan di Kotak Masuk)`;
                    groupOffline.appendChild(opt);
                });
                targetSelect.appendChild(groupOffline);
            }

            const currentDevice = (typeof Devices !== 'undefined') ? Devices.getSelectedDevice() : null;
            if (currentDevice && currentDevice.id && currentDevice.id !== 'all') {
                targetSelect.value = currentDevice.id;
            } else {
                targetSelect.value = 'all';
            }
        }

        // Preload description note
        const descTextarea = document.getElementById('send-confirm-desc');
        if (descTextarea) {
            descTextarea.value = description || '';
            descTextarea.style.height = 'auto';
            if (description) {
                descTextarea.style.height = Math.min(descTextarea.scrollHeight, 140) + 'px';
            }
        }

        this.renderStagedFiles();
        modal.style.display = 'flex';
    },

    renderStagedFiles() {
        const modal = document.getElementById('send-confirm-modal');
        const listEl = document.getElementById('send-confirm-files-list');
        const countEl = document.getElementById('send-confirm-count');
        const sizeEl = document.getElementById('send-confirm-size');
        const btnSendLabel = document.getElementById('btn-execute-send-text');

        if (!this.stagedData || !this.stagedData.files || this.stagedData.files.length === 0) {
            this.closeSendConfirmation();
            return;
        }

        const { files, isFolder, folderName } = this.stagedData;
        const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
        const sizeFormatted = (typeof LANX !== 'undefined' && LANX.formatSize) ? LANX.formatSize(totalBytes) : `${Math.round(totalBytes / 1024)} KB`;

        if (countEl) {
            countEl.textContent = isFolder 
                ? `Folder: ${folderName || 'Folder'} (${files.length} Berkas)` 
                : `${files.length} Berkas`;
        }
        if (sizeEl) {
            sizeEl.textContent = sizeFormatted;
        }
        if (btnSendLabel) {
            btnSendLabel.textContent = isFolder 
                ? `Kirim Folder (${sizeFormatted})` 
                : (files.length === 1 ? `Kirim Berkas (${sizeFormatted})` : `Kirim ${files.length} Berkas (${sizeFormatted})`);
        }

        if (!listEl) return;
        listEl.innerHTML = '';

        files.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'send-confirm-file-item';

            const isImage = file.type && file.type.startsWith('image/');
            let mediaThumbHtml = '';

            if (isImage) {
                try {
                    const objectUrl = URL.createObjectURL(file);
                    this.stagedData.objectUrls.push(objectUrl);
                    mediaThumbHtml = `<img src="${objectUrl}" alt="${LANX.escapeHtml(file.name)}" class="send-confirm-thumb">`;
                } catch (e) {
                    mediaThumbHtml = `<div class="send-confirm-icon">${this.getFileIcon(file.name, false, 24)}</div>`;
                }
            } else {
                mediaThumbHtml = `<div class="send-confirm-icon">${this.getFileIcon(file.name, isFolder, 24)}</div>`;
            }

            const formattedItemSize = (typeof LANX !== 'undefined' && LANX.formatSize) ? LANX.formatSize(file.size || 0) : '';

            item.innerHTML = `
                ${mediaThumbHtml}
                <div class="send-confirm-file-info">
                    <div class="send-confirm-file-name" title="${LANX.escapeHtml(file.name)}">${LANX.escapeHtml(file.name)}</div>
                    <div class="send-confirm-file-meta">${formattedItemSize}</div>
                </div>
                ${!isFolder && files.length > 1 ? `
                    <button type="button" class="btn-icon send-confirm-remove-btn" data-idx="${idx}" title="Hapus dari daftar kirim">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                ` : ''}
            `;

            const removeBtn = item.querySelector('.send-confirm-remove-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.stagedData.files.splice(idx, 1);
                    this.renderStagedFiles();
                });
            }

            listEl.appendChild(item);
        });
    },

    closeSendConfirmation() {
        const modal = document.getElementById('send-confirm-modal');
        if (modal) modal.style.display = 'none';

        if (this.stagedData && this.stagedData.objectUrls) {
            this.stagedData.objectUrls.forEach(url => {
                try { URL.revokeObjectURL(url); } catch (e) {}
            });
        }
        this.stagedData = null;
    },

    executeSendConfirmation() {
        if (!this.stagedData || !this.stagedData.files || this.stagedData.files.length === 0) {
            this.closeSendConfirmation();
            return;
        }

        const targetSelect = document.getElementById('send-confirm-target');
        const targetId = targetSelect ? targetSelect.value : 'all';

        let targetDevice = { id: 'all', name: 'Semua Perangkat' };
        if (targetId && targetId !== 'all') {
            const visible = (typeof Devices !== 'undefined') ? Devices.getVisibleDevices() : [];
            const found = visible.find(d => d.id === targetId);
            if (found) {
                targetDevice = found;
            } else {
                targetDevice = { id: targetId, name: 'Perangkat' };
            }
        }

        const descInput = document.getElementById('send-confirm-desc');
        const description = descInput ? descInput.value.trim() : '';

        const { files, isFolder, folderName } = this.stagedData;
        this.closeSendConfirmation();

        // Clear main description input
        const mainDescInput = document.getElementById('transfer-desc-input');
        if (mainDescInput) {
            mainDescInput.value = '';
            mainDescInput.style.height = '';
        }

        if (typeof LANX !== 'undefined' && LANX.vibrate) {
            LANX.vibrate('medium');
        }

        if (isFolder) {
            this.uploadFolder(folderName, files, targetDevice, description);
        } else {
            files.forEach(file => this.uploadFile(file, targetDevice, description));
        }
    },

    showDevicePicker(files, isFolder = false, folderName = '', preloadedDesc = '') {
        const visible = (typeof Devices !== 'undefined') ? Devices.getVisibleDevices() : [];
        const onlineDevices = visible.filter(d => d.online !== false);
        const offlineDevices = visible.filter(d => d.online === false);

        let description = preloadedDesc;
        if (!description) {
            const descInput = document.getElementById('transfer-desc-input');
            description = descInput ? descInput.value.trim() : '';
            if (descInput) {
                descInput.value = '';
                descInput.style.height = '';
            }
        }

        const overlay = document.createElement('div');
        overlay.className = 'device-picker-overlay';
        overlay.innerHTML = `
            <div class="device-picker">
                <h3>Kirim ${isFolder ? 'Folder' : 'Berkas'} ke:</h3>
                <div class="device-picker-broadcast-btn" id="btn-picker-broadcast">
                    <div class="device-card-icon" style="background: linear-gradient(135deg, #1a73e8, #4285f4); color: #fff;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.93 19.07A10 10 0 0 1 12 2a10 10 0 0 1 7.07 17.07"/><path d="M7.76 16.24A6 6 0 0 1 12 6a6 6 0 0 1 4.24 10.24"/><circle cx="12" cy="12" r="2"/></svg></div>
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
                    <div style="font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text-secondary); margin: 12px 0 6px 0; text-transform: uppercase;">Kotak Masuk Offline (${offlineDevices.length}):</div>
                    <div class="device-picker-list">
                        ${offlineDevices.map(d => `
                            <div class="device-card offline-device" data-device-id="${d.id}">
                                <div class="device-card-icon">${Devices.getDeviceIcon(d.name, d.platform)}</div>
                                <div class="device-card-info">
                                    <div class="device-card-name">${LANX.escapeHtml(d.name)}</div>
                                    <div class="device-card-status">
                                        <span class="status-dot offline"></span> Offline
                                        <span class="mailbox-pill">Kotak Masuk</span>
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
                const target = { id: 'all', name: 'Semua Perangkat' };
                if (isFolder) {
                    this.uploadFolder(folderName, files, target, description);
                } else {
                    files.forEach(file => this.uploadFile(file, target, description));
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
                        this.uploadFolder(folderName, files, device, description);
                    } else {
                        files.forEach(file => this.uploadFile(file, device, description));
                    }
                }
                overlay.remove();
            });
        });

        document.body.appendChild(overlay);
    },

    // ─── Upload Single File with Speedometer ─────────────

    async uploadFile(file, targetDevice, customDesc) {
        if (!targetDevice) {
            targetDevice = (typeof Devices !== 'undefined') ? (Devices.getSelectedDevice() || { id: 'all', name: 'Semua Perangkat' }) : { id: 'all', name: 'Semua Perangkat' };
        }
        const transferId = this.generateId();
        const isAll = !targetDevice.id || targetDevice.id === 'all';
        const targetDisplayName = isAll ? 'Semua Perangkat' : (targetDevice.name || 'Perangkat');

        let description = '';
        if (typeof customDesc === 'string') {
            description = customDesc;
        } else {
            const descInput = document.getElementById('transfer-desc-input');
            description = descInput ? descInput.value.trim() : '';
            if (descInput) {
                descInput.value = '';
                descInput.style.height = '';
            }
        }

        this.activeTransfers[transferId] = {
            id: transferId,
            filename: file.name,
            size: file.size,
            loaded: 0,
            percentage: 0,
            status: 'preparing',
            direction: 'sent',
            device: targetDisplayName,
            description: description,
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
        formData.append('description', description);

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

                        if (!this.updateActiveTransferDOM(item)) {
                            this.renderActiveTransfers();
                        }
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
                        LANX.showToast(`Berkas tersimpan di server! Akan otomatis masuk saat ${targetDisplayName} online.`, 'info');
                    } else {
                        LANX.showToast(`${file.name} berhasil terkirim`, 'success');
                    }
                    if (typeof LANX !== 'undefined' && LANX.playSound) LANX.playSound('success');
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
                setTimeout(() => {
                    delete this.activeTransfers[transferId];
                    this.renderActiveTransfers();
                }, 8000);
            });

            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        } catch (e) {
            if (this.activeTransfers[transferId]) this.activeTransfers[transferId].status = 'failed';
            this.renderActiveTransfers();
            LANX.showToast(`Gagal mengirim ${file.name}`, 'error');
            setTimeout(() => {
                delete this.activeTransfers[transferId];
                this.renderActiveTransfers();
            }, 8000);
        }
    },

    // ─── Upload Folder Auto-Zip with Speedometer ─────────

    async uploadFolder(folderName, files, targetDevice, customDesc) {
        if (!targetDevice) {
            targetDevice = (typeof Devices !== 'undefined') ? (Devices.getSelectedDevice() || { id: 'all', name: 'Semua Perangkat' }) : { id: 'all', name: 'Semua Perangkat' };
        }
        const transferId = this.generateId();
        const isAll = !targetDevice.id || targetDevice.id === 'all';
        const targetDisplayName = isAll ? 'Semua Perangkat' : (targetDevice.name || 'Perangkat');
        const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
        const displayZipName = folderName.endsWith('.zip') ? folderName : `${folderName}.zip`;

        let description = '';
        if (typeof customDesc === 'string') {
            description = customDesc;
        } else {
            const descInput = document.getElementById('transfer-desc-input');
            description = descInput ? descInput.value.trim() : '';
            if (descInput) {
                descInput.value = '';
                descInput.style.height = '';
            }
        }

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
            description: description,
        };

        this.renderActiveTransfers();

        const formData = new FormData();
        formData.append('folder_name', folderName);
        formData.append('target_device_id', targetDevice.id);
        formData.append('transfer_id', transferId);
        formData.append('sender_id', LANX.clientId || '');
        formData.append('sender_name', LANX.clientName || 'Perangkat Ini');
        formData.append('description', description);

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

                        if (!this.updateActiveTransferDOM(item)) {
                            this.renderActiveTransfers();
                        }
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
                        LANX.showToast(`Folder "${folderName}" tersimpan di server! Akan otomatis masuk saat ${targetDisplayName} online.`, 'info');
                    } else {
                        LANX.showToast(`Folder "${folderName}" berhasil dikemas & dikirim!`, 'success');
                    }
                    if (typeof LANX !== 'undefined' && LANX.playSound) LANX.playSound('success');
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
                setTimeout(() => {
                    delete this.activeTransfers[transferId];
                    this.renderActiveTransfers();
                }, 8000);
            });

            xhr.open('POST', '/api/upload-folder');
            xhr.send(formData);
        } catch (e) {
            if (this.activeTransfers[transferId]) this.activeTransfers[transferId].status = 'failed';
            this.renderActiveTransfers();
            LANX.showToast(`Gagal mengirim folder ${folderName}`, 'error');
            setTimeout(() => {
                delete this.activeTransfers[transferId];
                this.renderActiveTransfers();
            }, 8000);
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

        container.querySelectorAll('.btn-dismiss-active').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (id && this.activeTransfers[id]) {
                    delete this.activeTransfers[id];
                    this.renderActiveTransfers();
                }
            });
        });
    },

    updateActiveTransferDOM(transfer) {
        const container = document.getElementById('active-transfers');
        if (!container) return false;
        const el = container.querySelector(`.transfer-item[data-id="${transfer.id}"]`);
        if (!el) return false;

        const fill = el.querySelector('.transfer-progress-fill');
        if (fill) fill.style.width = `${transfer.percentage}%`;

        const statusEl = el.querySelector('.transfer-status');
        if (statusEl) statusEl.textContent = `${transfer.percentage}%`;

        const metaEl = el.querySelector('.transfer-meta span:nth-child(2)');
        if (metaEl) {
            metaEl.textContent = `${LANX.formatSize(transfer.loaded || 0)} / ${LANX.formatSize(transfer.size || 0)}`;
        }

        let speedRow = el.querySelector('.transfer-speed-row');
        if (transfer.speed > 0) {
            const speedText = `<span class="speed-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${this.formatSpeed(transfer.speed)}</span> ${transfer.eta !== null ? `<span class="eta-badge">${this.formatETA(transfer.eta)}</span>` : ''}`;
            if (speedRow) {
                speedRow.innerHTML = speedText;
            } else {
                const infoEl = el.querySelector('.transfer-info');
                if (infoEl) {
                    const newRow = document.createElement('div');
                    newRow.className = 'transfer-speed-row';
                    newRow.innerHTML = speedText;
                    infoEl.appendChild(newRow);
                }
            }
        }
        return true;
    },

    renderTransferItem(transfer, isActive = false) {
        const icon = this.getFileIcon(transfer.filename, transfer.isFolder || false);
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
                statusHtml = `<span class="transfer-status failed">Gagal ${isActive ? `<button type="button" class="btn-dismiss-active" data-id="${transfer.id}" title="Tutup" style="margin-left:4px;border:none;background:transparent;color:inherit;cursor:pointer;font-size:12px;font-weight:700;">✕</button>` : ''}</span>`;
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
                    <span class="speed-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${this.formatSpeed(transfer.speed)}</span>
                    ${transfer.eta !== null ? `<span class="eta-badge">${this.formatETA(transfer.eta)}</span>` : ''}
                </div>
            `;
        }

        // Preview button if received and previewable
        const canPreview = this.isPreviewable(transfer.filename);
        const downloadId = transfer.download_id;

        return `
            <div class="transfer-item" data-id="${downloadId || transfer.id || ''}">
                <div class="transfer-icon">${icon}</div>
                <div class="transfer-info">
                    <div class="transfer-name" title="${LANX.escapeHtml(transfer.filename)}">${LANX.escapeHtml(transfer.filename)}</div>
                    ${transfer.description ? `
                        <div class="transfer-note-bubble" title="Klik untuk pratinjau / lihat catatan"
                            data-id="${downloadId || ''}"
                            data-filename="${LANX.escapeHtml(transfer.filename)}"
                            data-size="${transfer.size || 0}"
                            data-from="${LANX.escapeHtml(transfer.device || '')}"
                            data-desc="${LANX.escapeHtml(transfer.description)}"
                            data-can-preview="${canPreview}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            <span>${LANX.formatDescription ? LANX.formatDescription(transfer.description) : LANX.escapeHtml(transfer.description)}</span>
                        </div>
                    ` : ''}
                    <div class="transfer-meta">
                        <span class="transfer-direction">${direction} ${transfer.device || ''}</span>
                        <span>${metaStr}</span>
                        ${timeStr ? `<span>${timeStr}</span>` : ''}
                    </div>
                    ${speedHtml}
                </div>
                ${progressHtml}
                ${statusHtml}
                ${!isActive && downloadId ? `
                    <!-- Desktop Actions -->
                    <div class="transfer-actions-desktop">
                        ${canPreview ? `
                            <button type="button" class="preview-btn btn-trigger-preview"
                                data-id="${downloadId}"
                                data-filename="${LANX.escapeHtml(transfer.filename)}"
                                data-size="${transfer.size || 0}"
                                data-from="${LANX.escapeHtml(transfer.device || '')}"
                                data-desc="${LANX.escapeHtml(transfer.description || '')}">
                                Pratinjau
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
                    <!-- Mobile Contextual 3-Dots Action Button -->
                    <button type="button" class="btn-row-action" title="Opsi Berkas"
                        data-filename="${LANX.escapeHtml(transfer.filename)}"
                        data-download-id="${downloadId}"
                        data-size="${transfer.size || 0}"
                        data-sender="${LANX.escapeHtml(transfer.device || '')}"
                        data-desc="${LANX.escapeHtml(transfer.description || '')}">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <circle cx="12" cy="5" r="1"/>
                            <circle cx="12" cy="12" r="1"/>
                            <circle cx="12" cy="19" r="1"/>
                        </svg>
                    </button>
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
                const desc = btn.dataset.desc || '';
                if (id && filename) {
                    LANX.openMediaPreview(filename, id, size, from, desc);
                }
                return;
            }

            // Clickable note bubble on transfer item
            const noteBubble = e.target.closest('.transfer-note-bubble');
            if (noteBubble && !e.target.closest('a')) {
                e.stopPropagation();
                const canPreview = noteBubble.dataset.canPreview === 'true';
                const id = noteBubble.dataset.id;
                const filename = noteBubble.dataset.filename;
                const size = parseInt(noteBubble.dataset.size || '0', 10);
                const from = noteBubble.dataset.from;
                const desc = noteBubble.dataset.desc || '';
                if (canPreview && id && filename) {
                    LANX.openMediaPreview(filename, id, size, from, desc);
                } else if (desc) {
                    if (typeof LANX !== 'undefined' && LANX.copyToClipboard) {
                        LANX.copyToClipboard(desc, 'Catatan disalin ke clipboard');
                    } else if (navigator.clipboard) {
                        navigator.clipboard.writeText(desc);
                    }
                }
                return;
            }

            // Clickable icon or title to open preview directly
            const triggerEl = e.target.closest('.transfer-icon, .transfer-name, .file-row-icon, .file-row-name');
            if (triggerEl && !e.target.closest('button, a')) {
                const row = triggerEl.closest('.transfer-item, .file-list-row');
                if (row) {
                    const previewBtn = row.querySelector('.btn-trigger-preview');
                    if (previewBtn) {
                        previewBtn.click();
                    }
                }
            }
        });
    },

    setupRowSelectionListener() {
        document.addEventListener('click', (e) => {
            const item = e.target.closest('.transfer-item, .file-list-row, .library-card');
            if (item && !e.target.closest('button, a, input, select, textarea, .btn-row-action, .transfer-note-bubble, .library-desc-preview')) {
                const wasSelected = item.classList.contains('selected');
                document.querySelectorAll('.transfer-item.selected, .file-list-row.selected, .library-card.selected').forEach(el => el.classList.remove('selected'));
                if (!wasSelected) {
                    item.classList.add('selected');
                }
            } else if (!e.target.closest('.transfer-item, .file-list-row, .library-card')) {
                document.querySelectorAll('.transfer-item.selected, .file-list-row.selected, .library-card.selected').forEach(el => el.classList.remove('selected'));
            }
        });
    },

    // ─── Attach Mobile Row Action Listeners (⋮) ─────────

    attachRowActionListeners() {
        document.querySelectorAll('.btn-row-action').forEach(btn => {
            if (btn.dataset.bound) return;
            btn.dataset.bound = 'true';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const filename = btn.dataset.filename;
                const downloadId = btn.dataset.downloadId;
                const size = parseInt(btn.dataset.size || '0', 10);
                const sender = btn.dataset.sender;
                const desc = btn.dataset.desc || '';
                const downloadUrl = downloadId ? `/api/download/${downloadId}` : '';

                if (typeof LANX !== 'undefined' && LANX.openFileActionSheet) {
                    LANX.openFileActionSheet({
                        id: downloadId,
                        name: filename,
                        size: size,
                        sender: sender,
                        description: desc,
                        downloadUrl: downloadUrl,
                        isLibrary: false,
                    });
                }
            });
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
        const historyContainer = document.getElementById('transfer-history');
        const historyEmpty = document.getElementById('history-empty');
        const filesContainer = document.getElementById('files-container');
        const filesEmpty = document.getElementById('files-empty');

        if (!items || items.length === 0) {
            if (historyContainer) {
                historyContainer.innerHTML = '';
                historyContainer.style.display = 'none';
            }
            if (historyEmpty) historyEmpty.style.display = 'block';

            if (filesContainer) {
                filesContainer.innerHTML = '';
                filesContainer.style.display = 'none';
            }
            if (filesEmpty) filesEmpty.style.display = 'block';
            return;
        }

        if (historyEmpty) historyEmpty.style.display = 'none';
        if (filesEmpty) filesEmpty.style.display = 'none';

        const html = items.map(t => this.renderTransferItem(t, false)).join('');
        if (historyContainer) {
            historyContainer.style.display = '';
            historyContainer.innerHTML = html;
        }
        if (filesContainer) {
            filesContainer.style.display = '';
            filesContainer.innerHTML = html;
        }

        // Toggle "Unduh Semua (.ZIP)" button in history header
        const btnDownloadAll = document.getElementById('btn-download-all-zip');
        const downloadableItems = (items || []).filter(t => t.download_id);
        if (btnDownloadAll) {
            if (downloadableItems.length >= 2) {
                btnDownloadAll.style.display = 'inline-flex';
                btnDownloadAll.onclick = () => {
                    const ids = downloadableItems.map(t => t.download_id).join(',');
                    window.location.href = `/api/download-batch?ids=${encodeURIComponent(ids)}`;
                };
            } else {
                btnDownloadAll.style.display = 'none';
            }
        }

        this.attachRowActionListeners();
    },

    // ─── WebSocket Events ────────────────────────────────

    handleEvent(msg) {
        const myId = LANX.clientId || (LANX.deviceInfo && LANX.deviceInfo.id);
        switch (msg.type) {
            case 'transfer_started':
                if (msg.direction === 'receiving') {
                    // Do not track receiving transfer on the sender itself
                    if (msg.sender_id && msg.sender_id === myId) {
                        break;
                    }
                    // If targeted to a specific device, ignore if this is not the target device
                    if (msg.target_device_id && msg.target_device_id !== 'all' && msg.target_device_id !== myId) {
                        break;
                    }
                    this.activeTransfers[msg.transfer_id] = {
                        id: msg.transfer_id,
                        filename: msg.filename,
                        size: msg.total_size,
                        loaded: 0,
                        percentage: 0,
                        status: 'transferring',
                        direction: 'received',
                        device: msg.from_device,
                        description: msg.description || '',
                        timestamp: Date.now(),
                    };
                    this.renderActiveTransfers();
                }
                break;

            case 'transfer_progress':
                if (this.activeTransfers[msg.transfer_id]) {
                    this.activeTransfers[msg.transfer_id].loaded = msg.bytes;
                    this.activeTransfers[msg.transfer_id].percentage = Math.round(msg.percentage);
                    if (msg.status) {
                        this.activeTransfers[msg.transfer_id].status = msg.status;
                    } else {
                        this.activeTransfers[msg.transfer_id].status = 'transferring';
                    }
                    this.renderActiveTransfers();
                }
                break;

            case 'transfer_complete':
                if (this.activeTransfers[msg.transfer_id]) {
                    this.activeTransfers[msg.transfer_id].status = 'completed';
                    this.activeTransfers[msg.transfer_id].percentage = 100;
                    this.activeTransfers[msg.transfer_id].download_id = msg.download_id;
                    this.renderActiveTransfers();

                    setTimeout(() => {
                        delete this.activeTransfers[msg.transfer_id];
                        this.renderActiveTransfers();
                    }, 4000);
                }
                // Reload history if this transfer was targeted to this device or was sent by this device
                const isRelevant = !msg.target_device_id || msg.target_device_id === 'all' || msg.target_device_id === myId || msg.sender_id === myId;
                if (isRelevant) {
                    this.loadHistory();
                }
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

    getFolderIcon(size = 22) {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 6.5C2 5.12 3.12 4 4.5 4H8.7C9.36 4 10 4.26 10.47 4.73L12.27 6.5H19.5C20.88 6.5 22 7.62 22 9V17.5C22 18.88 20.88 20 19.5 20H4.5C3.12 20 2 18.88 2 17.5V6.5Z" fill="#2563EB"/>
            <rect x="2" y="8" width="20" height="11.5" rx="2.5" fill="#3B82F6"/>
            <rect x="2" y="8" width="20" height="1" fill="#93C5FD" fill-opacity="0.4"/>
        </svg>`;
    },

    getFileIcon(filename, isFolder = false, size = 22) {
        if (isFolder || (filename && filename.endsWith('/'))) {
            return this.getFolderIcon(size);
        }
        if (!filename) {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
        }

        const ext = (filename.split('.').pop() || '').toLowerCase();

        // Check if folder or directory archive
        if (ext === 'folder' || filename.endsWith('.folder')) {
            return this.getFolderIcon(size);
        }

        // PDF (Muted red #DC2626 / #FEF2F2)
        if (ext === 'pdf') {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#FEF2F2" stroke="#DC2626" stroke-width="1.75" stroke-linejoin="round"/>
                <path d="M14 2V8H20" stroke="#DC2626" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="6.5" y="11.5" width="11" height="6.5" rx="1.5" fill="#DC2626"/>
                <text x="12" y="16.3" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="5" font-weight="800" text-anchor="middle" letter-spacing="0.3">PDF</text>
            </svg>`;
        }

        // Documents (Blue / slate #475569 / #2563EB)
        const docExts = ['doc', 'docx', 'txt', 'rtf', 'odt', 'pages', 'md', 'epub', 'xlsx', 'xls', 'csv', 'ppt', 'pptx'];
        if (docExts.includes(ext)) {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#F8FAFC" stroke="#475569" stroke-width="1.75" stroke-linejoin="round"/>
                <path d="M14 2V8H20" stroke="#475569" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 12H16" stroke="#2563EB" stroke-width="1.75" stroke-linecap="round"/>
                <path d="M8 15H14" stroke="#64748B" stroke-width="1.75" stroke-linecap="round"/>
                <path d="M8 18H12" stroke="#94A3B8" stroke-width="1.75" stroke-linecap="round"/>
            </svg>`;
        }

        // Images (Muted violet #8B5CF6 / #F5F3FF)
        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'tiff', 'psd', 'ai', 'raw'];
        if (imgExts.includes(ext)) {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="3" fill="#F5F3FF" stroke="#8B5CF6" stroke-width="1.75"/>
                <circle cx="8.5" cy="8.5" r="2" fill="#8B5CF6"/>
                <path d="M20.5 16L15.5 11L7 19.5" stroke="#8B5CF6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 18L17 15L20.5 18" stroke="#A78BFA" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }

        // Archives (Muted amber #D97706 / #FFFBEB)
        const archiveExts = ['zip', 'rar', 'tar', 'gz', '7z', 'bz2', 'xz', 'iso', 'dmg', 'tgz'];
        if (archiveExts.includes(ext)) {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 8V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V8" fill="#FFFBEB" stroke="#D97706" stroke-width="1.75" stroke-linejoin="round"/>
                <rect x="3" y="3.5" width="18" height="4.5" rx="1.5" fill="#FEF3C7" stroke="#D97706" stroke-width="1.75"/>
                <path d="M10 12H14" stroke="#D97706" stroke-width="1.75" stroke-linecap="round"/>
                <path d="M12 10V14" stroke="#D97706" stroke-width="1.75" stroke-linecap="round"/>
                <circle cx="12" cy="15" r="1.5" fill="#D97706"/>
            </svg>`;
        }

        // Videos (Muted purple #9333EA / #FAF5FF)
        const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v', 'flv', '3gp'];
        if (videoExts.includes(ext)) {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="#FAF5FF" stroke="#9333EA" stroke-width="1.75"/>
                <polygon points="10 9 16 12 10 15" fill="#9333EA"/>
            </svg>`;
        }

        // Audios (Muted teal #0D9488 / #F0FDFA)
        const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'aiff'];
        if (audioExts.includes(ext)) {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18V5L19 3V16" stroke="#0D9488" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="6" cy="18" r="3" fill="#CCFBF1" stroke="#0D9488" stroke-width="1.75"/>
                <circle cx="16" cy="16" r="3" fill="#CCFBF1" stroke="#0D9488" stroke-width="1.75"/>
            </svg>`;
        }

        // Code (Muted green #16A34A / #F0FDF4)
        const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'sh', 'sql', 'php', 'rb', 'swift', 'kt'];
        if (codeExts.includes(ext)) {
            return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="18" rx="3" fill="#F0FDF4" stroke="#16A34A" stroke-width="1.75"/>
                <path d="M9 9L6 12L9 15" stroke="#16A34A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M15 9L18 12L15 15" stroke="#16A34A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13 8L11 16" stroke="#22C55E" stroke-width="1.75" stroke-linecap="round"/>
            </svg>`;
        }

        // Generic File (Muted slate #64748B / #F8FAFC)
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="#F8FAFC" stroke="#64748B" stroke-width="1.75" stroke-linejoin="round"/>
            <path d="M14 2V8H20" stroke="#64748B" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    },

    generateId() {
        return 'tf_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    },
};
