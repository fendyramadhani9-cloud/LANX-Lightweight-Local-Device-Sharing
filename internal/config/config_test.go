package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCreatesDefaults(t *testing.T) {
	tmpDir := t.TempDir()
	dataDir := filepath.Join(tmpDir, ".lanx-test")

	cfg, err := Load(dataDir)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.DeviceID == "" {
		t.Error("DeviceID should not be empty")
	}
	if cfg.DeviceName == "" {
		t.Error("DeviceName should not be empty")
	}
	if cfg.Port != DefaultPort {
		t.Errorf("Port = %d, want %d", cfg.Port, DefaultPort)
	}
	if cfg.Theme != "light" {
		t.Errorf("Theme = %q, want 'light'", cfg.Theme)
	}

	// Verify config file was created
	cfgPath := filepath.Join(dataDir, ConfigFile)
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		t.Error("config.json should exist after Load()")
	}

	// Verify downloads directory was created
	dlDir := filepath.Join(dataDir, DownloadDir)
	if _, err := os.Stat(dlDir); os.IsNotExist(err) {
		t.Error("downloads/ should exist after Load()")
	}
}

func TestLoadReadsExisting(t *testing.T) {
	tmpDir := t.TempDir()
	dataDir := filepath.Join(tmpDir, ".lanx-test")

	// First load — create defaults
	cfg1, err := Load(dataDir)
	if err != nil {
		t.Fatalf("first Load() error: %v", err)
	}

	// Second load — should read existing config
	cfg2, err := Load(dataDir)
	if err != nil {
		t.Fatalf("second Load() error: %v", err)
	}

	if cfg1.DeviceID != cfg2.DeviceID {
		t.Error("DeviceID should persist across loads")
	}
}

func TestConfigUpdate(t *testing.T) {
	tmpDir := t.TempDir()
	dataDir := filepath.Join(tmpDir, ".lanx-test")

	cfg, err := Load(dataDir)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	originalName := cfg.DeviceName

	err = cfg.Update(func(c *Config) {
		c.DeviceName = "New Name"
	})
	if err != nil {
		t.Fatalf("Update() error: %v", err)
	}

	if cfg.DeviceName != "New Name" {
		t.Errorf("DeviceName = %q, want 'New Name'", cfg.DeviceName)
	}

	// Reload and verify persistence
	cfg2, err := Load(dataDir)
	if err != nil {
		t.Fatalf("reload error: %v", err)
	}
	if cfg2.DeviceName != "New Name" {
		t.Errorf("persisted DeviceName = %q, want 'New Name'", cfg2.DeviceName)
	}

	_ = originalName
}

func TestGenerateID(t *testing.T) {
	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := generateID()
		if id == "" {
			t.Fatal("generated empty ID")
		}
		if ids[id] {
			t.Fatalf("duplicate ID: %s", id)
		}
		ids[id] = true

		// Verify UUID format (8-4-4-4-12)
		if len(id) != 36 {
			t.Errorf("ID length = %d, want 36", len(id))
		}
	}
}
