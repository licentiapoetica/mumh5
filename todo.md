# Rust/Tauri migration checkpoint

Updated: 2026-11-24 (checkpoint 2). **Work is incomplete; keep PR #111 draft.**

- PR: https://github.com/licentiapoetica/mumh5/pull/111
- Branch: `feature/dream-cord-rust-tauri` in `licentiapoetica/mumh5`.
- Goal: a technical switch to Rust/Tauri, preserving current mumh5 features, including features added on main after the Dream Cord fork. Do not merge an exact Dream Cord snapshot that silently drops upstream functionality.
- Preserve mumh5 branding, desktop ID `dev.f0ck.mumh5`, Android ID `org.mumh5.app`, existing release/update links, and stable snapshot asset names.
- Keep the user's accepted UI changes: Modern/Classic/Stacked layouts; remove Rooms/interface selector; one Settings button beside Home; diagnostics; opt-in configurable client-side history; unified media cards and round player thumbs.
- Do not push to either repository's main branch. The user's original mumh5 checkout and running application must remain untouched.

## Completed in this checkpoint

- Imported Dream Cord's native Rust core/CLI/Tauri/Axum foundation into an isolated mumh5 feature branch, retaining both repositories' history.
- Renamed native packages/binaries/environment variables back to mumh5 and retained application identifiers.
- Three-way merged the latest frontend changes from upstream main (`19996b3`), using `efcfd1e` as the frontend base. Includes connection logging, same-host mumpeer discovery, microphone recovery, encoder/decoder recovery, Android voice controls, Web Locks, and background voice protections. Retained custom settings/debug UI.
- Implemented native Rust STUN/TURN UDP/TCP service, credentials, bounded queues, relay quotas/private-peer guards, and virtual mumpeer lane adapters.
- Implemented pinned TLS mumpeer backhaul and connected it to Tauri IPC/frontend relay calls.
- Ported Linux PipeWire graph routing and Wayland portal color picking, replacing disabled frontend stubs.
- Restored desktop tray actions/modes, attention blinking, native clipboard/save-image operations, popup creation, and service cleanup. Further manual verification is still needed.
- Added a Tauri Android voice plugin with microphone foreground service, notification mute/deafen/leave actions, wake/Wi-Fi locks, battery exemption request and WebView lifecycle handling. Generated/retained native Android scaffolding. No Capacitor implementation is carried over.
- Added non-destructive migration of legacy identity IDs/default identity, saved servers/pins/tokens and sound files. Explicit `MUMH5_PROFILE` skips discovery of other profiles.
- Restored installable/offline browser build, content-hashed assets, build metadata and deployment update checks.
- Ported gateway configuration to the existing `MUMH5_*` settings: target labels/default, private-target policy, origins, trusted reverse proxy, PROXY v1 before TLS, limits, and STUN/TURN configuration. Restored Compose configuration.
- Replaced the old build workflow with native Linux/Windows desktop builds, CLI artifacts, Android APK, Docker/GHCR, rolling snapshots/checksums and tagged release jobs. Bootstrap installs pinned Rust/Bun/native Tauri CLI locally, including Windows tool handling.
- Restored Linux portable installation and snapshot scripts with native executable packaging.
- Restored 23 upstream frontend test files using Bun; 154 frontend tests pass.

## Validation already observed

- Svelte/type check: **0 errors, 0 warnings**.
- Frontend unit suite: **154 passed, 0 failed**, 6,122 assertions.
- Bun production build passed. Hashed JS/CSS/worklet entry paths were added afterward and a new build passed; rerun the browser smoke test on this final bundle.
- Full Rust workspace check and an earlier full workspace test run passed. Final strict `cargo clippy --locked --workspace --all-targets -- -D warnings` passed. The final platform suite passed all six tests, including the non-destructive legacy profile migration fixture. Run the full suite again after further changes.
- Authenticated native TURN integration passed over UDP and TCP; virtual mumpeer lane bidirectional traffic passed without binding its documentation addresses.
- Actual Tauri/WebKit smoke passed: UI styles, native identity/private-key isolation, sound storage, server ping, TLS/channel sync, encrypted UDP probes, chat send/render.
- Chromium browser smoke passed: gateway origin/target restrictions, identity setup, channel sync/chat, pin persistence/history opt-in, unified audio/PDF cards and rendering, phone layout.
- Settings/diagnostics smoke passed: all layouts and rail states, Settings beside Home, debug copy/download/filter/clear, nested Escape, background connection longer than stock Mumble timeout, phone layout, known WebSocket close code/reason.
- GitHub Actions syntax passed `actionlint 1.7.12 -shellcheck=`. This is not proof that platform packaging jobs pass.
- Android Rust arm64 library compiled and linked using static OpenSSL/Opus; required shared libraries were Android system libraries only. APK packaging is not yet confirmed. Kotlin compilation reported an unused invalid `app.tauri.JSObject` import; it has been removed, and the Android build must be rerun.

