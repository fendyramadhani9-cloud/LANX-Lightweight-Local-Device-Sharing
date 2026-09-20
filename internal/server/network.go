package server

import (
	"net"
	"sort"
	"strings"
	"time"
)

// IPInfo represents a discovered local network IP and its interface name.
type IPInfo struct {
	InterfaceName string
	IP            string
	Priority      int
}

// isAPIPA returns true if the IP is in the 169.254.0.0/16 Link-Local range.
func isAPIPA(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	return ip4[0] == 169 && ip4[1] == 254
}

// isValidLANIP checks if an IPv4 address is valid for LAN sharing (not loopback, not link-local/APIPA).
func isValidLANIP(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	if ip4.IsLoopback() || ip4.IsLinkLocalUnicast() || ip4.IsLinkLocalMulticast() || isAPIPA(ip4) {
		return false
	}
	return true
}

// getOutboundIP queries the OS routing table for the outbound interface towards the default gateway.
func getOutboundIP() string {
	conn, err := net.DialTimeout("udp", "8.8.8.8:80", 250*time.Millisecond)
	if err != nil {
		// Fallback test to another common IP
		conn, err = net.DialTimeout("udp", "1.1.1.1:80", 250*time.Millisecond)
		if err != nil {
			return ""
		}
	}
	defer conn.Close()

	localAddr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok {
		return ""
	}

	if isValidLANIP(localAddr.IP) {
		return localAddr.IP.String()
	}
	return ""
}

// GetAllLocalIPs scans network interfaces and returns all valid LAN IPs sorted by priority.
func GetAllLocalIPs() []IPInfo {
	var results []IPInfo

	ifaces, err := net.Interfaces()
	if err != nil {
		return results
	}

	for _, iface := range ifaces {
		// Skip interfaces that are down or loopback
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		nameLower := strings.ToLower(iface.Name)

		// Calculate priority modifier based on interface type
		basePriority := 20
		if strings.Contains(nameLower, "wi-fi") || strings.Contains(nameLower, "wifi") ||
			strings.Contains(nameLower, "wlan") || strings.Contains(nameLower, "wireless") {
			basePriority = 50
		} else if strings.Contains(nameLower, "ethernet") || strings.Contains(nameLower, "eth") || strings.Contains(nameLower, "en0") {
			basePriority = 40
		}

		// Penalize virtual and container interfaces
		if strings.Contains(nameLower, "vmware") ||
			strings.Contains(nameLower, "virtualbox") ||
			strings.Contains(nameLower, "vbox") ||
			strings.Contains(nameLower, "vethernet") ||
			strings.Contains(nameLower, "docker") ||
			strings.Contains(nameLower, "wsl") ||
			strings.Contains(nameLower, "tailscale") ||
			strings.Contains(nameLower, "zerotier") ||
			strings.Contains(nameLower, "bluetooth") ||
			strings.Contains(nameLower, "tap") ||
			strings.Contains(nameLower, "tun") {
			basePriority -= 30
		}

		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}

			ip := ipNet.IP.To4()
			if ip == nil || !isValidLANIP(ip) {
				continue
			}

			prio := basePriority
			if ip.IsPrivate() {
				prio += 10
			}

			results = append(results, IPInfo{
				InterfaceName: iface.Name,
				IP:            ip.String(),
				Priority:      prio,
			})
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Priority > results[j].Priority
	})

	return results
}

// GetLocalIP returns the most appropriate local LAN IPv4 address.
func GetLocalIP() string {
	// First choice: check the actual outbound interface selected by OS routing
	if outbound := getOutboundIP(); outbound != "" {
		return outbound
	}

	// Second choice: highest priority LAN interface
	ips := GetAllLocalIPs()
	if len(ips) > 0 {
		return ips[0].IP
	}

	return "127.0.0.1"
}
