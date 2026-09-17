# LANX — Berbagi Data Antar-Perangkat di Jaringan Lokal

LANX adalah aplikasi berbagi data lokal yang dirancang untuk pertukaran berkas, teks, dan papan klip (clipboard) secara langsung antar-perangkat dalam satu jaringan lokal (LAN atau Wi-Fi). Aplikasi ini beroperasi sepenuhnya secara luring (offline) tanpa memerlukan koneksi internet, infrastruktur cloud, server perantara, ataupun basis data eksternal.

Seluruh antarmuka web modern dikompilasi langsung ke dalam satu berkas biner mandiri (*single binary*), memberikan kemudahan akses tanpa konfigurasi rumit untuk berbagai sistem operasi.

---

## Performa dan Efisiensi Sumber Daya

Aplikasi ini dioptimalkan untuk meminimalkan beban komputasi perangkat:

- Penggunaan RAM (Idle): Sekitar 18 MB hingga 20 MB Working Set RAM.
- Penggunaan RAM (Transfer Aktif): Konstan O(1) buffer memory melalui teknik *streaming io.Copy* per potongan data, mencegah lonjakan konsumsi memori saat mentransfer berkas berukuran gigabyte.
- Ukuran Biner: Berkas eksekutabel tunggal (~13 MB) yang telah mencakup seluruh aset antarmuka dan dependensi.
- Penggunaan CPU: Mendekati 0% saat kondisi diam (idle); berbasis *event-driven* untuk WebSocket dan mDNS.

---

## Fitur Utama

- Transfer Berkas: Unggah dan unduh berkas secara streaming berkecepatan tinggi tanpa membebani kapasitas RAM.
- Berbagi Teks: Mengirim catatan, tautan, dan potongan teks antar-perangkat secara instan.
- Sinkronisasi Papan Klip (Clipboard): Salin dan tempel konten antar-perangkat dengan sekali klik.
- Penemuan Otomatis (Zero-Configuration): Perangkat saling menemukan secara otomatis di jaringan lokal menggunakan mDNS (Multicast DNS).
- Pemasangan Cepat via QR Code: Perangkat seluler dapat terhubung langsung dengan memindai kode QR di layar.
- Telemetri Real-Time: Pemantauan progres transfer, kecepatan, dan status secara langsung melalui koneksi WebSocket.
- Tema Gelap dan Terang: Antarmuka yang bersih, responsif, dan nyaman digunakan di desktop maupun ponsel.
- Privasi Terjaga: Seluruh data dan transmisi tetap berada di dalam jaringan lokal tanpa ada kebocoran keluar.
- Lintas Platform: Dapat dijalankan di Windows, Linux, dan macOS.

---

## Arsitektur Sistem

LANX menggunakan topologi *peer-to-peer* terdesentralisasi. Setiap perangkat menjalankan server HTTP lokal dan modul mDNS broadcaster/listener mandiri.

```
       +-----------------------+              +-----------------------+
       |  Perangkat A (LANX)   |              |  Perangkat B (LANX)   |
       |  - Server HTTP        |              |  - Server HTTP        |
       |  - WebSocket Hub      |              |  - WebSocket Hub      |
       |  - mDNS Announcer     |              |  - mDNS Announcer     |
       +-----------+-----------+              +-----------+-----------+
                   |                                      |
                   |      Penemuan Perangkat (mDNS)       |
                   |<====================================>|
                   |        (_lanx._tcp / Port 5353)      |
                   |                                      |
                   |   Aliran Data HTTP & WebSocket       |
                   |<------------------------------------>|
                   |    (Berkas, Teks, Data Clipboard)    |
```

### Alur Komunikasi

1. Penemuan (Discovery): Saat aplikasi dimulai, LANX mempublikasikan layanannya (`_lanx._tcp`) melalui mDNS sekaligus memindai perangkat lain di subnet yang sama.
2. Resolusi: Perangkat yang terdeteksi akan langsung muncul di daftar perangkat aktif pada antarmuka web.
3. Pengiriman Data: Berkas dan teks dikirim langsung antar-perangkat menggunakan HTTP POST dengan mekanisme streaming multipart.
4. Notifikasi: Sambungan WebSocket menyiarkan kehadiran perangkat baru dan progres transfer langsung ke sesi peramban yang aktif.

---

## Instalasi

### Kebutuhan Sistem

