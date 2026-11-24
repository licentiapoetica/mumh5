# Dream Cord

Dream Cord is a native Rust Mumble client and bot platform with a Tauri desktop
application and a shared browser interface. It starts from mumh5's Rust CLI and
reuses its Svelte interface. This is a separate repository and toolchain.

The CLI is fully native: one incoming and one outgoing audio stream, independent
video input/output, text messages and a Rust bot API. The desktop uses the system
WebView through Tauri. The browser version is served by a Rust Axum gateway.
There is no Node.js runtime, Node backend, or Electron application in this project.
Bun builds the existing Svelte/TypeScript frontend; it is a development tool only.

## Start locally

On Debian/Ubuntu, install native build dependencies once:

```sh
sudo apt-get install build-essential pkg-config protobuf-compiler libssl-dev \
  libopus-dev libvpx-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf
```

Then, from this checkout in Bash:

```sh
./tools/bootstrap.sh
source tools/env.sh
(cd frontend && bun run build)
cargo run --locked -p dream-cord-desktop
```

`bootstrap.sh` installs Rust 1.100, rustfmt, clippy and Bun 1.4.5 under `.tooling/`.
It does not change your global Rust installation, shell configuration, or system
packages. Cargo's registry and Bun's cache also stay in this checkout. Build
artifacts are under `target/`; tools and artifacts are ignored by Git.
Linux x86-64 with WebKitGTK is verified. Other platforms need their corresponding
Tauri/native dependencies and have not been tested. The desktop asks for a new
identity on first launch; choose a Mumble server in the app.

For the headless client:

```sh
cargo build --locked --release -p dream-cord-cli
./target/release/dream-cord-cli --server localhost --name helper --trust-new
```

For the browser UI:

```sh
cargo run --locked -p dream-cord-web -- --server localhost:64738
# Open http://127.0.0.1:8080
```

Repeat `--server HOST:PORT` to permit additional targets. The gateway defaults to
loopback and an explicit server allowlist. Put it behind HTTPS for remote use
(browser microphone/camera APIs need a secure context). `--allow-any` is an
explicit operator choice to permit arbitrary destinations. Browser identities
stay in that browser and are sent to the gateway to establish Mumble TLS.

For a containerized browser gateway, `docker build -t dream-cord .` builds the
frontend with Bun and the gateway with Rust; the final image contains neither
build tool. Run `docker run --rm -p 127.0.0.1:8080:8080 dream-cord --server HOST:PORT`.
The configured Mumble host must be reachable from inside the container.

## Included interface

The reused interface includes both responsive layouts; channel trees and private
chats; independent collapsible lists; voice controls and noise suppression;
channel/private text and reactions; unified audio, video, image, PDF and document
cards; round player sliders; file transfers; profiles, identities, ACLs/roles;
themes, custom theme creation, backgrounds; notifications and sound packs.
Chat history is client-side, off by default, with configurable expiration (24
hours by default when saving is enabled). Expired history is pruned while the
client runs and again on startup.

Rust provides native TLS, encrypted UDP, certificate/PKCS#12 handling, private
profile files, saved servers/pins, sound-file storage, server discovery/ping,
link metadata, desktop tray, and the browser gateway. The frontend's existing
TypeScript state, protocol presentation and browser media logic remain reusable
in the system WebView. The CLI and desktop share native identity and OCB2 crypto
services; the CLI also owns its protocol state, Opus and WebRTC in Rust.

Screen/camera capture and media playback depend on the system WebView and installed
codecs. Screen capture uses the WebView/system picker. The former desktop-specific
system-audio routing, optional mumpeer relay/local TURN implementation, and portal
color picker are not ported; the UI exposes their availability accordingly. Direct
WebRTC camera/sharing remains available. Built-in TURN hosting and the former
installable/offline web worker are not included. Configure STUN/TURN in sharing
settings when required. Global push-to-talk remains outside this initial port.

See [architecture and migration notes](docs/ARCHITECTURE.md), the [CLI guide](docs/CLI.md),
and [Rust bots and chat commands](docs/BOTS.md).

## Development and checks

```sh
source tools/env.sh
./tools/check.sh
cargo test --locked -p dream-cord-core --no-default-features
```

Build the frontend after changes before running the desktop. For a dev server,
run `(cd frontend && bun run dev)` in one terminal and
`cargo run -p dream-cord-desktop --no-default-features` in another. Rebuild browser
assets with `bun run build`; the dev server serves the latest files on port 1420.

Tests do not contact public Mumble servers. See [integration testing](docs/TESTING.md)
for the disposable local Mumble server, browser checks and actual Tauri smoke test.

The original MIT license and asset/dependency notices are preserved. See
[LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
