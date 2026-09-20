package websocket

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	ws "github.com/coder/websocket"
)

// Message represents a WebSocket event message.
type Message struct {
	Type string `json:"type"`
	Data any    `json:"-"`
}

// InboundMessage represents a message received from a connected client.
type InboundMessage struct {
	Type     string `json:"type"`
	ID       string `json:"id,omitempty"`
	Name     string `json:"name,omitempty"`
	Platform string `json:"platform,omitempty"`
}

// Hub manages all WebSocket client connections.
type Hub struct {
	mu                 sync.RWMutex
	clients            map[*Client]struct{}
	logger             *log.Logger
	onClientRegister   func(id, name, platform, ip string)
	onClientDisconnect func(id string)
}

// NewHub creates a new WebSocket hub.
func NewHub(logger *log.Logger) *Hub {
	return &Hub{
		clients: make(map[*Client]struct{}),
		logger:  logger,
	}
}

// SetClientHooks sets callbacks for client registration and disconnect.
func (h *Hub) SetClientHooks(onRegister func(id, name, platform, ip string), onDisconnect func(id string)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.onClientRegister = onRegister
	h.onClientDisconnect = onDisconnect
}

// HandleWS is the HTTP handler for WebSocket upgrade.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := ws.Accept(w, r, &ws.AcceptOptions{
		InsecureSkipVerify: true, // Accept from any origin (LAN usage)
	})
	if err != nil {
		h.logger.Printf("WebSocket accept error: %v", err)
		return
	}

	remoteIP := r.RemoteAddr
	if cfIP := r.Header.Get("CF-Connecting-IP"); cfIP != "" {
		remoteIP = strings.TrimSpace(cfIP)
	} else if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		remoteIP = strings.TrimSpace(strings.Split(xff, ",")[0])
	} else if host, _, err := net.SplitHostPort(remoteIP); err == nil {
		remoteIP = host
	}

	client := &Client{
		hub:    h,
		conn:   conn,
		ip:     remoteIP,
		sendCh: make(chan []byte, 128),
	}

	h.register(client)
	defer h.unregister(client)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go client.writePump(ctx)
	client.readPump(ctx)
}

// Broadcast sends a message to all connected clients.
func (h *Hub) Broadcast(msgType string, data any) {
	payload := make(map[string]any)

	// If data is a map, merge it
	if m, ok := data.(map[string]any); ok {
		for k, v := range m {
			payload[k] = v
		}
	} else {
		payload["data"] = data
	}
	payload["type"] = msgType

	jsonData, err := json.Marshal(payload)
	if err != nil {
		h.logger.Printf("Failed to marshal broadcast: %v", err)
		return
	}

	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		c.send(jsonData)
	}
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// IsDeviceOnline checks if a device with deviceID is currently connected.
func (h *Hub) IsDeviceOnline(deviceID string) bool {
	if deviceID == "" || deviceID == "all" {
		return true
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.deviceID == deviceID {
			return true
		}
	}
	return false
}

// SendToDevice sends a message specifically to a client with the given deviceID.
func (h *Hub) SendToDevice(deviceID string, msgType string, data any) bool {
	payload := make(map[string]any)
	if m, ok := data.(map[string]any); ok {
		for k, v := range m {
			payload[k] = v
		}
	} else {
		payload["data"] = data
	}
	payload["type"] = msgType

	jsonData, err := json.Marshal(payload)
	if err != nil {
		h.logger.Printf("Failed to marshal message to device: %v", err)
		return false
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	sent := false
	for c := range h.clients {
		if c.deviceID == deviceID {
			c.send(jsonData)
			sent = true
		}
	}
	return sent
}

func (h *Hub) register(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	if _, exists := h.clients[c]; !exists {
		h.mu.Unlock()
		return
	}
	delete(h.clients, c)
	deviceID := c.deviceID
	disconnectHook := h.onClientDisconnect

	stillConnected := false
	if deviceID != "" {
		for other := range h.clients {
			if other.deviceID == deviceID {
				stillConnected = true
				break
			}
		}
	}
	h.mu.Unlock()

	c.conn.Close(ws.StatusNormalClosure, "")

	if deviceID != "" && disconnectHook != nil && !stillConnected {
		disconnectHook(deviceID)
	}
}

func (h *Hub) handleMessage(c *Client, msg InboundMessage) {
	switch msg.Type {
	case "register", "client_hello":
		if msg.ID != "" {
			c.deviceID = msg.ID
			h.mu.RLock()
			registerHook := h.onClientRegister
			h.mu.RUnlock()

			if registerHook != nil {
				name := msg.Name
				if name == "" {
					name = "Web Client"
				}
				registerHook(msg.ID, name, msg.Platform, c.ip)
			}
		}
	case "ping":
		c.send([]byte(`{"type":"pong"}`))
	}
}

// Client represents a single WebSocket connection.
type Client struct {
	hub      *Hub
	conn     *ws.Conn
	deviceID string
	ip       string
	sendCh   chan []byte
}

func (c *Client) readPump(ctx context.Context) {
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			return
		}

		var msg InboundMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			c.hub.handleMessage(c, msg)
		}
	}
}

func (c *Client) writePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-c.sendCh:
			if !ok {
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			err := c.conn.Write(writeCtx, ws.MessageText, data)
			cancel()
			if err != nil {
				c.conn.Close(ws.StatusNormalClosure, "write error")
				return
			}
		}
	}
}

func (c *Client) send(data []byte) {
	select {
	case c.sendCh <- data:
	default:
		// Queue full (slow client), drop message to prevent blocking the hub
	}
}

// RegisterRoutes registers the WebSocket endpoint.
func (h *Hub) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /ws", h.HandleWS)
}
