package device

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Device represents a LANX device profile on the network.
type Device struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CustomName bool   `json:"custom_name,omitempty"`
	IP         string `json:"ip"`
	Port       int    `json:"port"`
	Version    string `json:"version,omitempty"`
	Online     bool   `json:"online"`
	FirstSeen  int64  `json:"first_seen,omitempty"`
	LastSeen   int64  `json:"last_seen,omitempty"`
	IsBrowser  bool   `json:"is_browser,omitempty"`
	Platform   string `json:"platform,omitempty"`
	IsHost     bool   `json:"is_host,omitempty"`
}

// Registry maintains a thread-safe, persistent database of devices.
type Registry struct {
	mu          sync.RWMutex
	devices     map[string]*Device
	hostDevice  *Device
	storagePath string
	onEvent     func(eventType string, data any)
}

// NewRegistry creates a new device registry with optional persistent storage path.
func NewRegistry(storagePath string, onEvent func(string, any)) *Registry {
	r := &Registry{
		devices:     make(map[string]*Device),
		storagePath: storagePath,
		onEvent:     onEvent,
	}

	if storagePath != "" {
		_ = r.loadFromDisk()
	}

	return r
}

// SetHostDevice sets the current host server as a visible device.
func (r *Registry) SetHostDevice(host *Device) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if host != nil {
		host.IsHost = true
		host.Online = true
		if host.FirstSeen == 0 {
			host.FirstSeen = time.Now().UnixMilli()
		}
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

// AddOrUpdate adds a device or updates an existing one, preserving custom names.
func (r *Registry) AddOrUpdate(d *Device) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UnixMilli()
	existing, found := r.devices[d.ID]

	if found {
		// Preserve custom name if user customized it previously
		if existing.CustomName && !d.CustomName {
			d.Name = existing.Name
			d.CustomName = true
		}
		if existing.FirstSeen > 0 {
			d.FirstSeen = existing.FirstSeen
		}
	}

	if d.FirstSeen == 0 {
		d.FirstSeen = now
	}
	d.Online = true
	d.LastSeen = now
	r.devices[d.ID] = d

	_ = r.saveToDiskLocked()

	if !found || !existing.Online {
		// New device or came back online
		if r.onEvent != nil {
			r.onEvent("device_online", map[string]any{"device": d})
		}
		return true
	}

	// If device details changed, notify update
	if r.onEvent != nil {
		r.onEvent("device_update", map[string]any{"device": d})
	}

	return false
}

// SetOffline marks a device as offline and updates the database.
func (r *Registry) SetOffline(id string) {
	r.mu.Lock()
	d, ok := r.devices[id]
	if ok {
		d.Online = false
		d.LastSeen = time.Now().UnixMilli()
		_ = r.saveToDiskLocked()
	}
	r.mu.Unlock()

	if ok && r.onEvent != nil {
		r.onEvent("device_offline", map[string]any{"device_id": id})
	}
}

// UpdateProfile updates the device's name and/or platform in the database.
func (r *Registry) UpdateProfile(id, name, platform string) (*Device, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("device name cannot be empty")
	}
	if len(name) > 64 {
		return nil, fmt.Errorf("device name too long (max 64 chars)")
	}

	var target *Device

	if r.hostDevice != nil && r.hostDevice.ID == id {
		r.hostDevice.Name = name
		r.hostDevice.CustomName = true
		if platform != "" {
			r.hostDevice.Platform = platform
		}
		target = r.hostDevice
	} else if d, ok := r.devices[id]; ok {
		d.Name = name
		d.CustomName = true
		if platform != "" {
			d.Platform = platform
		}
		d.LastSeen = time.Now().UnixMilli()
		target = d
		_ = r.saveToDiskLocked()
	} else {
		// New device entry
		d := &Device{
			ID:         id,
			Name:       name,
			CustomName: true,
			Platform:   platform,
			Online:     true,
			FirstSeen:  time.Now().UnixMilli(),
			LastSeen:   time.Now().UnixMilli(),
		}
		r.devices[id] = d
		target = d
		_ = r.saveToDiskLocked()
	}

	if r.onEvent != nil {
		r.onEvent("device_update", map[string]any{"device": target})
	}

	return target, nil
}

// Remove deletes a device from the database and memory.
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	delete(r.devices, id)
	_ = r.saveToDiskLocked()
	r.mu.Unlock()

	if r.onEvent != nil {
		r.onEvent("device_offline", map[string]any{"device_id": id})
	}
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

// loadFromDisk loads saved device profiles from disk.
func (r *Registry) loadFromDisk() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.storagePath == "" {
		return nil
	}

	data, err := os.ReadFile(r.storagePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var saved []*Device
	if err := json.Unmarshal(data, &saved); err != nil {
		return err
	}

	for _, d := range saved {
		d.Online = false // Mark offline on server startup until they reconnect
		r.devices[d.ID] = d
	}

	return nil
}

// saveToDiskLocked writes the device list to disk while mu is held.
func (r *Registry) saveToDiskLocked() error {
	if r.storagePath == "" {
		return nil
	}

	list := make([]*Device, 0, len(r.devices))
	for _, d := range r.devices {
		list = append(list, d)
	}

	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}

	dir := filepath.Dir(r.storagePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// Write atomically via temporary file
	tmpFile := fmt.Sprintf("%s.tmp", r.storagePath)
	if err := os.WriteFile(tmpFile, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpFile, r.storagePath)
}

// RegisterRoutes registers device-related API routes.
func (r *Registry) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/devices", r.handleList)
	mux.HandleFunc("GET /api/devices/{id}", r.handleGet)
	mux.HandleFunc("PUT /api/devices/{id}", r.handleUpdateDeviceProfile)
	mux.HandleFunc("DELETE /api/devices/{id}", r.handleDeleteDevice)
	mux.HandleFunc("POST /api/device/profile", r.handleSelfProfile)
}

func (r *Registry) handleList(w http.ResponseWriter, req *http.Request) {
	devices := r.List()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(devices)
}

func (r *Registry) handleGet(w http.ResponseWriter, req *http.Request) {
	id := req.PathValue("id")
	dev, ok := r.Get(id)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Device not found"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dev)
}

type updateProfilePayload struct {
	Name     string `json:"name"`
	Platform string `json:"platform,omitempty"`
}

func (r *Registry) handleUpdateDeviceProfile(w http.ResponseWriter, req *http.Request) {
	id := req.PathValue("id")
	if id == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Missing device ID"})
		return
	}

	var payload updateProfilePayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request body"})
		return
	}

	updated, err := r.UpdateProfile(id, payload.Name, payload.Platform)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

type selfProfilePayload struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Platform string `json:"platform,omitempty"`
}

func (r *Registry) handleSelfProfile(w http.ResponseWriter, req *http.Request) {
	var payload selfProfilePayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request body"})
		return
	}

	if payload.ID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Missing client ID"})
		return
	}

	updated, err := r.UpdateProfile(payload.ID, payload.Name, payload.Platform)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (r *Registry) handleDeleteDevice(w http.ResponseWriter, req *http.Request) {
	id := req.PathValue("id")
	if id == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Missing device ID"})
		return
	}

	r.Remove(id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}
