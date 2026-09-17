package server

import (
	"net"
	"testing"
)

func TestIsAPIPA(t *testing.T) {
	tests := []struct {
		ip       string
		expected bool
	}{
		{"169.254.1.1", true},
		{"169.254.212.211", true},
		{"192.168.1.1", false},
		{"10.0.0.1", false},
		{"172.16.0.1", false},
		{"127.0.0.1", false},
	}

	for _, tt := range tests {
		ip := net.ParseIP(tt.ip)
		if got := isAPIPA(ip); got != tt.expected {
			t.Errorf("isAPIPA(%s) = %v, expected %v", tt.ip, got, tt.expected)
		}
	}
}

func TestIsValidLANIP(t *testing.T) {
	tests := []struct {
		ip       string
		expected bool
	}{
		{"169.254.212.211", false},
		{"127.0.0.1", false},
		{"192.168.1.5", true},
		{"10.10.10.1", true},
		{"172.19.160.1", true},
	}

	for _, tt := range tests {
		ip := net.ParseIP(tt.ip)
		if got := isValidLANIP(ip); got != tt.expected {
			t.Errorf("isValidLANIP(%s) = %v, expected %v", tt.ip, got, tt.expected)
		}
	}
}

func TestGetLocalIP(t *testing.T) {
	ip := GetLocalIP()
	if ip == "" {
		t.Fatal("GetLocalIP returned empty string")
	}

	parsed := net.ParseIP(ip)
	if parsed == nil {
		t.Fatalf("GetLocalIP returned invalid IP format: %s", ip)
	}

	if isAPIPA(parsed) {
		t.Fatalf("GetLocalIP returned APIPA address: %s", ip)
	}

	t.Logf("Selected local IP: %s", ip)
}
