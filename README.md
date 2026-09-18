# LANX — Berbagi Data & Berkas Antar-Perangkat di Jaringan Lokal

LANX adalah aplikasi berbagi data lokal yang dirancang untuk pertukaran berkas, folder, teks, dan papan klip (clipboard) secara instan antar-perangkat dalam satu jaringan lokal (LAN atau Wi-Fi). Aplikasi ini beroperasi sepenuhnya secara luring (offline) tanpa memerlukan koneksi internet, akun login, infrastruktur cloud, server perantara, ataupun basis data eksternal.

Seluruh antarmuka web modern dikompilasi langsung ke dalam satu berkas biner mandiri (*single executable binary*), memberikan kemudahan akses tanpa konfigurasi rumit untuk berbagai sistem operasi (Windows, Linux, macOS, Android, iOS).

---

## Fitur Unggulan

- 📬 **Kotak Masuk / Offline Queue (Store-and-Forward)**: Tetap bisa mengirim berkas, tugas, folder, atau teks ke komputer mana pun yang terdaftar meski komputer tujuan sedang **mati atau offline**. Berkas disimpan aman di server, dan begitu komputer tujuan menyala / terhubung ke LANX, semua berkas langsung otomatis terkirim dan terunduh!
- 🗑️ **Auto-Delete on Delivery & Anti-Penuh Server**: Harddisk server dijamin tidak akan membengkak. Berkas 1-per-1 otomatis langsung dihapus dari server begitu komputer penerima selesai mengunduhnya. Terdapat juga pembersih berkas usang otomatis (background cleaner) dan tombol *Bersihkan Server* di menu Pengaturan.
- ⚡ **Auto-Accept / Auto-Download**: Opsi untuk otomatis mengunduh berkas langsung ke folder `Downloads` laptop/PC tanpa perlu mengeklik tombol unduh setiap saat.
- 👁️ **In-Browser Media Preview (Lightbox Viewer)**: Pratinjau foto resolusi penuh, pemutar video native (`.mp4`, `.webm`, `.mov`), pemutar audio musik (`.mp3`, `.wav`, `.m4a`), dokumen PDF, dan file teks/kode (`.txt`, `.json`, `.md`) langsung di peramban tanpa harus membuka folder download.
- 📸 **Kamera Cepat / Instant Photo Shot (Khusus Mobile)**: Tombol kamera instan di ponsel untuk memotret catatan fisik/papan tulis dan langsung otomatis terkirim ke komputer target.
- 📁 **Kirim Folder Utuh (Auto-Zip)**: Tarik (drag & drop) atau pilih seluruh folder berstruktur sub-folder. Sistem otomatis mengemasnya secara streaming menjadi berkas `.zip`.
- 🚀 **Speedometer & Estimasi Waktu Nyata (ETA)**: Tampilan kecepatan transfer real-time (`24.5 MB/s`) dan sisa waktu transfer (`sisa 12 dtk`) dengan peredaman *Exponential Moving Average (EMA)*.
- 📢 **Mode Pengiriman Fleksibel**:
  - **1 per 1 Device**: Kirim berkas/teks khusus ke satu perangkat tertentu (baik online maupun offline).
  - **Semua Device (All)**: Siarkan materi, tugas, berkas, atau catatan ke seluruh perangkat yang terhubung serentak dalam satu klik.
- 🏷️ **Profil Perangkat & Ganti Nama Permanen**: Setiap perangkat dapat dinamai sendiri (misal: "Laptop Guru", "PC-Lab-01") dan tersimpan permanen di database lokal (`~/.lanx/devices.json`).
- 📋 **Sinkronisasi Teks & Papan Klip (Clipboard)**: Kirim teks, tautan, atau pesan cepat antar-perangkat dengan sekali klik.
- 🔍 **Penemuan Otomatis (Zero-Configuration)**: Perangkat saling menemukan secara otomatis menggunakan mDNS (Multicast DNS) dan WebSocket.
- 📱 **Pemasangan Cepat via QR Code**: Perangkat seluler cukup memindai kode QR di layar untuk langsung terhubung.
- 🔒 **Privasi & Keamanan Penuh**: Seluruh transmisi berada di jaringan lokal Anda tanpa pelacakan pihak ketiga.
- 🌐 **Mendukung Tunnels (Cloudflare Tunnel, Tailscale, ngrok)**: Otomatis mendeteksi WebSocket Secure (`wss://`) dan header IP klien saat diakses melalui tunnel publik.

