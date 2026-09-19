# LANX — Local Network Data & File Sharing Platform

LANX adalah perangkat lunak berbagi data lokal berkinerja tinggi yang dirancang untuk pertukaran berkas, direktori, teks, dan papan klip (clipboard) secara langsung antar-perangkat dalam satu jaringan area lokal (LAN atau Wi-Fi). Aplikasi ini beroperasi secara mandiri tanpa ketergantungan koneksi internet, akun pengguna wajib, infrastruktur cloud pihak ketiga, maupun dependensi basis data eksternal.

Seluruh antarmuka web dikompilasi langsung ke dalam satu berkas biner mandiri (*single executable binary*), memungkinkan penerapan tanpa instalasi dependensi runtime pada berbagai sistem operasi seperti Windows, Linux, macOS, Android, dan iOS.

---

## Fitur Utama

### 1. Pustaka Bersama (Shared Library)
- **Penyimpanan Persisten**: Menyediakan repositori bersama untuk modul ajar, materi kuliah, dan berkas tugas yang tidak terhapus otomatis saat diunduh serta bertahan saat server dimulai ulang.
- **Unggah Tamu Tanpa Kata Sandi**: Pengguna dan siswa dapat langsung mengunggah materi ke Pustaka tanpa memerlukan pendaftaran akun.
- **Masa Kedaluwarsa Berkas**: Mendukung opsi retensi waktu mulai dari 3, 7, 14, 30, 90 hari, hingga 1 tahun, dilengkapi pemilih tanggal kalender (*calendar date picker*) dengan batas maksimal 365 hari.
- **Pembersihan Otomatis**: Layanan pembersih di latar belakang (*background cleaner*) secara berkala memeriksa dan menghapus berkas yang telah melewati masa aktif.
- **Penghapusan Mandiri (Self-Delete Token)**: Server menerbitkan token kriptografi pada peramban pengunggah (`localStorage`), sehingga pengunggah dapat menghapus berkas miliknya sendiri tanpa mengizinkan tamu lain menghapusnya.
- **Pencarian dan Filter**: Pencarian cepat berbasis nama berkas, catatan keterangan, maupun nama pengunggah.
- **Pemantauan Kapasitas Disk**: Indikator kapasitas penyimpanan Pustaka real-time dengan batas keras (*hard cap quota*) untuk menjaga ruang simpan server tetap aman.

### 2. Catatan dan Pesan Berkas (File Descriptions)
- Pengirim dapat menyematkan catatan penjelasan (contoh: deskripsi tugas, konteks gambar, atau instruksi pengerjaan) pada transfer langsung maupun saat menyimpan ke Pustaka.
- Catatan ditampilkan secara visual pada riwayat transfer, gelembung notifikasi penerima, serta kartu berkas Pustaka.

### 3. Kendali dan Mode Administrator
- **Autentikasi Master PIN**: Akses panel kontrol administrator dilindungi oleh PIN utama (bawaan: `123456`, dapat diperbarui melalui pengaturan).
- **Persetujuan Cerdas Berkas Besar (Smart Approval)**: Berkas Pustaka yang melebihi batas ukuran tertentu (bawaan: 50 MB) secara otomatis ditahan dalam antrean persetujuan (*pending approval*) untuk mencegah kepenuhan disk akibat pengunggahan yang tidak terkontrol.
- **Notifikasi Persetujuan Real-Time**: Administrator menerima pemberitahuan instan via WebSocket untuk menyetujui atau menolak berkas besar.
- **Promosi Peran Perangkat (Role Promotion)**: Administrator dapat memberikan status admin kepada perangkat lain di jaringan secara langsung tanpa perlu membagikan Master PIN.
- **Hak Akses Penuh**: Administrator memiliki wewenang untuk menghapus berkas apa pun di Pustaka serta mengatur kapasitas kuota penyimpanan.

