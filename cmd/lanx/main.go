package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/fendy/lanx/internal/clipboard"
	"github.com/fendy/lanx/internal/config"
	"github.com/fendy/lanx/internal/device"
	"github.com/fendy/lanx/internal/discovery"
	"github.com/fendy/lanx/internal/library"
	"github.com/fendy/lanx/internal/pairing"
	"github.com/fendy/lanx/internal/server"
	"github.com/fendy/lanx/internal/transfer"
	"github.com/fendy/lanx/internal/websocket"
)

func main() {
	var (
		port    int
		name    string
		dataDir string
		version bool
	)

	flag.IntVar(&port, "port", 0, "HTTP server port")
	flag.StringVar(&name, "name", "", "device name")
	flag.StringVar(&dataDir, "data", "", "data directory")
	flag.BoolVar(&version, "version", false, "show version")
	flag.Usage = func() {
		fmt.Println("LANX — Local Device Sharing")
		fmt.Println()
		fmt.Println("Usage:")
		fmt.Println("  lanx [flags]")
		fmt.Println()
		fmt.Println("Flags:")
		fmt.Println("  --port       HTTP server port (default 8080)")
		fmt.Println("  --name       device name (default: hostname)")
		fmt.Println("  --data       data directory (default: ~/.lanx)")
		fmt.Println("  --version    show version")
		fmt.Println("  --help       show help")
	}
	flag.Parse()

	if version {
		fmt.Printf("LANX v%s\n", config.Version)
		os.Exit(0)
	}

	// Load config
	cfg, err := config.Load(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// CLI overrides
	if port > 0 {
		cfg.Port = port
	}
	if name != "" {
		cfg.DeviceName = name
	}

	logger := log.New(os.Stdout, "", log.LstdFlags)

	// Create WebSocket hub
	wsHub := websocket.NewHub(logger)

	// Create device registry with persistent storage and register host device
	devicesDBPath := filepath.Join(cfg.DataDir(), "devices.json")
	registry := device.NewRegistry(devicesDBPath, func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})
	registry.SetHostDevice(&device.Device{
		ID:       cfg.DeviceID,
		Name:     cfg.DeviceName,
		IP:       server.GetLocalIP(),
		Port:     cfg.Port,
		Online:   true,
		IsHost:   true,
		Platform: "desktop",
	})

	// Create mailbox for offline store-and-forward transfers
	mailboxPath := filepath.Join(cfg.DataDir(), "mailbox.json")
	mailbox := transfer.NewMailbox(mailboxPath)
	mailbox.StartAutoCleaner(30*time.Minute, 24*time.Hour)

	// Register WebSocket client hooks for browser device discovery
	wsHub.SetClientHooks(func(id, clientName, platform, ip string) {
		if id == cfg.DeviceID {
			return
		}
		registry.AddOrUpdate(&device.Device{
			ID:        id,
			Name:      clientName,
			IP:        ip,
			Port:      cfg.Port,
			Online:    true,
			IsBrowser: true,
			Platform:  platform,
		})

		// Flush any pending offline mailbox items for this device
		pending := mailbox.GetPendingForDevice(id)
		if len(pending) > 0 {
			go func(targetID string, items []*transfer.MailboxItem) {
				// Allow client UI to complete initial connection
				time.Sleep(600 * time.Millisecond)
				for _, it := range items {
					switch it.Type {
					case "file":
						wsHub.SendToDevice(targetID, "transfer_complete", map[string]any{
							"transfer_id":      it.TransferID,
							"download_id":      it.DownloadID,
							"filename":         it.Filename,
							"size":             it.Size,
							"target_device_id": it.TargetDeviceID,
							"sender_id":        it.SenderID,
							"from_device":      it.SenderName,
							"description":      it.Description,
							"download_url":     fmt.Sprintf("/api/download/%s", it.DownloadID),
							"is_offline_queue": true,
							"queued_at":        it.Timestamp,
						})
					case "text":
						wsHub.SendToDevice(targetID, "text_received", map[string]any{
							"target_device_id": it.TargetDeviceID,
							"text":             it.TextContent,
							"from_device":      it.SenderName,
							"from_id":          it.SenderID,
							"is_offline_queue": true,
							"queued_at":        it.Timestamp,
						})
					}
					mailbox.MarkDelivered(it.ID)
				}
			}(id, pending)
		}
	}, func(id string) {
		if id == cfg.DeviceID {
			return
		}
		registry.SetOffline(id)
	})

	// Create transfer manager
	transferMgr := transfer.NewManager(func(t *transfer.Transfer) {
		if t.Status == transfer.StatusFailed {
			wsHub.Broadcast("transfer_failed", map[string]any{
				"transfer_id": t.ID,
				"filename":    t.Filename,
				"reason":      t.Error,
			})
			return
		}
		wsHub.Broadcast("transfer_progress", map[string]any{
			"transfer_id": t.ID,
			"filename":    t.Filename,
			"bytes":       t.Loaded,
			"total":       t.Size,
			"percentage":  t.Percentage,
			"status":      t.Status,
		})
	})

	// Create transfer handler
	transferHandler := transfer.NewHandler(transferMgr, cfg.GetDownloadPath(), func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})
	transferHandler.SetMailbox(mailbox, wsHub.IsDeviceOnline)
	transferHandler.SetAutoDeleteDelivered(cfg.AutoDeleteDelivered)
	transferHandler.StartAutoCleaner(30*time.Minute, 24*time.Hour)

	// Create pairing manager
	pairingMgr := pairing.NewManager(cfg.Port, func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})

	// Create clipboard handler
	clipHandler := clipboard.NewHandler(registry, cfg.DeviceID, cfg.DeviceName, func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})
	clipHandler.SetMailbox(mailbox)

	// Create library manager & handler (Shared Library)
	libraryDBPath := filepath.Join(cfg.DataDir(), "library.json")
	libraryMgr := library.NewManager(libraryDBPath, cfg.GetLibraryPath(), func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})
	libraryMgr.StartAutoCleaner(15 * time.Minute)
	libraryHandler := library.NewHandler(libraryMgr, cfg, cfg.GetLibraryPath())

	// Wire admin validation from library handler to device registry and transfer handler
	registry.SetAdminValidator(libraryHandler.ValidateAdminToken)
	transferHandler.SetAdminValidator(libraryHandler.ValidateAdminToken)

	// Create HTTP server
	srv := server.New(cfg, logger)
	srv.SetDeviceRegistry(registry)
	srv.SetAdminAuth(libraryHandler.CreateAdminSession, libraryHandler.ValidateAdminToken)
	srv.SetOnSettingsUpdated(func(updatedCfg *config.Config) {
		transferHandler.SetAutoDeleteDelivered(updatedCfg.AutoDeleteDelivered)
	})
	mux := srv.Mux()

	// Register all routes
	wsHub.RegisterRoutes(mux)
	registry.RegisterRoutes(mux)
	transferHandler.RegisterRoutes(mux)
	libraryHandler.RegisterRoutes(mux)
	pairingMgr.RegisterRoutes(mux)
	clipHandler.RegisterRoutes(mux)

	// Graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		logger.Println("Shutting down...")
		cancel()
	}()

	// Start mDNS discovery
	disc := discovery.New(cfg, registry, logger)
	if err := disc.Start(ctx); err != nil {
		logger.Printf("Warning: mDNS discovery failed: %v", err)
		logger.Println("Device discovery will be unavailable. Other features still work.")
	}

	// Start HTTP server (blocking)
	if err := srv.Start(ctx); err != nil {
		logger.Fatalf("Server error: %v", err)
	}
}
