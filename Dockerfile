# ==============================================================================
# Multi-stage Dockerfile for APIKU Rust Engine (apiku-rs)
# + Sidecar Node.js backend (apiku) dengan Puppeteer/Chrome untuk endpoint browser
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder (Rust)
# ------------------------------------------------------------------------------
FROM rust:1-slim-bookworm AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests
COPY Cargo.toml Cargo.lock ./

# Copy source code and embedded assets
COPY src ./src
COPY configuration.json ./configuration.json

# Build the release binary
RUN cargo build --release

# ------------------------------------------------------------------------------
# Stage 2: Node sidecar deps (apiku + Puppeteer Chrome)
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS nodebackend

WORKDIR /nodeapp

# Chromium deps untuk Puppeteer + ffmpeg untuk endpoint video
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libx11-6 libxcb1 \
    libxext6 libx11-xcb1 libexpat1 fonts-liberation \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer download Chrome saat npm install
ENV PUPPETEER_SKIP_DOWNLOAD=false \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true \
    PUPPETEER_CACHE_DIR=/nodeapp/.cache/puppeteer

# Copy hanya manifests dulu (layer cache)
COPY apiku-deps/package.json ./

RUN (npm ci --omit=dev 2>/dev/null || npm install --omit=dev) \
    && npm cache clean --force 2>/dev/null || true

# ------------------------------------------------------------------------------
# Stage 3: Runtime (Rust binary + Node sidecar)
# ------------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Runtime utils, certs, Node.js 22, Chromium deps, ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dumb-init \
    ffmpeg \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libx11-6 libxcb1 \
    libxext6 libx11-xcb1 libexpat1 fonts-liberation \
    procps \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Necessary directories
RUN mkdir -p /app/data /app/logs /app/public /nodeapp && \
    chmod -R 777 /app/data /app/logs

# Rust binary + assets
COPY --from=builder /app/target/release/apiku-rs /app/apiku-rs
COPY configuration.json /app/configuration.json
COPY public /app/public
COPY data /app/data

# Node sidecar (apiku) + node_modules + Chrome cache
COPY --from=nodebackend /nodeapp /nodeapp
COPY apiku-deps/app /nodeapp

# Default env
ENV PORT=3005
ENV NODE_BACKEND_URL=http://127.0.0.1:3000
ENV NODE_PORT=3000
ENV RUST_LOG=info
ENV PUPPETEER_CACHE_DIR=/nodeapp/.cache/puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

EXPOSE 3005

# Startup script: Node dulu, tunggu ready, baru apiku-rs
COPY <<'EOF' /app/start.sh
#!/bin/bash
set -e
echo "[start] launching Node backend (apiku) on :${NODE_PORT}..."
cd /nodeapp
PORT=${NODE_PORT} node index.js &
NODE_PID=$!
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${NODE_PORT}/health" >/dev/null 2>&1; then
    echo "[start] node backend ready after ${i}s"
    break
  fi
  sleep 1
done
cd /app
echo "[start] launching apiku-rs on :${PORT}..."
exec /app/apiku-rs
EOF
RUN chmod +x /app/start.sh

# dumb-init as PID 1 (signal forwarding, zombie reaping)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/app/start.sh"]
