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
and phone navigation, the toolbar's Configure button opening Settings, the About debug
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

### Screen sharing and cameras on the Linux desktop

WebKitGTK has no WebRTC, so the desktop app shares through its own peer
(`crates/desktop/src/share_rtc.rs`, webrtc-rs) with WebCodecs in the page
(`frontend/src/lib/native-share-peer.ts`). Three checks, all with WebKit's mock
camera and mock screen (`MUMH5_SMOKE_MOCK_MEDIA=1`), never real devices:

- `cargo test -p mumh5-desktop`: two native peers connect and carry VP8.
- `frontend/tools/native-share-smoke.ts`, bundled with
  `bun build tools/native-share-smoke.ts --format iife --target browser --outfile X`
  and run as `MUMH5_SMOKE_SCRIPT=X`: a screen and a camera round trip inside one
  app, checked by the pixels on the page.
- `tools/desktop-share-e2e.sh camera|screen [binary]`: two app instances on the
  test server, through the real buttons and share dialog; the viewer checks the
  picture on its stage. The screen picker is opened with `smoke_click`, a click
  delivered through GTK, since `getDisplayMedia` needs a user gesture.
  `frontend/tools/share-interop.ts` is the browser side for mixed checks
  (`ROLE=viewer KIND=screen bun tools/share-interop.ts` against a gateway on
  :18080 while one app instance shares, or `ROLE=sender` while one watches).

Not covered: the real portal picker and PipeWire capture, screen sound, and
sharing across NAT.

When done, stop the gateway and remove only your disposable test container:

```sh
docker rm -f mumh5-test
```

Linux x86-64/WebKitGTK is the validated desktop platform. The README lists
features still dependent on native WebView or not ported from the old desktop.

## Frontend client against Murmur

`frontend/tests/server.test.ts` is upstream's server suite on Bun: two clients,
channel passwords and tokens, temporary channels, the admin list, pictures, XML
limits, pacing, the voice tunnel and encrypted UDP, files, pokes, ACLs, the
access checker against random rules, roles and display names. It skips unless
`MUMBLE_TEST_HOST` is set; the SuperUser tests also need
`MUMBLE_SUPERUSER_PASSWORD`. Test-only TLS, UDP and OCB2 helpers are in
`frontend/tests/support/` (identities come from the `openssl` tool).

```sh
docker run -d --name mumh5-test-su -p 127.0.0.1:64751:64738/tcp -p 127.0.0.1:64751:64738/udp \
  -e MUMBLE_CONFIG_AUTOBAN_ATTEMPTS=0 -e MUMBLE_SUPERUSER_PASSWORD=testsuper mumblevoip/mumble-server:latest
(cd frontend && MUMBLE_TEST_HOST=127.0.0.1:64751 MUMBLE_SUPERUSER_PASSWORD=testsuper bun test tests/server.test.ts)
```

## Where upstream's tests went

Every unit test file of the Electron version, and what covers it now:

| Upstream | Now |
| --- | --- |
| 32 frontend unit files (`access`, `audio-pack`, `channel-*`, `code`, `custom-themes`, `emoji`, `i18n*`, `keepalive`, `opus-wasm`, `themes`, ...) | Same files in `frontend/tests/` on Bun |
| `server.test.ts` | `frontend/tests/server.test.ts` (see above); CI runs it with a SuperUser |
| `ocb2.test.ts` | `crates/core/src/crypt.rs` tests (Mumble's vectors, replay, resync) |
| `identity.test.ts` | `crates/core/src/identity.rs` (persistence, pins) and `profiles.rs` `profile_and_backups_round_trip` (PKCS#12 export and import, wrong password, duplicates) |
| `saved-state.test.ts`, `sound-store.test.ts`, `dev-profile.test.ts` | `crates/platform/src/profiles.rs` tests: legacy shapes, damaged files and backups, sound files. Runtime merging of saved state across windows is not ported. |
| `pipewire.test.ts` | `crates/platform/src/pipewire.rs` tests (same fixtures, plus WebView children and stale nodes) |
| `turn.test.ts` | `crates/platform/src/turn.rs` tests (UDP and TCP relay, lanes, loopback restriction) |
| `mumpeer-link.test.ts` | `crates/platform/src/mumpeer.rs` tests (pinned TLS, ALPN, refusal, teardown, lanes) |
| `proxy.test.ts`, `proxy-mumpeer.test.ts` | `crates/web` tests (config, rate limits, relay validation) and `crates/web/tests/mumpeer_gateway.rs`; origin and target checks in `browser-smoke.ts` |
| `dbus.test.ts` | `crates/platform/src/color.rs` tests |
| `publist.test.ts` | `network::tests::live_public_list_parses` (ignored; the list answers HTTP 501 to the Rust client, an open issue) |
| `denoise.test.ts` | Not ported: it checked the Node proxy's compressed serving of the model. The model files are precached and fetched in `pwa-smoke.ts`. |
| `reaction-delivery.test.ts`, `reconnect.test.ts` | Not ported: they compile `session.svelte.ts` with esbuild and Node stubs. Reconnect behavior is exercised by `settings-smoke.ts` (background connection, close codes). |
| `build-electron.test.ts` | Not applicable (Electron packaging) |

The Electron E2E suites (`test/e2e/*.e2e.ts`) drove the Electron app with
Playwright. Their replacements are `browser-smoke.ts`, `settings-smoke.ts` and
`pwa-smoke.ts` (all in CI) and the Tauri smoke (`crates/desktop/tests/smoke.js`,
run locally). Not yet replaced: the two-instance screen-share E2E, backgrounds,
the theme creator, saved state and the sound E2E. Screen sharing between two
Rust clients is covered by `live_server`'s native video test, not through the UI.

## Performance comparisons

`frontend/tools/perf/` holds the tools used to compare builds on one Linux machine:
`load.ts` (N real Mumble clients, direct or through a gateway, some talking real Opus),
`sample.ts` (CPU and PSS of a whole process tree), `http.ts` (static file visits),
`webui.ts` (page load in Chromium) and `electron-connected.ts` (drives an Electron
build of `main` to the connected state). The Tauri smoke build stays connected after
its checks with `MUMH5_SMOKE_STAY=1`.

Never let a measured app play to a real output: load a null sink
(`pactl load-module module-null-sink sink_name=mumh5_perf_silent`), start the apps with
`PULSE_SINK=mumh5_perf_silent`, and keep their streams there and muted while bots talk.
