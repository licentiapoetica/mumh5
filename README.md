# mumh5

A modern Mumble client with a shared Svelte interface, native Rust services, a Tauri desktop/Android application, a Rust browser gateway, and a native headless client/bot library.

This branch migrates the existing application and build pipeline to Rust/Tauri. The migration is still under validation: see [todo.md](todo.md) for the exact remaining work and test results. The frontend remains Svelte/TypeScript and is built with Bun. Desktop and server deployments use native Rust binaries.

## Develop

On Debian/Ubuntu, install the native dependencies:

```sh
sudo apt-get install build-essential cmake pkg-config protobuf-compiler libssl-dev \
  libopus-dev libvpx-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf
./tools/bootstrap.sh
source tools/env.sh
(cd frontend && bun run build)
cargo run --locked -p mumh5-desktop
```

The bootstrap installs Rust 1.100, rustfmt, clippy, Bun 1.4.5, and the native Tauri CLI 2.12.6 into `.tooling/`. It does not change shell profiles or global tool installations. Native dependencies remain platform packages. See [testing](docs/TESTING.md) and [architecture](docs/ARCHITECTURE.md).

For desktop development, run `cargo tauri dev` from `crates/desktop`. The Bun asset server listens on port 1420; rebuild with `bun run build` after frontend edits.

For the browser UI:

```sh
cargo run --locked -p mumh5-web -- --server localhost:64738
# Open http://127.0.0.1:8080
```

The gateway also supports the existing `MUMH5_SERVERS`, `MUMH5_DEFAULT_SERVER`, bind/port, origin, trusted-proxy, PROXY protocol, connection quota, audio-pack limit, and STUN/TURN settings in [docker-compose.yml](docker-compose.yml). Explicitly listed Mumble targets may be on private networks; arbitrary private targets require `--allow-private` / `MUMH5_ALLOW_PRIVATE=1`. Use HTTPS for remote microphone/camera access. Browser identities remain client-side and are supplied to the gateway when establishing Mumble TLS.

```sh
docker build -t mumh5 .
docker run --rm -p 127.0.0.1:8080:8080 -e MUMH5_STUN_PORT=0 mumh5 --server HOST:PORT
```

Use Compose host networking, or expose the configured STUN/TURN and relay port range, for sharing across networks.

## Desktop and Android packaging

```sh
source tools/env.sh
(cd crates/desktop && cargo tauri build --ci --bundles deb,appimage)
./tools/package-linux.sh --no-build
# On Windows with MSVC and native libraries:
# (cd crates/desktop && cargo tauri build --ci --bundles nsis)
```

GitHub Actions builds Linux AppImage/deb/portable archives, Windows installers, native CLI executables, Android arm64 development APKs, and the Rust gateway container. Main-branch builds retain the rolling `snapshot` release, stable download filenames and SHA256SUMS; version tags have a separate release job. Cross-platform packaging is still being verified in this draft.

Android requires JDK 21, SDK 36, NDK 28.2.13676358, CMake, protoc and the Rust target:

```sh
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
export ANDROID_NDK_ROOT="$NDK_HOME"
rustup target add aarch64-linux-android
(cd crates/desktop && cargo tauri android build --ci --target aarch64 --apk --debug)
```

The Android application keeps `org.mumh5.app`; desktop keeps `dev.f0ck.mumh5`. Existing desktop identity IDs/default identity, saved servers/pins/tokens, and sound files are copied from the previous profile on first launch. Source files are preserved. `MUMH5_PROFILE=/path` selects an isolated profile and skips automatic discovery of another profile.

## Interface and native services

The reused interface includes Modern, Classic and Stacked layouts, channels and collapsible private chats, configurable opt-in local chat history, unified media/PDF cards, file transfers, reactions, identity/ACL/role management, themes, backgrounds, sounds, sharing, and connection diagnostics. Settings stays beside Home. The previously requested Rooms/interface-selector removal remains in place.

The latest main-branch microphone recovery, same-host mumpeer discovery, Android background voice controls, connection log, Web Lock and keepalive changes are merged. Rust ports provide native TLS/OCB2 UDP, certificates/PKCS#12, profile and sound storage, relay/TURN services, PipeWire capture and portal color picking. Hardware/platform behavior and complete feature parity still require the checks listed in todo.md. Global push-to-talk remains an existing platform limitation.

The browser build includes installable/offline support and deployment update checks. Desktop update checks keep mumh5's snapshot repository and links.

## Headless clients and bots

```sh
cargo build --locked --release -p mumh5-cli
./target/release/mumh5-cli --server localhost --name helper --trust-new
```

The CLI connects directly to Mumble. It has one independent incoming and outgoing audio stream, separate video input/output, text messaging, JSON control, and a Rust library API. See the [CLI guide](docs/CLI.md) and [bot/chat-command examples](docs/BOTS.md).

The original MIT license and asset/dependency notices remain in [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
