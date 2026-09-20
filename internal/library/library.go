package library

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	StatusApproved        = "approved"
	StatusPendingApproval = "pending_approval"
)

// LibraryItem represents a persistently stored item in the shared library.
type LibraryItem struct {
	ID            string `json:"id"`
	Filename      string `json:"filename"`
	Path          string `json:"path"`
	Size          int64  `json:"size"`
	Description   string `json:"description,omitempty"`
	Folder        string `json:"folder,omitempty"`
	UploaderName  string `json:"uploader_name"`
	UploaderID    string `json:"uploader_id"`
	DeleteToken   string `json:"delete_token,omitempty"`
	ExpiresAt     int64  `json:"expires_at"` // Timestamp ms
	CreatedAt     int64  `json:"created_at"` // Timestamp ms
	Status        string `json:"status"`     // "approved" or "pending_approval"
	DownloadCount int    `json:"download_count"`
}

// LibraryStorage defines disk serialization structure for backward compatibility.
type LibraryStorage struct {
	Folders []string       `json:"folders,omitempty"`
	Items   []*LibraryItem `json:"items"`
}

// Manager manages library items and persists metadata to JSON.
type Manager struct {
	mu          sync.RWMutex
	storagePath string
	libraryDir  string
	folders     []string
	items       map[string]*LibraryItem
	onEvent     func(eventType string, data any)
}

// NewManager creates a new library manager instance and loads saved items.
func NewManager(storagePath, libraryDir string, onEvent func(eventType string, data any)) *Manager {
	m := &Manager{
		storagePath: storagePath,
		libraryDir:  libraryDir,
		items:       make(map[string]*LibraryItem),
		onEvent:     onEvent,
	}

	_ = os.MkdirAll(libraryDir, 0o755)
	_ = m.loadFromDisk()

	// Initial clean of any expired files on startup
	m.CleanExpired()

	return m
}

// StartAutoCleaner runs a background ticker to remove expired files.
func (m *Manager) StartAutoCleaner(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			m.CleanExpired()
		}
	}()
}

// CleanExpired removes any items whose ExpiresAt is in the past.
func (m *Manager) CleanExpired() int {
	m.mu.Lock()
	now := time.Now().UnixMilli()
	var expired []*LibraryItem

	for id, it := range m.items {
		if it.ExpiresAt > 0 && it.ExpiresAt <= now {
			expired = append(expired, it)
			delete(m.items, id)
			_ = os.Remove(it.Path)
		}
	}

	if len(expired) > 0 {
		_ = m.saveToDiskLocked()
	}
	m.mu.Unlock()

	if len(expired) > 0 && m.onEvent != nil {
		m.onEvent("library_updated", map[string]any{"action": "expired_clean", "count": len(expired)})
	}

	return len(expired)
}

// AddItem stores a new library item and saves metadata to disk.
func (m *Manager) AddItem(item *LibraryItem) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if item.ID == "" {
		item.ID = GenerateID()
	}
	if item.CreatedAt == 0 {
		item.CreatedAt = time.Now().UnixMilli()
	}
	if strings.TrimSpace(item.Folder) == "" {
		item.Folder = "Umum"
	}

	// Cap maximum expiration to 1 year (365 days) from creation
	maxExpiry := item.CreatedAt + (365 * 24 * int64(time.Hour/time.Millisecond))
	if item.ExpiresAt <= 0 || item.ExpiresAt > maxExpiry {
		item.ExpiresAt = maxExpiry
	}

	m.items[item.ID] = item
	if err := m.saveToDiskLocked(); err != nil {
		return err
	}

	if m.onEvent != nil {
		switch item.Status {
		case StatusApproved:
			m.onEvent("library_updated", map[string]any{"action": "added", "item": item})
		case StatusPendingApproval:
			m.onEvent("library_approval_request", map[string]any{"action": "pending", "item": item})
		}
	}

	return nil
}

// Get returns an item by ID.
func (m *Manager) Get(id string) (*LibraryItem, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	it, ok := m.items[id]
	return it, ok
}

