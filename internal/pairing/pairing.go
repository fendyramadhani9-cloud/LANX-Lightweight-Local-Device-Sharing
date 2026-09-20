package pairing

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fendy/lanx/internal/server"
	qrcode "github.com/skip2/go-qrcode"
)

const (
	TokenExpiry = 5 * time.Minute
	TokenLength = 32
)

// PairToken represents a pairing token with expiry.
type PairToken struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	DeviceID  string    `json:"device_id,omitempty"`
	DeviceName string   `json:"device_name,omitempty"`
	Accepted  *bool     `json:"accepted,omitempty"`
}

// Manager handles pairing tokens and QR code generation.
type Manager struct {
	mu          sync.RWMutex
	tokens      map[string]*PairToken
	paired      map[string]bool // device IDs that are paired
	port        int
	onPairEvent func(string, any)
}

// NewManager creates a new pairing manager.
func NewManager(port int, onEvent func(string, any)) *Manager {
	return &Manager{
		tokens:      make(map[string]*PairToken),
		paired:      make(map[string]bool),
		port:        port,
		onPairEvent: onEvent,
	}
}

// RegisterRoutes registers pairing endpoints.
func (m *Manager) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/pair/qr", m.handleQR)
	mux.HandleFunc("POST /api/pair", m.handlePair)
	mux.HandleFunc("GET /api/pair/pending", m.handlePending)
	mux.HandleFunc("POST /api/pair/respond", m.handleRespond)
}

func (m *Manager) handleQR(w http.ResponseWriter, r *http.Request) {
	// Generate new token
	token := m.generateToken()

	// Build pairing URL: prefer incoming Host header if it's an accessible LAN address
	hostPart := ""
	portPart := m.port
	if r.Host != "" {
		host, portStr, err := net.SplitHostPort(r.Host)
		if err == nil {
			if host != "localhost" && host != "127.0.0.1" && host != "::1" && !strings.HasPrefix(host, "169.254.") {
				hostPart = host
			}
			if p, err := strconv.Atoi(portStr); err == nil && p > 0 {
				portPart = p
			}
		} else {
			if r.Host != "localhost" && r.Host != "127.0.0.1" && r.Host != "::1" && !strings.HasPrefix(r.Host, "169.254.") {
				hostPart = r.Host
			}
		}
	}
	if hostPart == "" {
		hostPart = server.GetLocalIP()
	}

	pairURL := fmt.Sprintf("http://%s:%d/pair?token=%s", hostPart, portPart, token.Token)

	// Generate QR code
	png, err := qrcode.Encode(pairURL, qrcode.Medium, 256)
	if err != nil {
		http.Error(w, "Failed to generate QR code", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Write(png)
}

type pairRequest struct {
	Token      string `json:"token"`
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
}

func (m *Manager) handlePair(w http.ResponseWriter, r *http.Request) {
	var req pairRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}

	// Validate token
	m.mu.Lock()
	pt, ok := m.tokens[req.Token]
	if !ok || time.Now().After(pt.ExpiresAt) {
		m.mu.Unlock()
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
		return
	}

	// Store device info on the token for accept/reject
	pt.DeviceID = req.DeviceID
	pt.DeviceName = req.DeviceName
	m.mu.Unlock()

	// Notify via WebSocket
	if m.onPairEvent != nil {
		m.onPairEvent("pair_request", map[string]any{
			"token":       req.Token,
			"device_id":   req.DeviceID,
			"device_name": req.DeviceName,
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "pending"})
}

func (m *Manager) handlePending(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing token"})
		return
	}

	m.mu.RLock()
	pt, ok := m.tokens[token]
	var accepted *bool
	var expired bool
	if ok {
		expired = time.Now().After(pt.ExpiresAt)
		if pt.Accepted != nil {
			val := *pt.Accepted
			accepted = &val
		}
	}
	m.mu.RUnlock()

	if !ok || expired {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Token not found or expired"})
		return
	}

	if accepted == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "pending"})
		return
	}

	if *accepted {
		writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
	} else {
		writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
	}
}

type respondRequest struct {
	Token    string `json:"token"`
	Accepted bool   `json:"accepted"`
}

func (m *Manager) handleRespond(w http.ResponseWriter, r *http.Request) {
	var req respondRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}

	m.mu.Lock()
	pt, ok := m.tokens[req.Token]
	if !ok {
		m.mu.Unlock()
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Token not found"})
		return
	}

	pt.Accepted = &req.Accepted

	if req.Accepted && pt.DeviceID != "" {
		m.paired[pt.DeviceID] = true
	}
	m.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// IsPaired checks if a device is paired.
func (m *Manager) IsPaired(deviceID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.paired[deviceID]
}

func (m *Manager) generateToken() *PairToken {
	b := make([]byte, TokenLength)
	rand.Read(b)
	token := hex.EncodeToString(b)

	pt := &PairToken{
		Token:     token,
		ExpiresAt: time.Now().Add(TokenExpiry),
	}

	m.mu.Lock()
	m.tokens[token] = pt
	m.mu.Unlock()

	// Cleanup expired tokens
	go m.cleanup()

	return pt
}

func (m *Manager) cleanup() {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for k, v := range m.tokens {
		if now.After(v.ExpiresAt) {
			delete(m.tokens, k)
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
