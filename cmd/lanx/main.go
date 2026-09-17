package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/fendy/lanx/internal/clipboard"
	"github.com/fendy/lanx/internal/config"
	"github.com/fendy/lanx/internal/device"
	"github.com/fendy/lanx/internal/discovery"
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

	// Create device registry
	registry := device.NewRegistry(func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})

	// Create transfer manager
	transferMgr := transfer.NewManager(func(t *transfer.Transfer) {
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

	// Create pairing manager
	pairingMgr := pairing.NewManager(cfg.Port, func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})

	// Create clipboard handler
	clipHandler := clipboard.NewHandler(registry, cfg.DeviceID, cfg.DeviceName, func(eventType string, data any) {
		wsHub.Broadcast(eventType, data)
	})

	// Create HTTP server
	srv := server.New(cfg, logger)
	mux := srv.Mux()

	// Register all routes
	wsHub.RegisterRoutes(mux)
	registry.RegisterRoutes(mux)
	transferHandler.RegisterRoutes(mux)
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
