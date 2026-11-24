# Rust/Tauri migration checkpoint

Updated: 2026-11-24. **Work is incomplete; keep PR #111 draft.**

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

## Remaining work, in order

1. **Complete Android APK validation.**
   - Rerun `cargo tauri android build --ci --target aarch64 --apk --debug` from `crates/desktop`.
   - JDK21, SDK36, NDK28.2.13676358, CMake, protoc, `aarch64-linux-android`; export both `NDK_HOME` and `ANDROID_NDK_ROOT`; native Tauri CLI must be on PATH because Gradle invokes `cargo tauri`.
   - Fix any remaining Kotlin/Gradle errors; clean up mobile-only Rust warnings and update deprecated lifecycle overrides if useful.
   - Check permissions, microphone/camera, foreground notification actions, muted microphone behavior, screen-off/background connection, leave/quit cleanup and battery exemption on an actual Android device. Compile success cannot validate these.
   - Current pipeline publishes a debug/development APK. Do not claim a signed production release. Decide/preserve signing and release-keystore configuration if production Android packaging is required.

2. **Finish strict verification on the final tree.**
   - `cargo fmt --all --check`
   - `cargo test --locked --workspace`
   - `cargo clippy --locked --workspace --all-targets -- -D warnings`
   - `cargo test --locked -p mumh5-core --no-default-features`
   - Run native live-server tests with the disposable local Mumble server (audio/video/text and no input/output loopback).
   - Rerun frontend check/build and browser/settings smoke after the final hashed CSS change. Check global theme/fonts styles load, PWA offline/reload/update behavior, worker/PDF/audio paths and subpath hosting.
   - Run the Tauri smoke again if native behavior changes after this checkpoint; always use a fresh isolated profile.

3. **Validate the full build/release pipeline on GitHub.**
   - Push the checkpoint and inspect PR checks. Fix actual Linux/Windows/Android/Docker failures; workflow syntax validation alone is insufficient.
   - Build/install Linux `.deb`, run AppImage (including static runtime check) and portable archive/user installer/uninstaller; verify native runtime dependencies and stable filenames.
   - Verify Windows bootstrap under Git Bash, MSVC/vcpkg OpenSSL/Opus/libvpx, protoc discovery, NSIS/WebView installation and CLI runtime dependencies.
   - Build/run Docker with the existing operator environment/Compose examples; check metadata in source archives without Git. Watch local disk space before doing a large Docker build.
   - Exercise snapshot assembly with fixture artifacts: exactly one installer of each required type, CLI files excluded from the installer glob, optional Android asset, checksums and links. Verify release tag/main guards and permissions. Do not publish a real snapshot from this feature branch.
   - Consider macOS CI if preserving the prior local `dist:mac` capability requires it; config/icons/Info.plist are supplied, but a macOS package has not been tested.
   - Add browser and actual Tauri integration jobs to CI if practical; current CI includes native core/live tests but does not automate every local smoke script.

4. **Close remaining feature-parity gaps.**
   - Review `git diff efcfd1e origin/main -- src` and upstream native modules against the new implementation. Restored behavior is not yet a complete parity sign-off.
   - Test mumpeer end-to-end with its real relay server, including TLS pin/ALPN rejection before sending the token, teardown/reconnect and lane reallocation. Add a local TLS backhaul test; current tests cover the virtual TURN adapter, not the complete pinned TLS link.
   - Add/port upstream PipeWire graph fixtures to Rust tests; verify all/app capture, MONO/stereo, exclusion of this app and its WebView children, stale link removal and cleanup after start failure/quit. Hardware routing remains unverified.
   - Verify portal color picker cancellation/success and desktop screen/camera capture across WebKitGTK/WebView2. Windows loopback is advertised but needs an actual system-audio test. Check WebView limitations explicitly before claiming full screen/audio feature parity.
   - Manually verify popup Settings/theme editor state sharing, image copy/save format/file naming, native tray menu state/blinking and click-to-restore behavior. Preserve useful upstream tray behavior, not just menu action wiring.
   - Review legacy profile migration beyond the copied native files: settings/themes/backgrounds/chat held only in the previous WebView's browser storage may require a separate migration/export path. Do not silently promise all legacy UI storage is migrated. Test damaged identity/state/sound settings and recoverable sound archive behavior.
   - Validate public-server XML compatibility, native Mumble JSON certificate import, sound-pack limits/recovery and reverse-proxy/private-DNS policies against upstream tests. Review default IPv6 STUN behavior (current default binds IPv4) and add coverage if upstream IPv6 reachability is needed.

5. **Finish generator/tooling migration and docs.**
   - Restore theme and protobuf regeneration with Bun/native tools. The generated files are retained, but old `npm run themes/proto` tooling has not yet been replaced. Do not reintroduce Node execution or Electron packages.
   - Check `scripts/build-deepfilter.sh` against its moved frontend vendor path; its path was updated but rebuild was not run.
   - Review README/architecture/testing and third-party notices for final capabilities, static Android/Windows libraries, complete runtime dependencies and accurate platform validation claims.
   - Check removed upstream developer docs for useful instructions worth retaining with new commands.

6. **Finish the PR only after the above.**
   - Fetch latest upstream main again and retain any additional features/fixes; do not discard new main changes.
   - Update PR title/body around the final feature-preserving implementation and evidence, link this checklist while incomplete, and remove obsolete snapshot-only claims.
   - Redeploy the requested local web UI from the final branch and report the URL. Existing Dream Cord server on 8080 has not been replaced by this checkpoint; migration tests use 18080.
   - Mark PR ready only after required tests/builds pass and feature gaps are resolved. No main-branch merge/push without instruction.

## Local resumption details (this machine)

- Worktree: `/tmp/mumh5-dream-cord`. The original `/home/fredf/projects/mumh5` remains on its original feature branch. Git metadata is shared/protected; Git mutations need the normal approval mechanism.
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
- Test gateway: `http://127.0.0.1:18080`, owned process running `target/debug/mumh5-web`, assets in the worktree, `MUMH5_STUN_PORT=0`. Existing user/Dream Cord UI on port8080 remains untouched.
- Owned virtual X display: `:193`; Tauri smoke already exited successfully. Report `/tmp/mumh5-tauri-smoke.json`, fresh profile `/tmp/mumh5-tauri-test-profile` (use a different fresh directory for another wizard test).
- Logs: `/tmp/mumh5-ui-check.log`, `mumh5-ui-tests.log`, `mumh5-ui-build.log`, `mumh5-rust-tests.log`, `mumh5-platform-tests.log`, `mumh5-platform-tests-final.log`, `mumh5-clippy-final.log`, `mumh5-browser-smoke.log`, `mumh5-settings-smoke.log`, `mumh5-android-build.log`, `mumh5-tauri-run.log` (all under `/tmp`).
- Last measured free space: root about6GB, `/tmp` about12GB. Prefer `/tmp` for additional release targets/large downloads and do not delete unrelated caches or user files.
