package library

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fendy/lanx/internal/config"
)

func TestLibraryManagerBasics(t *testing.T) {
	tempDir := t.TempDir()
	storagePath := filepath.Join(tempDir, "library.json")
	libDir := filepath.Join(tempDir, "files")

	mgr := NewManager(storagePath, libDir, nil)

	// Test AddItem
	item := &LibraryItem{
		Filename:     "test_doc.pdf",
		Path:         filepath.Join(libDir, "test_doc.pdf"),
		Size:         1024,
		Description:  "Tugas pertemuan 1",
		UploaderName: "Fendy",
		UploaderID:   "dev_123",
		DeleteToken:  "token_abc",
		ExpiresAt:    time.Now().Add(7 * 24 * time.Hour).UnixMilli(),
		Status:       StatusApproved,
	}

	_ = os.WriteFile(item.Path, []byte("dummy pdf content"), 0644)

	if err := mgr.AddItem(item); err != nil {
		t.Fatalf("AddItem failed: %v", err)
	}

	// Verify Get
	fetched, ok := mgr.Get(item.ID)
	if !ok || fetched.Filename != "test_doc.pdf" {
		t.Fatalf("Expected item to be fetched correctly, got: %+v", fetched)
	}

	// Test Search in ListApproved
	approved := mgr.ListApproved("pertemuan")
	if len(approved) != 1 {
		t.Fatalf("Expected 1 approved item matching search, got %d", len(approved))
	}

	// Test Increment Download
	mgr.IncrementDownload(item.ID)
	fetchedAfter, _ := mgr.Get(item.ID)
	if fetchedAfter.DownloadCount != 1 {
		t.Fatalf("Expected DownloadCount 1, got %d", fetchedAfter.DownloadCount)
	}

	// Test Storage Used
	usedBytes, count := mgr.GetTotalStorageUsed()
	if usedBytes != 1024 || count != 1 {
		t.Fatalf("Expected 1024 bytes and count 1, got %d and %d", usedBytes, count)
	}

	// Test Delete unauthorized token
	if err := mgr.Delete(item.ID, "wrong_token", false); err == nil {
		t.Fatal("Expected error deleting with wrong token, got nil")
	}

	// Test Delete with valid token
	if err := mgr.Delete(item.ID, "token_abc", false); err != nil {
		t.Fatalf("Failed to delete with valid token: %v", err)
	}

	if _, ok := mgr.Get(item.ID); ok {
		t.Fatal("Expected item to be deleted from manager")
	}
}

func TestLibraryApprovalWorkflow(t *testing.T) {
	tempDir := t.TempDir()
	storagePath := filepath.Join(tempDir, "library.json")
	libDir := filepath.Join(tempDir, "files")

	mgr := NewManager(storagePath, libDir, nil)

	item := &LibraryItem{
		Filename:     "large_video.mp4",
		Path:         filepath.Join(libDir, "large_video.mp4"),
		Size:         60 << 20, // 60 MB
		Description:  "Video rekaman besar",
		UploaderName: "Siswa A",
		Status:       StatusPendingApproval,
	}

	_ = os.WriteFile(item.Path, []byte("fake video content"), 0644)
	if err := mgr.AddItem(item); err != nil {
		t.Fatalf("AddItem failed: %v", err)
	}

	// Should not be in approved list
	if len(mgr.ListApproved("")) != 0 {
		t.Fatalf("Expected 0 approved items, got %d", len(mgr.ListApproved("")))
	}

	// Should be in pending list
	pending := mgr.ListPending()
	if len(pending) != 1 || pending[0].ID != item.ID {
		t.Fatalf("Expected 1 pending item, got %d", len(pending))
	}

	// Approve item
	approvedItem, err := mgr.Approve(item.ID)
	if err != nil || approvedItem.Status != StatusApproved {
		t.Fatalf("Approve failed: %v", err)
	}

	if len(mgr.ListApproved("")) != 1 {
		t.Fatalf("Expected 1 approved item after approval, got %d", len(mgr.ListApproved("")))
	}
}

func TestLibraryExpiration(t *testing.T) {
	tempDir := t.TempDir()
	storagePath := filepath.Join(tempDir, "library.json")
	libDir := filepath.Join(tempDir, "files")

	mgr := NewManager(storagePath, libDir, nil)

	// Add item already expired
	filePath := filepath.Join(libDir, "expired.txt")
	_ = os.WriteFile(filePath, []byte("expired"), 0644)

	item := &LibraryItem{
		Filename:  "expired.txt",
		Path:      filePath,
		Size:      7,
		ExpiresAt: time.Now().Add(-1 * time.Hour).UnixMilli(),
		Status:    StatusApproved,
	}

	_ = mgr.AddItem(item)

	cleaned := mgr.CleanExpired()
	if cleaned != 1 {
		t.Fatalf("Expected 1 cleaned item, got %d", cleaned)
	}

	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatal("Expected physical file to be removed upon expiration")
	}
}

