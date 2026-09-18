package clipboard

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fendy/lanx/internal/device"
)

func TestClipboardHandlers(t *testing.T) {
	registry := device.NewRegistry(nil)
	registry.SetHostDevice(&device.Device{
		ID:       "host-1",
		Name:     "Host PC",
		IP:       "192.168.1.10",
		Port:     8080,
		Online:   true,
		IsHost:   true,
		Platform: "desktop",
	})
	registry.AddOrUpdate(&device.Device{
		ID:        "browser-client-1",
		Name:      "Phone Browser",
		IP:        "192.168.1.20",
		Online:    true,
		IsBrowser: true,
		Platform:  "mobile",
	})

	var lastEvent string
	var lastData any
	handler := NewHandler(registry, "host-1", "Host PC", func(eventType string, data any) {
		lastEvent = eventType
		lastData = data
	})

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	t.Run("Send text to single device", func(t *testing.T) {
		reqBody, _ := json.Marshal(map[string]string{
			"text":             "Halo dunia",
			"target_device_id": "browser-client-1",
			"sender_name":      "Laptop A",
			"sender_id":        "laptop-a-id",
		})
		req := httptest.NewRequest("POST", "/api/text", bytes.NewReader(reqBody))
		w := httptest.NewRecorder()

		mux.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		if lastEvent != "text_received" {
			t.Fatalf("expected text_received event, got %s", lastEvent)
		}
		dataMap, ok := lastData.(map[string]any)
		if !ok {
			t.Fatalf("expected map data")
		}
		if dataMap["text"] != "Halo dunia" || dataMap["target_device_id"] != "browser-client-1" {
			t.Errorf("unexpected event data: %+v", dataMap)
		}
		if dataMap["from_device"] != "Laptop A" {
			t.Errorf("expected from_device Laptop A, got %v", dataMap["from_device"])
		}
	})

	t.Run("Send text to all devices", func(t *testing.T) {
		reqBody, _ := json.Marshal(map[string]string{
			"text":             "Pengumuman untuk semua",
			"target_device_id": "all",
			"sender_name":      "PC Kantor",
			"sender_id":        "pc-kantor-id",
		})
		req := httptest.NewRequest("POST", "/api/text", bytes.NewReader(reqBody))
		w := httptest.NewRecorder()

		mux.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		if lastEvent != "text_received" {
			t.Fatalf("expected text_received event, got %s", lastEvent)
		}
		dataMap, ok := lastData.(map[string]any)
		if !ok {
			t.Fatalf("expected map data")
		}
		if dataMap["text"] != "Pengumuman untuk semua" || dataMap["target_device_id"] != "all" {
			t.Errorf("unexpected event data: %+v", dataMap)
		}
		if dataMap["from_device"] != "PC Kantor" {
			t.Errorf("expected from_device PC Kantor, got %v", dataMap["from_device"])
		}
	})

	t.Run("Send clipboard to all devices", func(t *testing.T) {
		reqBody, _ := json.Marshal(map[string]string{
			"content":          "https://example.com/shared",
			"target_device_id": "all",
			"sender_name":      "PC Kantor",
			"sender_id":        "pc-kantor-id",
		})
		req := httptest.NewRequest("POST", "/api/clipboard", bytes.NewReader(reqBody))
		w := httptest.NewRecorder()

		mux.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		if lastEvent != "clipboard_received" {
			t.Fatalf("expected clipboard_received event, got %s", lastEvent)
		}
		dataMap, ok := lastData.(map[string]any)
		if !ok {
			t.Fatalf("expected map data")
		}
		if dataMap["content"] != "https://example.com/shared" || dataMap["target_device_id"] != "all" {
			t.Errorf("unexpected event data: %+v", dataMap)
		}
	})
}
