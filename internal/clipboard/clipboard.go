package clipboard

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/fendy/lanx/internal/device"
)

const (
	MaxTextSize = 1 << 20 // 1 MB max text size
)

// Handler manages text and clipboard sharing endpoints.
type Handler struct {
	registry   *device.Registry
	deviceID   string
	deviceName string
	onEvent    func(string, any)
}

// NewHandler creates a new clipboard/text handler.
func NewHandler(registry *device.Registry, deviceID, deviceName string, onEvent func(string, any)) *Handler {
	return &Handler{
		registry:   registry,
		deviceID:   deviceID,
		deviceName: deviceName,
		onEvent:    onEvent,
	}
}

// RegisterRoutes registers text and clipboard endpoints.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/text", h.handleSendText)
	mux.HandleFunc("POST /api/clipboard", h.handleSendClipboard)

	// Receive endpoints (called by peer devices)
	mux.HandleFunc("POST /api/receive/text", h.handleReceiveText)
	mux.HandleFunc("POST /api/receive/clipboard", h.handleReceiveClipboard)
}

// --- Send Text ---

type sendTextRequest struct {
	Text           string `json:"text"`
	TargetDeviceID string `json:"target_device_id"`
	SenderID       string `json:"sender_id,omitempty"`
	SenderName     string `json:"sender_name,omitempty"`
}

func (h *Handler) handleSendText(w http.ResponseWriter, r *http.Request) {
	var req sendTextRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, MaxTextSize)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}

	text := strings.TrimSpace(req.Text)
	if text == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Text cannot be empty"})
		return
	}

	fromDevice := h.deviceName
	if strings.TrimSpace(req.SenderName) != "" {
		fromDevice = strings.TrimSpace(req.SenderName)
	}
	fromID := h.deviceID
	if strings.TrimSpace(req.SenderID) != "" {
		fromID = strings.TrimSpace(req.SenderID)
	}

	// Handle All Devices (broadcast)
	if req.TargetDeviceID == "all" || req.TargetDeviceID == "*" {
		if h.onEvent != nil {
			h.onEvent("text_received", map[string]any{
				"target_device_id": "all",
				"text":             text,
				"from_device":      fromDevice,
				"from_id":          fromID,
			})
		}

		// Also forward to online standalone peer devices (not browser, not local host)
		for _, d := range h.registry.OnlineDevices() {
			if !d.IsBrowser && !d.IsHost && d.ID != fromID {
				go func(peer *device.Device) {
					_ = h.forwardToDevice(peer, "/api/receive/text", map[string]any{
						"text":        text,
						"from_device": fromDevice,
						"from_id":     fromID,
					})
				}(d)
			}
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "target": "all"})
		return
	}

	// Find target device
	dev, ok := h.registry.Get(req.TargetDeviceID)
	if !ok || !dev.Online {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Device not found or offline"})
		return
	}

	// If target device is a web browser client or the host itself, broadcast via WebSocket
	if dev.IsBrowser || dev.IsHost {
		if h.onEvent != nil {
			h.onEvent("text_received", map[string]any{
				"target_device_id": req.TargetDeviceID,
				"text":             text,
				"from_device":      fromDevice,
				"from_id":          fromID,
			})
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
		return
	}

	// Forward to standalone peer device HTTP server
	err := h.forwardToDevice(dev, "/api/receive/text", map[string]any{
		"text":        text,
		"from_device": fromDevice,
		"from_id":     fromID,
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Failed to send to device"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

// --- Send Clipboard ---

type sendClipboardRequest struct {
	Content        string `json:"content"`
	TargetDeviceID string `json:"target_device_id"`
	SenderID       string `json:"sender_id,omitempty"`
	SenderName     string `json:"sender_name,omitempty"`
}

func (h *Handler) handleSendClipboard(w http.ResponseWriter, r *http.Request) {
	var req sendClipboardRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, MaxTextSize)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Content cannot be empty"})
		return
	}

	fromDevice := h.deviceName
	if strings.TrimSpace(req.SenderName) != "" {
		fromDevice = strings.TrimSpace(req.SenderName)
	}
	fromID := h.deviceID
	if strings.TrimSpace(req.SenderID) != "" {
		fromID = strings.TrimSpace(req.SenderID)
	}

	// Handle All Devices (broadcast)
	if req.TargetDeviceID == "all" || req.TargetDeviceID == "*" {
		if h.onEvent != nil {
			h.onEvent("clipboard_received", map[string]any{
				"target_device_id": "all",
				"content":          content,
				"from_device":      fromDevice,
				"from_id":          fromID,
			})
		}

		for _, d := range h.registry.OnlineDevices() {
			if !d.IsBrowser && !d.IsHost && d.ID != fromID {
				go func(peer *device.Device) {
					_ = h.forwardToDevice(peer, "/api/receive/clipboard", map[string]any{
						"content":     content,
						"from_device": fromDevice,
						"from_id":     fromID,
					})
				}(d)
			}
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "target": "all"})
		return
	}

	dev, ok := h.registry.Get(req.TargetDeviceID)
	if !ok || !dev.Online {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Device not found or offline"})
		return
	}

	// If target device is a web browser client or the host itself, broadcast via WebSocket
	if dev.IsBrowser || dev.IsHost {
		if h.onEvent != nil {
			h.onEvent("clipboard_received", map[string]any{
				"target_device_id": req.TargetDeviceID,
				"content":          content,
				"from_device":      fromDevice,
				"from_id":          fromID,
			})
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
		return
	}

	err := h.forwardToDevice(dev, "/api/receive/clipboard", map[string]any{
		"content":     content,
		"from_device": fromDevice,
		"from_id":     fromID,
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Failed to send to device"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

// --- Receive Endpoints (called by peer devices) ---

type receiveTextPayload struct {
	Text       string `json:"text"`
	FromDevice string `json:"from_device"`
	FromID     string `json:"from_id"`
}

func (h *Handler) handleReceiveText(w http.ResponseWriter, r *http.Request) {
	var payload receiveTextPayload
	if err := json.NewDecoder(io.LimitReader(r.Body, MaxTextSize)).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}

	// Broadcast to local WebSocket clients
	if h.onEvent != nil {
		h.onEvent("text_received", map[string]any{
			"text":        payload.Text,
			"from_device": payload.FromDevice,
			"from_id":     payload.FromID,
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "received"})
}

type receiveClipboardPayload struct {
	Content    string `json:"content"`
	FromDevice string `json:"from_device"`
	FromID     string `json:"from_id"`
}

func (h *Handler) handleReceiveClipboard(w http.ResponseWriter, r *http.Request) {
	var payload receiveClipboardPayload
	if err := json.NewDecoder(io.LimitReader(r.Body, MaxTextSize)).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}

	if h.onEvent != nil {
		h.onEvent("clipboard_received", map[string]any{
			"content":     payload.Content,
			"from_device": payload.FromDevice,
			"from_id":     payload.FromID,
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "received"})
}

// --- Forward to peer device ---

func (h *Handler) forwardToDevice(dev *device.Device, path string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("http://%s%s", net.JoinHostPort(dev.IP, fmt.Sprintf("%d", dev.Port)), path)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("peer returned status %d", resp.StatusCode)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
