package transfer

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "normal filename",
			input:    "project.zip",
			expected: "project.zip",
		},
		{
			name:     "path traversal unix",
			input:    "../../../../etc/passwd",
			expected: "passwd",
		},
		{
			name:     "path traversal windows",
			input:    `..\..\..\..\windows\system32\config`,
			expected: "config",
		},
		{
			name:     "absolute path unix",
			input:    "/etc/passwd",
			expected: "passwd",
		},
		{
			name:     "absolute path windows",
			input:    `C:\Users\test\file.txt`,
			expected: "file.txt",
		},
		{
			name:     "hidden file",
			input:    ".env",
			expected: "env",
		},
		{
			name:     "special characters",
			input:    "file<>|?*.txt",
			expected: "file_____.txt",
		},
		{
			name:     "empty after sanitization",
			input:    "...",
			expected: "",
		},
		{
			name:     "unicode filename",
			input:    "文件.pdf",
			expected: "文件.pdf",
		},
		{
			name:     "spaces in name",
			input:    "my file (1).doc",
			expected: "my file (1).doc",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeFilename(tt.input)
			if result != tt.expected {
				t.Errorf("sanitizeFilename(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestGenerateTransferID(t *testing.T) {
	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := generateTransferID()
		if id == "" {
			t.Fatal("generated empty transfer ID")
		}
		if ids[id] {
			t.Fatalf("duplicate transfer ID: %s", id)
		}
		ids[id] = true
	}
}

func TestTransferManager(t *testing.T) {
	var lastUpdate *Transfer
	mgr := NewManager(func(tr *Transfer) {
		lastUpdate = tr
	})

	// Create transfer
	tr := mgr.Create("test.zip", 1000, "received", "Device A", "dev-1")
	if tr.ID == "" {
		t.Fatal("transfer ID should not be empty")
	}
	if tr.Status != StatusPreparing {
		t.Errorf("initial status = %s, want preparing", tr.Status)
	}

	// Update progress
	mgr.UpdateProgress(tr.ID, 500)
	got, ok := mgr.Get(tr.ID)
	if !ok {
		t.Fatal("transfer should exist")
	}
	if got.Loaded != 500 {
		t.Errorf("loaded = %d, want 500", got.Loaded)
	}
	if got.Percentage != 50 {
		t.Errorf("percentage = %f, want 50", got.Percentage)
	}
	if got.Status != StatusTransferring {
		t.Errorf("status = %s, want transferring", got.Status)
	}
	if lastUpdate == nil {
		t.Fatal("onUpdate should have been called")
	}

	// Complete transfer
	mgr.Complete(tr.ID, "dl-123")
	_, ok = mgr.Get(tr.ID)
	if ok {
		t.Error("completed transfer should not be in active map")
	}
	history := mgr.History()
	if len(history) != 1 {
		t.Fatalf("history length = %d, want 1", len(history))
	}
	if history[0].Status != StatusCompleted {
		t.Errorf("history status = %s, want completed", history[0].Status)
	}
	if history[0].DownloadID != "dl-123" {
		t.Errorf("download ID = %s, want dl-123", history[0].DownloadID)
	}
}

func TestTransferManagerFail(t *testing.T) {
	mgr := NewManager(nil)

	tr := mgr.Create("fail.zip", 500, "sent", "Device B", "dev-2")
	mgr.Fail(tr.ID, "connection lost")

	_, ok := mgr.Get(tr.ID)
	if ok {
		t.Error("failed transfer should not be in active map")
	}

	history := mgr.History()
	if len(history) != 1 {
		t.Fatalf("history length = %d, want 1", len(history))
	}
	if history[0].Status != StatusFailed {
		t.Errorf("status = %s, want failed", history[0].Status)
	}
	if history[0].Error != "connection lost" {
		t.Errorf("error = %q, want 'connection lost'", history[0].Error)
	}
}

func TestHistoryMaxLimit(t *testing.T) {
	mgr := NewManager(nil)

	for i := 0; i < 60; i++ {
		tr := mgr.Create("file.txt", 100, "sent", "dev", "id")
		mgr.Complete(tr.ID, "")
	}

	history := mgr.History()
	if len(history) > 50 {
		t.Errorf("history length = %d, should not exceed 50", len(history))
	}
}

func TestUploadBroadcastHandler(t *testing.T) {
	tempDir := t.TempDir()
	var lastEvent string
	var lastData any

	mgr := NewManager(nil)
	handler := NewHandler(mgr, tempDir, func(eventType string, data any) {
		lastEvent = eventType
		lastData = data
	})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "catatan.txt")
	if err != nil {
		t.Fatal(err)
	}
	part.Write([]byte("isi catatan penting"))
	writer.WriteField("target_device_id", "all")
	writer.WriteField("transfer_id", "tf-test-123")
	writer.WriteField("sender_id", "pc-a-id")
	writer.WriteField("sender_name", "PC A")
	writer.Close()

	req := httptest.NewRequest("POST", "/api/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	if lastEvent != "transfer_complete" {
		t.Fatalf("expected transfer_complete, got %s", lastEvent)
	}
	dataMap, ok := lastData.(map[string]any)
	if !ok {
		t.Fatalf("expected map data")
	}
	if dataMap["target_device_id"] != "all" {
		t.Errorf("expected target_device_id 'all', got %v", dataMap["target_device_id"])
	}
	if dataMap["sender_id"] != "pc-a-id" || dataMap["from_device"] != "PC A" {
		t.Errorf("expected sender pc-a-id / PC A, got %+v", dataMap)
	}
}

