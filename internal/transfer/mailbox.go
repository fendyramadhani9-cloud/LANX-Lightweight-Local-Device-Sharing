package transfer

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// MailboxItem represents a queued item for an offline device.
type MailboxItem struct {
	ID             string `json:"id"`
	Type           string `json:"type"` // "file" or "text"
	TransferID     string `json:"transfer_id,omitempty"`
	DownloadID     string `json:"download_id,omitempty"`
	Filename       string `json:"filename,omitempty"`
	Size           int64  `json:"size,omitempty"`
	TextContent    string `json:"text_content,omitempty"`
	Description    string `json:"description,omitempty"`
	TargetDeviceID string `json:"target_device_id"`
	SenderID       string `json:"sender_id"`
	SenderName     string `json:"sender_name"`
	Timestamp      int64  `json:"timestamp"`
	Delivered      bool   `json:"delivered"`
	DeliveredAt    int64  `json:"delivered_at,omitempty"`
}

// Mailbox manages persistent storage of queued items for offline devices.
type Mailbox struct {
	mu       sync.RWMutex
	filePath string
	items    []*MailboxItem
}

// NewMailbox creates or loads a mailbox store from filePath.
func NewMailbox(filePath string) *Mailbox {
	mb := &Mailbox{
		filePath: filePath,
		items:    make([]*MailboxItem, 0),
	}
	mb.load()
	return mb
}

// AddFile queues a file for an offline device.
func (mb *Mailbox) AddFile(transferID, downloadID, filename string, size int64, targetDeviceID, senderID, senderName string, description ...string) *MailboxItem {
	desc := ""
	if len(description) > 0 {
		desc = description[0]
	}
	item := &MailboxItem{
		ID:             generateMailboxID(),
		Type:           "file",
		TransferID:     transferID,
		DownloadID:     downloadID,
		Filename:       filename,
		Size:           size,
		Description:    desc,
		TargetDeviceID: targetDeviceID,
		SenderID:       senderID,
		SenderName:     senderName,
		Timestamp:      time.Now().UnixMilli(),
		Delivered:      false,
	}

	mb.mu.Lock()
	mb.items = append(mb.items, item)
	mb.mu.Unlock()

	mb.save()
	return item
}

// AddText queues a text message for an offline device.
func (mb *Mailbox) AddText(text, targetDeviceID, senderID, senderName string) *MailboxItem {
	item := &MailboxItem{
		ID:             generateMailboxID(),
		Type:           "text",
		TextContent:    text,
		TargetDeviceID: targetDeviceID,
		SenderID:       senderID,
		SenderName:     senderName,
		Timestamp:      time.Now().UnixMilli(),
		Delivered:      false,
	}

	mb.mu.Lock()
	mb.items = append(mb.items, item)
	mb.mu.Unlock()

	mb.save()
	return item
}

// GetPendingForDevice returns all undelivered items for targetDeviceID.
func (mb *Mailbox) GetPendingForDevice(targetDeviceID string) []*MailboxItem {
	mb.mu.RLock()
	defer mb.mu.RUnlock()

	var pending []*MailboxItem
	for _, it := range mb.items {
		if !it.Delivered && it.TargetDeviceID == targetDeviceID {
			pending = append(pending, it)
		}
	}
	return pending
}

// MarkDelivered marks an item as delivered and persists changes.
func (mb *Mailbox) MarkDelivered(id string) bool {
	mb.mu.Lock()
	found := false
	for _, it := range mb.items {
		if it.ID == id {
			it.Delivered = true
			it.DeliveredAt = time.Now().UnixMilli()
			found = true
			break
		}
	}
	mb.mu.Unlock()

	if found {
		mb.save()
	}
	return found
}

// CountPendingForDevice returns the count of undelivered items for targetDeviceID.
func (mb *Mailbox) CountPendingForDevice(targetDeviceID string) int {
	mb.mu.RLock()
	defer mb.mu.RUnlock()

	count := 0
	for _, it := range mb.items {
		if !it.Delivered && it.TargetDeviceID == targetDeviceID {
			count++
		}
	}
	return count
}

func (mb *Mailbox) load() {
	if mb.filePath == "" {
		return
	}
	data, err := os.ReadFile(mb.filePath)
	if err != nil {
		return
	}

	var items []*MailboxItem
	if err := json.Unmarshal(data, &items); err == nil {
		mb.mu.Lock()
		mb.items = items
		mb.mu.Unlock()
	}
}

func (mb *Mailbox) save() {
	if mb.filePath == "" {
		return
	}
	mb.mu.RLock()
	data, err := json.MarshalIndent(mb.items, "", "  ")
	mb.mu.RUnlock()
	if err != nil {
		return
	}

	_ = os.MkdirAll(filepath.Dir(mb.filePath), 0755)
	_ = os.WriteFile(mb.filePath, data, 0644)
}

func generateMailboxID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "mb_" + hex.EncodeToString(b)
}
