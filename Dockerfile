# Bun is a build tool only. The final gateway image contains native Rust binaries.
FROM oven/bun:1.4.5 AS frontend
WORKDIR /build/frontend
COPY LICENSE THIRD_PARTY_NOTICES.md /build/
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build

FROM rust:1.100-bookworm AS rust
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config protobuf-compiler libssl-dev libopus-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY proto/ proto/
COPY crates/ crates/
RUN cargo build --locked --release -p dream-cord-web

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 libopus0 && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 dreamcord
WORKDIR /app
COPY --from=rust /build/target/release/dream-cord-web /usr/local/bin/dream-cord-web
COPY --from=frontend /build/frontend/dist/ frontend/dist/
USER 10001
EXPOSE 8080
ENTRYPOINT ["dream-cord-web", "--bind", "0.0.0.0:8080"]
