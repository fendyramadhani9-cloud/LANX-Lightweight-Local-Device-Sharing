package device

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestDeviceRegistryPersistence(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "devices.json")

	var lastEvent string
	var lastData any

	r1 := NewRegistry(dbPath, func(eventType string, data any) {
		lastEvent = eventType
		lastData = data
	})

	r1.SetHostDevice(&Device{
		ID:       "host-1",
		Name:     "Host Server",
		Online:   true,
		IsHost:   true,
		Platform: "desktop",
	})

	// Add a client device
	r1.AddOrUpdate(&Device{
		ID:        "client-1",
		Name:      "Samsung Phone",
		IP:        "192.168.1.50",
		Online:    true,
		IsBrowser: true,
		Platform:  "mobile",
	})

	if lastEvent != "device_online" {
		t.Fatalf("expected device_online, got %s", lastEvent)
	}

	// Rename client-1
	_, err := r1.UpdateProfile("client-1", "HP Fendy", "mobile")
	if err != nil {
		t.Fatalf("failed to update profile: %v", err)
	}

	if lastEvent != "device_update" {
		t.Fatalf("expected device_update, got %s", lastEvent)
	}
	devMap := lastData.(map[string]any)["device"].(*Device)
	if devMap.Name != "HP Fendy" || !devMap.CustomName {
		t.Errorf("expected HP Fendy with CustomName=true, got %+v", devMap)
	}

	// Simulate server restart by creating new Registry with same dbPath
	r2 := NewRegistry(dbPath, nil)

	// Loaded devices should be restored (offline until reconnected)
	dev, ok := r2.Get("client-1")
	if !ok {
		t.Fatal("device client-1 should have been loaded from disk")
	}
	if dev.Name != "HP Fendy" {
		t.Errorf("expected restored name HP Fendy, got %s", dev.Name)
	}
	if dev.Online {
		t.Errorf("expected device to start offline on reload")
	}

	// When device reconnects with original browser name, custom name must be preserved!
	r2.AddOrUpdate(&Device{
		ID:        "client-1",
		Name:      "Android Phone (Original UserAgent)",
		IP:        "192.168.1.50",
		Online:    true,
		IsBrowser: true,
		Platform:  "mobile",
	})

	devAfterReconnect, _ := r2.Get("client-1")
	if devAfterReconnect.Name != "HP Fendy" {
		t.Errorf("expected custom name 'HP Fendy' to be preserved, got %s", devAfterReconnect.Name)
	}
	if !devAfterReconnect.Online {
		t.Errorf("expected device to be online after reconnect")
	}
}

func TestDeviceAPIEndpoints(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "devices.json")

	r := NewRegistry(dbPath, nil)
	r.SetHostDevice(&Device{
		ID:       "host-1",
		Name:     "Host PC",
		Online:   true,
		IsHost:   true,
		Platform: "desktop",
	})
	r.AddOrUpdate(&Device{
		ID:        "dev-1",
		Name:      "Tablet",
		Online:    true,
		Platform:  "tablet",
	})

	mux := http.NewServeMux()
	r.RegisterRoutes(mux)

	t.Run("GET /api/devices", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/devices", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var list []*Device
		json.Unmarshal(w.Body.Bytes(), &list)
		if len(list) != 2 {
			t.Errorf("expected 2 devices, got %d", len(list))
		}
	})

	t.Run("PUT /api/devices/{id}", func(t *testing.T) {
		payload, _ := json.Marshal(map[string]string{
			"name":     "iPad Kantor",
			"platform": "tablet",
		})
		req := httptest.NewRequest("PUT", "/api/devices/dev-1", bytes.NewReader(payload))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var updated Device
		json.Unmarshal(w.Body.Bytes(), &updated)
		if updated.Name != "iPad Kantor" {
			t.Errorf("expected iPad Kantor, got %s", updated.Name)
		}
	})

	t.Run("POST /api/device/profile", func(t *testing.T) {
		payload, _ := json.Marshal(map[string]string{
			"id":       "dev-2",
			"name":     "Laptop Baru",
			"platform": "desktop",
		})
		req := httptest.NewRequest("POST", "/api/device/profile", bytes.NewReader(payload))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var dev Device
		json.Unmarshal(w.Body.Bytes(), &dev)
		if dev.Name != "Laptop Baru" || dev.ID != "dev-2" {
			t.Errorf("unexpected profile: %+v", dev)
		}
	})

	t.Run("DELETE /api/devices/{id}", func(t *testing.T) {
		req := httptest.NewRequest("DELETE", "/api/devices/dev-2", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		_, ok := r.Get("dev-2")
		if ok {
			t.Error("expected dev-2 to be deleted")
		}
	})
}
