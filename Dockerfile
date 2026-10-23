# ==============================================================================
# Multi-stage Dockerfile for APIKU Rust Engine (apiku-rs)
# High-performance Axum-based REST API Engine
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder
# ------------------------------------------------------------------------------
FROM rust:1.80-slim-bookworm AS builder

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
# Stage 2: Runtime
# ------------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Install runtime utilities & certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create necessary directories
RUN mkdir -p /app/data /app/logs /app/public && \
    chmod -R 777 /app/data /app/logs

# Copy release binary from builder
COPY --from=builder /app/target/release/apiku-rs /app/apiku-rs

# Copy static assets and configuration
COPY configuration.json /app/configuration.json
COPY public /app/public
COPY data /app/data

# Default environment configuration
ENV PORT=3005
ENV NODE_BACKEND_URL=http://host.docker.internal:3000
ENV RUST_LOG=info

EXPOSE 3005

# Use dumb-init as PID 1 to handle signal forwarding cleanly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/app/apiku-rs"]
