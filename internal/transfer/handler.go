package transfer

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const (
	// MaxFileSize is the default maximum upload size (10 GB).
	MaxFileSize = 10 << 30
	// ProgressInterval controls how often we report progress (every 256 KB).
	ProgressInterval = 256 << 10
)

// FileStore manages stored files for download.
type FileStore struct {
	mu    sync.RWMutex
	files map[string]*StoredFile // downloadID -> file info
}

// StoredFile holds metadata about a stored file.
type StoredFile struct {
	ID       string
	Filename string
	Path     string
	Size     int64
}

// NewFileStore creates a new file store.
func NewFileStore() *FileStore {
	return &FileStore{
		files: make(map[string]*StoredFile),
	}
}

// Add registers a file for download.
func (fs *FileStore) Add(filename, path string, size int64) string {
	id := generateDownloadID()
	fs.mu.Lock()
	fs.files[id] = &StoredFile{
		ID:       id,
		Filename: filename,
		Path:     path,
		Size:     size,
	}
	fs.mu.Unlock()
	return id
}

// Get retrieves a stored file by download ID.
func (fs *FileStore) Get(id string) (*StoredFile, bool) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	f, ok := fs.files[id]
	return f, ok
}

// Handler provides HTTP handlers for file upload/download.
type Handler struct {
	mgr         *Manager
	store       *FileStore
	downloadDir string
	onTransferEvent func(eventType string, data any)
}

// NewHandler creates a new transfer handler.
func NewHandler(mgr *Manager, downloadDir string, onEvent func(string, any)) *Handler {
	return &Handler{
		mgr:             mgr,
		store:           NewFileStore(),
		downloadDir:     downloadDir,
		onTransferEvent: onEvent,
	}
}

// RegisterRoutes registers transfer-related routes on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/upload", h.handleUpload)
	mux.HandleFunc("POST /api/upload-folder", h.handleUploadFolder)
	mux.HandleFunc("GET /api/download/{id}", h.handleDownload)
	mux.HandleFunc("GET /api/transfers", h.handleListTransfers)
}

func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request) {
	// Limit request size
	r.Body = http.MaxBytesReader(w, r.Body, MaxFileSize)

	// Parse multipart — use 32 MB buffer for multipart parsing, rest streams to disk
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "File too large or invalid upload",
		})
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "No file provided",
		})
		return
	}
	defer file.Close()

	targetDeviceID := r.FormValue("target_device_id")
	clientTransferID := r.FormValue("transfer_id")
	senderID := r.FormValue("sender_id")
	senderName := r.FormValue("sender_name")
	if senderName == "" {
		senderName = "Perangkat Lain"
	}

	// Sanitize filename
	filename := sanitizeFilename(header.Filename)
	if filename == "" {
		filename = "unnamed_file"
	}

	// Create transfer record
	deviceName := senderName
	if targetDeviceID == "all" {
		deviceName = "Semua Perangkat"
	}
	t := h.mgr.Create(filename, header.Size, "received", deviceName, targetDeviceID)

	// Broadcast transfer started
	if h.onTransferEvent != nil {
		h.onTransferEvent("transfer_started", map[string]any{
			"transfer_id":        t.ID,
			"client_transfer_id": clientTransferID,
			"filename":           filename,
			"total_size":         header.Size,
			"direction":          "receiving",
			"target_device_id":   targetDeviceID,
			"sender_id":          senderID,
			"from_device":        senderName,
		})
	}

	// Create unique file on disk
	destPath := h.uniqueFilePath(filename)
	destFile, err := os.Create(destPath)
	if err != nil {
		h.mgr.Fail(t.ID, "Failed to create file")
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Failed to save file",
		})
		return
	}
	defer destFile.Close()

	// Stream copy with progress tracking
	var written int64
	buf := make([]byte, 64*1024) // 64 KB buffer
	lastReport := int64(0)

	for {
		n, readErr := file.Read(buf)
		if n > 0 {
			nw, writeErr := destFile.Write(buf[:n])
			if writeErr != nil {
				h.mgr.Fail(t.ID, "Failed to write file")
				writeJSON(w, http.StatusInternalServerError, map[string]string{
					"error": "Failed to write file",
				})
				return
			}
			written += int64(nw)

			// Report progress periodically
			if written-lastReport >= ProgressInterval {
				h.mgr.UpdateProgress(t.ID, written)
				lastReport = written
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			h.mgr.Fail(t.ID, "Transfer interrupted")
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "Transfer interrupted",
			})
			return
		}
	}

	// Register for download
	downloadID := h.store.Add(filename, destPath, written)

	// Mark complete
	h.mgr.Complete(t.ID, downloadID)

	// Broadcast completion
	if h.onTransferEvent != nil {
		h.onTransferEvent("transfer_complete", map[string]any{
			"transfer_id":      t.ID,
			"download_id":      downloadID,
			"filename":         filename,
			"size":             written,
			"target_device_id": targetDeviceID,
			"sender_id":        senderID,
			"from_device":      senderName,
			"download_url":     fmt.Sprintf("/api/download/%s", downloadID),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"transfer_id": t.ID,
		"download_id": downloadID,
		"filename":    filename,
		"size":        written,
	})
}

