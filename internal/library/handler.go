package library

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fendy/lanx/internal/config"
)

// Handler handles HTTP endpoints for the shared library.
type Handler struct {
	mgr           *Manager
	cfg           *config.Config
	libraryDir    string
	adminMu       sync.RWMutex
	adminSessions map[string]int64 // token -> expiry ms
	rateMu        sync.Mutex
	rateLimiter   map[string]time.Time // ip -> last upload time
}

// NewHandler creates a new Library HTTP handler.
func NewHandler(mgr *Manager, cfg *config.Config, libraryDir string) *Handler {
	return &Handler{
		mgr:           mgr,
		cfg:           cfg,
		libraryDir:    libraryDir,
		adminSessions: make(map[string]int64),
		rateLimiter:   make(map[string]time.Time),
	}
}

// RegisterRoutes registers library routes on the mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/library", h.handleList)
	mux.HandleFunc("GET /api/library/folders", h.handleListFolders)
	mux.HandleFunc("POST /api/library/folders", h.handleAddFolder)
	mux.HandleFunc("DELETE /api/library/folders", h.handleDeleteFolder)
	mux.HandleFunc("POST /api/library/clear", h.handleClear)
	mux.HandleFunc("GET /api/library/pending", h.handleListPending)
	mux.HandleFunc("POST /api/library/upload", h.handleUpload)
	mux.HandleFunc("GET /api/library/download/{id}", h.handleDownload)
	mux.HandleFunc("POST /api/library/delete", h.handleDelete)
	mux.HandleFunc("POST /api/library/approve", h.handleApprove)
	mux.HandleFunc("POST /api/library/reject", h.handleReject)
	mux.HandleFunc("GET /api/library/stats", h.handleStats)
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	folder := r.URL.Query().Get("folder")
	items := h.mgr.ListApproved(query, folder)
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) handleListPending(w http.ResponseWriter, r *http.Request) {
	if !h.isAdminRequest(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: Mode Admin diperlukan"})
		return
	}

	items := h.mgr.ListPending()
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request) {
	// 1. Anti-Bot Cooldown (5 seconds between uploads per IP)
	clientIP := getClientIP(r)
	h.rateMu.Lock()
	lastTime, exists := h.rateLimiter[clientIP]
	if exists && time.Since(lastTime) < 5*time.Second {
		h.rateMu.Unlock()
		writeJSON(w, http.StatusTooManyRequests, map[string]string{
			"error": "Terlalu cepat. Harap tunggu beberapa detik sebelum mengunggah lagi.",
		})
		return
	}
	h.rateLimiter[clientIP] = time.Now()
	h.rateMu.Unlock()

	// 2. Limit request size to 10 GB
	r.Body = http.MaxBytesReader(w, r.Body, 10<<30)

	// Parse multipart
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "File terlalu besar atau permintaan tidak valid",
		})
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Tidak ada berkas yang dipilih",
		})
		return
	}
	defer file.Close()

	// 3. Storage Quota Check (Hard Cap)
	usedBytes, _ := h.mgr.GetTotalStorageUsed()
	quotaBytes := h.cfg.GetLibraryQuotaBytes()
	if usedBytes+header.Size > quotaBytes {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("Kapasitas penyimpanan Pustaka penuh (Maksimal %s). Silakan hubungi admin.", formatBytes(quotaBytes)),
		})
		return
	}

	// 4. Large File Approval Check (Threshold applies ONLY to Pustaka)
	threshold := h.cfg.GetApprovalThresholdBytes()
	status := StatusApproved
	if header.Size > threshold {
		status = StatusPendingApproval
	}

	// 5. Expiration Calculation (Cap at max 365 days / 1 year)
	now := time.Now()
	maxExpiry := now.AddDate(1, 0, 0).UnixMilli()
	expiresAt := now.AddDate(0, 0, 7).UnixMilli() // Default 7 days

	expiryDaysStr := r.FormValue("expiry_days")
	expiryDateStr := r.FormValue("expiry_date")

	if expiryDateStr != "" {
		if t, err := time.Parse("2006-01-02", expiryDateStr); err == nil {
			// Set to end of day
			parsed := time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, time.Local).UnixMilli()
			if parsed > now.UnixMilli() && parsed <= maxExpiry {
				expiresAt = parsed
			}
		}
	} else if expiryDaysStr != "" {
		if days, err := strconv.Atoi(expiryDaysStr); err == nil && days > 0 {
			calc := now.AddDate(0, 0, days).UnixMilli()
			if calc <= maxExpiry {
				expiresAt = calc
			} else {
				expiresAt = maxExpiry
			}
		}
	}

	uploaderName := strings.TrimSpace(r.FormValue("uploader_name"))
	if uploaderName == "" {
		uploaderName = "Anonim"
	}
	uploaderID := strings.TrimSpace(r.FormValue("uploader_id"))
	description := strings.TrimSpace(r.FormValue("description"))
	folder := strings.TrimSpace(r.FormValue("folder"))
	if folder == "" {
		folder = "Umum"
	}

	filename := sanitizeFilename(header.Filename)
	if filename == "" {
		filename = "berkas_pustaka"
	}

	destPath := h.uniqueFilePath(filename)
	destFile, err := os.Create(destPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Gagal menyimpan berkas di server"})
		return
	}
	defer destFile.Close()

	written, err := io.Copy(destFile, file)
	if err != nil {
		destFile.Close()
		_ = os.Remove(destPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Gagal menulis berkas"})
		return
	}

	deleteToken := GenerateToken()
	item := &LibraryItem{
		ID:            GenerateID(),
		Filename:      filename,
		Path:          destPath,
		Size:          written,
		Description:   description,
		Folder:        folder,
		UploaderName:  uploaderName,
		UploaderID:    uploaderID,
		DeleteToken:   deleteToken,
		ExpiresAt:     expiresAt,
		CreatedAt:     time.Now().UnixMilli(),
		Status:        status,
		DownloadCount: 0,
	}

	if err := h.mgr.AddItem(item); err != nil {
		destFile.Close()
		_ = os.Remove(destPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Gagal menyimpan metadata berkas"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"item":                 item,
		"delete_token":         deleteToken,
		"is_pending_approval":  status == StatusPendingApproval,
		"status":               status,
	})
}

