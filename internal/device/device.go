package device

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Device represents a discovered LANX device on the network.
type Device struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	IP        string `json:"ip"`
	Port      int    `json:"port"`
	Version   string `json:"version,omitempty"`
	Online    bool   `json:"online"`
	LastSeen  int64  `json:"last_seen,omitempty"`
	IsBrowser bool   `json:"is_browser,omitempty"`
	Platform  string `json:"platform,omitempty"`
	IsHost    bool   `json:"is_host,omitempty"`
}

// Registry maintains a thread-safe map of discovered devices.
type Registry struct {
	mu         sync.RWMutex
	devices    map[string]*Device
	hostDevice *Device
	onEvent    func(eventType string, data any)
}

// NewRegistry creates a new device registry.
func NewRegistry(onEvent func(string, any)) *Registry {
	return &Registry{
		devices: make(map[string]*Device),
		onEvent: onEvent,
	}
}

// SetHostDevice sets the current host server as a visible device.
func (r *Registry) SetHostDevice(host *Device) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if host != nil {
		host.IsHost = true
		host.Online = true
		host.LastSeen = time.Now().UnixMilli()
	}
	r.hostDevice = host
}

// GetHostDevice returns the host device.
func (r *Registry) GetHostDevice() *Device {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.hostDevice
}

// AddOrUpdate adds a device or updates an existing one.
func (r *Registry) AddOrUpdate(d *Device) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	existing, found := r.devices[d.ID]
	d.Online = true
	d.LastSeen = time.Now().UnixMilli()
	r.devices[d.ID] = d

	if !found || !existing.Online {
		// New device or came back online
		if r.onEvent != nil {
			r.onEvent("device_online", map[string]any{"device": d})
		}
		return true
	}

	return false
}

// SetOffline marks a device as offline.
func (r *Registry) SetOffline(id string) {
	r.mu.Lock()
	d, ok := r.devices[id]
	if ok {
		d.Online = false
	}
	r.mu.Unlock()

	if ok && r.onEvent != nil {
		r.onEvent("device_offline", map[string]any{"device_id": id})
	}
}

// Remove deletes a device from the registry.
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	delete(r.devices, id)
	r.mu.Unlock()
}

// Get returns a device by ID.
func (r *Registry) Get(id string) (*Device, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.hostDevice != nil && r.hostDevice.ID == id {
		return r.hostDevice, true
	}
	d, ok := r.devices[id]
	return d, ok
}

// List returns all devices including the host device.
func (r *Registry) List() []*Device {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]*Device, 0, len(r.devices)+1)
	if r.hostDevice != nil {
		list = append(list, r.hostDevice)
	}
	for _, d := range r.devices {
		list = append(list, d)
	}
	return list
}

// OnlineDevices returns only online devices.
func (r *Registry) OnlineDevices() []*Device {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]*Device, 0, len(r.devices)+1)
	if r.hostDevice != nil && r.hostDevice.Online {
		list = append(list, r.hostDevice)
	}
	for _, d := range r.devices {
		if d.Online {
			list = append(list, d)
		}
	}
	return list
}

// RegisterRoutes registers device-related API routes.
func (r *Registry) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/devices", r.handleList)
}

func (r *Registry) handleList(w http.ResponseWriter, req *http.Request) {
	devices := r.List()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(devices)
}