func TestLibraryHTTPHandlers(t *testing.T) {
	tempDir := t.TempDir()
	cfg, err := config.Load(tempDir)
	if err != nil {
		t.Fatalf("config.Load failed: %v", err)
	}

	cfg.AdminPIN = "123456"
	cfg.LibraryQuotaBytes = 100 << 20    // 100 MB
	cfg.ApprovalThresholdBytes = 10 << 20 // 10 MB

	libDBPath := filepath.Join(tempDir, "library.json")
	mgr := NewManager(libDBPath, cfg.GetLibraryPath(), nil)
	handler := NewHandler(mgr, cfg, cfg.GetLibraryPath())

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// 1. Upload small file (< 10 MB) -> StatusApproved
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("file", "catatan.txt")
	part.Write([]byte("Ini isi catatan tugas kimia"))
	writer.WriteField("description", "Tugas kimia bab 3")
	writer.WriteField("uploader_name", "Budi")
	writer.WriteField("expiry_days", "7")
	writer.Close()

	req := httptest.NewRequest("POST", "/api/library/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Upload failed with status %d: %s", rec.Code, rec.Body.String())
	}

	var uploadResp struct {
		Item              *LibraryItem `json:"item"`
		DeleteToken       string       `json:"delete_token"`
		IsPendingApproval bool         `json:"is_pending_approval"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&uploadResp); err != nil {
		t.Fatalf("Failed to decode upload response: %v", err)
	}

	if uploadResp.IsPendingApproval {
		t.Fatal("Expected small file to be approved immediately")
	}
	if uploadResp.Item.Description != "Tugas kimia bab 3" {
		t.Fatalf("Expected description 'Tugas kimia bab 3', got '%s'", uploadResp.Item.Description)
	}
	if uploadResp.DeleteToken == "" {
		t.Fatal("Expected delete_token in upload response")
	}

	// 2. Download endpoint
	dlReq := httptest.NewRequest("GET", "/api/library/download/"+uploadResp.Item.ID, nil)
	dlRec := httptest.NewRecorder()
	mux.ServeHTTP(dlRec, dlReq)

	if dlRec.Code != http.StatusOK {
		t.Fatalf("Download failed with status %d", dlRec.Code)
	}
	if dlRec.Body.String() != "Ini isi catatan tugas kimia" {
		t.Fatalf("Downloaded content mismatch: %s", dlRec.Body.String())
	}

	// 3. Stats endpoint
	statsReq := httptest.NewRequest("GET", "/api/library/stats", nil)
	statsRec := httptest.NewRecorder()
	mux.ServeHTTP(statsRec, statsReq)

	if statsRec.Code != http.StatusOK {
		t.Fatalf("Stats endpoint failed: %d", statsRec.Code)
	}

	// 4. Delete endpoint with delete_token
	delPayload, _ := json.Marshal(map[string]string{
		"id":    uploadResp.Item.ID,
		"token": uploadResp.DeleteToken,
	})
	delReq := httptest.NewRequest("POST", "/api/library/delete", bytes.NewReader(delPayload))
	delReq.Header.Set("Content-Type", "application/json")
	delRec := httptest.NewRecorder()
	mux.ServeHTTP(delRec, delReq)

	if delRec.Code != http.StatusOK {
		t.Fatalf("Delete failed with status %d: %s", delRec.Code, delRec.Body.String())
	}
}

func TestLibraryFoldersAndClear(t *testing.T) {
	tempDir := t.TempDir()
	storagePath := filepath.Join(tempDir, "library.json")
	libDir := filepath.Join(tempDir, "files")

	mgr := NewManager(storagePath, libDir, nil)

	// Verify default folders
	folders := mgr.GetFolders()
	if len(folders) != 1 || folders[0] != "Umum" {
		t.Fatalf("Expected default folder 'Umum', got: %v", folders)
	}

	// Add folder
	if err := mgr.AddFolder("Modul Kuliah"); err != nil {
		t.Fatalf("AddFolder failed: %v", err)
	}
	if err := mgr.AddFolder("Modul Kuliah"); err == nil {
		t.Fatal("Expected error adding duplicate folder, got nil")
	}

	// Add items with different folders and types
	item1 := &LibraryItem{
		Filename:     "modul1.pdf",
		Path:         filepath.Join(libDir, "modul1.pdf"),
		Size:         100,
		Folder:       "Modul Kuliah",
		Status:       StatusApproved,
	}
	_ = os.WriteFile(item1.Path, []byte("modul content"), 0644)
	_ = mgr.AddItem(item1)

	item2 := &LibraryItem{
		Filename:     "foto.png",
		Path:         filepath.Join(libDir, "foto.png"),
		Size:         200,
		Folder:       "Umum",
		Status:       StatusApproved,
	}
	_ = os.WriteFile(item2.Path, []byte("png content"), 0644)
	_ = mgr.AddItem(item2)

	// Filter by folder
	modulItems := mgr.ListApproved("", "Modul Kuliah")
	if len(modulItems) != 1 || modulItems[0].Filename != "modul1.pdf" {
		t.Fatalf("Expected 1 item in 'Modul Kuliah', got %d", len(modulItems))
	}

	// Clear images
	count, freed, err := mgr.ClearItems("images")
	if err != nil || count != 1 || freed != 200 {
		t.Fatalf("ClearItems images failed: count=%d, freed=%d, err=%v", count, freed, err)
	}

	// Remaining items
	remaining := mgr.ListApproved("")
	if len(remaining) != 1 || remaining[0].Filename != "modul1.pdf" {
		t.Fatalf("Expected only modul1.pdf to remain, got %d items", len(remaining))
	}

	// Delete folder moves items to Umum
	if err := mgr.DeleteFolder("Modul Kuliah"); err != nil {
		t.Fatalf("DeleteFolder failed: %v", err)
	}
	fetched, _ := mgr.Get(item1.ID)
	if fetched.Folder != "Umum" {
		t.Fatalf("Expected item folder to be reset to 'Umum', got %s", fetched.Folder)
	}
}

