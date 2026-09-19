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

    init() {
        this.setupExpiryControls();
        this.setupSearch();
        this.setupDropZone();
        this.setupPreviewClickListener();

        // Initial fetch
        this.loadStats();
        this.loadItems();
        if (LANX.isAdmin) {
            this.loadPending();
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
        const searchInput = document.getElementById('library-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = (e.target.value || '').trim().toLowerCase();
                this.render();
            });
        }
    },

    // ─── Drop Zone & Upload ──────────────────────────────

    setupDropZone() {
        const dropZone = document.getElementById('library-drop-zone');
        const fileInput = document.getElementById('library-file-input');
        const btnPick = document.getElementById('btn-library-pick-file');

        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', (e) => {
            // If clicking controls, pills, or action buttons, don't trigger file picker
            if (e.target.closest('.library-upload-controls') || e.target.closest('#library-drop-actions')) return;
            fileInput.click();
        });

        if (btnPick) {
            btnPick.addEventListener('click', (e) => {
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

        const formData = new FormData();
        formData.append('file', file);
        formData.append('description', description);
        formData.append('uploader_name', LANX.clientName || 'Tamu');
        formData.append('uploader_id', LANX.clientId || '');

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
                this.render();
            }
        } catch (e) {
            // Ignore offline errors
        }
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
        if (!confirm('Tolak dan hapus berkas ini dari server?')) return;

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

        if (!confirm(promptMsg)) return;

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
                        <strong>${LANX.escapeHtml(item.name)}</strong>
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
        if (!grid || !empty) return;

        let filtered = this.items || [];
        if (this.searchQuery) {
            filtered = filtered.filter(item => {
                const name = (item.name || '').toLowerCase();
                const desc = (item.description || '').toLowerCase();
                const uploader = (item.uploader_name || '').toLowerCase();
                return name.includes(this.searchQuery) || desc.includes(this.searchQuery) || uploader.includes(this.searchQuery);
            });
        }

        if (filtered.length === 0) {
            grid.innerHTML = '';
            grid.appendChild(empty);
            empty.style.display = 'flex';
            return;
        }

        empty.style.display = 'none';
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
                if (typeof LANX !== 'undefined' && LANX.openFileActionSheet) {
                    LANX.openFileActionSheet({
                        id: id,
                        name: name,
                        size: size,
                        sender: uploader,
                        downloadUrl: `/api/library/download/${id}`,
                        isLibrary: true,
                    });
                }
            });
        });
    },

    renderCard(item) {
        const isFolder = !!(item.is_folder || (item.name && item.name.endsWith('.zip') && item.name.toLowerCase().includes('folder')) || !item.name.includes('.'));
        const iconSize = isFolder ? 44 : 32;
        const icon = typeof Transfer !== 'undefined' ? Transfer.getFileIcon(item.name, isFolder, iconSize) : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.75"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
        const canPreview = typeof Transfer !== 'undefined' && Transfer.isPreviewable(item.name);
        const hasSelfToken = !!this.getDeleteToken(item.id);
        const isAdmin = !!LANX.isAdmin;
        const canDelete = hasSelfToken || isAdmin;

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
                            ${item.downloads || 0}
                        </span>
                    </div>
                </div>

                <div class="library-card-body">
                    <div class="library-card-name" title="${LANX.escapeHtml(item.name)}">
                        ${LANX.escapeHtml(item.name)}
                    </div>
                    <div class="library-card-meta">
                        <span>${LANX.formatSize(item.size)}</span> ·
                        <span>Oleh: <strong>${LANX.escapeHtml(item.uploader_name || 'Tamu')}</strong></span>
                    </div>

                    ${item.description ? `
                        <div class="library-desc-preview" title="Catatan: ${LANX.escapeHtml(item.description)}">
                            ${LANX.escapeHtml(item.description)}
                        </div>
                    ` : ''}
                </div>

                <!-- Desktop Action Buttons -->
                <div class="library-card-actions transfer-actions-desktop">
                    ${canPreview ? `
                        <button type="button" class="btn btn-sm btn-ghost btn-lib-preview"
                            data-id="${item.id}"
                            data-filename="${LANX.escapeHtml(item.name)}"
                            data-size="${item.size || 0}"
                            data-uploader="${LANX.escapeHtml(item.uploader_name || '')}">
                            Pratinjau
                        </button>
                    ` : ''}
                    <a href="/api/library/download/${item.id}" class="btn btn-sm btn-primary btn-lib-download" download="${LANX.escapeHtml(item.name)}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Unduh
                    </a>
                    ${canDelete ? `
                        <button type="button" class="btn btn-sm btn-danger-ghost btn-delete-library"
                            data-id="${item.id}"
                            data-filename="${LANX.escapeHtml(item.name)}"
                            title="${hasSelfToken ? 'Hapus berkas milik Anda' : 'Hapus berkas sebagai Admin'}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            ${hasSelfToken ? 'Hapus' : 'Hapus (Admin)'}
                        </button>
                    ` : ''}
                </div>

                <!-- Mobile Action Button (⋮) -->
                <button type="button" class="btn-row-action btn-lib-row-action" title="Opsi Berkas"
                    data-id="${item.id}"
                    data-filename="${LANX.escapeHtml(item.name)}"
                    data-size="${item.size || 0}"
                    data-uploader="${LANX.escapeHtml(item.uploader_name || '')}">
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
                if (id && filename) {
                    this.openLibraryPreview(filename, id, size, uploader);
                }
            }
        });
    },

    openLibraryPreview(filename, itemId, size, uploader) {
        const modal = document.getElementById('media-preview-modal');
        if (!modal) return;

        const nameEl = document.getElementById('preview-filename');
        const metaEl = document.getElementById('preview-meta');
        const iconEl = document.getElementById('preview-icon');
        const dlBtn = document.getElementById('preview-btn-download');
        const stage = document.getElementById('preview-stage');

        if (nameEl) nameEl.textContent = filename;
        if (metaEl) metaEl.textContent = `${LANX.formatSize(size || 0)} · Diunggah oleh ${uploader || 'Tamu'}`;
        if (iconEl && typeof Transfer !== 'undefined') iconEl.innerHTML = Transfer.getFileIcon(filename);
        if (dlBtn) {
            dlBtn.href = `/api/library/download/${itemId}`;
            dlBtn.download = filename;
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
                this.loadItems();
                this.loadStats();
                if (LANX.isAdmin) this.loadPending();
                break;
        }
    },
};
