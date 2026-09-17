package websocket

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
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
	if host, _, err := net.SplitHostPort(remoteIP); err == nil {
		remoteIP = host
	}

	client := &Client{
		hub:  h,
		conn: conn,
		ip:   remoteIP,
	}

	h.register(client)
	defer h.unregister(client)

	client.readPump(r.Context())
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

func (h *Hub) register(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	deviceID := c.deviceID
	disconnectHook := h.onClientDisconnect
	h.mu.Unlock()

	c.conn.Close(ws.StatusNormalClosure, "")

	if deviceID != "" && disconnectHook != nil {
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
	mu       sync.Mutex
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

func (c *Client) send(data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := c.conn.Write(ctx, ws.MessageText, data); err != nil {
		// Client disconnected — will be cleaned up by readPump
	}
}

// RegisterRoutes registers the WebSocket endpoint.
func (h *Hub) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /ws", h.HandleWS)
}