---

## Performa dan Efisiensi Sumber Daya

- **Penggunaan RAM (Idle)**: Hanya ~18 MB hingga 25 MB Working Set RAM.
- **Penggunaan RAM (Transfer Aktif)**: Konstan O(1) buffer memory via streaming `io.Copy`, aman untuk transfer file berukuran puluhan gigabyte.
- **Ukuran Biner**: Berkas eksekutabel tunggal (~14 MB) tanpa dependensi eksternal.
- **Penggunaan CPU**: Mendekati 0% saat kondisi diam (idle); berbasis *event-driven*.

---

## Panduan Menjalankan LANX

### 1. Di Komputer Windows (Laptop / PC)

#### A. Menjalankan di Depan Layar (Biasa via Terminal)
```powershell
# Jalankan lanx.exe langsung
.\lanx.exe

# Atau jika ingin menentukan port dan nama perangkat
.\lanx.exe --port 9000 --name "Laptop-Fendy"
```

#### B. Menjalankan di Latar Belakang (Background / Tanpa Jendela Terminal)
Tersedia skrip praktis yang langsung siap digunakan:
1. **Menjalankan**: Dobel klik file **`start-background.vbs`**.
   - LANX akan langsung berjalan di latar belakang secara siluman (*silent*).
   - Muncul notifikasi popup kecil di pojok layar: *"LANX sudah berjalan di latar belakang!"*.
2. **Mematikan**: Dobel klik file **`stop-lanx.bat`**.

*Atau via PowerShell:*
```powershell
# Jalankan tersembunyi
Start-Process -FilePath ".\lanx.exe" -WindowStyle Hidden

# Hentikan proses
Stop-Process -Name "lanx" -Force
```

#### C. Menjalankan Otomatis Saat Windows Dinyalakan (Auto-Start Booting)
1. Tekan tombol **Windows + R** di keyboard, ketik `shell:startup`, lalu tekan **Enter**.
2. Buat *Shortcut* dari file `start-background.vbs` (Klik kanan `start-background.vbs` -> *Create shortcut*).
3. Pindahkan file shortcut tersebut ke dalam folder Startup yang tadi terbuka.
4. Selesai! LANX otomatis aktif di latar belakang setiap kali laptop dinyalakan.

---

### 2. Di Server Linux / Proxmox VE (Untuk Lab Komputer / Kantor)

Menjalankan LANX di server Proxmox (LXC Container Debian/Ubuntu atau VM) sangat ideal untuk lab komputer sekolah/kampus karena **PC siswa tidak perlu install aplikasi apa pun** (cukup buka browser ke alamat server).

#### Pilihan A: Menggunakan Systemd Service (Rekomendasi Utama, Super Ringan)

1. **Siapkan binary LANX untuk Linux:**
   *(Jika kompilasi dari Windows, jalankan di PowerShell)*:
   ```powershell
   $env:CGO_ENABLED="0"; $env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags="-w -s" -o lanx ./cmd/lanx
   ```
   *(Atau `go build` langsung di console server Linux Anda).*

2. **Pasang binary dan service di Linux / LXC Proxmox:**
   ```bash
   # Buat folder kerja
   sudo mkdir -p /opt/lanx /var/lib/lanx
   sudo cp lanx /opt/lanx/
   sudo chmod +x /opt/lanx/lanx

   # Pasang file service systemd
   sudo cp lanx.service /etc/systemd/system/
   ```