func (h *Handler) handleDownload(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}

	it, ok := h.mgr.Get(id)
	if !ok {
		http.Error(w, "Berkas tidak ditemukan", http.StatusNotFound)
		return
	}

	if _, err := os.Stat(it.Path); os.IsNotExist(err) {
		http.Error(w, "Berkas fisik sudah tidak tersedia", http.StatusGone)
		return
	}

	isPreview := r.URL.Query().Get("preview") == "1"
	mimeType := getMimeType(it.Filename)

	if isPreview {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, it.Filename))
	} else {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, it.Filename))
		// Increment download counter for real downloads
		h.mgr.IncrementDownload(id)
	}
	w.Header().Set("Content-Type", mimeType)

	http.ServeFile(w, r, it.Path)
}

type deleteRequest struct {
	ID          string `json:"id"`
	Token       string `json:"token,omitempty"`
	DeleteToken string `json:"delete_token,omitempty"`
	AdminToken  string `json:"admin_token,omitempty"`
}

func (h *Handler) handleDelete(w http.ResponseWriter, r *http.Request) {
	var req deleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Permintaan tidak valid"})
		return
	}

	// Merge delete_token and token — frontend may send either field name
	selfToken := req.Token
	if selfToken == "" {
		selfToken = req.DeleteToken
	}

	isAdmin := h.ValidateAdminToken(req.AdminToken) || h.isAdminRequest(r)

	if err := h.mgr.Delete(req.ID, selfToken, isAdmin); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type approvalRequest struct {
	ID         string `json:"id"`
	AdminToken string `json:"admin_token,omitempty"`
}

func (h *Handler) handleApprove(w http.ResponseWriter, r *http.Request) {
	var req approvalRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	if !h.ValidateAdminToken(req.AdminToken) && !h.isAdminRequest(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: Mode Admin diperlukan"})
		return
	}

	item, err := h.mgr.Approve(req.ID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "approved", "item": item})
}

