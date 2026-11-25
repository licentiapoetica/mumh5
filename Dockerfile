# The browser version: web app and gateway in one image.
#   docker compose up -d --build
FROM node:26-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
# No install scripts: the Electron download they would trigger is only needed for the desktop app
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:web

# The gateway (crates/web). Its build needs protoc for the Mumble protocol and libopus.
FROM rust:1.100-bookworm AS gateway
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config protobuf-compiler libssl-dev libopus-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY proto/ proto/
COPY crates/ crates/
RUN cargo build --locked --release -p mumh5-web

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 libopus0 && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 mumh5
WORKDIR /app
COPY --from=gateway /src/target/release/mumh5-web /usr/local/bin/mumh5-web
COPY --from=web /src/dist-web ./dist-web
USER 10001
ENV MUMH5_PORT=8080 MUMH5_STATIC=/app/dist-web
EXPOSE 8080/tcp 3478/udp 3478/tcp 49160-49659/udp
CMD ["mumh5-web"]