- Go versi 1.21 atau lebih baru (jika melakukan kompilasi dari kode sumber)
- Jaringan lokal (Wi-Fi atau kabel LAN)

### Kompilasi dari Kode Sumber

```bash
git clone https://github.com/fendyramadhani9-cloud/LANX-Lightweight-Local-Device-Sharing.git
cd LANX-Lightweight-Local-Device-Sharing
go build -ldflags="-s -w" -o lanx ./cmd/lanx/
```

Untuk pengguna Windows:

```powershell
go build -ldflags="-s -w" -o lanx.exe ./cmd/lanx/
```

---

## Panduan Penggunaan

Jalankan aplikasi dengan konfigurasi standar:

```bash
./lanx
```

### Opsi Perintah (CLI Flags)

| Parameter | Tipe | Nilai Bawaan | Deskripsi |
|-----------|------|--------------|-----------|
| `--port` | integer | `8080` | Port untuk layanan HTTP dan WebSocket |
| `--name` | string | Hostname | Nama perangkat yang akan ditampilkan ke perangkat lain |
| `--data` | string | `~/.lanx` | Direktori penyimpanan berkas unduhan dan konfigurasi |
| `--version` | boolean | `false` | Menampilkan informasi versi aplikasi |
| `--help` | boolean | `false` | Menampilkan petunjuk opsi perintah |

### Contoh Penggunaan

Menjalankan pada port khusus dengan nama perangkat tertentu:

```bash
./lanx --port 9000 --name "Laptop-Kerja"
```

Menentukan lokasi folder penyimpanan berkas yang diterima:

```bash
./lanx --data "D:/LANX-Storage"
```

Setelah aplikasi berjalan, terminal akan menampilkan alamat URL lokal (contoh: `http://192.168.1.50:8080`). Buka alamat tersebut melalui peramban (browser) di perangkat apa pun dalam jaringan yang sama.

---

## Struktur Direktori Data

Secara default, data aplikasi disimpan di direktori home pengguna (atau lokasi yang ditentukan melalui parameter `--data`):

```
~/.lanx/
├── config.json         # Identitas perangkat, UUID, dan preferensi
└── downloads/          # Direktori penampung berkas yang diterima
```

---

## Aspek Keamanan dan Privasi

- Isolasi Jaringan: Data tidak pernah keluar dari jaringan lokal. Tidak ada pelacakan, analitik, maupun koneksi ke server pihak ketiga.
- Pencegahan Path Traversal: Nama berkas yang masuk disaring secara ketat untuk mencegah manipulasi direktori sistem.
- Token Pairing Dinamis: Token otentikasi pemasangan perangkat memiliki masa kedaluwarsa 5 menit yang diacak menggunakan algoritma kriptografi.
- Proteksi Alokasi Memori: Pembatasan ukuran payload dan mekanisme streaming mencegah serangan kehabisan memori (*out of memory*).

---

## Kompilasi Lintas Platform (Cross-Compilation)

Anda dapat membuat berkas instalasi biner untuk berbagai sistem operasi:

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

## Panduan Pemecahan Masalah

### Perangkat Tidak Saling Terdeteksi

- Pastikan semua perangkat terhubung ke router atau hotspot Wi-Fi yang sama.
- Pastikan fitur AP Isolation (Client Isolation) pada router dalam keadaan dinonaktifkan.
- Periksa bahwa port UDP 5353 (mDNS) tidak diblokir oleh firewall sistem (Windows Defender, UFW, atau pf).
- Jika mDNS tidak didukung oleh jaringan, perangkat tetap dapat dihubungkan langsung dengan membuka alamat IP dan port perangkat tujuan melalui peramban.

### Transfer Berkas Gagal

- Pastikan ruang penyimpanan pada perangkat penerima mencukupi.
- Pastikan folder tujuan memiliki izin akses tulis (*write permissions*).

---

## Spesifikasi Teknis

- Bahasa Pemrograman: Go (Golang)
- Server HTTP: Go `net/http` standard library
- Penemuan Jaringan: Multicast DNS (`grandcat/zeroconf`)
- Implementasi WebSocket: `coder/websocket`
- Pembuat QR Code: `skip2/go-qrcode`
- Antarmuka Frontend: HTML5, CSS3, dan JavaScript murni (Vanilla JS) tanpa ketergantungan CDN eksternal

---

## Lisensi

Proyek ini dilisensikan di bawah lisensi MIT.