func (h *Handler) handleUploadFolder(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxFileSize)

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Folder too large or invalid upload",
		})
		return
	}
	defer r.MultipartForm.RemoveAll()

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "No files provided in folder",
		})
		return
	}

	paths := r.MultipartForm.Value["paths"]
	folderName := r.FormValue("folder_name")
	if folderName == "" && len(paths) > 0 {
		parts := strings.Split(filepath.ToSlash(paths[0]), "/")
		if len(parts) > 1 && parts[0] != "" {
			folderName = parts[0]
		}
	}
	if folderName == "" {
		folderName = "Folder_Transfer"
	}
	folderName = sanitizeFilename(folderName)
	if !strings.HasSuffix(strings.ToLower(folderName), ".zip") {
		folderName += ".zip"
	}

	targetDeviceID := r.FormValue("target_device_id")
	clientTransferID := r.FormValue("transfer_id")
	senderID := r.FormValue("sender_id")
	senderName := r.FormValue("sender_name")
	if senderName == "" {
		senderName = "Perangkat Lain"
	}

	deviceName := senderName
	if targetDeviceID == "all" {
		deviceName = "Semua Perangkat"
	}
	t := h.mgr.Create(folderName, 0, "received", deviceName, targetDeviceID)

	if h.onTransferEvent != nil {
		h.onTransferEvent("transfer_started", map[string]any{
			"transfer_id":        t.ID,
			"client_transfer_id": clientTransferID,
			"filename":           folderName,
			"total_size":         0,
			"direction":          "receiving",
			"target_device_id":   targetDeviceID,
			"sender_id":          senderID,
			"from_device":        senderName,
		})
	}

	destPath := h.uniqueFilePath(folderName)
	destZipFile, err := os.Create(destPath)
	if err != nil {
		h.mgr.Fail(t.ID, "Failed to create zip file")
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Failed to create zip archive",
		})
		return
	}

	zipWriter := zip.NewWriter(destZipFile)
	var totalWritten int64

	for i, fileHeader := range files {
		relPath := fileHeader.Filename
		if i < len(paths) && paths[i] != "" {
			relPath = paths[i]
		}
		relPath = filepath.ToSlash(filepath.Clean(relPath))
		relPath = strings.TrimLeft(relPath, "./\\")
		if relPath == "" || strings.HasPrefix(relPath, "..") {
			relPath = sanitizeFilename(fileHeader.Filename)
		}

		entryWriter, err := zipWriter.Create(relPath)
		if err != nil {
			continue
		}

		srcFile, err := fileHeader.Open()
		if err != nil {
			continue
		}

		nw, copyErr := io.Copy(entryWriter, srcFile)
		srcFile.Close()
		if copyErr == nil {
			totalWritten += nw
		}
	}

	if err := zipWriter.Close(); err != nil {
		destZipFile.Close()
		h.mgr.Fail(t.ID, "Failed to finalize zip archive")
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Failed to finalize zip archive",
		})
		return
	}
	destZipFile.Close()

	fi, err := os.Stat(destPath)
	zipSize := totalWritten
	if err == nil {
		zipSize = fi.Size()
	}

	// Register for download
	downloadID := h.store.Add(folderName, destPath, zipSize)

	// Complete transfer
	h.mgr.Complete(t.ID, downloadID)

	if h.onTransferEvent != nil {
		h.onTransferEvent("transfer_complete", map[string]any{
			"transfer_id":      t.ID,
			"download_id":      downloadID,
			"filename":         folderName,
			"size":             zipSize,
			"target_device_id": targetDeviceID,
			"sender_id":        senderID,
			"from_device":      senderName,
			"download_url":     fmt.Sprintf("/api/download/%s", downloadID),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"transfer_id": t.ID,
		"download_id": downloadID,
		"filename":    folderName,
		"size":        zipSize,
	})
}

func (h *Handler) handleDownload(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing download ID", http.StatusBadRequest)
		return
	}

	sf, ok := h.store.Get(id)
	if !ok {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Verify file still exists
	if _, err := os.Stat(sf.Path); os.IsNotExist(err) {
		http.Error(w, "File no longer available", http.StatusGone)
		return
	}

	isPreview := r.URL.Query().Get("preview") == "1"
	mimeType := getMimeType(sf.Filename)

	if isPreview {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, sf.Filename))
	} else {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, sf.Filename))
	}
	w.Header().Set("Content-Type", mimeType)

	http.ServeFile(w, r, sf.Path)
}

func getMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".mkv":
		return "video/x-matroska"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".m4a":
		return "audio/mp4"
	case ".flac":
		return "audio/flac"
	case ".pdf":
		return "application/pdf"
	case ".txt", ".log":
		return "text/plain; charset=utf-8"
	case ".json":
		return "application/json"
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".html", ".htm":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".zip":
		return "application/zip"
	}
	t := mime.TypeByExtension(ext)
	if t != "" {
		return t
	}
	return "application/octet-stream"
}

func (h *Handler) handleListTransfers(w http.ResponseWriter, r *http.Request) {
	history := h.mgr.History()
	writeJSON(w, http.StatusOK, history)
}

// --- Utilities ---

var unsafeChars = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

func sanitizeFilename(name string) string {
	// Take only the base name — prevent path traversal
	name = filepath.Base(name)

	// Remove unsafe characters
	name = unsafeChars.ReplaceAllString(name, "_")

	// Remove leading dots (hidden files / traversal)
	name = strings.TrimLeft(name, ".")

	// Limit length
	if len(name) > 255 {
		ext := filepath.Ext(name)
		name = name[:255-len(ext)] + ext
	}

	return name
}

func (h *Handler) uniqueFilePath(filename string) string {
	path := filepath.Join(h.downloadDir, filename)

	// If file doesn't exist, use as-is
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}

	// Otherwise, append a unique suffix
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)

	for i := 1; i < 10000; i++ {
		path = filepath.Join(h.downloadDir, fmt.Sprintf("%s_%d%s", base, i, ext))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return path
		}
	}

	// Fallback: use random suffix
	b := make([]byte, 4)
	rand.Read(b)
	return filepath.Join(h.downloadDir, fmt.Sprintf("%s_%s%s", base, hex.EncodeToString(b), ext))
}

func generateDownloadID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
