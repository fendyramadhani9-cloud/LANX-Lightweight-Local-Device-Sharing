package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/fendy/lanx/internal/config"
	"github.com/fendy/lanx/internal/device"
	"github.com/grandcat/zeroconf"
)

const (
	ServiceType = "_lanx._tcp"
	Domain      = "local."
	BrowseInterval = 30 * time.Second
	HealthTimeout  = 3 * time.Second
)

// Discovery manages mDNS service registration and browsing.
type Discovery struct {
	cfg      *config.Config
	registry *device.Registry
	server   *zeroconf.Server
	logger   *log.Logger
}

// New creates a new Discovery instance.
func New(cfg *config.Config, registry *device.Registry, logger *log.Logger) *Discovery {
	return &Discovery{
		cfg:      cfg,
		registry: registry,
		logger:   logger,
	}
}

// Start registers this device and begins browsing for peers.
func (d *Discovery) Start(ctx context.Context) error {
	// Register our service
	txt := []string{
		fmt.Sprintf("id=%s", d.cfg.DeviceID),
		fmt.Sprintf("name=%s", d.cfg.DeviceName),
		fmt.Sprintf("version=%s", config.Version),
	}

	var err error
	d.server, err = zeroconf.Register(
		d.cfg.DeviceName,
		ServiceType,
		Domain,
		d.cfg.Port,
		txt,
		nil,
	)
	if err != nil {
		return fmt.Errorf("register mDNS: %w", err)
	}
	d.logger.Printf("mDNS service registered: %s", d.cfg.DeviceName)

	// Start browsing in background
	go d.browseLoop(ctx)

	// Wait for context cancellation
	go func() {
		<-ctx.Done()
		d.server.Shutdown()
	}()

	return nil
}

func (d *Discovery) browseLoop(ctx context.Context) {
	// Initial browse
	d.browse(ctx)

	ticker := time.NewTicker(BrowseInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.browse(ctx)
		}
	}
}

func (d *Discovery) browse(ctx context.Context) {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		d.logger.Printf("mDNS resolver error: %v", err)
		return
	}

	entries := make(chan *zeroconf.ServiceEntry)

	browseCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	go func() {
		for entry := range entries {
			d.handleEntry(entry)
		}
	}()

	if err := resolver.Browse(browseCtx, ServiceType, Domain, entries); err != nil {
		d.logger.Printf("mDNS browse error: %v", err)
	}

	<-browseCtx.Done()
}

func (d *Discovery) handleEntry(entry *zeroconf.ServiceEntry) {
	// Parse TXT records
	var deviceID, deviceName, version string
	for _, txt := range entry.Text {
		parts := strings.SplitN(txt, "=", 2)
		if len(parts) != 2 {
			continue
		}
		switch parts[0] {
		case "id":
			deviceID = parts[1]
		case "name":
			deviceName = parts[1]
		case "version":
			version = parts[1]
		}
	}

	// Skip ourselves
	if deviceID == d.cfg.DeviceID {
		return
	}

	// Get IPv4 address, filtering out loopback and APIPA (169.254.x.x)
	ip := ""
	for _, addr := range entry.AddrIPv4 {
		if addr.IsLoopback() || addr.IsLinkLocalUnicast() {
			continue
		}
		ip4 := addr.To4()
		if ip4 != nil && (ip4[0] == 169 && ip4[1] == 254) {
			continue
		}
		ip = addr.String()
		break
	}
	if ip == "" {
		// Try IPv6
		for _, addr := range entry.AddrIPv6 {
			if addr.IsLoopback() || addr.IsLinkLocalUnicast() {
				continue
			}
			ip = addr.String()
			break
		}
	}
	if ip == "" {
		return
	}

	dev := &device.Device{
		ID:      deviceID,
		Name:    deviceName,
		IP:      ip,
		Port:    entry.Port,
		Version: version,
		Online:  true,
	}

	isNew := d.registry.AddOrUpdate(dev)
	if isNew {
		d.logger.Printf("Device discovered: %s (%s:%d)", deviceName, ip, entry.Port)
	}
}

// HealthCheck pings a device to verify it's still online.
func (d *Discovery) HealthCheck(dev *device.Device) bool {
	url := fmt.Sprintf("http://%s/api/device", net.JoinHostPort(dev.IP, fmt.Sprintf("%d", dev.Port)))

	client := &http.Client{Timeout: HealthTimeout}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	var info struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return false
	}

	return info.ID == dev.ID
}
