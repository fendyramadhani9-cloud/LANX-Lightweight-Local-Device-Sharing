# LANX — Lightweight Local Device Sharing

LANX is a lightweight, self-contained local device sharing application designed for seamless peer-to-peer data exchange across devices connected to the same Local Area Network (LAN or Wi-Fi). It functions completely offline without requiring internet access, cloud infrastructure, third-party relays, or external databases.

The system embeds a modern web interface directly into a single binary, providing a friction-free experience for transferring files, text snippets, and clipboard data across heterogeneous operating systems.

---

## Performance and Resource Footprint

Designed with minimal overhead in mind:

- Memory Footprint (Idle): ~18 MB to 20 MB Working Set RAM.
- Memory Footprint (Active Transfer): Constant O(1) buffer memory via streaming io.Copy chunking, preventing memory spikes during multi-gigabyte transfers.
- Binary Size: Single self-contained executable (~13 MB) with all assets and dependencies compiled in.
- CPU Utilization: Near 0% at idle; lightweight event-driven WebSocket and mDNS operations.

---

## Key Features

- File Transfer: High-throughput streaming uploads and downloads. Large files are streamed directly to disk without loading into RAM.
- Text and Snippet Sharing: Real-time bilateral text sharing between connected network clients.
- Clipboard Synchronization: Seamless one-click copying and pasting across local machines.
- Zero-Configuration Discovery: Automatic peer discovery across the local subnet utilizing mDNS (Multicast DNS).
- QR-Based Quick Pairing: Mobile devices can connect immediately by scanning an on-screen QR code.
- Real-Time Transfer Telemetry: WebSocket-based live progress updates, throughput tracking, and transfer status reporting.
- Native Dark and Light Themes: Clean, responsive user interface adapted for desktop and mobile viewports.
- Local Privacy First: All communications and data remain strictly contained within the local subnet.
- Cross-Platform Compatibility: Fully functional on Windows, Linux, and macOS.

---

## System Architecture

LANX utilizes a decentralized peer-to-peer topology. Each node runs an embedded HTTP server and mDNS broadcaster/listener.

```
       +-----------------------+              +-----------------------+
       |   Device A (LANX)     |              |   Device B (LANX)     |
       |  - HTTP Server        |              |  - HTTP Server        |
       |  - WebSocket Hub      |              |  - WebSocket Hub      |
       |  - mDNS Announcer     |              |  - mDNS Announcer     |
       +-----------+-----------+              +-----------+-----------+
                   |                                      |
                   |       mDNS Peer Discovery            |
                   |<====================================>|
                   |        (_lanx._tcp / Port 5353)      |
                   |                                      |
                   |   Direct HTTP & WebSocket Stream     |
                   |<------------------------------------>|
                   |      (File, Text, Clipboard Data)    |
```

### Communication Flow

1. Discovery: On startup, LANX announces its service instance (`_lanx._tcp`) via mDNS while actively querying for other network peers.
2. Connection: Peer devices are resolved and displayed in the local device registry.
3. Data Transfer: Files and text payloads are transmitted directly via HTTP POST endpoints using streaming multipart readers to ensure low memory consumption.
4. Notifications: WebSocket connections broadcast device presence and live transfer progress to all active browser sessions.

---

## Installation

### Prerequisites

- Go 1.21 or later (if compiling from source)
- Local network connection (Wi-Fi or Ethernet)

### Compiling from Source

```bash
git clone https://github.com/fendyramadhani9-cloud/LANX-Lightweight-Local-Device-Sharing.git
cd LANX-Lightweight-Local-Device-Sharing
go build -ldflags="-s -w" -o lanx ./cmd/lanx/
```

On Windows:

```powershell
go build -ldflags="-s -w" -o lanx.exe ./cmd/lanx/
```

---

## Usage

Start the application with default settings:

```bash
./lanx
```

### Command Line Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--port` | integer | `8080` | Port for the HTTP and WebSocket service |
| `--name` | string | Hostname | Display name broadcasted to other network peers |
| `--data` | string | `~/.lanx` | Directory for configuration and received downloads |
| `--version` | boolean | `false` | Display version information and exit |
| `--help` | boolean | `false` | Display command usage and available flags |

### Examples

Run on a custom port with a designated device name:

```bash
./lanx --port 9000 --name "Workstation-Office"
```

Specify a custom download and data directory:

```bash
./lanx --data "/opt/lanx-storage"
```

Once started, the console will output the local network URL (e.g., `http://192.168.1.50:8080`). Navigate to this address from any browser on your local network.

---

## Directory Structure

LANX automatically manages its state within the user's home directory (or custom path provided via `--data`):

```
~/.lanx/
├── config.json         # Device identity, UUID, and user preferences
└── downloads/          # Default destination directory for received files
```

---

## Security and Integrity Considerations

- Subnet Isolation: Data never leaves the local network boundary. No external telemetry or remote cloud connections are initiated.
- Path Traversal Protection: Inbound file names are strictly sanitized to prevent directory traversal vulnerabilities (e.g., stripping relative path components and illegal characters).
- Expiring Pairing Tokens: Pairing operations utilize time-limited security tokens (5-minute expiration) generated via cryptographic random bytes.
- Memory Defense: Upload limits and streaming handlers prevent denial-of-service attempts via unbounded memory allocation.

---

## Cross-Platform Compilation

Build binaries for target platforms from any development environment:

```bash
# Windows (64-bit)
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/lanx-windows-amd64.exe ./cmd/lanx/

# Linux (64-bit)
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/lanx-linux-amd64 ./cmd/lanx/

# macOS (Apple Silicon - arm64)
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/lanx-darwin-arm64 ./cmd/lanx/

# macOS (Intel - amd64)
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/lanx-darwin-amd64 ./cmd/lanx/
```

---

## Troubleshooting

### Devices Not Discoverable

- Verify that all machines are connected to the same subnet and AP isolation (client isolation) is disabled on your Wi-Fi router.
- Ensure that UDP port 5353 (mDNS) is not blocked by local software firewalls (Windows Defender, UFW, or pf).
- If multicast discovery is restricted on your network, access the target machine directly using its IP address and port in your browser.

### Transfer Failures

- Confirm that write permissions exist on the download directory.
- Ensure adequate disk storage is available for incoming payloads.

---

## Technical Specifications

- Core Runtime: Go (Golang)
- Web Server: Go `net/http` standard library
- Network Discovery: Multicast DNS (`grandcat/zeroconf`)
- WebSocket Implementation: `coder/websocket`
- QR Generation: `skip2/go-qrcode`
- Frontend: Embedded standards-compliant HTML5, CSS3, and ES6 JavaScript (No external CDN dependencies)

---

## License

This project is licensed under the MIT License.