### 4. Transfer Langsung Antar-Perangkat
- **Bebas Kuota Pustaka**: Mode transfer langsung antar-perangkat tidak dikenakan batas persetujuan berkas besar (mendukung berkas hingga kapasitas batas engine 10 GB).
- **Kotak Masuk Luring (Store-and-Forward Mailbox)**: Pengiriman berkas tetap dapat dilakukan meskipun komputer tujuan sedang mati atau terputus. Berkas disimpan sementara di server dan otomatis terkirim begitu perangkat tujuan terhubung.
- **Auto-Delete on Delivery**: Berkas transfer langsung 1-ke-1 otomatis dihapus dari penyimpanan server begitu selesai diunduh oleh penerima guna menjaga kebersihan disk server.
- **Unduh Otomatis (Auto-Download)**: Opsi opsional bagi penerima untuk langsung menyimpan berkas masuk ke folder unduhan tanpa konfirmasi manual.
- **Pratinjau Media di Peramban**: Pratinjau langsung untuk berkas citra, pemutar video (`.mp4`, `.webm`, `.mov`), pemutar audio (`.mp3`, `.wav`, `.m4a`), dokumen PDF, dan berkas teks/kode sumber tanpa perlu mengunduh terlebih dahulu.
- **Pengemasan Direktori Streaming (Auto-Zip)**: Unggah folder utuh beserta struktur sub-direktorinya yang otomatis dikemas menjadi arsip `.zip` secara streaming.
- **Speedometer dan Estimasi Waktu (ETA)**: Pengukuran kecepatan transfer real-time dengan penghalusan *Exponential Moving Average (EMA)* dan kalkulasi sisa waktu transfer.
- **Mode Pengiriman Fleksibel**: Pilihan kirim ke satu perangkat tertentu (*1-to-1*) atau siaran serentak ke seluruh perangkat di jaringan (*Broadcast*).

### 5. Arsitektur Ganda (Dual UX Experience)
LANX mengusung arsitektur antarmuka terarah (*tailored dual experience*) yang membedakan pengalaman pengguna Desktop dan Mobile secara fundamental:

1. **Desktop / Laptop UX (Lab File Manager)**:
   - Dirancang khusus untuk PC laboratorium komputer dan laptop berbasis interaksi mouse dan keyboard.
   - **Sidebar Persisten**: Navigasi kiri yang selalu terlihat untuk beralih antara Files, Recent, Shared Library, Text, dan Devices. Dilengkapi indikator pemakaian penyimpanan server dan status host LAN.
   - **Bilah Pencarian Global**: Pencarian berkas, catatan, dan perangkat secara instan di bagian atas antarmuka.
   - **Tampilan Grid dan List**: Tombol alih tampilan berkas antara kartu grid modern dan tabel baris berkas.
   - **Area Tarik-dan-Lepas (Drag & Drop Zone)**: Area dropzone interaktif untuk transfer berkas atau folder secara langsung.

2. **Mobile / Touch UX (Native Touch First)**:
   - Dirancang ergonomis untuk navigasi satu tangan menggunakan ibu jari (*thumb-zone navigation*) pada ponsel pintar dan tablet.
   - **Bilah Atas Ringkas**: Menampilkan identitas perangkat aktif dan status koneksi tanpa memakan ruang layar.
   - **Daftar Berkas Vertikal Bersih**: Format baris berkas ringkas yang memuat ikon tipe berkas, nama berkas, ukuran, waktu transfer, pengirim, dan tombol aksi titik-tiga vertikal (`⋮`).
   - **Bilah Navigasi Bawah (Bottom Navigation Bar)**: Tersemat di bagian bawah layar dengan 5 tab utama (Files, Recent, Shared, Text, More).
   - **Tombol Tambah Mengambang (Floating Action Button / FAB)**: Tombol `+` mengambang di atas bilah navigasi bawah untuk membuka lembar unggah secara instan.
   - **Lembar Aksi Bawah (Contextual Bottom Sheets)**: Menggantikan popup kaku dan menu klik kanan. Menekan tombol `⋮` pada berkas akan memunculkan menu slide-up bawah untuk Unduh, Pratinjau, Salin Tautan, dan Hapus.
   - **Bebas Ketergantungan Drag & Drop**: Seluruh interaksi mobile digantikan dengan pemilih berkas native, kamera langsung, dan pemilihan folder.