3. **Aktifkan dan jalankan service di background 24/7:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now lanx
   ```

4. **Periksa status:**
   ```bash
   sudo systemctl status lanx
   ```

5. **Perintah Pengelolaan:**
   ```bash
   sudo systemctl restart lanx   # Me-restart LANX
   sudo systemctl stop lanx      # Menghentikan LANX
   sudo journalctl -u lanx -f    # Melihat log real-time
   ```

#### Pilihan B: Menggunakan Docker & Docker Compose

Jika server Linux/Proxmox Anda menggunakan Docker:

1. **Jalankan container di background:**
   ```bash
   docker compose up -d
   ```
2. **Cek status:**
   ```bash
   docker compose ps
   docker compose logs -f
   ```
3. **Menghentikan:**
   ```bash
   docker compose down
   ```

---

### 3. Menggunakan Tunnels (Cloudflare Tunnel, Tailscale, ngrok)

LANX dapat ditempelkan ke layanan Tunnel agar bisa diakses dari luar jaringan lokal (internet) dengan aman:

#### A. Cloudflare Tunnel (Gratis, Otomatis HTTPS & WebSocket Secure)
```bash
# Jalankan quick tunnel sementara
cloudflared tunnel --url http://localhost:9000
```
Atau hubungkan ke tunnel permanen di dashboard Cloudflare Zero Trust mengarah ke port `9000`.

#### B. Ngrok
```bash
ngrok http 9000
```

#### C. Pinggy (Tanpa Perlu Install Aplikasi)
```bash
ssh -p 443 -R0:localhost:9000 a.pinggy.io
```

---

## Opsi Perintah CLI (Command Line Flags)

| Parameter | Tipe | Nilai Bawaan | Deskripsi |
|-----------|------|--------------|-----------|
| `--port` | integer | `8080` | Port untuk layanan HTTP dan WebSocket |
| `--name` | string | Hostname | Nama perangkat yang akan ditampilkan ke perangkat lain |
| `--data` | string | `~/.lanx` | Lokasi folder basis data profil dan unduhan berkas |
| `--version` | boolean | `false` | Menampilkan informasi versi aplikasi |
| `--help` | boolean | `false` | Menampilkan petunjuk opsi perintah |

### Contoh Penggunaan Khusus

```bash
# Menjalankan di port 9000 dengan nama khusus
./lanx --port 9000 --name "Server-Lab-Komputer"

# Menentukan lokasi penyimpanan berkas khusus
./lanx --data "/mnt/storage/lanx-data"
```

---

## Kompilasi dari Kode Sumber (Build)

### Kebutuhan
- Go versi 1.21 atau lebih baru

```bash
# Clone repositori
git clone https://github.com/fendyramadhani9-cloud/LANX-Lightweight-Local-Device-Sharing.git
cd LANX-Lightweight-Local-Device-Sharing

# Kompilasi untuk sistem saat ini
go build -ldflags="-s -w" -o lanx ./cmd/lanx/
```

### Kompilasi Silang (Cross-Compilation)

```bash
# Windows (64-bit)
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o lanx.exe ./cmd/lanx/

# Linux (64-bit)
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o lanx-linux ./cmd/lanx/

# macOS (Apple Silicon arm64)
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o lanx-mac ./cmd/lanx/
```

---

## Struktur Direktori Data

Secara default, data aplikasi disimpan di `~/.lanx` (atau lokasi `--data`):

```
~/.lanx/
├── config.json         # Konfigurasi aplikasi, port, tema, dan ID perangkat
├── devices.json        # Database lokal profil perangkat & nama alias perangkat
└── downloads/          # Direktori penampung berkas unduhan
```

---

## Spesifikasi Teknis

- **Backend**: Go (Golang) standard library `net/http`, `archive/zip`
- **Real-Time Engine**: WebSocket via `github.com/coder/websocket`
- **Device Discovery**: Multicast DNS via `github.com/grandcat/zeroconf`
- **QR Code Engine**: `github.com/skip2/go-qrcode`
- **Frontend UI**: Vanilla JavaScript (ES6+), HTML5, CSS3 Modern Glassmorphism (Zero Framework, Zero CDN dependencies, 100% luring).

---

## Lisensi

Proyek ini dilisensikan di bawah lisensi MIT.
