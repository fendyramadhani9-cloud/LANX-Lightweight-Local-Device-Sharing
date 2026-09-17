package transfer

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// Status represents the state of a file transfer.
type Status string

const (
	StatusPreparing    Status = "preparing"
	StatusTransferring Status = "transferring"
	StatusCompleted    Status = "completed"
	StatusFailed       Status = "failed"
	StatusCancelled    Status = "cancelled"
)

// Transfer represents an ongoing or completed file transfer.
type Transfer struct {
	ID           string `json:"id"`
	Filename     string `json:"filename"`
	Size         int64  `json:"size"`
	Loaded       int64  `json:"loaded"`
	Percentage   float64 `json:"percentage"`
	Status       Status `json:"status"`
	Direction    string `json:"direction"` // "sent" or "received"
	DeviceName   string `json:"device"`
	DeviceID     string `json:"device_id,omitempty"`
	DownloadID   string `json:"download_id,omitempty"`
	Timestamp    int64  `json:"timestamp"`
	Error        string `json:"error,omitempty"`
}

// Manager tracks all transfers and their progress.
type Manager struct {
	mu        sync.RWMutex
	active    map[string]*Transfer
	history   []*Transfer
	maxHist   int
	onUpdate  func(t *Transfer) // callback for WebSocket broadcast
}

// NewManager creates a new transfer manager.
func NewManager(onUpdate func(t *Transfer)) *Manager {
	return &Manager{
		active:   make(map[string]*Transfer),
		history:  make([]*Transfer, 0),
		maxHist:  50,
		onUpdate: onUpdate,
	}
}

// Create initializes a new transfer.
func (m *Manager) Create(filename string, size int64, direction, deviceName, deviceID string) *Transfer {
	t := &Transfer{
		ID:         generateTransferID(),
		Filename:   filename,
		Size:       size,
		Status:     StatusPreparing,
		Direction:  direction,
		DeviceName: deviceName,
		DeviceID:   deviceID,
		Timestamp:  time.Now().UnixMilli(),
	}

	m.mu.Lock()
	m.active[t.ID] = t
	m.mu.Unlock()

	return t
}

// UpdateProgress updates transfer progress.
func (m *Manager) UpdateProgress(id string, loaded int64) {
	m.mu.Lock()
	t, ok := m.active[id]
	if ok {
		t.Loaded = loaded
		t.Status = StatusTransferring
		if t.Size > 0 {
			t.Percentage = float64(loaded) / float64(t.Size) * 100
		}
	}
	m.mu.Unlock()

	if ok && m.onUpdate != nil {
		m.onUpdate(t)
	}
}

// Complete marks a transfer as completed.
func (m *Manager) Complete(id string, downloadID string) {
	m.mu.Lock()
	t, ok := m.active[id]
	if ok {
		t.Status = StatusCompleted
		t.Percentage = 100
		t.Loaded = t.Size
		t.DownloadID = downloadID
		m.addToHistory(t)
		delete(m.active, id)
	}
	m.mu.Unlock()

	if ok && m.onUpdate != nil {
		m.onUpdate(t)
	}
}

// Fail marks a transfer as failed.
func (m *Manager) Fail(id string, reason string) {
	m.mu.Lock()
	t, ok := m.active[id]
	if ok {
		t.Status = StatusFailed
		t.Error = reason
		m.addToHistory(t)
		delete(m.active, id)
	}
	m.mu.Unlock()

	if ok && m.onUpdate != nil {
		m.onUpdate(t)
	}
}

// Get returns a transfer by ID.
func (m *Manager) Get(id string) (*Transfer, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.active[id]
	return t, ok
}

// History returns recent transfer history.
func (m *Manager) History() []*Transfer {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*Transfer, len(m.history))
	copy(result, m.history)
	return result
}

func (m *Manager) addToHistory(t *Transfer) {
	// Prepend
	m.history = append([]*Transfer{t}, m.history...)
	if len(m.history) > m.maxHist {
		m.history = m.history[:m.maxHist]
	}
}

func generateTransferID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}
