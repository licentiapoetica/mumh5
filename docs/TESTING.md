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

### Gateway comparison in CI

`frontend/tools/perf/compare.ts` runs two gateway binaries against one Murmur in alternating
order (base, new, new, base, ...), starting each one fresh, and compares the medians:

- gateway CPU time per forwarded voice packet (`load.ts`, 20 clients, 5 talking; only the
  talking phase is counted) and peak PSS meanwhile;
- the p50 of sequential requests on one keep-alive connection, which must also stay under
  10 ms whatever the base shows (Nagle and delayed ACKs once added about 40 ms here);
- gateway CPU time per static visit, static p50 latency and visits per second (`http.ts`).

Absolute numbers from shared runners do not compare between runs, so only the ratio of the two
binaries measured side by side is checked. It fails when a median is worse by more than
25 % (CPU), 20 % (memory), 25 % and 2 ms (latency) or 50 % (throughput); `--max-cpu`,
`--max-pss`, `--max-latency`, `--max-throughput` and `--keepalive-ceiling` change them. Two
runs of one binary against itself (5 rounds, on a busy machine) kept the medians within 2 %
for voice CPU and memory, 13 % for CPU per static visit, 16 % for static latency and 26 %
for throughput (single runs of voice CPU ranged from 24 to 33 us per packet); the thresholds
sit above that, though the margin for static latency is thin. A base without `crates/web`
(`main` before the Rust branch) is skipped with a note in the summary. A run where the
clients received less than 90 % of the expected voice packets is not valid and fails too.

The `Gateway performance` workflow (`.github/workflows/perf.yml`) builds the pull request's
gateway and its base's in one job and runs this with 5 rounds (about 4 minutes of
measuring). It runs on pull requests that touch `crates/web`, `crates/core`,
`crates/platform`, the Cargo files, `frontend/tools/build.ts` or the perf tools, and by hand
(Actions, Run workflow, with any base). The table goes to the job summary, the raw runs to
the `gateway-perf-*` artifact. Each side serves its own web build, so a build change shows
in the static numbers; the keep-alive probe fetches the page only.

Locally, with a Murmur on 64750 and two release builds of `mumh5-web`:

```bash
cd frontend && bun run build
bun tools/perf/compare.ts --base /path/to/old/mumh5-web --new ../target/release/mumh5-web \
  --server 127.0.0.1:64750 --rounds 5
```

Gateways listen on `--port` and the port after it (default 18210 and 18211).
