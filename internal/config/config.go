package config

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const (
	Version     = "1.0.0"
	DefaultPort = 8080
	AppDir      = ".lanx"
	ConfigFile  = "config.json"
	DownloadDir = "downloads"
	LibraryDir  = "library"

	DefaultAdminPIN          = "123456"
	DefaultLibraryQuotaBytes = int64(5 << 30)  // 5 GB
	DefaultApprovalThreshold = int64(50 << 20) // 50 MB
)

// Config holds the application configuration.
type Config struct {
	DeviceID               string `json:"device_id"`
	DeviceName             string `json:"device_name"`
	Port                   int    `json:"port"`
	DownloadPath           string `json:"download_path"`
	LibraryPath            string `json:"library_path"`
	Theme                  string `json:"theme"`
	PairingReq             bool   `json:"pairing_required"`
	AutoDeleteDelivered    bool   `json:"auto_delete_delivered"`
	AdminPIN               string `json:"admin_pin"`
	LibraryQuotaBytes      int64  `json:"library_quota_bytes"`
	ApprovalThresholdBytes int64  `json:"approval_threshold_bytes"`

	mu       sync.RWMutex `json:"-"`
	filePath string       `json:"-"`
}

// Load reads the config from disk, creating defaults if it doesn't exist.
func Load(dataDir string) (*Config, error) {
	if dataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("get home dir: %w", err)
		}
		dataDir = filepath.Join(home, AppDir)
	}

	// Ensure directories exist
	dlDir := filepath.Join(dataDir, DownloadDir)
	if err := os.MkdirAll(dlDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	libDir := filepath.Join(dataDir, LibraryDir)
	if err := os.MkdirAll(libDir, 0o755); err != nil {
		return nil, fmt.Errorf("create library dir: %w", err)
	}

	cfgPath := filepath.Join(dataDir, ConfigFile)
	cfg := &Config{
		filePath:               cfgPath,
		AutoDeleteDelivered:    true,
		AdminPIN:               DefaultAdminPIN,
		LibraryQuotaBytes:      DefaultLibraryQuotaBytes,
		ApprovalThresholdBytes: DefaultApprovalThreshold,
	}

	data, err := os.ReadFile(cfgPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("read config: %w", err)
		}
		// First run — generate defaults
		cfg.DeviceID = generateID()
		cfg.DeviceName = defaultDeviceName()
		cfg.Port = DefaultPort
		cfg.DownloadPath = dlDir
		cfg.LibraryPath = libDir
		cfg.Theme = "light"
		cfg.PairingReq = true
		cfg.AutoDeleteDelivered = true
		cfg.AdminPIN = DefaultAdminPIN
		cfg.LibraryQuotaBytes = DefaultLibraryQuotaBytes
		cfg.ApprovalThresholdBytes = DefaultApprovalThreshold

		if err := cfg.Save(); err != nil {
			return nil, fmt.Errorf("save default config: %w", err)
		}
		return cfg, nil
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	cfg.filePath = cfgPath

	// Set defaults if empty on existing configs
	if cfg.DownloadPath == "" {
		cfg.DownloadPath = dlDir
	}
	if cfg.LibraryPath == "" {
		cfg.LibraryPath = libDir
	}
	if cfg.AdminPIN == "" {
		cfg.AdminPIN = DefaultAdminPIN
	}
	if cfg.LibraryQuotaBytes <= 0 {
		cfg.LibraryQuotaBytes = DefaultLibraryQuotaBytes
	}
	if cfg.ApprovalThresholdBytes <= 0 {
		cfg.ApprovalThresholdBytes = DefaultApprovalThreshold
	}

	if err := os.MkdirAll(cfg.DownloadPath, 0o755); err != nil {
		return nil, fmt.Errorf("create download dir: %w", err)
	}
	if err := os.MkdirAll(cfg.LibraryPath, 0o755); err != nil {
		return nil, fmt.Errorf("create library dir: %w", err)
	}

	return cfg, nil
}

// Save writes the current config to disk.
func (c *Config) Save() error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(c.filePath, data, 0o644)
}

// Update modifies config fields under a lock and saves.
func (c *Config) Update(fn func(c *Config)) error {
	c.mu.Lock()
	fn(c)
	c.mu.Unlock()
	return c.Save()
}

// GetDownloadPath returns the current download directory.
func (c *Config) GetDownloadPath() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.DownloadPath
}

// GetLibraryPath returns the current library directory.
func (c *Config) GetLibraryPath() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.LibraryPath
}

// GetAdminPIN returns the admin Master PIN.
func (c *Config) GetAdminPIN() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.AdminPIN
}

// GetLibraryQuotaBytes returns max bytes for the library.
func (c *Config) GetLibraryQuotaBytes() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.LibraryQuotaBytes
}

// GetApprovalThresholdBytes returns the threshold above which files need admin approval.
func (c *Config) GetApprovalThresholdBytes() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ApprovalThresholdBytes
}

// DataDir returns the base data directory.
func (c *Config) DataDir() string {
	return filepath.Dir(c.filePath)
}

func generateID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	// Format as UUID v4
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func defaultDeviceName() string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return "LANX Device"
	}
	return name
}