// ListApproved returns all approved items, optionally filtered by search query and folder.
func (m *Manager) ListApproved(query string, folder ...string) []*LibraryItem {
	m.mu.RLock()
	defer m.mu.RUnlock()

	q := strings.ToLower(strings.TrimSpace(query))
	fFilter := ""
	if len(folder) > 0 {
		fFilter = strings.TrimSpace(folder[0])
		if fFilter == "all" {
			fFilter = ""
		}
	}

	var result []*LibraryItem

	for _, it := range m.items {
		if it.Status != StatusApproved {
			continue
		}
		if fFilter != "" {
			itemFolder := it.Folder
			if itemFolder == "" {
				itemFolder = "Umum"
			}
			if !strings.EqualFold(itemFolder, fFilter) {
				continue
			}
		}
		if q != "" {
			nameMatch := strings.Contains(strings.ToLower(it.Filename), q)
			descMatch := strings.Contains(strings.ToLower(it.Description), q)
			uploaderMatch := strings.Contains(strings.ToLower(it.UploaderName), q)
			folderMatch := strings.Contains(strings.ToLower(it.Folder), q)
			if !nameMatch && !descMatch && !uploaderMatch && !folderMatch {
				continue
			}
		}
		result = append(result, it)
	}

	return result
}

// ListPending returns all items awaiting admin approval.
func (m *Manager) ListPending() []*LibraryItem {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*LibraryItem
	for _, it := range m.items {
		if it.Status == StatusPendingApproval {
			result = append(result, it)
		}
	}
	return result
}

// Approve marks a pending item as approved.
func (m *Manager) Approve(id string) (*LibraryItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	it, ok := m.items[id]
	if !ok {
		return nil, fmt.Errorf("item not found")
	}

	it.Status = StatusApproved
	if err := m.saveToDiskLocked(); err != nil {
		return nil, err
	}

	if m.onEvent != nil {
		m.onEvent("library_updated", map[string]any{"action": "approved", "item": it})
		m.onEvent("library_approval_resolved", map[string]any{"id": id, "status": StatusApproved})
	}

	return it, nil
}

// Reject rejects and deletes a pending item.
func (m *Manager) Reject(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	it, ok := m.items[id]
	if !ok {
		return fmt.Errorf("item not found")
	}

	_ = os.Remove(it.Path)
	delete(m.items, id)

	_ = m.saveToDiskLocked()

	if m.onEvent != nil {
		m.onEvent("library_approval_resolved", map[string]any{"id": id, "status": "rejected"})
	}

	return nil
}

// Delete removes an item. Allowed if deleteToken matches or if isAdmin is true.
func (m *Manager) Delete(id, token string, isAdmin bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	it, ok := m.items[id]
	if !ok {
		return fmt.Errorf("item not found")
	}

	if !isAdmin {
		if token == "" || it.DeleteToken == "" || it.DeleteToken != token {
			return fmt.Errorf("unauthorized to delete this item")
		}
	}

	_ = os.Remove(it.Path)
	delete(m.items, id)

	if err := m.saveToDiskLocked(); err != nil {
		return err
	}

	if m.onEvent != nil {
		m.onEvent("library_updated", map[string]any{"action": "deleted", "id": id})
	}

	return nil
}

// IncrementDownload increments the download counter for an item.
func (m *Manager) IncrementDownload(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if it, ok := m.items[id]; ok {
		it.DownloadCount++
		_ = m.saveToDiskLocked()
	}
}

// GetTotalStorageUsed returns total bytes used by all library files and total count.
// GetFolders returns all available folder names.
func (m *Manager) GetFolders() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if len(m.folders) == 0 {
		return []string{"Umum"}
	}
	result := make([]string, len(m.folders))
	copy(result, m.folders)
	return result
}

// AddFolder creates a new folder/category.
func (m *Manager) AddFolder(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return fmt.Errorf("nama folder tidak boleh kosong")
	}
	if len(trimmed) > 64 {
		return fmt.Errorf("nama folder maksimal 64 karakter")
	}
	if strings.ContainsAny(trimmed, "/\\:*?\"<>|") || strings.Contains(trimmed, "..") {
		return fmt.Errorf("nama folder mengandung karakter tidak valid")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	for _, f := range m.folders {
		if strings.EqualFold(f, trimmed) {
			return fmt.Errorf("folder dengan nama tersebut sudah ada")
		}
	}

	m.folders = append(m.folders, trimmed)
	if err := m.saveToDiskLocked(); err != nil {
		return err
	}

	if m.onEvent != nil {
		m.onEvent("library_updated", map[string]any{"action": "folder_added", "folder": trimmed})
	}
	return nil
}