### 6. Komunikasi Teks dan Penemuan Jaringan
- **Sinkronisasi Teks & Papan Klip**: Pengiriman teks, catatan ringkas, dan tautan antar-perangkat secara instan.
- **Penemuan Otomatis (Zero-Configuration)**: Deteksi perangkat otomatis di jaringan lokal menggunakan Multicast DNS (mDNS) dan WebSocket.
- **Penyambungan Kode QR**: Perangkat seluler dapat memindai kode QR di antarmuka web untuk langsung terhubung.
- **Dukungan Reverse Proxy & Tunnels**: Kompatibel dengan Cloudflare Tunnel, Tailscale, ngrok, dan Nginx/Caddy dengan deteksi otomatis header protokol dan WebSocket Secure (`wss://`).

---

## Profil Kinerja dan Penggunaan Memori

Aplikasi ini dirancang dengan efisiensi tinggi berbasis bahasa Go murni:

| Parameter | Nilai Rata-rata | Keterangan |
|-----------|-----------------|------------|
| Konsumsi RAM (Idle) | ~11 MB - 20 MB | Working Set Memory pada sistem operasi Windows dan Linux |
| Konsumsi RAM (Transfer Aktif) | ~30 MB - 60 MB | Memori streaming I/O konstan O(1) buffer 32 KB, tidak memuat seluruh berkas ke RAM |
| Penggunaan CPU (Idle) | Mendekati 0.0% | Arsitektur berbasis *event-driven* murni |
| Ukuran Biner Mandiri | ~15 MB | Berisi seluruh runtime, aset web (HTML/CSS/JS), dan logika aplikasi |

---

## Panduan Penerapan (Deployment)

### 1. Sistem Operasi Windows

#### Menjalankan via Terminal
```powershell
# Menjalankan langsung dengan pengaturan standar (Port 8080)
.\lanx.exe

# Menjalankan dengan port dan nama perangkat kustom
.\lanx.exe --port 9000 --name "Workstation-Lab"
```

#### Menjalankan di Latar Belakang (Background Service)
1. **Memulai**: Jalankan berkas `start-background.vbs` untuk menjalankan aplikasi secara tersembunyi tanpa jendela konsol.
2. **Menghentikan**: Jalankan berkas `stop-lanx.bat` atau gunakan perintah PowerShell:
   ```powershell
   Stop-Process -Name "lanx" -Force
   ```
3. **Mulai Otomatis Saat Booting (Auto-Start)**:
   - Tekan tombol `Windows + R`, ketik `shell:startup`, lalu tekan `Enter`.
   - Buat pintasan (*shortcut*) dari berkas `start-background.vbs` dan tempatkan di folder Startup tersebut.

---

### 2. Server Linux / Proxmox VE (LXC Container atau VM)

Penerapan pada server Proxmox atau Linux sangat ideal untuk laboratorium komputer sekolah, kampus, maupun perkantoran karena perangkat klien tidak memerlukan instalasi perangkat lunak apa pun selain peramban web modern.

#### Metode Systemd Service (Rekomendasi Utama)

1. **Kompilasi biner untuk target Linux (jika dikompilasi dari host Windows):**
   ```powershell
   $env:CGO_ENABLED="0"; $env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags="-w -s" -o lanx ./cmd/lanx
   ```

2. **Pemasangan berkas pada server Linux:**
   ```bash
   # Membuat direktori kerja
   sudo mkdir -p /opt/lanx /var/lib/lanx
   sudo cp lanx /opt/lanx/
   sudo chmod +x /opt/lanx/lanx

   # Memasang berkas unit systemd
   sudo cp lanx.service /etc/systemd/system/
   ```

