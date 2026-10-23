# APIKU Rust Engine (`apiku-rs`) / Zyvor APIs

High-performance, ultra-low-memory REST API engine written in **Rust (Axum)** with **512 endpoints** across 32 categories (AI, Downloader, Anime, Ephoto, Random, Tools, Maker, Canvas, Fun, Stalker, Search, etc.).

Designed with a 1:1 structural architecture mirroring the Node.js API, serving native high-throughput endpoints with sub-millisecond response times while maintaining a tiny memory footprint.

---

## ⚡ Fitur Utama

- **512 Endpoints & 32 Kategori**: Sinkronisasi penuh 1:1 dengan katalog Node.js.
- **Ultra-Low Memory Footprint**: Berjalan di memory **~15 - 25 MB** (dibandingkan Node.js yang memakan ~400 - 800 MB).
- **Embedded Local Assets (`include_str!` / `include_bytes!`)**: Dataset (seperti quotes anime, template canvas, font) di-compile langsung ke binary untuk performa instan tanpa I/O bottleneck.
- **Self-Contained OpenAPI Specification (`/openapi.json`)**: Auto-generated spec yang sinkron dengan seluruh router Rust, dilengkapi UI Swagger/Scalar di `/docs`.
- **Hybrid Proxy Integration**: Menyajikan route native Rust berkecepatan tinggi, dengan fallback proxy transparan ke Node.js backend untuk handler browser-heavy (Puppeteer/Playwright).
- **Security & Utilities Built-in**:
  - `bot_shield`: Proteksi probe scanner dan bot crawling liar.
  - `visitor_tracker`: Daily unique visitor tracker berbasis hashing.
  - `safe_fetch`: SSRF-safe HTTP client.
  - In-memory cache TTL untuk efisiensi fetch eksternal.

---

## 📦 Persyaratan Sistem

| Komponen | Minimum | Rekomendasi |
|----------|---------|-------------|
| OS | Linux (Ubuntu 22.04 LTS / Debian 12) | Ubuntu 22.04 LTS / Alpine |
| Rust Toolchain | 1.78+ (Edition 2021) | 1.80+ Stable |
| RAM | 256 MB | 512 MB+ |
| Disk | ~100 MB (setelah strip binary) | ~500 MB (termasuk build artifacts) |

---

## 🚀 Instalasi & Menjalankan

### 1. Build & Run Manual (Rust Toolchain)

```bash
# 1. Masuk ke direktori apiku-rs
cd apiku-rs

# 2. Compile binary release teroptimasi
cargo build --release

# 3. Jalankan server
PORT=3005 ./target/release/apiku-rs
```

Server akan aktif di: `http://0.0.0.0:3005`.

---

### 2. Menjalankan via PM2 (Production Manager)

Menjalankan binary Rust langsung di bawah PM2 agar auto-restart saat crash atau server reboot:

```bash
cd apiku-rs

# Compile release
cargo build --release

# Daftarkan proses ke PM2
PORT=3005 pm2 start ./target/release/apiku-rs --name apiku-rs

# Simpan state PM2 (auto-start saat boot)
pm2 save

# Cek logs dan status
pm2 status apiku-rs
pm2 logs apiku-rs
```

---

### 3. Menjalankan via Docker

Dockerfile multi-stage sudah disediakan (`apiku-rs/Dockerfile`):

```bash
cd apiku-rs

# Build Docker image
docker build -t apiku-rs .

# Jalankan container
docker run -d \
  --name apiku-rs \
  -p 3005:3005 \
  -e PORT=3005 \
  -e NODE_BACKEND_URL=http://host.docker.internal:3000 \
  --restart unless-stopped \
  apiku-rs
```

#### Docker Compose Contoh (`docker-compose.yml`)

```yaml
version: "3.8"

services:
  apiku-rs:
    build: .
    container_name: apiku-rs
    restart: unless-stopped
    ports:
      - "3005:3005"
    environment:
      - PORT=3005
      - NODE_BACKEND_URL=http://node_api:3000
      - RUST_LOG=info
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
```

---

## ⚙️ Variabel Lingkungan (`.env`)

Buat file `.env` di direktori `apiku-rs/`:

```ini
# Port server Axum Rust (default: 3005)
PORT=3005

# URL backend Node.js untuk proxy fallback route
NODE_BACKEND_URL=http://127.0.0.1:3000

# Level logging tracing (trace, debug, info, warn, error)
RUST_LOG=info

# Admin security key
ADMIN_KEY=SUPERADMIN
```

---

## 🔍 Verifikasi & Uji Endpoint

Setelah server berjalan, periksa halaman dan endpoint:

```bash
# Cek Homepage status
curl http://localhost:3005/

# Cek Dokumentasi OpenAPI JSON (Total 512 endpoint)
curl http://localhost:3005/openapi.json

# Test salah satu endpoint native (Random Anime Quotes)
curl http://localhost:3005/api/random/quotesanime

# Test endpoint image effect (Ephoto Photooxy)
curl "http://localhost:3005/api/ephoto/photooxy?effect=flaming&text=Halo" -o test.png
```

---

## 📁 Struktur Direktori

```
apiku-rs/
├── Cargo.toml              # Definisi dependensi crates Rust
├── Cargo.lock              # Lockfile dependensi
├── Dockerfile              # Multi-stage Docker build
├── README.md               # Dokumentasi apiku-rs
├── configuration.json      # Metadata & konfigurasi API Zyvor
├── public/                 # Static web assets (HTML, CSS, JS, favicon)
│   ├── index.html          # Web UI Homepage
│   └── docs.html           # Swagger/Scalar OpenAPI UI
└── src/
    ├── main.rs             # Entrypoint server Axum & graceful shutdown
    ├── state.rs            # Shared AppState & HTTP client connection pool
    ├── routes/             # Route system (OpenAPI, docs, status, proxy)
    ├── utils/              # Utilities (SSRF shield, cipher, session, tracker)
    └── api/                # 32 kategori endpoint (1:1 selaras dengan Node.js)
        ├── ai/
        ├── anime/
        ├── canvas/
        ├── ephoto/
        ├── fun/
        ├── maker/
        ├── random/
        ├── tools/
        └── ...
```

---

## 📄 Lisensi

GPL-3.0 — (C) 2026 Zyvor / BAWORBAWORID
