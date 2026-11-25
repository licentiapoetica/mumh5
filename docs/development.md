# Development

[Back to the README](../README.md)

## Running from source

You need Node.js 22 or newer, npm and Git. CI uses Node.js 26. The clone command below uses the GitHub CLI (`gh`).

```bash
gh repo clone licentiapoetica/mumh5
cd mumh5
npm ci
npm run dev
```

To install what you built, with a `mumh5` command and a menu entry, run `build/linux/install.sh` from the checkout (Linux). It builds the app and installs it in `~/.local`; run it again after pulling to update.

On first start, mumh5 asks you to set up your identity. If you already use Mumble on this computer, pick "Use my Mumble desktop identity" to keep your registrations. Then add a server with the plus button.

## Building installers

```bash
npm run dist:linux   # AppImage, .deb and .tar.gz (with install.sh and uninstall.sh from build/linux)
npm run dist:win     # NSIS installer
npm run dist:mac     # .dmg
```

Installers are written to `release/`. The Windows installer also builds on Linux with Wine installed; the macOS one needs a Mac. Pushing a version tag (`git tag v0.2.0 && git push origin v0.2.0`) makes the Gitea workflow in `.gitea/workflows/release.yml` build the Linux and Windows files and attach them to a release.

The GitHub [build workflow](../.github/workflows/build.yml) runs type checks, unit tests and the gateway's Rust checks and tests on pushes to `main`, pull requests targeting `main`, and manual runs. Desktop packaging and Docker builds run only for pushes and manual runs; pull requests do not build installers or images.

Successful builds from `main` update the [latest snapshot prerelease](https://github.com/licentiapoetica/mumh5/releases/tag/snapshot), with stable installer filenames and SHA256 checksums. The `snapshot` tag points to the built commit. Desktop installers are also kept as workflow artifacts for 14 days, including manual builds from other branches.

Pushes and manual runs publish `ghcr.io/licentiapoetica/mumh5:sha-<full-commit-sha>`. Builds from `main` also update `ghcr.io/licentiapoetica/mumh5:latest`. The workflow uses the built-in `GITHUB_TOKEN`; package visibility is configured separately in GitHub.

## Development

```bash
npm run dev          # app with hot reload
npm run check        # type check
npm test             # unit tests
```

Tests against a real Mumble server, including an end-to-end test that drives the app:

```bash
docker run -d --name mumh5-test-murmur -p 64739:64738 -p 64739:64738/udp \
  -e MUMBLE_CONFIG_AUTOBANATTEMPTS=0 -e MUMBLE_SUPERUSER_PASSWORD=testsuper mumblevoip/mumble-server
MUMBLE_TEST_HOST=localhost:64739 npm test
npm run build
MUMBLE_TEST_HOST=localhost:64739 MUMBLE_SUPERUSER_PASSWORD=testsuper npm run test:e2e
npm run build:web
MUMBLE_TEST_HOST=localhost:64739 npm run test:e2e:web   # browser build through the gateway (built with cargo)
```

The web gateway is Rust (version in `rust-toolchain.toml`; it needs `protoc` and the OpenSSL and Opus development files, and the workspace tests also libvpx):

```bash
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
MUMH5_TEST_HOST=127.0.0.1 MUMH5_TEST_PORT=64739 cargo test --locked -p mumh5-web --test mumpeer_gateway
```

On Linux the end-to-end test forces X11, so it can run on a virtual display: `Xvfb :99 & DISPLAY=:99 npm run test:e2e`. See [CLAUDE.md](../CLAUDE.md) for the architecture and project conventions.

```
electron/   main process: window, TLS sockets, identities, tray
crates/     web gateway (Rust): web/ serves dist-web and bridges WebSocket to TLS, platform/ STUN and TURN, core/ Mumble
src/core/   Mumble protocol: framing, codec, client state, voice packets
src/lib/    shared app state, actions and menus, voice engine, sanitizing, file transfers
src/ui/     standard interface, shared components and dialogs
src/ui2/    Rooms interface, using the same state, actions and dialogs
proto/      Mumble.proto and MumbleUDP.proto from upstream
test/       unit, server and end-to-end tests
```

## Design notes

- [mumpeer-relay.md](mumpeer-relay.md) covers desktop screen sharing through a community relay, its protocol, and the integration test.

## README screenshots

See [the screenshot guide](screenshots/README.md) to regenerate the visual tour with disposable test clients and a real local Mumble server.
