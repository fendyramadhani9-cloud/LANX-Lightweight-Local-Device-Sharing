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
    autoDownload: false,
    isAdmin: false,
    adminToken: (() => {
        try {
            const t = localStorage.getItem('lanx_admin_token');
            return (t && t !== 'undefined' && t !== 'null') ? t : null;
        } catch (e) {
            return null;
        }
    })(),
    soundEnabled: (() => {
        try {
            return localStorage.getItem('lanx_sound_enabled') !== 'false';
        } catch (e) {
            return true;
        }
    })(),
    audioCtx: null,

    /** Initialize the application */
    async init() {
        // Load device info
        await this.loadDeviceInfo();

        // Initialize client identity
        this.initClientIdentity();

        // Initialize Admin authentication
        await this.initAdmin();

        // Load settings & apply theme
        await this.loadSettings();

        // Initialize Auto-Download preference
        this.initAutoDownload();

        // Setup UI handlers
        this.setupTabs();
        this.setupDualUX();
        this.setupSettings();
        this.setupQuickTheme();
        this.setupPairing();
        this.setupProfileModal();
        this.setupModals();
        this.setupMediaPreviewModal();
        this.setupGuideModal();
        this.initSound();
        this.setupGlobalPaste();

        // Sync profile with server database
        await this.syncDeviceProfile();

        // Connect WebSocket
        this.connectWebSocket();

        // Initialize sub-modules
        if (typeof Devices !== 'undefined') Devices.init();
        if (typeof Transfer !== 'undefined') Transfer.init();
        if (typeof Clipboard !== 'undefined') Clipboard.init();
        if (typeof Library !== 'undefined') Library.init();

        // Check for incoming QR pairing token in URL
        this.checkPairingToken();
    },

    initClientIdentity() {
        let id = localStorage.getItem('lanx_client_id');
        if (!id) {
            id = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
            localStorage.setItem('lanx_client_id', id);
        }
        this.clientId = id;

        const savedPlat = localStorage.getItem('lanx_client_platform');
        if (savedPlat) {
            this.platform = savedPlat;
        }

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
            if (/iPhone|Android|Mobile/i.test(navigator.userAgent) && !savedPlat) {
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

    // ─── Dual UX & Tab Management ──────────────────────
    currentTab: 'files',
    currentFileActionItem: null,

    switchTab(tabId) {
        if (!tabId || tabId === 'more') return;
        this.currentTab = tabId;

        // 1. Sync Desktop Sidebar
        document.querySelectorAll('.sidebar-item').forEach(item => {
            if (item.dataset.tab === tabId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // 2. Sync Mobile Bottom Navigation
        document.querySelectorAll('.nav-tab-btn').forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 3. Switch Tab Panel
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        const targetPanel = document.getElementById(`panel-${tabId}`);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }

        // 4. Update Workspace Header Title, Subtitle, & Controls
        const titles = {
            files: { title: 'Files', subtitle: 'Kirim dan kelola berkas transfer lokal' },
            recent: { title: 'Riwayat Transfer', subtitle: 'Riwayat pengiriman dan penerimaan berkas' },
            library: { title: 'Pustaka Bersama', subtitle: 'Pusat materi, modul, dan arsip berkas bersama' },
            text: { title: 'Catatan & Teks', subtitle: 'Berbagi catatan, tautan, dan teks instan' },
            devices: { title: 'Perangkat Terhubung', subtitle: 'Perangkat yang terhubung dalam jaringan lokal' },
        };
        const titleEl = document.getElementById('workspace-title');
        const subtitleEl = document.getElementById('workspace-subtitle');
        if (titleEl && titles[tabId]) titleEl.textContent = titles[tabId].title;
        if (subtitleEl && titles[tabId]) subtitleEl.textContent = titles[tabId].subtitle;

        // Contextual Header Actions
        const btnDesktopUpload = document.getElementById('btn-desktop-upload');
        const viewModeToggle = document.getElementById('view-mode-toggle');
        if (btnDesktopUpload) {
            if (tabId === 'files') {
                btnDesktopUpload.style.display = 'inline-flex';
                const span = btnDesktopUpload.querySelector('span');
                if (span) span.textContent = '+ Upload File';
            } else if (tabId === 'library') {
                btnDesktopUpload.style.display = 'inline-flex';
                const span = btnDesktopUpload.querySelector('span');
                if (span) span.textContent = '+ Upload ke Pustaka';
            } else {
                btnDesktopUpload.style.display = 'none';
            }
        }
        if (viewModeToggle) {
            viewModeToggle.style.display = (tabId === 'files' || tabId === 'library') ? 'inline-flex' : 'none';
        }

        // 5. Trigger sub-module updates on tab switch
        if (tabId === 'library' && typeof Library !== 'undefined') {
            Library.loadItems();
            Library.loadStats();
            if (this.isAdmin) Library.loadPending();
        } else if (tabId === 'recent' && typeof Transfer !== 'undefined') {
            Transfer.loadHistory();
        } else if (tabId === 'files' && typeof Transfer !== 'undefined') {
            Transfer.loadHistory();
        } else if (tabId === 'devices' && typeof Devices !== 'undefined') {
            Devices.loadDevices();
        }

        // Reset search filter on tab switch
        const searchInput = document.getElementById('global-search-input');
        if (searchInput && searchInput.value) {
            searchInput.value = '';
            document.getElementById('btn-clear-search')?.style.setProperty('display', 'none');
            this.applyGlobalSearch('');
        } else if (typeof Library !== 'undefined' && Library.searchQuery) {
            Library.searchQuery = '';
            Library.render();
        }
    },

    setupTabs() {
        // Desktop sidebar items
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.tab;
                if (target) this.switchTab(target);
            });
        });

        // Mobile bottom navigation buttons
        document.querySelectorAll('.nav-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                if (target === 'more') {
                    this.openBottomSheet('more-sheet-overlay');
                } else if (target) {
                    this.switchTab(target);
                }
            });
        });

        // Quick button to view all recent from files panel
        const btnViewRecent = document.getElementById('btn-view-all-recent');
        if (btnViewRecent) {
            btnViewRecent.addEventListener('click', () => this.switchTab('recent'));
        }
    },

    setupDualUX() {
        // ─── Mobile Floating Action Button (FAB) ───
        const mobileFab = document.getElementById('mobile-fab');
        if (mobileFab) {
            mobileFab.addEventListener('click', () => {
                const sheetHeaderTitle = document.querySelector('#mobile-upload-sheet .sheet-header h3');
                const sheetHeaderDesc = document.querySelector('#mobile-upload-sheet .sheet-header p');
                const mPickFileText = document.querySelector('#m-pick-files .sheet-btn-text strong');
                const mPickFileSub = document.querySelector('#m-pick-files .sheet-btn-text span');
                const mPickFolder = document.getElementById('m-pick-folder');

                if (this.currentTab === 'library') {
                    if (sheetHeaderTitle) sheetHeaderTitle.textContent = 'Upload ke Pustaka Bersama';
                    if (sheetHeaderDesc) sheetHeaderDesc.textContent = 'Simpan berkas ke server lokal agar dapat diunduh semua orang';
                    if (mPickFileText) mPickFileText.textContent = 'Pilih Berkas Pustaka';
                    if (mPickFileSub) mPickFileSub.textContent = 'Dokumen, PDF, modul, materi, foto, atau video';
                    if (mPickFolder) mPickFolder.style.display = 'none';
                } else {
                    if (sheetHeaderTitle) sheetHeaderTitle.textContent = 'Upload & Kirim Berkas';
                    if (sheetHeaderDesc) sheetHeaderDesc.textContent = 'Pilih berkas untuk dibagikan ke jaringan lokal';
                    if (mPickFileText) mPickFileText.textContent = 'Pilih Berkas';
                    if (mPickFileSub) mPickFileSub.textContent = 'Dokumen, PDF, musik, video dari penyimpanan';
                    if (mPickFolder) mPickFolder.style.display = 'flex';
                }

                this.openBottomSheet('upload-sheet-overlay');
            });
        }

        // ─── Mobile Upload Bottom Sheet Actions ───
        const btnPickFiles = document.getElementById('m-pick-files');
        if (btnPickFiles) {
            btnPickFiles.addEventListener('click', () => {
                this.closeBottomSheet('upload-sheet-overlay');
                if (this.currentTab === 'library') {
                    document.getElementById('library-file-input')?.click();
                } else {
                    document.getElementById('file-input')?.click();
                }
            });
        }

        const btnPickCamera = document.getElementById('m-pick-camera');
        if (btnPickCamera) {
            btnPickCamera.addEventListener('click', () => {
                this.closeBottomSheet('upload-sheet-overlay');
                document.getElementById('camera-input')?.click();
            });
        }

        const btnPickFolder = document.getElementById('m-pick-folder');
        if (btnPickFolder) {
            btnPickFolder.addEventListener('click', () => {
                this.closeBottomSheet('upload-sheet-overlay');
                document.getElementById('folder-input')?.click();
            });
        }

        const btnCancelUploadSheet = document.getElementById('btn-cancel-upload-sheet');
        if (btnCancelUploadSheet) {
            btnCancelUploadSheet.addEventListener('click', () => {
                this.closeBottomSheet('upload-sheet-overlay');
            });
        }

        // ─── Mobile More Menu Bottom Sheet Actions ───
        const mMoreDevices = document.getElementById('m-more-devices');
        if (mMoreDevices) {
            mMoreDevices.addEventListener('click', () => {
                this.closeBottomSheet('more-sheet-overlay');
                this.switchTab('devices');
            });
        }

        const mMoreProfile = document.getElementById('m-more-profile');
        if (mMoreProfile) {
            mMoreProfile.addEventListener('click', () => {
                this.closeBottomSheet('more-sheet-overlay');
                const btnProf = document.getElementById('btn-my-profile');
                if (btnProf) btnProf.click();
            });
        }

        const mMoreGuide = document.getElementById('m-more-guide');
        if (mMoreGuide) {
            mMoreGuide.addEventListener('click', () => {
                this.closeBottomSheet('more-sheet-overlay');
                this.openGuideModal();
            });
        }

        const mMoreAdmin = document.getElementById('m-more-admin');
        if (mMoreAdmin) {
            mMoreAdmin.addEventListener('click', () => {
                this.closeBottomSheet('more-sheet-overlay');
                const btnAdmin = document.getElementById('btn-admin-mode');
                if (btnAdmin) btnAdmin.click();
            });
        }

        const mMoreSettings = document.getElementById('m-more-settings');
        if (mMoreSettings) {
            mMoreSettings.addEventListener('click', () => {
                this.closeBottomSheet('more-sheet-overlay');
                const btnSet = document.getElementById('btn-settings');
                if (btnSet) btnSet.click();
            });
        }

        const btnCancelMoreSheet = document.getElementById('btn-cancel-more-sheet');
        if (btnCancelMoreSheet) {
            btnCancelMoreSheet.addEventListener('click', () => {
                this.closeBottomSheet('more-sheet-overlay');
            });
        }

        // ─── Contextual Action Bottom Sheet (Triggered by ⋮) ───
        const btnCancelActionSheet = document.getElementById('btn-cancel-action-sheet');
        if (btnCancelActionSheet) {
            btnCancelActionSheet.addEventListener('click', () => {
                this.closeBottomSheet('action-sheet-overlay');
            });
        }

        const sheetActDownload = document.getElementById('sheet-act-download');
        if (sheetActDownload) {
            sheetActDownload.addEventListener('click', () => {
                if (this.currentFileActionItem && this.currentFileActionItem.downloadUrl) {
                    const a = document.createElement('a');
                    a.href = this.currentFileActionItem.downloadUrl;
                    a.download = this.currentFileActionItem.name || 'file';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
                this.closeBottomSheet('action-sheet-overlay');
            });
        }

        const sheetActPreview = document.getElementById('sheet-act-preview');
        if (sheetActPreview) {
            sheetActPreview.addEventListener('click', () => {
                if (this.currentFileActionItem) {
                    const item = this.currentFileActionItem;
                    this.closeBottomSheet('action-sheet-overlay');
                    if (item.isLibrary && typeof Library !== 'undefined') {
                        Library.openLibraryPreview(item.name, item.id, item.size || 0, item.sender || '', item.description || '');
                    } else {
                        this.openMediaPreview(item.name, item.id, item.size || 0, item.sender || '', item.description || '');
                    }
                }
            });
        }

        const sheetActCopyLink = document.getElementById('sheet-act-copy-link');
        if (sheetActCopyLink) {
            sheetActCopyLink.addEventListener('click', () => {
                if (this.currentFileActionItem) {
                    const fullUrl = this.currentFileActionItem.downloadUrl
                        ? window.location.origin + this.currentFileActionItem.downloadUrl
                        : window.location.origin;
                    this.copyToClipboard(fullUrl, 'Tautan unduhan berhasil disalin');
                }
                this.closeBottomSheet('action-sheet-overlay');
            });
        }

        const sheetActDelete = document.getElementById('sheet-act-delete');
        if (sheetActDelete) {
            sheetActDelete.addEventListener('click', () => {
                if (this.currentFileActionItem) {
                    const item = this.currentFileActionItem;
                    this.closeBottomSheet('action-sheet-overlay');
                    if (item.isLibrary && typeof Library !== 'undefined') {
                        Library.deleteItem(item.id, item.name);
                    } else {
                        // Remove item from DOM transfer list if present
                        if (item.id) {
                            document.querySelectorAll(`.transfer-item[data-id="${item.id}"]`).forEach(el => el.remove());
                        }
                        this.showToast(`Berkas ${item.name} dihapus dari daftar tampilan`, 'info');
                    }
                }
            });
        }

        // Close bottom sheets on overlay backdrop click
        document.querySelectorAll('.bottom-sheet-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.style.display = 'none';
                }
            });
        });

        // Close modals, sheets, and preview on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // 1. If confirm modal is active, trigger cancel
                const confirmModal = document.getElementById('app-confirm-modal');
                if (confirmModal && confirmModal.style.display !== 'none') {
                    const cancelBtn = document.getElementById('btn-cancel-app-confirm');
                    if (cancelBtn) cancelBtn.click();
                    return;
                }

                // 2. If media preview is active, close it
                const previewModal = document.getElementById('media-preview-modal');
                if (previewModal && previewModal.style.display !== 'none') {
                    this.closeMediaPreview();
                    return;
                }

                // 2b. If send confirmation is active, close and revoke preview URLs
                const sendConfirmModal = document.getElementById('send-confirm-modal');
                if (sendConfirmModal && sendConfirmModal.style.display !== 'none') {
                    if (typeof Transfer !== 'undefined' && Transfer.closeSendConfirmation) {
                        Transfer.closeSendConfirmation();
                    } else {
                        sendConfirmModal.style.display = 'none';
                    }
                    return;
                }

                // 3. Remove device picker overlays if any
                document.querySelectorAll('.device-picker-overlay').forEach(o => o.remove());

                // 4. Close bottom sheets
                document.querySelectorAll('.bottom-sheet-overlay').forEach(o => o.style.display = 'none');

                // 5. Close any open standard modals
                document.querySelectorAll('.modal-overlay').forEach(m => {
                    if (m.style.display !== 'none') {
                        m.style.display = 'none';
                    }
                });
            }
        });

        // ─── Desktop Header & Workspace Actions ───
        const btnDesktopUpload = document.getElementById('btn-desktop-upload');
        if (btnDesktopUpload) {
            btnDesktopUpload.addEventListener('click', () => {
                if (this.currentTab === 'library') {
                    document.getElementById('library-file-input')?.click();
                } else {
                    document.getElementById('file-input')?.click();
                }
            });
        }

        // View mode toggle
        const savedViewMode = localStorage.getItem('lanx_view_mode') || 'grid';
        this.setViewMode(savedViewMode);

        const btnViewGrid = document.getElementById('btn-view-grid');
        const btnViewList = document.getElementById('btn-view-list');
        if (btnViewGrid) {
            btnViewGrid.addEventListener('click', () => this.setViewMode('grid'));
        }
        if (btnViewList) {
            btnViewList.addEventListener('click', () => this.setViewMode('list'));
        }

        // Global Search
        const searchInput = document.getElementById('global-search-input');
        const btnClearSearch = document.getElementById('btn-clear-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = (e.target.value || '').trim();
                if (btnClearSearch) {
                    btnClearSearch.style.display = query ? 'flex' : 'none';
                }
                this.applyGlobalSearch(query.toLowerCase());
            });
        }
        if (btnClearSearch) {
            btnClearSearch.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                btnClearSearch.style.display = 'none';
                this.applyGlobalSearch('');
            });
        }
    },

    openBottomSheet(overlayId) {
        const overlay = document.getElementById(overlayId);
        if (overlay) {
            overlay.style.display = 'flex';
        }
    },

    closeBottomSheet(overlayId) {
        const overlay = document.getElementById(overlayId);
        if (overlay) {
            overlay.style.display = 'none';
        }
    },

    openFileActionSheet(item) {
        this.currentFileActionItem = item;
        const iconEl = document.getElementById('sheet-file-icon');
        const nameEl = document.getElementById('sheet-file-name');
        const metaEl = document.getElementById('sheet-file-meta');
        const btnPreview = document.getElementById('sheet-act-preview');

        if (nameEl) nameEl.textContent = item.name || 'Berkas';
        if (metaEl) {
            const sizeStr = this.formatSize(item.size || 0);
            const timeStr = item.time ? ` · ${item.time}` : '';
            const senderStr = item.sender ? ` · ${item.sender}` : '';
            metaEl.textContent = `${sizeStr}${timeStr}${senderStr}`;
        }
        if (iconEl && typeof Transfer !== 'undefined') {
            const isFolder = !!(item.is_folder || item.isFolder || (item.name && item.name.endsWith('.zip') && item.name.toLowerCase().includes('folder')));
            iconEl.innerHTML = Transfer.getFileIcon(item.name, isFolder, 28);
        }

        // Hide preview button if not previewable
        if (btnPreview && typeof Transfer !== 'undefined') {
            const canPreview = Transfer.isPreviewable(item.name);
            btnPreview.style.display = canPreview ? 'flex' : 'none';
        }

        // Hide delete button if item is library file that cannot be deleted by current user
        const btnDelete = document.getElementById('sheet-act-delete');
        if (btnDelete) {
            const canDelete = item.isLibrary ? !!item.canDelete : true;
            btnDelete.style.display = canDelete ? 'flex' : 'none';
        }

        this.openBottomSheet('action-sheet-overlay');
    },

    setViewMode(mode) {
        localStorage.setItem('lanx_view_mode', mode);
        const btnGrid = document.getElementById('btn-view-grid');
        const btnList = document.getElementById('btn-view-list');
        const filesContainer = document.getElementById('files-container');
        const historyContainer = document.getElementById('transfer-history');
        const libraryGrid = document.getElementById('library-grid');

        if (mode === 'list') {
            btnList?.classList.add('active');
            btnGrid?.classList.remove('active');
            filesContainer?.classList.remove('view-mode-grid');
            filesContainer?.classList.add('view-mode-list');
            historyContainer?.classList.remove('view-mode-grid');
            historyContainer?.classList.add('view-mode-list');
            libraryGrid?.classList.remove('view-mode-grid');
            libraryGrid?.classList.add('view-mode-list');
        } else {
            btnGrid?.classList.add('active');
            btnList?.classList.remove('active');
            filesContainer?.classList.remove('view-mode-list');
            filesContainer?.classList.add('view-mode-grid');
            historyContainer?.classList.remove('view-mode-list');
            historyContainer?.classList.add('view-mode-grid');
            libraryGrid?.classList.remove('view-mode-list');
            libraryGrid?.classList.add('view-mode-grid');
        }
    },

    applyGlobalSearch(query) {
        if (this.currentTab === 'library' && typeof Library !== 'undefined') {
            Library.searchQuery = query;
            Library.render();
            return;
        }

        // Filter files & recent transfer items
        const items = document.querySelectorAll('.transfer-item, .file-list-row');
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = (!query || text.includes(query)) ? '' : 'none';
        });

        // Filter device cards if in devices tab
        if (this.currentTab === 'devices') {
            document.querySelectorAll('.device-card').forEach(card => {
                const text = card.textContent.toLowerCase();
                card.style.display = (!query || text.includes(query)) ? '' : 'none';
            });
        }
    },

    updateSidebarCounters() {
        const devicesCountEl = document.getElementById('sidebar-devices-count');
        if (devicesCountEl && typeof Devices !== 'undefined') {
            const visible = Devices.getVisibleDevices ? Devices.getVisibleDevices() : [];
            devicesCountEl.textContent = visible.length;
        }

        const storageBar = document.getElementById('sidebar-storage-bar');
        const storagePct = document.getElementById('sidebar-storage-pct');
        if (storageBar && storagePct && typeof Library !== 'undefined' && Library.storageStats) {
            const pct = Math.min(100, Math.round(Library.storageStats.percentage || 0));
            storageBar.style.width = `${pct}%`;
            storagePct.textContent = `${pct}%`;
        }
    },

    // ─── Settings ────────────────────────────────────────

    async loadSettings() {
        try {
            const res = await fetch('/api/settings');
            this.settings = await res.json();
            this.applyTheme(this.settings.theme || 'dark');
        } catch (e) {
            console.error('Failed to load settings:', e);
            // Apply saved theme from localStorage as fallback
            const saved = localStorage.getItem('lanx-theme') || 'dark';
            this.applyTheme(saved);
        }
    },

    initAutoDownload() {
        this.autoDownload = localStorage.getItem('lanx_auto_download') === 'true';

        const btnQuick = document.getElementById('btn-quick-auto-download');
        if (btnQuick) {
            btnQuick.addEventListener('click', () => {
                this.autoDownload = !this.autoDownload;
                localStorage.setItem('lanx_auto_download', this.autoDownload ? 'true' : 'false');
                this.updateAutoDownloadUI();
                this.showToast(this.autoDownload ? 'Auto-Download diaktifkan: berkas langsung tersimpan' : 'Auto-Download dinonaktifkan', 'info');
            });
        }

        const checkSetting = document.getElementById('setting-auto-download');
        if (checkSetting) {
            checkSetting.addEventListener('change', (e) => {
                this.autoDownload = e.target.checked;
                localStorage.setItem('lanx_auto_download', this.autoDownload ? 'true' : 'false');
                this.updateAutoDownloadUI();
            });
        }

        this.updateAutoDownloadUI();
    },

    updateAutoDownloadUI() {
        const quickStatus = document.getElementById('quick-auto-status');
        const quickBtn = document.getElementById('btn-quick-auto-download');
        const checkSetting = document.getElementById('setting-auto-download');

        if (quickStatus) quickStatus.textContent = this.autoDownload ? 'ON' : 'OFF';
        if (quickBtn) {
            if (this.autoDownload) quickBtn.classList.add('active');
            else quickBtn.classList.remove('active');
        }
        if (checkSetting) {
            checkSetting.checked = this.autoDownload;
        }
    },

    // ─── Admin Mode ───────────────────────────────────────

    async initAdmin() {
        this.setupAdmin();
        if (this.adminToken && this.adminToken !== 'undefined' && this.adminToken !== 'null') {
            try {
                const res = await fetch('/api/admin/config', {
                    headers: { 'X-Admin-Token': this.adminToken },
                });
                if (res.ok) {
                    this.setAdminActive(true);
                } else {
                    this.setAdminActive(false);
                }
            } catch (e) {
                // If offline, preserve state if token was already saved
                this.setAdminActive(true);
            }
        } else {
            this.setAdminActive(false);
        }
    },

    setAdminActive(active) {
        this.isAdmin = !!active;
        if (!active) {
            this.adminToken = null;
            localStorage.removeItem('lanx_admin_token');
        }
        const btnAdmin = document.getElementById('btn-admin-mode');
        const adminGroup = document.getElementById('admin-settings-group');
        if (btnAdmin) {
            if (active) {
                btnAdmin.classList.add('active');
                btnAdmin.title = 'Mode Admin Aktif (Klik untuk Konfigurasi)';
            } else {
                btnAdmin.classList.remove('active');
                btnAdmin.title = 'Mode Admin (Khusus Guru / Admin)';
            }
        }
        if (adminGroup) {
            adminGroup.style.display = active ? 'block' : 'none';
        }
        if (active) {
            this.loadStorageStats();
        }
        if (typeof Library !== 'undefined' && Library.updateAdminActionsVisibility) {
            Library.updateAdminActionsVisibility(active);
        }
    },

    setupAdmin() {
        const btnAdmin = document.getElementById('btn-admin-mode');
        const modal = document.getElementById('admin-login-modal');
        const btnClose = document.getElementById('btn-close-admin-login');
        const btnCancel = document.getElementById('btn-cancel-admin-login');
        const btnSubmit = document.getElementById('btn-submit-admin-login');
        const pinInput = document.getElementById('admin-pin-input');

        if (btnAdmin) {
            btnAdmin.addEventListener('click', () => {
                if (this.isAdmin) {
                    this.openSettings();
                    const adminGroup = document.getElementById('admin-settings-group');
                    if (adminGroup) adminGroup.scrollIntoView({ behavior: 'smooth' });
                } else {
                    if (modal) {
                        modal.style.display = 'flex';
                        if (pinInput) {
                            pinInput.value = '';
                            pinInput.focus();
                        }
                    }
                }
            });
        }

        const closeAdminModal = () => {
            if (modal) modal.style.display = 'none';
        };

        if (btnClose) btnClose.addEventListener('click', closeAdminModal);
        if (btnCancel) btnCancel.addEventListener('click', closeAdminModal);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeAdminModal();
            });
        }

        const doLogin = async () => {
            const pin = pinInput ? pinInput.value.trim() : '';
            if (!pin) {
                this.showToast('Masukkan PIN Admin', 'error');
                return;
            }

            try {
                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin: pin }),
                });

                if (res.ok) {
                    const data = await res.json();
                    const token = data.token || data.admin_token || pin;
                    this.adminToken = token;
                    localStorage.setItem('lanx_admin_token', token);
                    this.setAdminActive(true);
                    closeAdminModal();
                    this.showToast('Berhasil masuk ke Mode Admin!', 'success');

                    if (typeof Library !== 'undefined') {
                        Library.loadPending();
                        Library.renderFolders();
                        Library.render();
                    }
                    if (typeof Devices !== 'undefined') {
                        Devices.render();
                    }
                } else {
                    const err = await res.json();
                    this.showToast(err.error || 'PIN Admin salah', 'error');
                }
            } catch (e) {
                this.showToast('Gagal terhubung ke server', 'error');
            }
        };

        if (btnSubmit) btnSubmit.addEventListener('click', doLogin);
        if (pinInput) {
            pinInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doLogin();
            });
        }
    },

    // ─── Settings ────────────────────────────────────────

    setupSettings() {
        const btnOpen = document.getElementById('btn-settings');
        const btnClose = document.getElementById('btn-close-settings');
        const btnSave = document.getElementById('btn-save-settings');
        const modal = document.getElementById('settings-modal');

        btnOpen.addEventListener('click', () => this.openSettings());
        btnClose.addEventListener('click', () => this.closeModal(modal));
        btnSave.addEventListener('click', () => this.saveSettings());

        const btnCleanStorage = document.getElementById('btn-clean-server-storage');
        if (btnCleanStorage) {
            btnCleanStorage.addEventListener('click', async () => {
                if (!this.isAdmin || !this.adminToken) {
                    this.showToast('Hanya Admin yang bisa membersihkan penyimpanan server', 'error');
                    return;
                }
                const ok = await this.confirm({
                    title: 'Bersihkan Penyimpanan Server',
                    message: 'Hapus semua berkas sementara yang tersimpan di server sekarang? Tindakan ini tidak dapat dibatalkan.',
                    confirmText: 'Hapus Berkas Sementara',
                    danger: true,
                });
                if (!ok) return;
                try {
                    const res = await fetch('/api/storage/clean', {
                        method: 'POST',
                        headers: { 'X-Admin-Token': this.adminToken },
                    });
                    if (res.ok) {
                        const data = await res.json();
                        this.showToast(`Penyimpanan server dibersihkan (${data.deleted_count} berkas)`, 'success');
                        this.loadStorageStats();
                    } else {
                        this.showToast('Gagal membersihkan penyimpanan server', 'error');
                    }
                } catch (e) {
                    this.showToast('Gagal membersihkan penyimpanan server', 'error');
                }
            });
        }

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal(modal);
        });
    },

    initSound() {
        const toggle = document.getElementById('setting-sound-enabled');
        if (toggle) {
            toggle.checked = this.soundEnabled;
            toggle.addEventListener('change', () => {
                this.soundEnabled = toggle.checked;
                try {
                    localStorage.setItem('lanx_sound_enabled', toggle.checked ? 'true' : 'false');
                } catch (e) {}
            });
        }
    },

    vibrate(pattern = 'light') {
        if (!this.soundEnabled) return;
        try {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                if (typeof pattern === 'string') {
                    const presets = {
                        light: 25,
                        medium: 40,
                        success: [30, 60, 40],
                        incoming: [40, 80, 40],
                        error: [70, 50, 70]
                    };
                    navigator.vibrate(presets[pattern] || 30);
                } else {
                    navigator.vibrate(pattern);
                }
            }
        } catch (e) {}
    },

    playSound(type = 'success') {
        if (!this.soundEnabled) return;
        this.vibrate(type);
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            if (!this.audioCtx) {
                this.audioCtx = new AudioContext();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            const now = this.audioCtx.currentTime;
            const masterGain = this.audioCtx.createGain();
            masterGain.gain.setValueAtTime(0.08, now);
            masterGain.connect(this.audioCtx.destination);

            if (type === 'success') {
                // Harmonic AirDrop-style double bell (D5 -> A5)
                const osc1 = this.audioCtx.createOscillator();
                const gain1 = this.audioCtx.createGain();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(587.33, now);
                gain1.gain.setValueAtTime(0.8, now);
                gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
                osc1.connect(gain1);
                gain1.connect(masterGain);
                osc1.start(now);
                osc1.stop(now + 0.3);

                const osc2 = this.audioCtx.createOscillator();
                const gain2 = this.audioCtx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(880.00, now + 0.1);
                gain2.gain.setValueAtTime(0.9, now + 0.1);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
                osc2.connect(gain2);
                gain2.connect(masterGain);
                osc2.start(now + 0.1);
                osc2.stop(now + 0.45);
            } else if (type === 'incoming') {
                // Soft arrival chime (E5 -> G5)
                const osc1 = this.audioCtx.createOscillator();
                const gain1 = this.audioCtx.createGain();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(659.25, now);
                gain1.gain.setValueAtTime(0.7, now);
                gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
                osc1.connect(gain1);
                gain1.connect(masterGain);
                osc1.start(now);
                osc1.stop(now + 0.25);

                const osc2 = this.audioCtx.createOscillator();
                const gain2 = this.audioCtx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(783.99, now + 0.08);
                gain2.gain.setValueAtTime(0.8, now + 0.08);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
                osc2.connect(gain2);
                gain2.connect(masterGain);
                osc2.start(now + 0.08);
                osc2.stop(now + 0.4);
            }
        } catch (e) {
            // AudioContext blocked or not supported
        }
    },

    setupGlobalPaste() {
        window.addEventListener('paste', (e) => {
            const items = e.clipboardData ? e.clipboardData.items : null;
            const files = e.clipboardData ? e.clipboardData.files : null;

            let fileList = [];
            if (files && files.length > 0) {
                fileList = Array.from(files);
            } else if (items) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].kind === 'file') {
                        const f = items[i].getAsFile();
                        if (f) fileList.push(f);
                    }
                }
            }

            if (fileList.length > 0) {
                e.preventDefault();

                const processedFiles = fileList.map((file, idx) => {
                    let name = file.name;
                    if (!name || name === 'image.png' || name === 'blob') {
                        const dateStr = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
                        const ext = (file.type && file.type.split('/')[1]) || 'png';
                        name = `Screenshot_${dateStr}_${idx + 1}.${ext}`;
                        try {
                            return new File([file], name, { type: file.type });
                        } catch (err) {
                            return file;
                        }
                    }
                    return file;
                });

                if (typeof Transfer !== 'undefined' && Transfer.openSendConfirmation) {
                    Transfer.openSendConfirmation(processedFiles, false, '', '');
                    this.showToast('Foto/berkas dari papan klip siap dikirim!', 'info');
                    this.playSound('incoming');
                }
            }
        });
    },

    async loadStorageStats() {
        if (!this.isAdmin || !this.adminToken) return;
        const pctEl = document.getElementById('admin-storage-pct');
        const fillEl = document.getElementById('admin-disk-fill');
        const detailEl = document.getElementById('admin-storage-detail');

        try {
            const res = await fetch('/api/storage/stats', {
                headers: { 'X-Admin-Token': this.adminToken || '' }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.host_disk) {
                    const d = data.host_disk;
                    const pct = Math.min(100, Math.max(0, Math.round(d.percentage || 0)));
                    if (pctEl) pctEl.textContent = `${pct}%`;
                    if (fillEl) {
                        fillEl.style.width = `${pct}%`;
                        if (pct >= 90) {
                            fillEl.style.background = '#ef4444';
                        } else if (pct >= 80) {
                            fillEl.style.background = '#f59e0b';
                        } else {
                            fillEl.style.background = 'var(--color-primary)';
                        }
                    }
                    if (detailEl) {
                        detailEl.textContent = `Digunakan: ${this.formatSize(d.used_bytes)} / ${this.formatSize(d.total_bytes)} (Tersisa: ${this.formatSize(d.free_bytes)} • ${data.file_count || 0} berkas sementara)`;
                    }
                } else if (detailEl) {
                    detailEl.textContent = `${data.file_count || 0} berkas sementara (${this.formatSize(data.total_bytes || 0)})`;
                }
            }
        } catch (e) {
            if (detailEl) detailEl.textContent = 'Gagal memuat kapasitas disk';
        }
    },

    openSettings() {
        const modal = document.getElementById('settings-modal');
        const nameInput = document.getElementById('setting-device-name');
        const serverNameInput = document.getElementById('setting-admin-server-name');
        const pairingInput = document.getElementById('setting-pairing');
        const autoDownloadInput = document.getElementById('setting-auto-download');
        const autoDeleteInput = document.getElementById('setting-auto-delete');
        const versionSpan = document.getElementById('settings-version');
        const adminGroup = document.getElementById('admin-settings-group');

        // Always show the user's current device name in the main device field
        if (nameInput) {
            nameInput.value = this.clientName || '';
        }
        if (serverNameInput && this.settings) {
            serverNameInput.value = this.settings.device_name || '';
        }

        if (this.settings) {
            pairingInput.checked = this.settings.pairing_required;
            if (autoDeleteInput) {
                autoDeleteInput.checked = this.settings.auto_delete_delivered !== false;
            }
        }
        if (autoDownloadInput) {
            autoDownloadInput.checked = this.autoDownload;
        }
        if (this.deviceInfo) {
            versionSpan.textContent = this.deviceInfo.version || '1.0.0';
        }

        // If admin is active, load and populate admin config
        if (this.isAdmin) {
            if (adminGroup) adminGroup.style.display = 'block';
            if (this.adminToken) {
                fetch('/api/admin/config', {
                    headers: { 'X-Admin-Token': this.adminToken }
                }).then(r => r.json()).then(cfg => {
                    if (cfg) {
                        const quotaInput = document.getElementById('setting-admin-quota');
                        const threshInput = document.getElementById('setting-admin-threshold');
                        if (quotaInput && cfg.library_quota_bytes) {
                            quotaInput.value = Math.round(cfg.library_quota_bytes / (1024 * 1024 * 1024));
                        }
                        if (threshInput && cfg.approval_threshold_bytes) {
                            threshInput.value = Math.round(cfg.approval_threshold_bytes / (1024 * 1024));
                        }
                    }
                }).catch(() => {});
            }
        } else {
            if (adminGroup) adminGroup.style.display = 'none';
        }

        // Load current disk storage usage
        this.loadStorageStats();

        // Theme radios
        const theme = this.settings?.theme || localStorage.getItem('lanx-theme') || 'dark';
        const radio = document.getElementById(`theme-${theme}`);
        if (radio) radio.checked = true;

        modal.style.display = 'flex';
    },

    async saveSettings() {
        const myNewName = document.getElementById('setting-device-name')?.value.trim();
        const serverName = document.getElementById('setting-admin-server-name')?.value.trim();
        const pairing = document.getElementById('setting-pairing').checked;
        const autoDelete = document.getElementById('setting-auto-delete')?.checked ?? true;
        const autoDownloadChecked = document.getElementById('setting-auto-download')?.checked ?? false;
        const theme = document.querySelector('input[name="theme"]:checked')?.value || 'light';

        // Persist auto-download preference from settings modal
        this.autoDownload = autoDownloadChecked;
        localStorage.setItem('lanx_auto_download', autoDownloadChecked ? 'true' : 'false');
        this.updateAutoDownloadUI();

        // 1. If user changed their own device name, update local state, sync profile to server, and re-register WS
        if (myNewName) {
            this.clientName = myNewName;
            localStorage.setItem('lanx_client_name', myNewName);
            this.updateHeaderProfileBadge();

            try {
                await fetch('/api/device/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: this.clientId,
                        name: myNewName,
                        platform: this.platform,
                    }),
                });
                this.registerWithHub();
                if (typeof Devices !== 'undefined') Devices.loadDevices();
            } catch (e) {
                console.error('Failed to sync profile from settings:', e);
            }
        }

        // 2. Save server settings
        try {
            const serverPayload = {
                pairing_required: pairing,
                theme: theme,
                auto_delete_delivered: autoDelete,
            };
            if (serverName) {
                serverPayload.device_name = serverName;
            } else if (myNewName) {
                serverPayload.device_name = myNewName;
            }

            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serverPayload),
            });
            if (res.ok) {
                this.settings = await res.json();
                this.applyTheme(theme);
                localStorage.setItem('lanx-theme', theme);

                // If Admin, save Admin Configuration
                if (this.isAdmin && this.adminToken) {
                    const quotaGb = parseInt(document.getElementById('setting-admin-quota')?.value || '5', 10);
                    const threshMb = parseInt(document.getElementById('setting-admin-threshold')?.value || '50', 10);
                    const newPin = document.getElementById('setting-admin-new-pin')?.value.trim() || '';

                    const adminBody = {
                        library_quota_bytes: quotaGb * 1024 * 1024 * 1024,
                        approval_threshold_bytes: threshMb * 1024 * 1024,
                        admin_token: this.adminToken,
                    };
                    if (newPin) adminBody.new_pin = newPin;

                    try {
                        const aRes = await fetch('/api/admin/config', {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Admin-Token': this.adminToken,
                            },
                            body: JSON.stringify(adminBody),
                        });
                        if (aRes.ok) {
                            const aData = await aRes.json();
                            if (newPin) {
                                const updatedToken = aData.token || aData.admin_token || aData.admin_pin || newPin;
                                this.adminToken = updatedToken;
                                localStorage.setItem('lanx_admin_token', updatedToken);
                                this.showToast('PIN Admin berhasil diperbarui!', 'success');
                            }
                            const newPinInput = document.getElementById('setting-admin-new-pin');
                            if (newPinInput) newPinInput.value = '';
                            if (typeof Library !== 'undefined') Library.loadStats();
                        } else {
                            const aErr = await aRes.json();
                            this.showToast(aErr.error || 'Gagal menyimpan konfigurasi Admin', 'error');
                        }
                    } catch (e) {
                        console.error('Failed to update admin config:', e);
                        this.showToast('Gagal menghubungi server untuk konfigurasi Admin', 'error');
                    }
                } else if (this.isAdmin && !this.adminToken) {
                    this.setAdminActive(false);
                    this.showToast('Sesi Admin berakhir. Harap login kembali.', 'error');
                }

                if (typeof Devices !== 'undefined') {
                    Devices.loadDevices();
                }

                this.closeModal(document.getElementById('settings-modal'));
                this.showToast('Pengaturan berhasil disimpan', 'success');
            }
        } catch (e) {
            this.showToast('Gagal menyimpan pengaturan', 'error');
        }
    },

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('lanx-theme', theme);

        // Sync quick theme toggle button icons
        const sunIcon = document.querySelector('.icon-theme-sun');
        const moonIcon = document.querySelector('.icon-theme-moon');
        if (sunIcon && moonIcon) {
            if (theme === 'dark') {
                sunIcon.style.display = 'block';
                moonIcon.style.display = 'none';
            } else {
                sunIcon.style.display = 'none';
                moonIcon.style.display = 'block';
            }
        }

        // Sync settings modal radio options
        const radioLight = document.getElementById('theme-light');
        const radioDark = document.getElementById('theme-dark');
        if (radioLight && radioDark) {
            if (theme === 'dark') radioDark.checked = true;
            else radioLight.checked = true;
        }
    },

    setupQuickTheme() {
        const btn = document.getElementById('btn-theme-quick');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') || 'light';
            const next = cur === 'dark' ? 'light' : 'dark';
            this.applyTheme(next);

            // Save to server
            fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: next })
            }).catch(() => {});

            this.showToast(`Beralih ke mode ${next === 'dark' ? 'Gelap' : 'Terang'}`, 'info');
        });
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

        if (this._qrBlobUrl) {
            URL.revokeObjectURL(this._qrBlobUrl);
            this._qrBlobUrl = null;
        }

        container.innerHTML = '<div class="qr-loading">Membuat QR code...</div>';
        modal.style.display = 'flex';

        try {
            const res = await fetch('/api/pair/qr');
            if (res.ok) {
                const blob = await res.blob();
                this._qrBlobUrl = URL.createObjectURL(blob);
                container.innerHTML = `<img src="${this._qrBlobUrl}" alt="QR Code" width="200" height="200">`;

                // Show URL
                const host = window.location.host;
                urlEl.textContent = `http://${host}`;
            } else {
                container.innerHTML = '<div class="qr-loading">Gagal membuat QR code</div>';
            }
        } catch (e) {
            container.innerHTML = '<div class="qr-loading">Gagal membuat QR code</div>';
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
            this.showToast(accept ? 'Perangkat berhasil terhubung!' : 'Permintaan koneksi ditolak', accept ? 'success' : 'info');
        } catch (e) {
            this.showToast('Gagal merespons permintaan koneksi', 'error');
        }
        this.closeModal(modal);
    },

    // ─── Device Profile ───────────────────────────────────

    async syncDeviceProfile() {
        try {
            const res = await fetch(`/api/devices/${encodeURIComponent(this.clientId)}`);
            if (res.ok) {
                const dev = await res.json();
                if (dev && dev.name) {
                    this.clientName = dev.name;
                    localStorage.setItem('lanx_client_name', dev.name);
                    if (dev.platform) {
                        this.platform = dev.platform;
                        localStorage.setItem('lanx_client_platform', dev.platform);
                    }
                }
            } else {
                // Register self profile to server
                await fetch('/api/device/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: this.clientId,
                        name: this.clientName,
                        platform: this.platform,
                    }),
                });
            }
        } catch (e) {
            // Ignore offline or initial connect errors
        }
        this.updateHeaderProfileBadge();
    },

    updateHeaderProfileBadge() {
        const nameEl = document.getElementById('my-device-name');
        const iconEl = document.getElementById('my-device-icon');
        if (nameEl) nameEl.textContent = this.clientName || 'Perangkat Saya';
        if (iconEl) {
            const svgDesktop = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
            const svgPhone = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
            const svgTablet = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
            let icon = svgDesktop;
            if (this.platform === 'mobile') icon = svgPhone;
            else if (this.platform === 'tablet') icon = svgTablet;
            iconEl.innerHTML = icon;
        }
    },

    setupProfileModal() {
        const btnOpen = document.getElementById('btn-my-profile');
        const btnClose = document.getElementById('btn-close-profile');
        const btnCancel = document.getElementById('btn-cancel-profile');
        const btnSave = document.getElementById('btn-save-profile');
        const modal = document.getElementById('profile-modal');

        if (btnOpen) {
            btnOpen.addEventListener('click', () => {
                const nameInput = document.getElementById('profile-device-name');
                const idEl = document.getElementById('profile-device-id');
                if (nameInput) nameInput.value = this.clientName || '';
                if (idEl) idEl.textContent = this.clientId || '-';

                const platRadio = document.getElementById(`plat-${this.platform}`);
                if (platRadio) {
                    platRadio.checked = true;
                } else {
                    const defRadio = document.getElementById('plat-desktop');
                    if (defRadio) defRadio.checked = true;
                }

                modal.style.display = 'flex';
                if (nameInput) nameInput.focus();
            });
        }

        const closeIt = () => this.closeModal(modal);
        if (btnClose) btnClose.addEventListener('click', closeIt);
        if (btnCancel) btnCancel.addEventListener('click', closeIt);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeIt();
            });
        }

        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const nameInput = document.getElementById('profile-device-name');
                const newName = nameInput ? nameInput.value.trim() : '';
                const selectedPlat = document.querySelector('input[name="profile-platform"]:checked')?.value || this.platform;

                if (!newName) {
                    this.showToast('Nama perangkat tidak boleh kosong', 'error');
                    return;
                }

                try {
                    const res = await fetch('/api/device/profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: this.clientId,
                            name: newName,
                            platform: selectedPlat,
                        }),
                    });

                    if (res.ok) {
                        this.clientName = newName;
                        this.platform = selectedPlat;
                        localStorage.setItem('lanx_client_name', newName);
                        localStorage.setItem('lanx_client_platform', selectedPlat);
                        this.updateHeaderProfileBadge();
                        this.closeModal(modal);
                        this.showToast('Profil perangkat berhasil disimpan!', 'success');

                        // Update websocket hub
                        this.registerWithHub();
                        if (typeof Devices !== 'undefined') Devices.loadDevices();
                    } else {
                        const err = await res.json();
                        this.showToast(err.error || 'Gagal menyimpan profil', 'error');
                    }
                } catch (e) {
                    this.showToast('Gagal menyimpan profil', 'error');
                }
            });
        }

        const profileNameInput = document.getElementById('profile-device-name');
        if (profileNameInput) {
            profileNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (btnSave) btnSave.click();
                }
            });
        }

        this.updateHeaderProfileBadge();
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
        if (!modal) return;
        modal.style.display = 'none';
        if (modal.id === 'pair-modal' && this._qrBlobUrl) {
            URL.revokeObjectURL(this._qrBlobUrl);
            this._qrBlobUrl = null;
        }
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
                if (msg.type === 'device_update' && msg.device) {
                    const myId = this.clientId || (this.deviceInfo && this.deviceInfo.id);
                    if (msg.device.id === myId) {
                        this.clientName = msg.device.name;
                        if (msg.device.platform) this.platform = msg.device.platform;
                        localStorage.setItem('lanx_client_name', this.clientName);
                        localStorage.setItem('lanx_client_platform', this.platform);
                        this.updateHeaderProfileBadge();
                    }
                }
                break;

            case 'transfer_complete':
                if (typeof Transfer !== 'undefined') Transfer.handleEvent(msg);
                const myId = this.clientId || (this.deviceInfo && this.deviceInfo.id);
                const isHostId = this.deviceInfo && this.deviceInfo.id;
                // Do not show incoming download toast to the sender itself
                if (msg.sender_id && (msg.sender_id === myId || (isHostId && msg.sender_id === isHostId))) {
                    break;
                }
                const isTarget = !msg.target_device_id || msg.target_device_id === 'all' || msg.target_device_id === myId || (isHostId && msg.target_device_id === isHostId);
                if (isTarget && msg.download_url) {
                    let autoDownloaded = false;
                    if (this.autoDownload) {
                        try {
                            const a = document.createElement('a');
                            a.href = msg.download_url;
                            a.download = msg.filename || 'download';
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            autoDownloaded = true;
                        } catch (e) {
                            console.error('[LANX] Auto-download error:', e);
                        }
                    }
                    this.showFileReceivedToast(msg, autoDownloaded);
                    this.playSound('incoming');
                }
                break;

            case 'transfer_progress':
            case 'transfer_failed':
            case 'transfer_started':
                if (typeof Transfer !== 'undefined') Transfer.handleEvent(msg);
                break;

            case 'text_received':
                const curId = this.clientId || (this.deviceInfo && this.deviceInfo.id);
                const hostClipId = this.deviceInfo && this.deviceInfo.id;
                if (msg.from_id && (msg.from_id === curId || (hostClipId && msg.from_id === hostClipId))) {
                    break;
                }
                if (!msg.target_device_id || msg.target_device_id === 'all' || msg.target_device_id === curId || (hostClipId && msg.target_device_id === hostClipId)) {
                    if (typeof Clipboard !== 'undefined') Clipboard.handleTextReceived(msg);
                }
                break;

            case 'clipboard_received':
                const curClipId = this.clientId || (this.deviceInfo && this.deviceInfo.id);
                const hostClipId2 = this.deviceInfo && this.deviceInfo.id;
                if (msg.from_id && (msg.from_id === curClipId || (hostClipId2 && msg.from_id === hostClipId2))) {
                    break;
                }
                if (!msg.target_device_id || msg.target_device_id === 'all' || msg.target_device_id === curClipId || (hostClipId2 && msg.target_device_id === hostClipId2)) {
                    if (typeof Clipboard !== 'undefined') Clipboard.handleClipboardReceived(msg);
                }
                break;

            case 'pair_request':
                this.showPairRequest(msg.device_name, msg.token);
                break;

            case 'incoming_file':
                this.showIncomingFile(msg);
                break;

            case 'library_updated':
            case 'library_approval_request':
            case 'library_approval_resolved':
                if (typeof Library !== 'undefined') Library.handleEvent(msg);
                break;

            default:
                console.log('[LANX] Unknown WS message type:', msg.type);
        }
    },

    showFileReceivedToast(msg, autoDownloaded = false) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast success';
        const isBroadcast = msg.target_device_id === 'all';
        const fromDevice = msg.from_device ? `Dari <strong>${this.escapeHtml(msg.from_device)}</strong>` : 'Berkas Baru';
        const canPreview = typeof Transfer !== 'undefined' && Transfer.isPreviewable(msg.filename);

        let badgeText = isBroadcast ? 'Siaran ke Semua' : 'Berkas Diterima';
        let badgeBg = 'rgba(26,115,232,0.15)';
        let badgeColor = 'var(--color-primary)';

        if (msg.is_offline_queue) {
            badgeText = autoDownloaded ? 'Masuk dari Kotak Masuk (Terunduh)' : 'Masuk dari Kotak Masuk Offline';
            badgeBg = 'rgba(245,158,11,0.18)';
            badgeColor = '#d97706';
        } else if (autoDownloaded) {
            badgeText = 'Terunduh Otomatis';
            badgeBg = 'rgba(16,185,129,0.15)';
            badgeColor = '#10b981';
        }

        toast.innerHTML = `
            <div style="margin-bottom: 8px;">
                <span style="font-size: 0.75rem; background: ${badgeBg}; color: ${badgeColor}; padding: 1px 6px; border-radius: 4px; font-weight: 600; display: inline-block; margin-bottom: 4px;">
                    ${badgeText}
                </span>
                <div>${fromDevice}: <strong>${this.escapeHtml(msg.filename)}</strong> (${this.formatSize(msg.size)})</div>
                ${msg.description ? `
                    <div class="toast-note-clickable" data-id="${msg.download_id || ''}" data-filename="${this.escapeHtml(msg.filename)}" data-size="${msg.size || 0}" data-from="${this.escapeHtml(msg.from_device || '')}" data-desc="${this.escapeHtml(msg.description)}" style="margin-top: 4px; font-size: 0.75rem; color: var(--color-primary); background: var(--color-primary-light); padding: 4px 10px; border-radius: 4px; border-left: 3px solid var(--color-primary); cursor: pointer; font-style: normal; font-weight: 500;" title="Klik untuk membuka pratinjau">
                        💬 ${this.formatDescription(msg.description)}
                    </div>
                ` : ''}
                ${msg.is_offline_queue ? '<div style="font-size: 0.75rem; color: var(--color-text-tertiary); margin-top: 2px;">(Dikirim saat perangkat ini sedang offline)</div>' : ''}
            </div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                ${canPreview ? `
                    <button type="button" class="btn btn-sm btn-ghost btn-toast-preview"
                        data-id="${msg.download_id}"
                        data-filename="${this.escapeHtml(msg.filename)}"
                        data-size="${msg.size || 0}"
                        data-from="${this.escapeHtml(msg.from_device || '')}"
                        data-desc="${this.escapeHtml(msg.description || '')}"
                        style="padding: 4px 10px; border: 1px solid var(--color-border); font-weight: 500;">
                        Pratinjau
                    </button>
                ` : ''}
                <a href="${msg.download_url}" download="${this.escapeHtml(msg.filename)}" class="btn btn-sm btn-primary" style="display: inline-block; padding: 4px 12px; text-decoration: none; color: #fff; border-radius: 4px; font-weight: 500;">
                    ${autoDownloaded ? 'Unduh Ulang' : 'Unduh Berkas'}
                </a>
            </div>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 15000);
    },

    formatDescription(text) {
        if (!text) return '';
        const escaped = this.escapeHtml(text);
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        return escaped.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" class="desc-link" onclick="event.stopPropagation()">$1</a>')
                      .replace(/\r\n|\r|\n/g, '<br>');
    },

    setupMediaPreviewModal() {
        const modal = document.getElementById('media-preview-modal');
        const btnClose = document.getElementById('btn-close-preview');
        const btnCopyDesc = document.getElementById('btn-copy-preview-desc');

        if (btnClose) {
            btnClose.addEventListener('click', () => this.closeMediaPreview());
        }
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeMediaPreview();
            });
        }
        if (btnCopyDesc) {
            btnCopyDesc.addEventListener('click', () => {
                const descText = document.getElementById('preview-desc-text');
                if (descText && descText.textContent) {
                    this.copyToClipboard(descText.textContent, 'Catatan disalin ke clipboard');
                }
            });
        }

        // Event delegation for toast preview button & clickable toast note
        document.addEventListener('click', (e) => {
            const toastBtn = e.target.closest('.btn-toast-preview');
            if (toastBtn) {
                const id = toastBtn.dataset.id;
                const filename = toastBtn.dataset.filename;
                const size = parseInt(toastBtn.dataset.size || '0', 10);
                const from = toastBtn.dataset.from;
                const desc = toastBtn.dataset.desc || '';
                if (id && filename) {
                    this.openMediaPreview(filename, id, size, from, desc);
                }
                return;
            }

            const toastNote = e.target.closest('.toast-note-clickable');
            if (toastNote && !e.target.closest('a')) {
                const id = toastNote.dataset.id;
                const filename = toastNote.dataset.filename;
                const size = parseInt(toastNote.dataset.size || '0', 10);
                const from = toastNote.dataset.from;
                const desc = toastNote.dataset.desc || '';
                if (id && filename && typeof Transfer !== 'undefined' && Transfer.isPreviewable(filename)) {
                    this.openMediaPreview(filename, id, size, from, desc);
                }
            }
        });
    },

    async openMediaPreview(filename, downloadId, size, fromDevice, description = '') {
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
        if (metaEl) metaEl.textContent = `${this.formatSize(size || 0)} · Dari ${fromDevice || 'Perangkat Lain'}`;
        if (iconEl && typeof Transfer !== 'undefined') iconEl.innerHTML = Transfer.getFileIcon(filename, false, 24);
        if (dlBtn) {
            dlBtn.href = `/api/download/${downloadId}`;
            dlBtn.download = filename;
        }

        if (descBar && descText) {
            if (description) {
                descText.innerHTML = this.formatDescription(description);
                descBar.style.display = 'flex';
            } else {
                descBar.style.display = 'none';
                descText.innerHTML = '';
            }
        }

        const ext = (filename.split('.').pop() || '').toLowerCase();
        const previewUrl = `/api/download/${downloadId}?preview=1`;

        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const vidExts = ['mp4', 'webm', 'mov', 'mkv'];
        const audExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
        const txtExts = ['txt', 'md', 'json', 'log', 'csv', 'js', 'html', 'css', 'go'];

        stage.innerHTML = '<div style="color: var(--color-text-tertiary); font-size: var(--font-size-sm);">Memuat pratinjau...</div>';

        if (imgExts.includes(ext)) {
            stage.innerHTML = `<img src="${previewUrl}" alt="${this.escapeHtml(filename)}">`;
        } else if (vidExts.includes(ext)) {
            stage.innerHTML = `<video src="${previewUrl}" controls autoplay playsinline style="max-width: 100%; max-height: 70vh;"></video>`;
        } else if (audExts.includes(ext)) {
            stage.innerHTML = `
                <div class="preview-audio-container">
                    <div class="preview-audio-disc">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                    <div style="font-weight: 600; color: var(--color-text); margin-bottom: 4px;">${this.escapeHtml(filename)}</div>
                    <audio src="${previewUrl}" controls autoplay></audio>
                </div>
            `;
        } else if (ext === 'pdf') {
            stage.innerHTML = `<iframe src="${previewUrl}" style="width: 100%; height: 70vh; border: none; border-radius: var(--radius-sm);"></iframe>`;
        } else if (txtExts.includes(ext)) {
            try {
                const res = await fetch(previewUrl);
                if (res.ok) {
                    const text = await res.text();
                    stage.innerHTML = `
                        <div class="preview-text-container">
                            <pre class="preview-text-content">${this.escapeHtml(text)}</pre>
                        </div>
                    `;
                } else {
                    stage.innerHTML = '<div class="preview-empty-stage">Gagal memuat isi teks.</div>';
                }
            } catch (e) {
                stage.innerHTML = '<div class="preview-empty-stage">Gagal memuat isi teks.</div>';
            }
        } else {
            stage.innerHTML = `
                <div class="preview-empty-stage">
                    <div style="display: flex; justify-content: center; margin-bottom: 12px; color: var(--color-text-secondary);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                    </div>
                    <p style="font-weight: 500; color: var(--color-text); margin-bottom: 4px;">Pratinjau langsung tidak didukung untuk format ini</p>
                    <p style="font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-bottom: 16px;">Anda dapat langsung mengunduh berkas ke komputer.</p>
                    <a href="/api/download/${downloadId}" class="btn btn-primary" download="${this.escapeHtml(filename)}">Unduh Berkas Sekarang</a>
                </div>
            `;
        }

        modal.style.display = 'flex';
    },

    closeMediaPreview() {
        const modal = document.getElementById('media-preview-modal');
        if (!modal) return;
        const stage = document.getElementById('preview-stage');
        if (stage) {
            const mediaElements = stage.querySelectorAll('video, audio');
            mediaElements.forEach(el => {
                el.pause();
                el.src = '';
            });
            stage.innerHTML = '';
        }
        const descBar = document.getElementById('preview-description-bar');
        const descText = document.getElementById('preview-desc-text');
        if (descBar) descBar.style.display = 'none';
        if (descText) descText.innerHTML = '';
        modal.style.display = 'none';
    },

    showIncomingFile(msg) {
        const modal = document.getElementById('incoming-modal');
        const title = document.getElementById('incoming-title');
        const body = document.getElementById('incoming-body');

        title.textContent = 'Berkas Masuk';
        body.innerHTML = `
            <p style="text-align: center; margin-bottom: 8px;">
                <strong>${this.escapeHtml(msg.device_name || 'Perangkat Lain')}</strong> ingin mengirimkan berkas kepada Anda.
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
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let iconSvg = '';
        if (type === 'success') {
            iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-success); flex-shrink: 0;"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (type === 'error') {
            iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-error); flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        } else if (type === 'warning') {
            iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-warning); flex-shrink: 0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        } else {
            iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary); flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        }

        toast.innerHTML = `${iconSvg}<span>${this.escapeHtml(message)}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, 3200);
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

    openGuideModal() {
        const modal = document.getElementById('welcome-guide-modal');
        if (modal) modal.style.display = 'flex';
    },

    copyToClipboard(text, successMsg = 'Teks berhasil disalin ke papan klip!') {
        if (!text) return Promise.resolve(false);

        const fallback = (str) => {
            const ta = document.createElement('textarea');
            ta.value = str;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try {
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) {
                    this.vibrate('light');
                    if (successMsg) this.showToast(successMsg, 'success');
                    return true;
                }
            } catch (err) {
                document.body.removeChild(ta);
            }
            if (successMsg) this.showToast(str, 'info');
            return false;
        };

        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text)
                .then(() => {
                    this.vibrate('light');
                    if (successMsg) this.showToast(successMsg, 'success');
                    return true;
                })
                .catch(() => fallback(text));
        }
        return Promise.resolve(fallback(text));
    },

    checkPairingToken() {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (!token) return;

        // Clean query param from URL bar without page reload
        const cleanUrl = window.location.pathname.startsWith('/pair') ? '/' : window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);

        this.showToast('Mengirim permintaan koneksi ke perangkat...', 'info');

        // Request pairing from server
        fetch('/api/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                device_id: this.clientId,
                device_name: this.clientName || 'Perangkat Baru',
            }),
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'pending') {
                this.pollPairingStatus(token);
            } else if (data.error) {
                this.showToast(data.error || 'Token pairing tidak valid atau telah kedaluwarsa', 'error');
            }
        })
        .catch(() => {
            this.showToast('Gagal mengirim permintaan koneksi', 'error');
        });
    },

    pollPairingStatus(token) {
        let attempts = 0;
        const maxAttempts = 30; // 30 x 2s = 60s
        const timer = setInterval(async () => {
            attempts++;
            if (attempts > maxAttempts) {
                clearInterval(timer);
                this.showToast('Waktu permintaan koneksi habis', 'info');
                return;
            }
            try {
                const res = await fetch(`/api/pair/pending?token=${encodeURIComponent(token)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'accepted') {
                        clearInterval(timer);
                        this.showToast('Perangkat berhasil terhubung dan disetujui!', 'success');
                        if (typeof Devices !== 'undefined') Devices.loadDevices();
                    } else if (data.status === 'rejected') {
                        clearInterval(timer);
                        this.showToast('Permintaan koneksi ditolak oleh perangkat tujuan', 'info');
                    }
                }
            } catch (e) {
                // Keep polling
            }
        }, 2000);
    },

    confirm({ title = 'Konfirmasi', message = '', confirmText = 'Lanjutkan', cancelText = 'Batal', danger = false } = {}) {
        return new Promise((resolve) => {
            const modal = document.getElementById('app-confirm-modal');
            const titleEl = document.getElementById('app-confirm-title');
            const descEl = document.getElementById('app-confirm-desc');
            const btnClose = document.getElementById('btn-close-app-confirm');
            const btnCancel = document.getElementById('btn-cancel-app-confirm');
            const btnExecute = document.getElementById('btn-execute-app-confirm');
            const iconWrap = document.getElementById('app-confirm-title-wrap');

            if (!modal) {
                resolve(window.confirm(message));
                return;
            }

            if (titleEl) titleEl.textContent = title;
            if (descEl) descEl.textContent = message;
            if (btnCancel) btnCancel.textContent = cancelText;
            if (btnExecute) {
                btnExecute.textContent = confirmText;
                if (danger) {
                    btnExecute.style.background = '#ef4444';
                    btnExecute.style.borderColor = '#ef4444';
                    if (iconWrap) iconWrap.style.color = '#ef4444';
                } else {
                    btnExecute.style.background = '';
                    btnExecute.style.borderColor = '';
                    if (iconWrap) iconWrap.style.color = '';
                }
            }

            const cleanUp = (result) => {
                modal.style.display = 'none';
                btnClose?.removeEventListener('click', onCancel);
                btnCancel?.removeEventListener('click', onCancel);
                btnExecute?.removeEventListener('click', onConfirm);
                modal.removeEventListener('click', onOverlay);
                document.removeEventListener('keydown', onKeyDown);
                resolve(result);
            };

            const onCancel = () => cleanUp(false);
            const onConfirm = () => cleanUp(true);
            const onOverlay = (e) => { if (e.target === modal) cleanUp(false); };
            const onKeyDown = (e) => {
                if (modal.style.display !== 'none') {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        cleanUp(false);
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        cleanUp(true);
                    }
                }
            };

            btnClose?.addEventListener('click', onCancel);
            btnCancel?.addEventListener('click', onCancel);
            btnExecute?.addEventListener('click', onConfirm);
            modal.addEventListener('click', onOverlay);
            document.addEventListener('keydown', onKeyDown);

            modal.style.display = 'flex';
        });
    },
};

// ─── Guide Modal ─────────────────────────────────────
LANX.setupGuideModal = function() {
    const modal = document.getElementById('welcome-guide-modal');
    const btnClose = document.getElementById('btn-close-guide');
    const btnDismiss = document.getElementById('btn-dismiss-guide');
    const btnOpen = document.getElementById('btn-open-guide');

    if (!modal) return;

    const closeGuide = () => {
        modal.style.display = 'none';
        sessionStorage.setItem('lanx_guide_dismissed', 'true');
        localStorage.setItem('lanx_seen_guide', 'true');
    };

    if (btnClose) btnClose.addEventListener('click', closeGuide);
    if (btnDismiss) btnDismiss.addEventListener('click', closeGuide);

    // Click overlay to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeGuide();
    });

    // Re-open via header button
    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            modal.style.display = 'flex';
        });
    }

    // Show only on first visit if not dismissed yet
    if (!localStorage.getItem('lanx_seen_guide') && !sessionStorage.getItem('lanx_guide_dismissed')) {
        modal.style.display = 'flex';
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => LANX.init());
