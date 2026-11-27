# Bun is a build tool only. The final gateway image contains native Rust binaries.
FROM oven/bun:1.4.5 AS frontend
ARG MUMH5_BUILD_COMMIT
ARG MUMH5_BUILD_REPO=licentiapoetica/mumh5
ENV GITHUB_SHA=$MUMH5_BUILD_COMMIT GITHUB_REPOSITORY=$MUMH5_BUILD_REPO
WORKDIR /build/frontend
COPY LICENSE THIRD_PARTY_NOTICES.md /build/
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
COPY build/web/ /build/build/web/
RUN bun run build:web

FROM rust:1.100-bookworm AS rust
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config protobuf-compiler libssl-dev libopus-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY proto/ proto/
COPY crates/ crates/
RUN cargo build --locked --release -p mumh5-web

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 libopus0 && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 mumh5
WORKDIR /app
COPY --from=rust /build/target/release/mumh5-web /usr/local/bin/mumh5-web
COPY --from=frontend /build/frontend/dist/ frontend/dist/
USER 10001
EXPOSE 8080 3478/udp 3478/tcp 49160-49659/udp
ENV MUMH5_BIND=0.0.0.0
ENTRYPOINT ["mumh5-web"]