// DeleteFolder removes a folder and moves its items to "Umum".
func (m *Manager) DeleteFolder(name string) error {
	trimmed := strings.TrimSpace(name)
	if strings.EqualFold(trimmed, "Umum") {
		return fmt.Errorf("folder utama 'Umum' tidak dapat dihapus")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	found := false
	newFolders := make([]string, 0, len(m.folders))
	for _, f := range m.folders {
		if strings.EqualFold(f, trimmed) {
			found = true
			continue
		}
		newFolders = append(newFolders, f)
	}

	if !found {
		return fmt.Errorf("folder tidak ditemukan")
	}

	m.folders = newFolders
	for _, it := range m.items {
		if strings.EqualFold(it.Folder, trimmed) {
			it.Folder = "Umum"
		}
	}

	if err := m.saveToDiskLocked(); err != nil {
		return err
	}

	if m.onEvent != nil {
		m.onEvent("library_updated", map[string]any{"action": "folder_deleted", "folder": trimmed})
	}
	return nil
}

// ClearItems removes all approved items or all image items (Admin only).
func (m *Manager) ClearItems(target string) (int, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	imageExts := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".webp": true, ".svg": true, ".bmp": true, ".ico": true,
	}

	var toDelete []*LibraryItem
	for _, it := range m.items {
		if it.Status != StatusApproved {
			continue
		}
		switch target {
		case "images":
			ext := strings.ToLower(filepath.Ext(it.Filename))
			if imageExts[ext] {
				toDelete = append(toDelete, it)
			}
		case "all":
			toDelete = append(toDelete, it)
		}
	}

	var freedBytes int64
	for _, it := range toDelete {
		delete(m.items, it.ID)
		_ = os.Remove(it.Path)
		freedBytes += it.Size
	}

	if len(toDelete) > 0 {
		_ = m.saveToDiskLocked()
		if m.onEvent != nil {
			m.onEvent("library_updated", map[string]any{"action": "cleared", "target": target, "count": len(toDelete)})
		}
	}

	return len(toDelete), freedBytes, nil
}

func (m *Manager) GetTotalStorageUsed() (int64, int) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var totalBytes int64
	count := 0
	for _, it := range m.items {
		totalBytes += it.Size
		count++
	}
	return totalBytes, count
}

func (m *Manager) loadFromDisk() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.storagePath == "" {
		return nil
	}

	data, err := os.ReadFile(m.storagePath)
	if err != nil {
		if os.IsNotExist(err) {
			m.folders = []string{"Umum"}
			return nil
		}
		return err
	}

	var storage LibraryStorage
	if err := json.Unmarshal(data, &storage); err == nil && (len(storage.Items) > 0 || len(storage.Folders) > 0) {
		m.folders = storage.Folders
		for _, it := range storage.Items {
			if it.Folder == "" {
				it.Folder = "Umum"
			}
			m.items[it.ID] = it
		}
	} else {
		// Fallback for legacy format: []LibraryItem
		var legacy []*LibraryItem
		if errLegacy := json.Unmarshal(data, &legacy); errLegacy == nil {
			for _, it := range legacy {
				if it.Folder == "" {
					it.Folder = "Umum"
				}
				m.items[it.ID] = it
			}
		}
	}

	if len(m.folders) == 0 {
		m.folders = []string{"Umum"}
	}

	return nil
}

func (m *Manager) saveToDiskLocked() error {
	if m.storagePath == "" {
		return nil
	}

	list := make([]*LibraryItem, 0, len(m.items))
	for _, it := range m.items {
		list = append(list, it)
	}

	if len(m.folders) == 0 {
		m.folders = []string{"Umum"}
	}

	storage := LibraryStorage{
		Folders: m.folders,
		Items:   list,
	}

	data, err := json.MarshalIndent(storage, "", "  ")
	if err != nil {
		return err
	}

	_ = os.MkdirAll(filepath.Dir(m.storagePath), 0o755)
	tmpFile := fmt.Sprintf("%s.tmp", m.storagePath)
	if err := os.WriteFile(tmpFile, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpFile, m.storagePath)
}

// GenerateID creates a random library item ID.
func GenerateID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "lib_" + hex.EncodeToString(b)
}

// GenerateToken generates a random token for delete permissions.
func GenerateToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// HashToken returns SHA256 of token string.
func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