func TestUploadFolderHandler(t *testing.T) {
	tempDir := t.TempDir()
	var lastEvent string
	var lastData any

	mgr := NewManager(nil)
	handler := NewHandler(mgr, tempDir, func(eventType string, data any) {
		lastEvent = eventType
		lastData = data
	})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("folder_name", "MyProject")
	writer.WriteField("target_device_id", "dev-pc")
	writer.WriteField("transfer_id", "tf-folder-1")
	writer.WriteField("sender_id", "hp-1")
	writer.WriteField("sender_name", "HP User")

	writer.WriteField("paths", "MyProject/main.go")
	p1, err := writer.CreateFormFile("files", "main.go")
	if err != nil {
		t.Fatal(err)
	}
	p1.Write([]byte("package main\nfunc main() {}"))

	writer.WriteField("paths", "MyProject/sub/notes.txt")
	p2, err := writer.CreateFormFile("files", "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	p2.Write([]byte("catatan proyek"))
	writer.Close()

	req := httptest.NewRequest("POST", "/api/upload-folder", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	if lastEvent != "transfer_complete" {
		t.Fatalf("expected transfer_complete, got %s", lastEvent)
	}
	dataMap, ok := lastData.(map[string]any)
	if !ok {
		t.Fatalf("expected map data")
	}
	if dataMap["filename"] != "MyProject.zip" {
		t.Errorf("expected MyProject.zip, got %v", dataMap["filename"])
	}
}

func TestDownloadPreviewHandler(t *testing.T) {
	tempDir := t.TempDir()
	mgr := NewManager(nil)
	handler := NewHandler(mgr, tempDir, nil)

	// Add image and txt to file store
	imgPath := tempDir + "/test_img.png"
	txtPath := tempDir + "/test_doc.txt"
	_ = bytes.NewBuffer(nil) // dummy
	if err := os.WriteFile(imgPath, []byte("fake png content"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(txtPath, []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}

	imgID := handler.store.Add("test_img.png", imgPath, 16)
	txtID := handler.store.Add("test_doc.txt", txtPath, 11)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// Test regular download (attachment)
	reqDl := httptest.NewRequest("GET", "/api/download/"+imgID, nil)
	wDl := httptest.NewRecorder()
	mux.ServeHTTP(wDl, reqDl)
	if wDl.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", wDl.Code)
	}
	if disp := wDl.Header().Get("Content-Disposition"); !bytes.Contains([]byte(disp), []byte("attachment")) {
		t.Errorf("expected attachment Content-Disposition, got %s", disp)
	}
	if ctype := wDl.Header().Get("Content-Type"); ctype != "image/png" {
		t.Errorf("expected image/png, got %s", ctype)
	}

	// Test preview download (inline)
	reqPrev := httptest.NewRequest("GET", "/api/download/"+imgID+"?preview=1", nil)
	wPrev := httptest.NewRecorder()
	mux.ServeHTTP(wPrev, reqPrev)
	if wPrev.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", wPrev.Code)
	}
	if disp := wPrev.Header().Get("Content-Disposition"); !bytes.Contains([]byte(disp), []byte("inline")) {
		t.Errorf("expected inline Content-Disposition, got %s", disp)
	}

	// Test text preview
	reqTxt := httptest.NewRequest("GET", "/api/download/"+txtID+"?preview=1", nil)
	wTxt := httptest.NewRecorder()
	mux.ServeHTTP(wTxt, reqTxt)
	if wTxt.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", wTxt.Code)
	}
	if ctype := wTxt.Header().Get("Content-Type"); !bytes.Contains([]byte(ctype), []byte("text/plain")) {
		t.Errorf("expected text/plain, got %s", ctype)
	}
}