3. **Mengaktifkan dan menjalankan layanan:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now lanx
   ```

4. **Pemeliharaan Layanan:**
   ```bash
   sudo systemctl status lanx     # Memeriksa status proses
   sudo systemctl restart lanx    # Memuat ulang aplikasi
   sudo journalctl -u lanx -f     # Memantau log aktivitas real-time
   ```

#### Metode Docker & Docker Compose

```bash
# Menjalankan kontainer di latar belakang
docker compose up -d

# Memeriksa status dan log
docker compose ps
docker compose logs -f

# Menghentikan layanan
docker compose down
```

---

### 3. Integrasi Tunnel Publik

Untuk akses jarak jauh lintas jaringan melalui internet:

#### Cloudflare Tunnel
```bash
cloudflared tunnel --url http://localhost:8080
```
Atau konfigurasikan ingress rule permanen pada dashboard Cloudflare Zero Trust mengarah ke port lokal LANX.

#### Ngrok
```bash
ngrok http 8080
```

---

## Opsi Perintah Baris (CLI Flags)

| Flag | Tipe | Nilai Bawaan | Penjelasan |
|------|------|--------------|------------|
| `--port` | integer | `8080` | Nomor port jaringan untuk protokol HTTP dan WebSocket |
| `--name` | string | Hostname sistem | Nama pengenal perangkat yang tampil pada perangkat lain |
| `--data` | string | `~/.lanx` | Direktori penyimpanan berkas konfigurasi, Pustaka, dan pangkalan data |
| `--version` | boolean | `false` | Menampilkan nomor versi biner aplikasi |
| `--help` | boolean | `false` | Menampilkan dokumentasi parameter baris perintah |

Contoh konfigurasi khusus:
```bash
./lanx --port 9000 --name "Server-Pusat-Sekolah" --data "/mnt/storage/lanx-data"
```

---

## Kompilasi dari Kode Sumber

### Kebutuhan Lingkungan
- Go versi 1.21 atau versi yang lebih baru.

### Kompilasi Mandiri
```bash
git clone https://github.com/fendyramadhani9-cloud/LANX-Lightweight-Local-Device-Sharing.git
cd LANX-Lightweight-Local-Device-Sharing

# Kompilasi untuk platform sistem saat ini
go build -ldflags="-s -w" -o lanx ./cmd/lanx/
```

### Kompilasi Silang (Cross-Compilation)
```bash
# Target Windows x86_64
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o lanx.exe ./cmd/lanx/

# Target Linux x86_64
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o lanx-linux ./cmd/lanx/

# Target Linux ARM64 (Raspberry Pi / Server ARM)
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o lanx-arm64 ./cmd/lanx/

# Target macOS Apple Silicon
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o lanx-mac ./cmd/lanx/
```

---

## Struktur Direktori Penyimpanan Data

Secara default seluruh berkas tersimpan terisolasi di bawah direktori `~/.lanx` (atau path sesuai flag `--data`):

```
~/.lanx/
├── config.json         # Konfigurasi aplikasi, preferensi tema, PIN admin, dan kuota
├── devices.json        # Database lokal profil perangkat terdaftar dan peran (role)
├── library.json        # Indeks metadata berkas Pustaka (masa aktif, pengunggah, token)
├── library/            # Direktori fisik penyimpanan berkas Pustaka bersama
├── mailbox/            # Direktori antrean berkas Kotak Masuk luring (store-and-forward)
└── downloads/          # Direktori penampung berkas unduhan transfer langsung
```

---

## Spesifikasi Teknis Komponen

- **Bahasa Inti**: Go (Golang) standard library `net/http`, `archive/zip`, `io`
- **Mesin Real-Time**: WebSocket melalui `github.com/coder/websocket`
- **Protokol Penemuan**: Multicast DNS (mDNS) melalui `github.com/grandcat/zeroconf`
- **Pembangkit Kode QR**: `github.com/skip2/go-qrcode`
- **Antarmuka Pengguna**: Vanilla JavaScript (ES6+), HTML5 Semantik, CSS3 Modern (tanpa framework eksternal, tanpa dependensi CDN, beroperasi penuh secara luring).

---

## Lisensi

Proyek ini didistribusikan di bawah lisensi MIT.
