# LANX — Local Device Sharing

> **Share locally. Stay private.**

LANX is a lightweight, single-binary application for sharing files, text, and clipboard content across devices on the same local network. No internet, no cloud, no accounts required.

## Features

- 📁 **File Transfer** — Drag & drop files, streaming upload/download (handles large files without RAM spikes)
- 📝 **Text Sharing** — Send text snippets between devices instantly
- 📋 **Clipboard Sync** — Share clipboard content across devices
- 🔍 **Auto Discovery** — Devices find each other automatically via mDNS
- 📱 **QR Code Pairing** — Scan to connect devices
- 📊 **Realtime Progress** — WebSocket-powered transfer progress
- 🌙 **Dark Mode** — Light and dark themes
- 🔒 **Private** — Everything stays on your local network
- 💻 **Cross-Platform** — Windows, Linux, macOS

## Architecture

```
Device A                    Device B
   │                           │
   │     ┌─────────────┐      │
   └─────┤  LAN / WiFi  ├─────┘
         └──────┬──────┘
                │
         mDNS Discovery
         (_lanx._tcp)
                │
         HTTP + WebSocket
         (direct device-to-device)
```

Each device runs its own LANX instance. Communication is direct — no central server.

## Installation

### From Binary

Download the latest release for your platform from the [Releases](https://github.com/fendy/lanx/releases) page.

### From Source

```bash
git clone https://github.com/fendy/lanx.git
cd lanx
go build -o lanx ./cmd/lanx/
```

## Usage

```bash
# Start with defaults
lanx

# Custom port
lanx --port 9090

# Custom device name
lanx --name "My Laptop"

# Custom data directory
lanx --data /path/to/data
```

LANX starts and displays:

```
LANX

Local sharing server started

Local:
http://192.168.1.10:8080

Device: My Laptop

Waiting for devices...
```

Open the URL in any browser on your network to access the web UI.

## CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--port` | HTTP server port | `8080` |
| `--name` | Device name | OS hostname |
| `--data` | Data directory | `~/.lanx` |
| `--version` | Show version | |
| `--help` | Show help | |

## Network Requirements

- All devices must be on the **same local network** (LAN/WiFi)
- **No internet required** — works completely offline
- mDNS multicast must be allowed (most routers allow this by default)
- Port 8080 (or custom) must be accessible between devices

## Data Directory

```
~/.lanx/
├── config.json      # Device configuration
└── downloads/       # Received files
```

## Security

- Random device IDs (UUID v4)
- Pairing tokens with 5-minute expiry
- Filename sanitization (prevents path traversal)
- Request size limits
- No data leaves your local network

## Development

### Prerequisites

- Go 1.21+

### Build

```bash
go build -o lanx ./cmd/lanx/
```

### Test

```bash
go test ./...
```

### Cross-Platform Build

```bash
# Windows
GOOS=windows GOARCH=amd64 go build -o lanx.exe ./cmd/lanx/

# Linux
GOOS=linux GOARCH=amd64 go build -o lanx ./cmd/lanx/

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o lanx ./cmd/lanx/
```

## Troubleshooting

### Devices not discovering each other

- Ensure both devices are on the same WiFi/LAN
- Check that mDNS (port 5353 UDP) is not blocked by firewall
- Try accessing the URL directly: `http://<ip>:<port>`

### File transfer fails

- Check available disk space
- Verify the download directory is writable
- Large files stream to disk — ensure stable network connection

### WebSocket connection issues

- Some corporate proxies block WebSocket connections
- Try accessing via direct IP instead of hostname

## Tech Stack

- **Backend**: Go (standard library + minimal dependencies)
- **Frontend**: Vanilla HTML/CSS/JS (embedded in binary)
- **Discovery**: mDNS via [zeroconf](https://github.com/grandcat/zeroconf)
- **QR Code**: [go-qrcode](https://github.com/skip2/go-qrcode)
- **WebSocket**: [coder/websocket](https://github.com/coder/websocket)

## License

MIT