func (h *Handler) handleReject(w http.ResponseWriter, r *http.Request) {
	var req approvalRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	if !h.ValidateAdminToken(req.AdminToken) && !h.isAdminRequest(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: Mode Admin diperlukan"})
		return
	}

	if err := h.mgr.Reject(req.ID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}

func (h *Handler) handleStats(w http.ResponseWriter, r *http.Request) {
	usedBytes, count := h.mgr.GetTotalStorageUsed()
	pendingItems := h.mgr.ListPending()

	writeJSON(w, http.StatusOK, map[string]any{
		"used_bytes":      usedBytes,
		"quota_bytes":     h.cfg.GetLibraryQuotaBytes(),
		"threshold_bytes": h.cfg.GetApprovalThresholdBytes(),
		"item_count":      count,
		"pending_count":   len(pendingItems),
	})
}

func (h *Handler) handleListFolders(w http.ResponseWriter, r *http.Request) {
	folders := h.mgr.GetFolders()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"folders": folders,
	})
}

func (h *Handler) handleAddFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string `json:"name"`
		AdminToken string `json:"admin_token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if !h.ValidateAdminToken(req.AdminToken) && !h.isAdminRequest(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: Mode Admin diperlukan"})
		return
	}

	if err := h.mgr.AddFolder(req.Name); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"folders": h.mgr.GetFolders(),
	})
}

func (h *Handler) handleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string `json:"name"`
		AdminToken string `json:"admin_token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if !h.ValidateAdminToken(req.AdminToken) && !h.isAdminRequest(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: Mode Admin diperlukan"})
		return
	}

	if err := h.mgr.DeleteFolder(req.Name); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"folders": h.mgr.GetFolders(),
	})
}

func (h *Handler) handleClear(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Target     string `json:"target"` // "images" or "all"
		AdminToken string `json:"admin_token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if !h.ValidateAdminToken(req.AdminToken) && !h.isAdminRequest(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: Mode Admin diperlukan"})
		return
	}

	count, freed, err := h.mgr.ClearItems(req.Target)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"target":      req.Target,
		"count":       count,
		"freed_bytes": freed,
	})
}

// --- Admin Authentication Helpers ---

// CreateAdminSession generates an admin session token valid for 7 days.
func (h *Handler) CreateAdminSession() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)

	h.adminMu.Lock()
	defer h.adminMu.Unlock()
	h.adminSessions[token] = time.Now().Add(7 * 24 * time.Hour).UnixMilli()
	return token
}

// ValidateAdminToken checks if the token is valid or matches Master PIN.
func (h *Handler) ValidateAdminToken(token string) bool {
	if token == "" {
		return false
	}
	if token == h.cfg.GetAdminPIN() {
		return true
	}

	h.adminMu.RLock()
	defer h.adminMu.RUnlock()
	exp, ok := h.adminSessions[token]
	return ok && time.Now().UnixMilli() < exp
}

func (h *Handler) isAdminRequest(r *http.Request) bool {
	token := r.Header.Get("X-Admin-Token")
	if token == "" {
		token = r.URL.Query().Get("admin_token")
	}
	return h.ValidateAdminToken(token)
}

// --- Utilities ---

func getClientIP(r *http.Request) string {
	if cfIP := r.Header.Get("CF-Connecting-IP"); cfIP != "" {
		return strings.TrimSpace(cfIP)
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

var unsafeChars = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

func sanitizeFilename(name string) string {
	name = filepath.Base(name)
	name = unsafeChars.ReplaceAllString(name, "_")
	name = strings.TrimLeft(name, ".")
	if len(name) > 255 {
		ext := filepath.Ext(name)
		name = name[:255-len(ext)] + ext
	}
	return name
}

func (h *Handler) uniqueFilePath(filename string) string {
	path := filepath.Join(h.libraryDir, filename)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}

	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)

	for i := 1; i < 10000; i++ {
		path = filepath.Join(h.libraryDir, fmt.Sprintf("%s_%d%s", base, i, ext))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return path
		}
	}

	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return filepath.Join(h.libraryDir, fmt.Sprintf("%s_%s%s", base, hex.EncodeToString(b), ext))
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

func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
