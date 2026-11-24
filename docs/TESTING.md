# Testing

From the repository root in Bash:

```sh
./tools/bootstrap.sh
source tools/env.sh
./tools/check.sh
cargo test --locked -p mumh5-core --no-default-features
```

The normal suite checks OCB2 vectors/replay protection, voice framing and Opus,
fragment assembly, native VP8/RTP, certificate pins, private profile persistence,
PKCS#12 round trips, and gateway allowlists. `live_server` returns immediately
unless the operator explicitly sets a test host.

## Disposable integration server

Use a test server, not a production server. Port 64750 is loopback only. The test
image's ban limit is disabled because tests create several short-lived clients.

```sh
docker run -d --name mumh5-test \
  -p 127.0.0.1:64750:64738/tcp -p 127.0.0.1:64750:64738/udp \
  -e MUMBLE_CONFIG_AUTOBAN_ATTEMPTS=0 mumblevoip/mumble-server:latest
MUMH5_TEST_HOST=127.0.0.1 MUMH5_TEST_PORT=64750 \
  cargo test --locked -p mumh5-core --test live_server -- --nocapture
```

This checks private and channel text, native audio over both encrypted UDP and
TCP fallback, absence of audio loopback, native WebRTC/VP8 between two Rust
clients, and absence of video loopback. Test identities use temporary profiles.
The normal suite never reaches public servers.

## Browser UI

Build the frontend and gateway, then start the gateway in another terminal:

```sh
(cd frontend && bun run build)
cargo run --locked -p mumh5-web -- \
  --server 127.0.0.1:64750 --bind 127.0.0.1:18080
# Another terminal, with tools/env.sh sourced:
(cd frontend && bun tools/browser-smoke.ts)
```

Requires Chromium at `/usr/bin/chromium`, or `CHROMIUM_PATH`. It uses a temporary
browser context and synthetic media devices. It checks gateway origin/target
restrictions, component styling, identity setup, server sync, chat, certificate
pin persistence, opt-in history, unified audio/PDF cards, PDF rendering, and phone
layout. It blocks external HTTPS requests. Screenshot output is ignored under
`.tooling/`. `MUMH5_TEST_URL` overrides the gateway URL; the test target
remains 127.0.0.1:64750.

## Connection diagnostics and settings regression

With the same disposable server and gateway running, run:

```sh
(cd frontend && bun tools/settings-smoke.ts)
```

This checks migration from a saved Rooms interface without changing its layout,
exactly one Settings button beside Home across layouts, collapsed server lists
and phone navigation (outside the audio toolbar), the About debug
window and its copy/download/filter/clear controls, and a background connection
idle for 36 seconds (longer than stock Mumble's timeout). It then closes the test
WebSocket with a known code/reason and checks that both appear in the log.

The frontend unit suite (`cd frontend && bun run test`) covers worker startup and
failure fallback, timer cancellation, bounded logs, credentials staying out of
diagnostics, and a local disconnect reason surviving synchronous native close.
Rust tests also check that upstream TLS EOF preserves queued bytes and a useful
close reason.

## Actual Tauri window

This test runs the built native Tauri/WebKit application, not a browser mock.
The test-only reporting command and injected script are compiled exclusively
with `smoke-test`. Normal builds do not contain the command or script.

```sh
cargo build --locked -p mumh5-desktop --features smoke-test
# With a disposable Xvfb display (install xvfb if required):
MUMH5_PROFILE="$PWD/.tooling/desktop-test" \
MUMH5_SMOKE_REPORT="$PWD/.tooling/desktop-smoke.json" \
  xvfb-run -a dbus-run-session -- ./target/debug/mumh5-desktop
cat .tooling/desktop-smoke.json
```

Use a fresh test profile for each run; the wizard is part of the test. It uses
synthetic microphone input, never a real microphone. It checks styled UI mount,
native identity setup/private-key isolation, UDP ping, native sound files,
TLS sync and channel tree, encrypted UDP probes, and chat. It exits after
writing the report. It requires the disposable Mumble server on port 64750.
Hardware capture, system portal interaction, WAN/NAT traversal, and other OS
WebViews are not covered by this smoke test.

When done, stop the gateway and remove only your disposable test container:

```sh
docker rm -f mumh5-test
```

Linux x86-64/WebKitGTK is the validated desktop platform. The README lists
features still dependent on native WebView or not ported from the old desktop.