## Completed in checkpoint 2 (2026-11-24, second session)

- **Upstream re-sync to `21498a3`** (main moved after the first checkpoint): three-way merged i18n + German (#109), hidden-tab microphone reopen (#97), and the frontend of browser mumpeer through the proxy (#104). Ported #104's backend to Rust: public-relay TURN lane credentials (`<expiry>:lane-<32 hex>`, one allocation per lane, unknown/removed lanes refused, never a normal relay) in `crates/platform/src/turn.rs`; gateway `relay-open/turn/lane-close/close` frames, `relay-closed`, `MUMH5_MUMPEER_PORTS` (default 443), 9 links + 20 opens/min per connection, same-host/allow-any/private-address policy and one generic failure message in `crates/web/src/relay.rs`; `/api/config` `mumpeer`. #110 (Capacitor Android shell opening a hosted site) is intentionally not carried over: the Tauri Android app bundles the UI and uses the native mumpeer path.
- Kept the Settings-beside-Home change through the i18n merge (new `nav.settings` key replaces the toolbar's `userBar.configure`); dropped re-created `ui2/`.
- **Fixed** two regressions found by the smokes: the service worker was never registered (boot module loads after `load`), so the PWA had no offline support; and after upstream stopped awaiting `syncInput()`, a stale microphone source/gain from the previous audio context was connected to the new one on reconnect (`voice.svelte.ts`).
- Android: APK rebuilt successfully (`app-universal-debug.apk`, `org.mumh5.app`, arm64, microphone FGS type, only Android system shared libs). Lifecycle overrides moved to the non-deprecated `(activity)` variants; no Kotlin warnings left in our sources (only Gradle DSL deprecations in the plugin build script and Tauri-generated files).
- PipeWire: upstream graph fixtures ported to Rust tests, plus WebView-child exclusion; `start` now waits for the virtual mic's ports and removes the node if linking/monitor startup fails.
- Mumpeer: local pinned-TLS tests (bind/token, wrong pin and missing ALPN rejected before the token is sent, relay refusal, relay teardown, parent cancellation, lane reuse/reallocation, invalid endpoints) and a gateway end-to-end test (`crates/web/tests/mumpeer_gateway.rs`, added to CI's live step).
- Tooling: `bun run themes` (`frontend/tools/gen-themes.ts`, output byte-identical apart from the header) and `bun run proto` (`frontend/tools/gen-proto.ts`, pinned `protobufjs-cli@2.7.1` via `bun x`, or `PBJS=` for a local pbjs; verified with the local copy). `scripts/build-deepfilter.sh` path checked; not rebuilt (needs `wasm-opt`, the wasm32 target and network).
- Docs: restored `docs/mumpeer-relay.md` (Rust/Tauri wording, test commands) and `docs/translating.md`; README and Compose list `MUMH5_MUMPEER_PORTS`.
- New `frontend/tools/pwa-smoke.ts`: theme/font styles, all precached assets (workers, worklets, PDF, WASM, audio), SW scope, build marker, offline reload, both at `/` and behind a `/mumh5/` path prefix. Smokes pin `locale: en-US` (the UI now follows the browser language).

### Validation in checkpoint 2 (final tree)

- `cargo fmt --all --check`, `cargo test --locked --workspace`, strict `cargo clippy --locked --workspace --all-targets -- -D warnings`, `cargo test --locked -p mumh5-core --no-default-features`: all pass.
- Live (disposable Mumble on 64750): core `live_server` 2/2, gateway `mumpeer_gateway` 1/1.
- Frontend: svelte-check 0 errors/0 warnings; 162 tests pass; production build OK; browser, settings and PWA/subpath smokes pass.
- Tauri/WebKit smoke with a fresh profile: all 7 checks pass (run with `LANG=en_US.UTF-8`).

## Remaining work, in order

1. **Android on a real device.** Check permissions, microphone/camera, foreground notification actions, muted microphone, screen-off/background connection, leave/quit cleanup, battery exemption and native mumpeer. CI publishes a debug APK only; decide on release signing/keystore before claiming a production Android release.
2. **Validate the full build/release pipeline on GitHub** (pushed with this checkpoint; inspect PR checks and fix real failures). Then: install the Linux `.deb`, run the AppImage and portable installer/uninstaller; Windows bootstrap/MSVC/vcpkg/NSIS/WebView2 and CLI runtime deps; Docker with the Compose examples (and source archives without Git); snapshot assembly with fixture artifacts (one installer per type, CLI excluded from installer glob, optional Android asset, checksums, tag/main guards). Do not publish a real snapshot from this branch. Consider macOS CI for `dist:mac` parity, and browser/Tauri smoke jobs in CI.
3. **Remaining parity gaps.**
   - Mumpeer against the real relay/bot (mumbot peer-with-relay) end to end; the local tests cover the protocol, not interop.
   - PipeWire on real hardware (all/app capture, cleanup after quit); portal color picker cancel/success; screen/camera capture on WebKitGTK and WebView2; Windows system-audio loopback.
   - Manual: popup Settings/theme editor state sharing, image copy/save formats/names, tray menu state/blinking/click-to-restore.
   - Legacy profile migration beyond copied native files (settings/themes/backgrounds/chat in old WebView storage need an export/migration path; do not promise it). Damaged identity/state/sound settings and sound archive recovery.
   - Public-server XML, native Mumble JSON certificate import, sound-pack limits/recovery and reverse-proxy/private-DNS policies against upstream tests; default IPv4-only STUN bind vs upstream `::`.
   - The pre-#104 `git diff efcfd1e 19996b3 -- src` review is still not a full parity sign-off.
4. **Docs/tooling leftovers.** Rebuild DeepFilterNet with `scripts/build-deepfilter.sh` once `wasm-opt`/wasm32 are available; review README/ARCHITECTURE/TESTING/THIRD_PARTY_NOTICES for final capabilities and static Android/Windows libraries; check other removed upstream docs (`development.md`, `features.md`, `installation.md`, `self-hosting.md`) for content worth keeping.
5. **Finish the PR.** Fetch upstream main again before marking ready and merge anything new; update the PR body with evidence; mark ready only after CI and the gaps above. No main-branch merge/push without instruction.

## Local resumption details (this machine)

- Checkpoint 2 worked directly in `/home/fredf/projects/mumh5` (now on this branch). `/tmp/mumh5-dream-cord` is a detached worktree used for the Android build (tmpfs). Git metadata is shared/protected; Git mutations need the normal approval mechanism.
- Dream Cord source checkout: `/home/fredf/projects/dream-cord`; only its isolated toolchain/cache/target were reused, not source/main changes.
- Reuse cache without bootstrapping another toolchain:
  ```sh
  source /home/fredf/projects/dream-cord/tools/env.sh
  export CARGO_TARGET_DIR=/home/fredf/projects/dream-cord/target
  export CARGO_BUILD_JOBS=4
  export PATH=/tmp/mumh5-tools/bin:/tmp/mumh5-cmake/bin:$PATH
  ```
  The frontend's ignored `node_modules` is a symlink to the existing Dream Cord dependency cache. Do not commit it.
- Native tools: `/tmp/mumh5-tools/bin/cargo-tauri` 2.12.6 and `actionlint` 1.7.12. Portable CMake is `/tmp/mumh5-cmake/bin`. SDK is `/tmp/mumh5-android`; NDK is its `ndk/28.2.13676358`; JDK is `/usr/lib/jvm/java-21-openjdk`; `GRADLE_USER_HOME=/tmp/mumh5-gradle`.
- Disposable container: `mumh5-rust-migration-test`, loopback TCP/UDP 64750. Do not stop other user containers.
- Test gateway: `http://127.0.0.1:18080`, owned process running `target/debug/mumh5-web` from `/home/fredf/projects/mumh5` (assets `frontend/dist`), `MUMH5_STUN_PORT=0 MUMH5_SERVERS=127.0.0.1:64750`. Existing user/Dream Cord UI on port8080 remains untouched.
- Owned virtual X display: `:193`; Tauri smoke already exited successfully. Report `/tmp/mumh5-tauri-smoke.json`, fresh profile `/tmp/mumh5-tauri-test-profile` (use a different fresh directory for another wizard test).
- Logs: `/tmp/mumh5-ui-check.log`, `mumh5-ui-tests.log`, `mumh5-ui-build.log`, `mumh5-rust-tests.log`, `mumh5-platform-tests.log`, `mumh5-platform-tests-final.log`, `mumh5-clippy-final.log`, `mumh5-browser-smoke.log`, `mumh5-settings-smoke.log`, `mumh5-android-build.log`, `mumh5-tauri-run.log` (all under `/tmp`).
- Last measured free space: root about6GB, `/tmp` about12GB. Prefer `/tmp` for additional release targets/large downloads and do not delete unrelated caches or user files.
