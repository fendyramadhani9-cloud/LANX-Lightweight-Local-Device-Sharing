/**
 * LANX — Shared Library (Pustaka Bersama) Module
 * Handles: long-term shared files, zero-password guest upload, descriptions,
 * calendar / presets expiry (capped at 1 year), self-delete token, and admin approvals.
 */

const Library = {
    items: [],
    pendingItems: [],
    storageStats: null,
    selectedDays: 7,
    selectedCustomDate: '',
    searchQuery: '',
    folders: ['Umum'],
    currentFolder: 'root',

    init() {
        this.setupExpiryControls();
        this.setupSearch();
        this.setupDropZone();
        this.setupBreadcrumbs();
        this.setupFolderControls();
        this.setupAdminClearControls();
        this.setupPreviewClickListener();

        // Initial fetch
        this.loadFolders();
        this.loadStats();
        this.loadItems();
        if (LANX.isAdmin) {
            this.loadPending();
            this.updateAdminActionsVisibility(true);
        }
    },

    // ─── Token Management for Self-Delete (Opsi B) ──────

    getTokens() {
        try {
            return JSON.parse(localStorage.getItem('lanx_lib_tokens') || '{}');
        } catch (e) {
            return {};
        }
    },

    getDeleteToken(itemId) {
        const tokens = this.getTokens();
        return tokens[itemId] || null;
    },

    saveDeleteToken(itemId, token) {
        if (!itemId || !token) return;
        const tokens = this.getTokens();
        tokens[itemId] = token;
        localStorage.setItem('lanx_lib_tokens', JSON.stringify(tokens));
    },

    removeDeleteToken(itemId) {
        const tokens = this.getTokens();
        delete tokens[itemId];
        localStorage.setItem('lanx_lib_tokens', JSON.stringify(tokens));
    },

    // ─── Expiry & Calendar Controls ──────────────────────

    setupExpiryControls() {
        const pillsContainer = document.getElementById('library-expiry-pills');
        const calendarWrap = document.getElementById('library-calendar-wrap');
        const dateInput = document.getElementById('library-custom-date');

        // Set calendar date picker min and max (max 1 year = 365 days)
        if (dateInput) {
            const today = new Date();
            const minDate = new Date(today);
            minDate.setDate(minDate.getDate() + 1);

            const maxDate = new Date(today);
            maxDate.setFullYear(maxDate.getFullYear() + 1);

            dateInput.min = minDate.toISOString().split('T')[0];
            dateInput.max = maxDate.toISOString().split('T')[0];

            dateInput.addEventListener('change', (e) => {
                this.selectedCustomDate = e.target.value;
                this.selectedDays = 0; // custom date active
            });
        }

        if (pillsContainer) {
            pillsContainer.addEventListener('click', (e) => {
                const pill = e.target.closest('.expiry-pill');
                if (!pill) return;

                pillsContainer.querySelectorAll('.expiry-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                if (pill.dataset.type === 'calendar') {
                    if (calendarWrap) calendarWrap.style.display = 'flex';
                    this.selectedDays = 0;
                    if (dateInput && !dateInput.value) {
                        // Default to 14 days ahead when opening calendar
                        const def = new Date();
                        def.setDate(def.getDate() + 14);
                        dateInput.value = def.toISOString().split('T')[0];
                        this.selectedCustomDate = dateInput.value;
                    } else if (dateInput) {
                        this.selectedCustomDate = dateInput.value;
                    }
                } else {
                    if (calendarWrap) calendarWrap.style.display = 'none';
                    this.selectedDays = parseInt(pill.dataset.days || '7', 10);
                    this.selectedCustomDate = '';
                }
            });
        }
    },

    // ─── Search Bar ──────────────────────────────────────

    setupSearch() {
        // Global search filtering is centrally coordinated by LANX.applyGlobalSearch() in app.js
    },

    // ─── Drop Zone & Upload ──────────────────────────────

    setupDropZone() {
        const dropZone = document.getElementById('library-drop-zone');
        const fileInput = document.getElementById('library-file-input');
        const btnPick = document.getElementById('btn-library-pick-file');

        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', (e) => {
            // If clicking controls, pills, desc box, or action buttons, don't trigger file picker
            if (e.target.closest('.library-upload-controls, #library-drop-actions, .library-desc-box, .library-desc-input, button, input, textarea, label')) return;
            fileInput.click();
        });

        const descInput = document.getElementById('library-description-input');
        if (descInput) {
            const autoResize = () => {
                descInput.style.height = 'auto';
                descInput.style.height = Math.min(descInput.scrollHeight, 140) + 'px';
            };
            descInput.addEventListener('input', autoResize);
            descInput.addEventListener('click', (e) => e.stopPropagation());
            descInput.addEventListener('keydown', (e) => e.stopPropagation());
        }

        if (btnPick) {
            btnPick.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput.click();
            });
        }

        const btnUploadExplorer = document.getElementById('btn-library-upload-explorer');
        if (btnUploadExplorer) {
            btnUploadExplorer.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput.click();
            });
        }

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                Array.from(e.target.files).forEach(file => this.uploadFile(file));
                fileInput.value = '';
            }
        });

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
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');

            const files = Array.from(e.dataTransfer.files || []);
            if (files.length > 0) {
                files.forEach(file => this.uploadFile(file));
            }
        });
    },

    async uploadFile(file) {
        const descInput = document.getElementById('library-description-input');
        const description = descInput ? descInput.value.trim() : '';
        if (descInput) {
            descInput.value = '';
            descInput.style.height = '';
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('description', description);
        formData.append('uploader_name', LANX.clientName || 'Tamu');
        formData.append('uploader_id', LANX.clientId || '');

        const folderSelect = document.getElementById('library-upload-folder-select');
        const folder = folderSelect ? folderSelect.value : (this.currentFolder !== 'all' ? this.currentFolder : 'Umum');
        formData.append('folder', folder || 'Umum');

        if (this.selectedCustomDate) {
            formData.append('expiry_date', this.selectedCustomDate);
        } else {
            formData.append('expiry_days', String(this.selectedDays || 7));
        }

        const headers = {};
        if (LANX.adminToken) {
            headers['X-Admin-Token'] = LANX.adminToken;
        }

        LANX.showToast(`Mengunggah "${file.name}" ke Pustaka...`, 'info');

        try {
            const res = await fetch('/api/library/upload', {
                method: 'POST',
                headers: headers,
                body: formData,
            });

            const data = await res.json();
            if (res.ok) {
                if (data.item && data.item.id && data.delete_token) {
                    this.saveDeleteToken(data.item.id, data.delete_token);
                }

                if (data.status === 'pending_approval') {
                    LANX.showToast(`Berkas besar "${file.name}" tersimpan! Menunggu persetujuan Admin.`, 'info');
                } else {
                    LANX.showToast(`"${file.name}" berhasil disimpan di Pustaka!`, 'success');
                }

                if (descInput) descInput.value = '';
                this.loadItems();
                this.loadStats();
                if (LANX.isAdmin) this.loadPending();
            } else {
                LANX.showToast(data.error || `Gagal mengunggah ${file.name}`, 'error');
            }
        } catch (e) {
            LANX.showToast(`Gagal mengunggah ${file.name} (Koneksi terputus)`, 'error');
        }
    },

    // ─── Data Loading ────────────────────────────────────

    async loadStats() {
        try {
            const res = await fetch('/api/library/stats');
            if (res.ok) {
                this.storageStats = await res.json();
                this.renderQuota(this.storageStats);
            }
        } catch (e) {
            // Ignore offline errors
        }
    },

    async loadItems() {
        try {
            const res = await fetch('/api/library');
            if (res.ok) {
                this.items = await res.json() || [];
                this.renderFolders();
                this.renderBreadcrumbs();
                this.render();
            }
        } catch (e) {
            // Ignore offline errors
        }
    },

    // ─── Folders Management (Option 2: Explorer Style) ───

    async loadFolders() {
        try {
            const res = await fetch('/api/library/folders');
            if (res.ok) {
                const data = await res.json();
                this.folders = data.folders || ['Umum'];
                this.renderFolderSelect();
                this.renderFolders();
                this.renderBreadcrumbs();
            }
        } catch (e) {
            // Ignore offline errors
        }
    },

    renderFolderSelect() {
        const select = document.getElementById('library-upload-folder-select');
        if (!select) return;
        const currentVal = select.value || (this.currentFolder !== 'root' && this.currentFolder !== 'all' ? this.currentFolder : 'Umum');
        select.innerHTML = this.folders.map(f => `
            <option value="${LANX.escapeHtml(f)}" ${f === currentVal ? 'selected' : ''}>${LANX.escapeHtml(f)}</option>
        `).join('');
    },

    setupBreadcrumbs() {
        const btnBack = document.getElementById('btn-library-back');
        if (btnBack) {
            btnBack.addEventListener('click', () => {
                this.openFolder('root');
            });
        }
    },

    renderBreadcrumbs() {
        const breadcrumbs = document.getElementById('library-breadcrumbs');
        const btnBack = document.getElementById('btn-library-back');
        if (!breadcrumbs) return;

        const isRoot = !this.currentFolder || this.currentFolder === 'root' || this.currentFolder === 'all';

        if (btnBack) {
            btnBack.style.display = isRoot ? 'none' : 'inline-flex';
        }

        if (isRoot) {
            breadcrumbs.innerHTML = `
                <span class="breadcrumb-item active" id="breadcrumb-root">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                    <span>Pustaka</span>
                </span>
            `;
        } else {
            breadcrumbs.innerHTML = `
                <button type="button" class="breadcrumb-item" id="breadcrumb-root" title="Kembali ke Pustaka Utama">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                    <span>Pustaka</span>
                </button>
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-item active">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>${LANX.escapeHtml(this.currentFolder)}</span>
                </span>
            `;

            const rootBtn = breadcrumbs.querySelector('#breadcrumb-root');
            if (rootBtn) {
                rootBtn.addEventListener('click', () => this.openFolder('root'));
            }
        }
    },

    renderFolders() {
        const section = document.getElementById('library-folders-section');
        const grid = document.getElementById('explorer-folders-grid');
        const countEl = document.getElementById('library-folders-count');
        if (!section || !grid) return;

        const isRoot = !this.currentFolder || this.currentFolder === 'root' || this.currentFolder === 'all';

        if (!isRoot) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        // Count items per folder
        const counts = {};
        (this.items || []).forEach(it => {
            const f = it.folder || 'Umum';
            counts[f] = (counts[f] || 0) + 1;
        });

        if (countEl) {
            countEl.textContent = `${this.folders.length} folder`;
        }

        const cardsHtml = this.folders.map(f => {
            const isDefault = f.toLowerCase() === 'umum';
            const count = counts[f] || 0;
            return `
                <div class="explorer-folder-card" data-folder="${LANX.escapeHtml(f)}" title="Buka folder ${LANX.escapeHtml(f)}">
                    <div class="explorer-folder-top">
                        <svg class="explorer-folder-icon" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        ${(!isDefault && LANX.isAdmin) ? `
                            <button type="button" class="btn-del-folder" data-del-folder="${LANX.escapeHtml(f)}" title="Hapus folder">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        ` : ''}
                    </div>
                    <div class="explorer-folder-name">${LANX.escapeHtml(f)}</div>
                    <div class="explorer-folder-meta">
                        <span class="explorer-folder-badge">${count} berkas</span>
                    </div>
                </div>
            `;
        }).join('');

        grid.innerHTML = cardsHtml;

        // Attach folder click listeners
        grid.querySelectorAll('.explorer-folder-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const delBtn = e.target.closest('.btn-del-folder');
                if (delBtn) {
                    e.stopPropagation();
                    this.deleteFolder(delBtn.dataset.delFolder);
                    return;
                }
                this.openFolder(card.dataset.folder);
            });
        });
    },

    openFolder(folder) {
        this.currentFolder = folder;
        const select = document.getElementById('library-upload-folder-select');
        if (select) {
            if (folder && folder !== 'root' && folder !== 'all') {
                select.value = folder;
            } else {
                select.value = 'Umum';
            }
        }
        this.renderFolders();
        this.renderBreadcrumbs();
        this.render();
    },

    async addFolder(name) {
        const folderName = (name || '').trim();
        if (!folderName) return;

        const token = LANX.adminToken;
        if (!token) {
            LANX.showToast('Mode Admin diperlukan untuk membuat folder', 'info');
            LANX.setAdminActive(false);
            const adminLoginModal = document.getElementById('admin-login-modal');
            if (adminLoginModal) {
                adminLoginModal.style.display = 'flex';
                const pinInput = document.getElementById('admin-pin-input');
                if (pinInput) pinInput.focus();
            }
            return;
        }

        try {
            const res = await fetch('/api/library/folders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token,
                },
                body: JSON.stringify({
                    name: folderName,
                    admin_token: token,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                LANX.showToast(`Folder "${folderName}" berhasil dibuat`, 'success');
                await this.loadFolders();
                this.openFolder(folderName);
            } else {
                LANX.showToast(data.error || 'Gagal membuat folder', 'error');
                if (res.status === 401) {
                    LANX.setAdminActive(false);
                }
            }
        } catch (e) {
            LANX.showToast('Gagal membuat folder (koneksi terputus)', 'error');
        }
    },

    async deleteFolder(name) {
        const ok = (typeof LANX !== 'undefined' && LANX.confirm)
            ? await LANX.confirm({
                title: 'Hapus Folder',
                message: `Hapus folder "${name}"? Berkas di dalamnya akan dipindahkan ke folder "Umum".`,
                confirmText: 'Hapus Folder',
                danger: true,
            })
            : confirm(`Hapus folder "${name}"? Berkas di dalamnya akan dipindahkan ke folder "Umum".`);
        if (!ok) return;

        const token = LANX.adminToken;
        if (!token) {
            LANX.showToast('Mode Admin diperlukan untuk menghapus folder', 'info');
            LANX.setAdminActive(false);
            return;
        }

        try {
            const res = await fetch('/api/library/folders', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token,
                },
                body: JSON.stringify({
                    name: name,
                    admin_token: token,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                LANX.showToast(`Folder "${name}" telah dihapus`, 'info');
                if (this.currentFolder === name) {
                    this.currentFolder = 'root';
                }
                this.loadFolders();
                this.loadItems();
            } else {
                LANX.showToast(data.error || 'Gagal menghapus folder', 'error');
                if (res.status === 401) {
                    LANX.setAdminActive(false);
                }
            }
        } catch (e) {
            LANX.showToast('Gagal menghapus folder', 'error');
        }
    },

    setupFolderControls() {
        const btnAdd = document.getElementById('btn-library-add-folder');
        const modal = document.getElementById('add-folder-modal');
        const btnClose = document.getElementById('btn-close-add-folder');
        const btnCancel = document.getElementById('btn-cancel-add-folder');
        const btnSubmit = document.getElementById('btn-submit-add-folder');
        const inputName = document.getElementById('new-folder-name-input');

        const openModal = () => {
            if (!LANX.isAdmin || !LANX.adminToken) {
                const adminLoginModal = document.getElementById('admin-login-modal');
                if (adminLoginModal) {
                    adminLoginModal.style.display = 'flex';
                    const pinInput = document.getElementById('admin-pin-input');
                    if (pinInput) pinInput.focus();
                    LANX.showToast('Mode Admin diperlukan untuk membuat folder', 'info');
                    return;
                }
            }
            if (inputName) inputName.value = '';
            if (modal) modal.style.display = 'flex';
            if (inputName) inputName.focus();
        };

        const closeModal = () => {
            if (modal) modal.style.display = 'none';
        };

        if (btnAdd) btnAdd.addEventListener('click', openModal);
        if (btnClose) btnClose.addEventListener('click', closeModal);
        if (btnCancel) btnCancel.addEventListener('click', closeModal);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
        }

        if (btnSubmit) {
            btnSubmit.addEventListener('click', () => {
                const name = inputName ? inputName.value.trim() : '';
                if (!name) {
                    LANX.showToast('Nama folder tidak boleh kosong', 'error');
                    return;
                }
                this.addFolder(name);
                closeModal();
            });
        }
        if (inputName) {
            inputName.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (btnSubmit) btnSubmit.click();
                }
            });
        }
    },

    // ─── Admin Bulk Clear Controls ───────────────────────

    setupAdminClearControls() {
        const btnClearImages = document.getElementById('btn-lib-clear-images');
        const btnClearAll = document.getElementById('btn-lib-clear-all');
        const modal = document.getElementById('clear-confirm-modal');
        const btnClose = document.getElementById('btn-close-clear-confirm');
        const btnCancel = document.getElementById('btn-cancel-clear-confirm');
        const btnExecute = document.getElementById('btn-execute-clear');
        const titleEl = document.getElementById('clear-confirm-title');
        const descEl = document.getElementById('clear-confirm-desc');
        const pinField = document.getElementById('clear-pin-field');
        const pinInput = document.getElementById('clear-admin-pin');

        let pendingClearTarget = null;

        const openClearModal = (target) => {
            pendingClearTarget = target;
            if (target === 'images') {
                if (titleEl) titleEl.textContent = 'Bersihkan Semua Gambar';
                if (descEl) descEl.textContent = 'Apakah Anda yakin ingin menghapus SEMUA berkas gambar (.jpg, .png, .webp, dll) di Pustaka? Berkas dokumen/arsip lainnya tidak akan terpengaruh.';
            } else {
                if (titleEl) titleEl.textContent = 'Kosongkan Seluruh Pustaka';
                if (descEl) descEl.textContent = 'PERINGATAN: Semua berkas yang tersimpan di Pustaka Bersama akan dihapus permanen dari server.';
            }

            if (!LANX.isAdmin && pinField) {
                pinField.style.display = 'block';
                if (pinInput) pinInput.value = '';
            } else if (pinField) {
                pinField.style.display = 'none';
            }

            if (modal) modal.style.display = 'flex';
        };

        const closeModal = () => {
            if (modal) modal.style.display = 'none';
            pendingClearTarget = null;
        };

        if (btnClearImages) btnClearImages.addEventListener('click', () => openClearModal('images'));
        if (btnClearAll) btnClearAll.addEventListener('click', () => openClearModal('all'));
        if (btnClose) btnClose.addEventListener('click', closeModal);
        if (btnCancel) btnCancel.addEventListener('click', closeModal);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
        }
        if (pinInput) {
            pinInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (btnExecute) btnExecute.click();
                }
            });
        }

        if (btnExecute) {
            btnExecute.addEventListener('click', async () => {
                if (!pendingClearTarget) return;
                const token = LANX.adminToken || (pinInput ? pinInput.value.trim() : '');
                if (!token) {
                    LANX.showToast('Harap masukkan PIN Admin untuk melanjutkan', 'error');
                    return;
                }

                try {
                    const res = await fetch('/api/library/clear', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Admin-Token': token,
                        },
                        body: JSON.stringify({
                            target: pendingClearTarget,
                            admin_token: token,
                        }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                        LANX.showToast(`Berhasil menghapus ${data.count} berkas (${LANX.formatSize(data.freed_bytes || 0)} ruang dibebaskan)`, 'success');
                        closeModal();
                        this.loadItems();
                        this.loadStats();
                    } else {
                        LANX.showToast(data.error || 'Gagal membersihkan berkas', 'error');
                    }
                } catch (e) {
                    LANX.showToast('Gagal membersihkan berkas (koneksi terputus)', 'error');
                }
            });
        }
    },

    updateAdminActionsVisibility(isAdmin) {
        const adminActions = document.getElementById('library-admin-actions');
        if (adminActions) {
            adminActions.style.display = isAdmin ? 'inline-flex' : 'none';
        }
        this.renderFolders();
    },

    async loadPending() {
        if (!LANX.isAdmin || !LANX.adminToken) {
            this.pendingItems = [];
            this.renderPending();
            return;
        }

        try {
            const res = await fetch('/api/library/pending', {
                headers: { 'X-Admin-Token': LANX.adminToken },
            });
            if (res.ok) {
                this.pendingItems = await res.json() || [];
                this.renderPending();
            }
        } catch (e) {
            this.pendingItems = [];
            this.renderPending();
        }
    },

    // ─── Admin Actions: Approve / Reject ──────────────────

    async approveItem(itemId) {
        if (!LANX.adminToken) return;
        try {
            const res = await fetch('/api/library/approve', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': LANX.adminToken,
                },
                body: JSON.stringify({ id: itemId }),
            });
            if (res.ok) {
                LANX.showToast('Berkas berhasil disetujui & aktif di Pustaka', 'success');
                this.loadPending();
                this.loadItems();
                this.loadStats();
            } else {
                const err = await res.json();
                LANX.showToast(err.error || 'Gagal menyetujui berkas', 'error');
            }
        } catch (e) {
            LANX.showToast('Gagal menyetujui berkas', 'error');
        }
    },

    async rejectItem(itemId) {
        if (!LANX.adminToken) return;
        const ok = (typeof LANX !== 'undefined' && LANX.confirm)
            ? await LANX.confirm({
                title: 'Tolak Berkas',
                message: 'Tolak dan bersihkan berkas ini dari server?',
                confirmText: 'Tolak Berkas',
                danger: true,
            })
            : confirm('Tolak dan hapus berkas ini dari server?');
        if (!ok) return;

        try {
            const res = await fetch('/api/library/reject', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': LANX.adminToken,
                },
                body: JSON.stringify({ id: itemId }),
            });
            if (res.ok) {
                LANX.showToast('Berkas ditolak dan dibersihkan dari server', 'info');
                this.loadPending();
                this.loadStats();
            } else {
                const err = await res.json();
                LANX.showToast(err.error || 'Gagal menolak berkas', 'error');
            }
        } catch (e) {
            LANX.showToast('Gagal menolak berkas', 'error');
        }
    },

    // ─── Delete Item (Self-Delete or Admin Delete) ─────────

    async deleteItem(itemId, fileName) {
        const token = this.getDeleteToken(itemId);
        const isAdmin = LANX.isAdmin;

        if (!token && !isAdmin) {
            LANX.showToast('Anda tidak memiliki izin menghapus berkas ini', 'error');
            return;
        }

        const promptMsg = isAdmin && !token
            ? `Hapus berkas "${fileName}" dari Pustaka sebagai Admin?`
            : `Hapus berkas "${fileName}" milik Anda dari Pustaka?`;

        const ok = (typeof LANX !== 'undefined' && LANX.confirm)
            ? await LANX.confirm({
                title: 'Hapus Berkas Pustaka',
                message: promptMsg,
                confirmText: 'Hapus Berkas',
                danger: true,
            })
            : confirm(promptMsg);
        if (!ok) return;

        const headers = { 'Content-Type': 'application/json' };
        if (isAdmin && LANX.adminToken) {
            headers['X-Admin-Token'] = LANX.adminToken;
        }

        try {
            const res = await fetch('/api/library/delete', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    id: itemId,
                    delete_token: token || '',
                }),
            });

            if (res.ok) {
                this.removeDeleteToken(itemId);
                LANX.showToast(`Berkas "${fileName}" telah dihapus`, 'success');
                this.loadItems();
                this.loadStats();
            } else {
                const err = await res.json();
                LANX.showToast(err.error || 'Gagal menghapus berkas', 'error');
            }
        } catch (e) {
            LANX.showToast('Gagal menghapus berkas', 'error');
        }
    },

    // ─── Render UI ───────────────────────────────────────

    renderQuota(stats) {
        const infoEl = document.getElementById('library-quota-info');
        const fillEl = document.getElementById('library-quota-fill');
        if (!infoEl || !fillEl || !stats) return;

        const usedStr = LANX.formatSize(stats.used_bytes || 0);
        const quotaStr = LANX.formatSize(stats.quota_bytes || 0);
        const pct = Math.min(100, Math.round(stats.percentage || 0));
        const fileCount = stats.file_count || 0;

        infoEl.textContent = `${usedStr} / ${quotaStr} (${pct}%) · ${fileCount} berkas`;
        fillEl.style.width = `${pct}%`;

        // Color threshold
        fillEl.classList.remove('warning', 'danger');
        if (pct >= 90) {
            fillEl.classList.add('danger');
        } else if (pct >= 70) {
            fillEl.classList.add('warning');
        }

        // Sync Desktop Sidebar Storage Card
        const sideBar = document.getElementById('sidebar-storage-bar');
        const sidePct = document.getElementById('sidebar-storage-pct');
        if (sideBar && sidePct) {
            sideBar.style.width = `${pct}%`;
            sidePct.textContent = `${pct}%`;
        }
    },

    renderPending() {
        const banner = document.getElementById('library-pending-banner');
        const countEl = document.getElementById('library-pending-count');
        const listEl = document.getElementById('library-pending-list');

        if (!banner || !countEl || !listEl) return;

        if (!LANX.isAdmin || !this.pendingItems || this.pendingItems.length === 0) {
            banner.style.display = 'none';
            listEl.innerHTML = '';
            return;
        }

        banner.style.display = 'block';
        countEl.textContent = this.pendingItems.length;

        listEl.innerHTML = this.pendingItems.map(item => `
            <div class="pending-item-card">
                <div class="pending-item-info">
                    <div class="pending-item-title">
                        <span class="pending-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
                        <strong>${LANX.escapeHtml(item.filename || item.name || 'Berkas')}</strong>
                        <span class="pending-item-size">(${LANX.formatSize(item.size)})</span>
                    </div>
                    <div class="pending-item-meta">
                        Oleh: <strong>${LANX.escapeHtml(item.uploader_name || 'Tamu')}</strong> ·
                        Masa aktif: ${this.formatRemaining(item.expires_at)}
                    </div>
                    ${item.description ? `
                        <div class="pending-item-desc">
                            Catatan: "${LANX.escapeHtml(item.description)}"
                        </div>
                    ` : ''}
                </div>
                <div class="pending-item-actions">
                    <button type="button" class="btn btn-sm btn-primary btn-approve-library" data-id="${item.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Setujui
                    </button>
                    <button type="button" class="btn btn-sm btn-danger btn-reject-library" data-id="${item.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Tolak
                    </button>
                </div>
            </div>
        `).join('');

        // Attach action handlers
        listEl.querySelectorAll('.btn-approve-library').forEach(btn => {
            btn.addEventListener('click', () => this.approveItem(btn.dataset.id));
        });
        listEl.querySelectorAll('.btn-reject-library').forEach(btn => {
            btn.addEventListener('click', () => this.rejectItem(btn.dataset.id));
        });
    },

    render() {
        const grid = document.getElementById('library-grid');
        const empty = document.getElementById('library-empty');
        const filesHeading = document.getElementById('library-files-heading');
        const filesCount = document.getElementById('library-files-count');
        const emptyTitle = document.getElementById('library-empty-title');
        const emptyHint = document.getElementById('library-empty-hint');
        if (!grid) return;

        const isRoot = !this.currentFolder || this.currentFolder === 'root' || this.currentFolder === 'all';

        let filtered = this.items || [];
        if (!isRoot) {
            filtered = filtered.filter(item => {
                const f = item.folder || 'Umum';
                return f.toLowerCase() === this.currentFolder.toLowerCase();
            });
        }
        if (this.searchQuery) {
            filtered = filtered.filter(item => {
                const name = (item.filename || item.name || '').toLowerCase();
                const desc = (item.description || '').toLowerCase();
                const uploader = (item.uploader_name || '').toLowerCase();
                const folder = (item.folder || '').toLowerCase();
                return name.includes(this.searchQuery) || desc.includes(this.searchQuery) || uploader.includes(this.searchQuery) || folder.includes(this.searchQuery);
            });
        }

        if (filesHeading) {
            filesHeading.textContent = isRoot ? 'Semua Berkas' : `Berkas di "${this.currentFolder}"`;
        }
        if (filesCount) {
            filesCount.textContent = `${filtered.length} berkas`;
        }

        if (filtered.length === 0) {
            grid.innerHTML = '';
            grid.style.display = 'none';
            if (empty) {
                empty.style.display = 'flex';
                if (emptyTitle) {
                    emptyTitle.textContent = isRoot ? 'Belum ada berkas di Pustaka' : `Folder "${this.currentFolder}" masih kosong`;
                }
                if (emptyHint) {
                    emptyHint.textContent = isRoot ? 'Tarik berkas atau gunakan tombol di atas untuk menitip materi/tugas.' : 'Tarik berkas atau unggah untuk menyimpan berkas di folder ini.';
                }
            }
            return;
        }

        if (empty) empty.style.display = 'none';
        grid.style.display = '';
        const cardsHtml = filtered.map(item => this.renderCard(item)).join('');
        grid.innerHTML = cardsHtml;

        // Attach card actions
        grid.querySelectorAll('.btn-delete-library').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteItem(btn.dataset.id, btn.dataset.filename);
            });
        });

        // Attach Mobile Row Action Button (⋮)
        grid.querySelectorAll('.btn-lib-row-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const name = btn.dataset.filename;
                const size = parseInt(btn.dataset.size || '0', 10);
                const uploader = btn.dataset.uploader;
                const desc = btn.dataset.desc || '';
                if (typeof LANX !== 'undefined' && LANX.openFileActionSheet) {
                    LANX.openFileActionSheet({
                        id: id,
                        name: name,
                        size: size,
                        sender: uploader,
                        description: desc,
                        downloadUrl: `/api/library/download/${id}`,
                        isLibrary: true,
                    });
                }
            });
        });
    },

    renderCard(item) {
        const itemName = item.filename || item.name || 'Berkas';
        const isFolder = !!(item.is_folder || (itemName.endsWith('.zip') && itemName.toLowerCase().includes('folder')) || !itemName.includes('.'));
        const iconSize = isFolder ? 44 : 32;
        const icon = typeof Transfer !== 'undefined' ? Transfer.getFileIcon(itemName, isFolder, iconSize) : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.75"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
        const canPreview = typeof Transfer !== 'undefined' && Transfer.isPreviewable(itemName);
        const hasSelfToken = !!this.getDeleteToken(item.id);
        const isAdmin = !!LANX.isAdmin;
        const canDelete = hasSelfToken || isAdmin;
        const itemFolder = item.folder || 'Umum';

        const remaining = this.getRemainingDays(item.expires_at);
        let badgeClass = 'badge-blue';
        if (remaining <= 2) {
            badgeClass = 'badge-red';
        } else if (remaining <= 7) {
            badgeClass = 'badge-yellow';
        }

        return `
            <div class="library-card ${isFolder ? 'is-folder-card' : ''}" data-id="${item.id}">
                <div class="library-card-header">
                    <div class="library-card-icon">${icon}</div>
                    <div class="library-card-badges">
                        <span class="countdown-badge ${badgeClass}" title="Waktu otomatis dihapus oleh server">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            ${this.formatRemaining(item.expires_at)}
                        </span>
                        <span class="dl-count-badge" title="Jumlah unduhan">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            ${item.download_count || item.downloads || 0}
                        </span>
                    </div>
                </div>

                <div class="library-card-body">
                    <div class="library-card-name" title="${LANX.escapeHtml(itemName)}">
                        ${LANX.escapeHtml(itemName)}
                    </div>
                    <div class="library-card-meta">
                        <span class="library-card-folder-badge" title="Folder: ${LANX.escapeHtml(itemFolder)}">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            ${LANX.escapeHtml(itemFolder)}
                        </span> ·
                        <span>${LANX.formatSize(item.size)}</span> ·
                        <span>Oleh: <strong>${LANX.escapeHtml(item.uploader_name || 'Tamu')}</strong></span>
                    </div>

                    ${item.description ? `
                        <div class="library-desc-preview" title="Klik untuk pratinjau / lihat catatan"
                            data-id="${item.id}"
                            data-filename="${LANX.escapeHtml(itemName)}"
                            data-size="${item.size || 0}"
                            data-uploader="${LANX.escapeHtml(item.uploader_name || '')}"
                            data-desc="${LANX.escapeHtml(item.description)}"
                            data-can-preview="${canPreview}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            <span>${LANX.formatDescription ? LANX.formatDescription(item.description) : LANX.escapeHtml(item.description)}</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Desktop Action Buttons -->
                <div class="library-card-actions transfer-actions-desktop">
                    ${canPreview ? `
                        <button type="button" class="btn btn-sm btn-ghost btn-lib-preview"
                            data-id="${item.id}"
                            data-filename="${LANX.escapeHtml(itemName)}"
                            data-size="${item.size || 0}"
                            data-uploader="${LANX.escapeHtml(item.uploader_name || '')}"
                            data-desc="${LANX.escapeHtml(item.description || '')}">
                            Pratinjau
                        </button>
                    ` : ''}
                    <a href="/api/library/download/${item.id}" class="btn btn-sm btn-primary btn-lib-download" download="${LANX.escapeHtml(itemName)}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Unduh
                    </a>
                    ${canDelete ? `
                        <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-library"
                            data-id="${item.id}"
                            data-filename="${LANX.escapeHtml(itemName)}"
                            data-name="${LANX.escapeHtml(itemName)}"
                            title="Hapus berkas ini">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            Hapus
                        </button>
                    ` : ''}
                </div>
                <!-- Mobile Action Button (⋮) -->
                <button type="button" class="btn-row-action btn-lib-row-action" title="Opsi Berkas"
                    data-id="${item.id}"
                    data-filename="${LANX.escapeHtml(itemName)}"
                    data-size="${item.size || 0}"
                    data-uploader="${LANX.escapeHtml(item.uploader_name || '')}"
                    data-desc="${LANX.escapeHtml(item.description || '')}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <circle cx="12" cy="5" r="1"/>
                        <circle cx="12" cy="12" r="1"/>
                        <circle cx="12" cy="19" r="1"/>
                    </svg>
                </button>
            </div>
        `;
    },

    getRemainingDays(expiresAtIso) {
        if (!expiresAtIso) return 999;
        const expiry = new Date(expiresAtIso).getTime();
        const diffMs = expiry - Date.now();
        return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
    },

    formatRemaining(expiresAtIso) {
        if (!expiresAtIso) return 'Selamanya';
        const expiry = new Date(expiresAtIso).getTime();
        const diffMs = expiry - Date.now();

        if (diffMs <= 0) return 'Kedaluwarsa';

        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        if (days >= 30) {
            const months = Math.floor(days / 30);
            return `${months} bln`;
        }
        if (days >= 1) {
            return `${days} hr ${hours > 0 ? hours + ' jam' : ''}`;
        }
        if (hours >= 1) {
            return `${hours} jam`;
        }
        const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
        return `${mins} mnt`;
    },

    setupPreviewClickListener() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-lib-preview');
            if (btn) {
                const id = btn.dataset.id;
                const filename = btn.dataset.filename;
                const size = parseInt(btn.dataset.size || '0', 10);
                const uploader = btn.dataset.uploader;
                const desc = btn.dataset.desc || '';
                if (id && filename) {
                    this.openLibraryPreview(filename, id, size, uploader, desc);
                }
                return;
            }

            // Clickable note bubble on library card
            const descEl = e.target.closest('.library-desc-preview');
            if (descEl && !e.target.closest('a')) {
                e.stopPropagation();
                const canPreview = descEl.dataset.canPreview === 'true';
                const id = descEl.dataset.id;
                const filename = descEl.dataset.filename;
                const size = parseInt(descEl.dataset.size || '0', 10);
                const uploader = descEl.dataset.uploader;
                const desc = descEl.dataset.desc || '';
                if (canPreview && id && filename) {
                    this.openLibraryPreview(filename, id, size, uploader, desc);
                } else if (desc) {
                    if (typeof LANX !== 'undefined' && LANX.copyToClipboard) {
                        LANX.copyToClipboard(desc, 'Catatan disalin ke clipboard');
                    } else if (navigator.clipboard) {
                        navigator.clipboard.writeText(desc);
                    }
                }
                return;
            }

            // Clickable icon or title on library card to open preview
            const cardTrigger = e.target.closest('.library-card-icon, .library-card-name');
            if (cardTrigger && !e.target.closest('button, a')) {
                const card = cardTrigger.closest('.library-card');
                if (card) {
                    const previewBtn = card.querySelector('.btn-lib-preview');
                    if (previewBtn) {
                        previewBtn.click();
                    }
                }
            }
        });
    },

    openLibraryPreview(filename, itemId, size, uploader, description = '') {
        const modal = document.getElementById('media-preview-modal');
        if (!modal) return;

        const nameEl = document.getElementById('preview-filename');
        const metaEl = document.getElementById('preview-meta');
        const iconEl = document.getElementById('preview-icon');
        const dlBtn = document.getElementById('preview-btn-download');
        const stage = document.getElementById('preview-stage');
        const descBar = document.getElementById('preview-description-bar');
        const descText = document.getElementById('preview-desc-text');

        if (nameEl) nameEl.textContent = filename;
        if (metaEl) metaEl.textContent = `${LANX.formatSize(size || 0)} · Diunggah oleh ${uploader || 'Tamu'}`;
        if (iconEl && typeof Transfer !== 'undefined') iconEl.innerHTML = Transfer.getFileIcon(filename);
        if (dlBtn) {
            dlBtn.href = `/api/library/download/${itemId}`;
            dlBtn.download = filename;
        }

        if (descBar && descText) {
            if (description) {
                descText.innerHTML = LANX.formatDescription ? LANX.formatDescription(description) : LANX.escapeHtml(description);
                descBar.style.display = 'flex';
            } else {
                descBar.style.display = 'none';
                descText.innerHTML = '';
            }
        }

        const ext = (filename.split('.').pop() || '').toLowerCase();
        const previewUrl = `/api/library/download/${itemId}?preview=1`;

        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const vidExts = ['mp4', 'webm', 'mov', 'mkv'];
        const audExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
        const txtExts = ['txt', 'md', 'json', 'log', 'csv', 'js', 'html', 'css', 'go'];

        stage.innerHTML = '<div style="color: var(--color-text-tertiary); font-size: var(--font-size-sm);">Memuat pratinjau...</div>';

        if (imgExts.includes(ext)) {
            stage.innerHTML = `<img src="${previewUrl}" alt="${LANX.escapeHtml(filename)}">`;
        } else if (vidExts.includes(ext)) {
            stage.innerHTML = `<video src="${previewUrl}" controls autoplay playsinline style="max-width: 100%; max-height: 70vh;"></video>`;
        } else if (audExts.includes(ext)) {
            stage.innerHTML = `
                <div class="preview-audio-container">
                    <div class="preview-audio-disc">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                    <div style="font-weight: 600; color: var(--color-text); margin-bottom: 4px;">${LANX.escapeHtml(filename)}</div>
                    <audio src="${previewUrl}" controls autoplay></audio>
                </div>
            `;
        } else if (ext === 'pdf') {
            stage.innerHTML = `<iframe src="${previewUrl}" style="width: 100%; height: 70vh; border: none; border-radius: var(--radius-sm);"></iframe>`;
        } else if (txtExts.includes(ext)) {
            fetch(previewUrl)
                .then(res => res.text())
                .then(text => {
                    stage.innerHTML = `
                        <div class="preview-text-container">
                            <pre class="preview-text-content">${LANX.escapeHtml(text)}</pre>
                        </div>
                    `;
                })
                .catch(() => {
                    stage.innerHTML = '<div class="preview-empty-stage">Gagal memuat pratinjau teks.</div>';
                });
        } else {
            stage.innerHTML = `
                <div class="preview-empty-stage">
                    <div style="display: flex; justify-content: center; margin-bottom: 12px; color: var(--color-text-secondary);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                    </div>
                    <p style="font-weight: 500; color: var(--color-text); margin-bottom: 4px;">Pratinjau langsung tidak didukung untuk format ini</p>
                    <p style="font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-bottom: 16px;">Anda dapat langsung mengunduh berkas ke komputer.</p>
                    <a href="/api/library/download/${itemId}" class="btn btn-primary" download="${LANX.escapeHtml(filename)}">Unduh Berkas Sekarang</a>
                </div>
            `;
        }

        modal.style.display = 'flex';
    },

    // ─── WebSocket Event Handlers ────────────────────────

    handleEvent(msg) {
        switch (msg.type) {
            case 'library_updated':
                this.loadFolders();
                this.loadItems();
                this.loadStats();
                if (LANX.isAdmin) this.loadPending();
                break;

            case 'library_approval_request':
                if (LANX.isAdmin) {
                    LANX.showToast(`Permintaan persetujuan: "${msg.filename}" (${LANX.formatSize(msg.size)}) oleh ${msg.uploader_name || 'Tamu'}`, 'info');
                    this.loadPending();
                }
                break;

            case 'library_approval_resolved':
                this.loadFolders();
                this.loadItems();
                this.loadStats();
                if (LANX.isAdmin) this.loadPending();
                break;
        }
    },
};
