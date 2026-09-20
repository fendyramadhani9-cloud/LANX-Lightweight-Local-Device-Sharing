package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"

	"github.com/fendy/lanx/internal/config"
)

func (s *Server) registerRoutes() {
	// API routes
	s.mux.HandleFunc("GET /api/device", s.handleGetDevice)
	s.mux.HandleFunc("PUT /api/device", s.handleUpdateDevice)
	s.mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	s.mux.HandleFunc("PUT /api/settings", s.handleUpdateSettings)
	s.mux.HandleFunc("POST /api/admin/login", s.handleAdminLogin)
	s.mux.HandleFunc("GET /api/admin/config", s.handleGetAdminConfig)
	s.mux.HandleFunc("PUT /api/admin/config", s.handleUpdateAdminConfig)

	// Serve embedded frontend
	staticFS := StaticFS()
	fileServer := http.FileServer(http.FS(staticFS))

	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Prevent aggressive browser caching during dev/local usage
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")

		// For SPA: serve index.html for non-file paths
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Check if file exists in embedded FS
		if _, err := fs.Stat(staticFS, path); err != nil {
			// Serve index.html for SPA routing
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}

// --- Device endpoints ---

type deviceResponse struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
}

func (s *Server) handleGetDevice(w http.ResponseWriter, r *http.Request) {
	resp := deviceResponse{
		ID:      s.cfg.DeviceID,
		Name:    s.cfg.DeviceName,
		Version: config.Version,
	}
	writeJSON(w, http.StatusOK, resp)
}

type updateDeviceRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleUpdateDevice(w http.ResponseWriter, r *http.Request) {
	var req updateDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Device name cannot be empty")
		return
	}
	if len(name) > 64 {
		writeError(w, http.StatusBadRequest, "Device name too long")
		return
	}

	if err := s.cfg.Update(func(c *config.Config) {
		c.DeviceName = name
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to save config")
		return
	}

	if s.devices != nil {
		_, _ = s.devices.UpdateProfile(s.cfg.DeviceID, name, "")
	}

	writeJSON(w, http.StatusOK, deviceResponse{
		ID:      s.cfg.DeviceID,
		Name:    s.cfg.DeviceName,
		Version: config.Version,
	})
}

// --- Settings endpoints ---

type settingsResponse struct {
	DeviceName          string `json:"device_name"`
	Port                int    `json:"port"`
	DownloadPath        string `json:"download_path"`
	Theme               string `json:"theme"`
	PairingReq          bool   `json:"pairing_required"`
	AutoDeleteDelivered bool   `json:"auto_delete_delivered"`
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	resp := settingsResponse{
		DeviceName:          s.cfg.DeviceName,
		Port:                s.cfg.Port,
		DownloadPath:        s.cfg.DownloadPath,
		Theme:               s.cfg.Theme,
		PairingReq:          s.cfg.PairingReq,
		AutoDeleteDelivered: s.cfg.AutoDeleteDelivered,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req settingsResponse
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	name := strings.TrimSpace(req.DeviceName)
	if err := s.cfg.Update(func(c *config.Config) {
		if name != "" && len(name) <= 64 {
			c.DeviceName = name
		}
		if req.Theme == "light" || req.Theme == "dark" {
			c.Theme = req.Theme
		}
		c.PairingReq = req.PairingReq
		c.AutoDeleteDelivered = req.AutoDeleteDelivered
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to save settings")
		return
	}

	if name != "" && s.devices != nil {
		_, _ = s.devices.UpdateProfile(s.cfg.DeviceID, name, "")
	}

	if s.onSettingsUpdated != nil {
		s.onSettingsUpdated(s.cfg)
	}

	s.handleGetSettings(w, r)
}

// --- Admin Endpoints ---

type adminLoginRequest struct {
	PIN string `json:"pin"`
}

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var req adminLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Permintaan tidak valid")
		return
	}

	pin := strings.TrimSpace(req.PIN)
	if pin == "" || pin != s.cfg.GetAdminPIN() {
		writeError(w, http.StatusUnauthorized, "PIN Admin salah")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"token":       s.cfg.GetAdminPIN(),
		"admin_token": s.cfg.GetAdminPIN(),
		"message":     "Login admin berhasil",
	})
}

type adminConfigResponse struct {
	Token                  string `json:"token"`
	AdminToken             string `json:"admin_token"`
	AdminPIN               string `json:"admin_pin"`
	LibraryQuotaBytes      int64  `json:"library_quota_bytes"`
	ApprovalThresholdBytes int64  `json:"approval_threshold_bytes"`
}

func (s *Server) handleGetAdminConfig(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("X-Admin-Token")
	if token == "" || token != s.cfg.GetAdminPIN() {
		writeError(w, http.StatusUnauthorized, "Unauthorized: Mode Admin diperlukan")
		return
	}

	writeJSON(w, http.StatusOK, adminConfigResponse{
		Token:                  s.cfg.GetAdminPIN(),
		AdminToken:             s.cfg.GetAdminPIN(),
		AdminPIN:               s.cfg.GetAdminPIN(),
		LibraryQuotaBytes:      s.cfg.GetLibraryQuotaBytes(),
		ApprovalThresholdBytes: s.cfg.GetApprovalThresholdBytes(),
	})
}

type updateAdminConfigRequest struct {
	NewPIN                 string `json:"new_pin,omitempty"`
	LibraryQuotaBytes      int64  `json:"library_quota_bytes,omitempty"`
	ApprovalThresholdBytes int64  `json:"approval_threshold_bytes,omitempty"`
	AdminToken             string `json:"admin_token"`
}

func (s *Server) handleUpdateAdminConfig(w http.ResponseWriter, r *http.Request) {
	var req updateAdminConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Permintaan tidak valid")
		return
	}

	token := r.Header.Get("X-Admin-Token")
	if token == "" {
		token = req.AdminToken
	}
	if token != s.cfg.GetAdminPIN() {
		writeError(w, http.StatusUnauthorized, "Unauthorized: PIN Admin tidak sah")
		return
	}

	if err := s.cfg.Update(func(c *config.Config) {
		if pin := strings.TrimSpace(req.NewPIN); pin != "" {
			c.AdminPIN = pin
		}
		if req.LibraryQuotaBytes > 0 {
			c.LibraryQuotaBytes = req.LibraryQuotaBytes
		}
		if req.ApprovalThresholdBytes > 0 {
			c.ApprovalThresholdBytes = req.ApprovalThresholdBytes
		}
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "Gagal menyimpan konfigurasi admin")
		return
	}

	writeJSON(w, http.StatusOK, adminConfigResponse{
		Token:                  s.cfg.GetAdminPIN(),
		AdminToken:             s.cfg.GetAdminPIN(),
		AdminPIN:               s.cfg.GetAdminPIN(),
		LibraryQuotaBytes:      s.cfg.GetLibraryQuotaBytes(),
		ApprovalThresholdBytes: s.cfg.GetApprovalThresholdBytes(),
	})
}

// --- JSON helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

type errorResponse struct {
	Error string `json:"error"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorResponse{Error: msg})
}
