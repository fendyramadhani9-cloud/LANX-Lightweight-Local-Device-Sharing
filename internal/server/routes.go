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

	// Serve embedded frontend
	staticFS := StaticFS()
	fileServer := http.FileServer(http.FS(staticFS))

	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
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

	writeJSON(w, http.StatusOK, deviceResponse{
		ID:      s.cfg.DeviceID,
		Name:    s.cfg.DeviceName,
		Version: config.Version,
	})
}

// --- Settings endpoints ---

type settingsResponse struct {
	DeviceName   string `json:"device_name"`
	Port         int    `json:"port"`
	DownloadPath string `json:"download_path"`
	Theme        string `json:"theme"`
	PairingReq   bool   `json:"pairing_required"`
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	resp := settingsResponse{
		DeviceName:   s.cfg.DeviceName,
		Port:         s.cfg.Port,
		DownloadPath: s.cfg.DownloadPath,
		Theme:        s.cfg.Theme,
		PairingReq:   s.cfg.PairingReq,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req settingsResponse
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := s.cfg.Update(func(c *config.Config) {
		if name := strings.TrimSpace(req.DeviceName); name != "" && len(name) <= 64 {
			c.DeviceName = name
		}
		if req.Theme == "light" || req.Theme == "dark" {
			c.Theme = req.Theme
		}
		c.PairingReq = req.PairingReq
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to save settings")
		return
	}

	s.handleGetSettings(w, r)
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
