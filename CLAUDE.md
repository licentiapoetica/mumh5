# CLAUDE.md

## Style rules

- Square by default. No `border-radius` in components (a global `border-radius: 0 !important` backs this up in `frontend/src/app.css`). The only exception is the opt-in Rounded corners setting: groups in `frontend/src/lib/corners.ts`, rules in `frontend/src/corners.css`.
- No emojis in code, UI text, comments, commit messages or docs. Emoji inside chat content from users is fine.
- UI copy is short, plain and honest. Don't claim something works if it is not tested. Explanations go in tooltips or help text, not in big callouts.
- Colors come from the CSS variables in `frontend/src/app.css`; icons from `frontend/src/lib/icons.ts` via `<Icon>`.
- Sizes and effects too: `--header-h`, `--control-h`, `--line-strong` (borders of fields, buttons, menus and popups), `--ease`. No drop shadows; floating things are set apart by their border. Form labels are sentence case; small uppercase headings are 11px, weight 650, 0.07em spacing.
- The font is Inter, bundled from `@fontsource-variable/inter` (imported in `frontend/src/main.ts`), so no font is fetched from outside.

## Project overview

mumh5 is a Mumble client: a Tauri desktop app (Windows, macOS, Linux) and Android app on a Rust core, with a Svelte 5 + TypeScript UI in `frontend/`, Discord-like layout, responsive down to phone width. It must stay compatible with stock Murmur servers and with people on the desktop Mumble client. There is also a browser build that connects through a self-hosted Rust WebSocket gateway with a server allowlist (`crates/web`).

Files go through the Mumble server itself, no file host (see File transfer below).

## Commands

Tools are local to the checkout: `./tools/bootstrap.sh` installs the pinned Rust, Bun and Tauri CLI into `.tooling/`; `source tools/env.sh` puts them on `PATH`.

```bash
./tools/check.sh                     # everything below that CI's check job runs
(cd frontend && bun run check)       # svelte-check; must report 0 errors and 0 warnings
(cd frontend && bun run test)        # frontend unit tests (Bun)
(cd frontend && bun run build)       # UI to frontend/dist (also the gateway's static files)
(cd frontend && bun run dev)         # UI dev server on :1420 (debug Tauri builds load it)
(cd frontend && bun run themes)      # regenerate the theme catalog (tools/gen-themes.ts)
(cd frontend && bun run proto)       # regenerate src/core/mumble-pb.js and mumble-udp-pb.js from proto/
cargo fmt --all --check
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
(cd crates/desktop && cargo tauri dev)            # desktop app
(cd crates/desktop && cargo tauri build)          # desktop installers
(cd crates/desktop && cargo tauri android build --target aarch64 --apk --debug)
cargo run -p mumh5-web -- --server HOST:PORT      # browser gateway on 127.0.0.1:8080
```

Test server (autoban off because tests reconnect a lot):

```bash
docker run -d --name mumh5-test-murmur -p 127.0.0.1:64750:64738 -p 127.0.0.1:64750:64738/udp \
  -e MUMBLE_CONFIG_AUTOBAN_ATTEMPTS=0 mumblevoip/mumble-server
MUMH5_TEST_HOST=127.0.0.1 MUMH5_TEST_PORT=64750 cargo test --locked -p mumh5-core --test live_server
MUMH5_TEST_HOST=127.0.0.1 MUMH5_TEST_PORT=64750 cargo test --locked -p mumh5-web --test mumpeer_gateway
```

Browser smokes run against a gateway on `MUMH5_TEST_URL` (default `http://127.0.0.1:18080`): `bun tools/browser-smoke.ts`, `bun tools/settings-smoke.ts`, `bun tools/pwa-smoke.ts` in `frontend/`. The desktop smoke is the `smoke-test` feature of `crates/desktop` (`tests/smoke.js`, report path in `MUMH5_SMOKE_REPORT`, fresh `MUMH5_PROFILE`). See `docs/TESTING.md`.

## Architecture

- `crates/core`: the Mumble protocol in Rust. TLS with trust-on-first-use pinning (`identity.rs`, pin checked before Authenticate), the client state machine (`client.rs`), OCB2 voice crypto (`crypt.rs`, Mumble's vectors), UDP voice (`udp_transport.rs`), audio and video (`audio.rs`, `video.rs` with libvpx), bot commands (`bot.rs`).
- `crates/platform`: what the desktop and the gateway share. STUN/TURN over UDP and TCP (`turn.rs`; the relay's own address reaches only its live allocations; mumpeer lanes as virtual allocations, on loopback for the desktop and as `<expiry>:lane-<id>` credentials on the gateway's public relay), the pinned TLS mumpeer link (`mumpeer.rs`), PipeWire sound for screen sharing (`pipewire.rs`, a virtual microphone fed with `pw-link`, never with this app's own playback, stale nodes of crashed runs removed), the Wayland portal color picker (`color.rs`), certificates and PKCS#12, the profile with migration from the Electron profile (`profiles.rs`, damaged legacy files are skipped and logged), public list and link previews (`network.rs`, previews never reach private addresses).
- `crates/desktop`: the Tauri shell. One `wire` command family bridges the frontend's transports to the Rust core; tray, attention, popups (Settings window), clipboard and image saving. The dev server origin is trusted in debug builds only. Capabilities are limited to the main window.
- `crates/web`: the browser gateway (`mumh5-web`, Axum). Serves `frontend/dist`, bridges WebSocket connections to Mumble over TLS with the connection's own identity, stateless identity endpoints, `/api/relay` credentials, origin guard and per-route rate limits. Mumpeer for browsers in `relay.rs`: text frames after the hello (`relay-open`, `relay-turn`, `relay-lane-close`, `relay-close`, at most 4 KiB, four in flight), the relay on the Mumble server's host unless any server is allowed, never private, ports from `MUMH5_MUMPEER_PORTS`. See `docs/mumpeer-relay.md`.
- `crates/voice`: the Android voice plugin (Kotlin in `android/`): microphone foreground service with wake and Wi-Fi locks, notification Mute, Deafen and Leave, battery exemption request.
- `crates/cli`: the headless client and bot.
- PWA (browser build): `frontend/tools/build.ts` writes `manifest.webmanifest`, the icons and `sw.js` from `build/web/`; the service worker caches exactly the files of the build, network first for the page, never `api/`.
- Android: Chromium freezes a page 60 s after it became hidden, which stops the audio worklet and the Mumble pings. `VoicePlugin.kt` answers every hide of the window with "visible" while voice runs (a window-visibility listener on the WebView, the Tauri form of the old `VoiceWebView`); this needs a device test. With the screen off `getUserMedia` never answers, so the microphone is never given back while muted (`micWanted` in `voice.svelte.ts`, `inAndroidShell()` is true in the Tauri app). Notification permission is asked at runtime on Android 13 and later. The notification's buttons reach `frontend/src/lib/android-controls.svelte.ts` as plugin `action` events.

Frontend (`frontend/src`):
- `frontend/src/core/` (browser-safe TypeScript, also runs in the Bun tests): framing and codec (`proto.ts`), the Mumble client state machine (`client.ts`), voice packet formats (`voice-packet.ts`). No DOM, no Tauri, no Bun or Node imports here.
- Shared UI actions live in `frontend/src/lib/actions.ts` (profiles, channel and user menus, server certificates). `frontend/src/lib/server-menu.ts` owns saved-server menus, connection state and unread counts. Keep behavior there.
- `frontend/src/lib/native.ts`: `desktop` is the Tauri bridge (`frontend/src/lib/tauri.ts`) or null; `native` is what both platforms provide (identities, certificates), backed by `web.svelte.ts` in the browser build (`isWeb`). Desktop-only features check `desktop`.
- `frontend/src/lib/`: app state. `session.svelte.ts` has one `Session` per server plus the `sessions` manager; `session` is a Proxy to the active one. `audio/voice.svelte.ts` is the voice engine (WebCodecs Opus, capture and playback AudioWorklets); where a browser has no WebCodecs audio it uses libopus in WebAssembly (`audio/opus-wasm.ts`, `localStorage mumh5.forceWasmOpus = 1` forces it). `html.ts` sanitizes incoming HTML and serializes outgoing rich text.
- Noise suppression: `settings.noiseEngine` is `deepfilter` (desktop default) or `browser` (web default, since the model is a 10 MB download). `audio/denoise.worklet.ts` runs upstream DeepFilterNet3 from `frontend/vendor/deepfilternet/`, rebuilt byte for byte from a pinned commit by `scripts/build-deepfilter.sh`. The browser's filter takes over while it loads, if it fails or if the device is too slow; the two never run together. The model removes the fake test microphone's tone, so E2E voice steps use `browser`.
- Screen sharing: `frontend/src/core/share-signal.ts` (signals as Mumble plugin data, id `mumh5.share`, compressed and chunked) and `frontend/src/lib/share.svelte.ts` (one WebRTC connection per viewer and stream, candidates inside the description, no trickle; a viewer holds one screen and any number of cameras in `share.watches`). The start dialog is `ShareDialog.svelte`, the tiles and the large view are `VoiceStage.svelte`. The webcam is the same single outgoing stream (camera or screen, not both): `share.toggleCamera` is the camera button in `UserBar` and `VoiceControls`, `frontend/src/lib/camera.ts` opens it with the choices from `VideoSettings.svelte`, and `share.applyCamera` applies changes to a running camera. On Linux (WebKitGTK has no WebRTC) `share-peer.ts` picks `NativeSharePeer` (`native-share-peer.ts`): the Rust peer in `crates/desktop/src/share_rtc.rs` (webrtc-rs) carries VP8 and Opus that the page encodes and decodes with WebCodecs. WebKitGTK plays only capture-device streams, and only unmuted (a muted off-screen video is suspended), never streams made by the page, and `requestVideoFrameCallback` never fires: capture copies the hidden video through a canvas on a timer, and received pictures are painted onto canvases laid over the video elements (`frontend/src/lib/stream-picture.ts`, `media` action). Desktop capture uses the WebView's own `getDisplayMedia`; Linux sound is `crates/platform/src/pipewire.rs` (a virtual microphone fed with pw-link, never with this app's own playback).
- i18n: `frontend/src/core/i18n.ts` (no library; texts by key like `home.addServer`, `frontend/src/locales/en.ts` is the source of truth and the fallback, `{name}` placeholders), `frontend/src/lib/i18n.svelte.ts` (`t()` reads `settings.language`, `auto` follows the browser), other catalogs in `frontend/src/locales/` (see the guide for adding one). Wrap new UI text in `t()`; `test/i18n.test.ts` checks catalogs keep their placeholders. Plurals: `tn(key, n)` with `key#one` entries. How to translate: `docs/translating.md`. Only some screens are converted so far (user bar, start screen, composer toolbar, Settings tab names and Accessibility); the rest stays English.
- `frontend/src/ui/`: Svelte components. `App.svelte` owns layout and global dialogs (`ui.svelte.ts` store). Stacked is the default layout (`settings.arrangement`). While the shown server is not connected, `Home.svelte` (saved servers, people counts, the kicked or lost-connection notice) replaces channels and chat in every layout. `UserBar.svelte` is your name and the mute, deafen and other buttons, under the channel list, as the stacked toolbar, and on the start screen.

- File transfer: `frontend/src/core/file-transfer.ts` (announcement marker in a chat message, pieces as chat messages addressed to the downloaders with 15 bits per character inside `<img src="data:,...">`, requests as plugin data `mumh5.file`, the `Sender` scheduler and `pump`) and `frontend/src/lib/files.svelte.ts` (downloads split between up to four holders, serving, files kept in IndexedDB up to 2 GB). Pieces use `MumbleClient.sendBulk`, which leaves two messages of the rate limit to the user and waits for `flushed()` (a ping round trip) every three pieces. The card is `FileCard.svelte`. Small pictures still go inline as `<img>`.
- Profiles and pictures: a click on a person opens `ProfileCard.svelte` (`openProfile` in `actions.ts`, state `ui.profile`), placed beside what was clicked; your own picture, name and description are edited in `ProfileDialog.svelte` (`ui.profileEdit`). Lists show spheres instead of pictures by default (`settings.avatars`); `<Avatar keep>` keeps the picture or letter in chat, the member lists, profiles and voice tiles. Pictures are Mumble textures (`MumbleClient.setTexture`): servers announce a hash, `session.avatar(id)` fetches with RequestBlob and returns an object URL; your own is kept in IndexedDB (`avatar.svelte.ts`) and sent on every connect, since servers do not echo it and forget it for unregistered users. Over `imagemessagelength` it is dropped silently.
- People on saved servers: `server-status.svelte.ts` pings each one (desktop: UDP from the Rust core; browser: `POST /api/ping` on the gateway, listed servers only) at start and every minute; connected servers count live. Shown on the start screen, not in the server rail.
- Update check: `frontend/tools/build.ts` bakes the version, commit (`GITHUB_SHA` or git) and repository (`GITHUB_REPOSITORY`, else `licentiapoetica/mumh5`) into `__MUMH5_BUILD__`. Desktop: `checkForUpdate` in `frontend/src/core/update-check.ts` asks GitHub's compare API whether the rolling `snapshot` release tag is ahead of that commit (the version number never changes between snapshots), every 6 hours, Download button. Browser: never GitHub; `checkDeployed` fetches `version.json` from the site and compares its `build` with `<meta name="mumh5-build">` in the page (both the content hash the `pwa()` plugin also names the service worker cache after, so Docker builds without a commit work too), every 15 minutes and when the tab comes back, Reload button, nothing kept in localStorage. `frontend/src/lib/updates.svelte.ts` runs both, checks 5 s after start, shows the bar on top of `App.svelte` (both interfaces) and the Settings > About tab; off with `settings.updateCheck`. The desktop E2E answers for GitHub with a Playwright route; the web E2E rewrites `dist-web/version.json` (service worker requests bypass routes).
- Display names: `frontend/src/core/display-name.ts`. The account name stays bound to the certificate; the name you choose is published in your comment as `<img src="data:,mumh5name:..." width="0" height="0"/>`, so it changes live and only you can write it. Other Mumble clients keep showing the account name. `Session.setDisplayName` waits for your own long comment before writing, and restores the name after connecting (`store.displayNames` per server and certificate, guests lose their comment). Comments over 127 characters arrive as a hash, so the session fetches them in small batches to read names. A registered user's comment is the truth on connect, also when it holds no name; Murmur does not store a comment written before registering, so it is sent again afterwards. A chosen name that someone connected uses shows as `Name (account)`; offline people and lookalike letters are not covered, the profile shows the account. If Murmur refuses the longer comment (TextTooLong), the saved name is put back. Servers with HTML off strip the marker. Show people with `store.displayName(u)`, strip the marker from comments with `stripDisplayName`.
- Pokes: `frontend/src/core/poke.ts`. A private TextMessage starting with `<!--mumh5:poke-->` and reading "Poked you: ...", so other clients show a normal private message. `Session.poke` sends, received ones go to `ui.pokes` and `PokeDialog.svelte` (sound `poke`). While the window is not focused: a system notification (`notify.ts`, setting `pokeNotify`; a browser asks permission when the poke popup is closed or the setting is turned on), and on desktop `window:attention` flashes the taskbar entry and blinks the tray icon (`tray.blink`) until the window is focused.
- Code snippets: `frontend/src/core/code.ts` (highlight.js with a fixed language set, detection, ```` ``` ```` fences). Sent as `<pre title="language">` (stock clients show plain preformatted text); a `<pre>` without a known title, as the desktop client's Markdown sends it (with `<br/>`), is detected. `renderIncoming` turns every `<pre>` into a `.code` block after sanitizing; the copy button is handled in `App.svelte`. `CodeDialog.svelte` is the editor behind the composer's code button. Token colors (`.hl` in `app.css`) derive from `--text`; `themes.test.ts` checks their contrast in every scheme.
- Reactions: `frontend/src/core/reactions.ts` (plugin data `mumh5.react` to the people who got the message; a message is named by a digest of its HTML as sent, its author's session and its age in seconds, text channel messages by their id) and `frontend/src/lib/reactions.ts` (paced, applies what arrives to `ChatEntry.reactions`). `ChatLog.svelte` holds the one `EmojiPicker` for its messages; `Message.svelte` has the button and the reactions. In memory only, also in text channels.
- Text channels: `frontend/src/core/text-signal.ts` (a marker in the channel description, messages as plugin data, id `mumh5.text`, sent to everyone on the server) and `frontend/src/lib/text-channels.ts` (pacing under Murmur's plugin limit, messages kept in IndexedDB per server, catch-up from one other client after connecting). They share the `ch:<id>` chat view; `session.isText(id)` tells them apart. `channelTopic` makes single-line description previews for both interfaces, removing metadata through `stripMark`. Channel order for drag and drop is `frontend/src/core/channel-order.ts`.
- Channel passwords: `frontend/src/core/channel-password.ts` writes the desktop client's ACL form (deny `@all`, grant `#<password>`). Passwords that worked are access tokens in `store.tokens` per host:port, sent on connect and live with `MumbleClient.setTokens`. A password may not start with `!`, `~`, `#` or `$`: Murmur parses those as operators, and `#!x` admits everyone without `x`. Text channels cannot have one, since their messages go to the whole server.
- Channel access: `frontend/src/core/access.ts` follows Murmur's `effectivePermissions` and `appliesToUser` (a server test compares it with real answers on random rules) and holds the grid and presets. `ChannelAccess.svelte` is the Access tab, with the old rule list behind Advanced rules; `AccessCheck.svelte` is the Check tab. Write does not bring back Speak or Whisper, and restores Kick, Ban and the other server permissions only on root; those are always checked against root, and Ban also allows kicking. Other people's tokens and certificate status are unknown, so an answer can be "may be able to".
- Roles: `frontend/src/core/roles.ts`. Every group on root is a role, so servers need no conversion; permissions are its rules on root, and later rules win, so the highest role's rules are written last. Names, colors, icons, order and members are published in the root description as `<img src="data:,mumh5roles:..." width="0" height="0"/>`: desktop Mumble shows nothing for it and keeps it through an edit, and a comment that long would be refused. `stripMark` hides it. `RolesDialog.svelte` manages roles, members and access keys; `RoleBadges.svelte` shows the icons in both interfaces. The Roles submenu of the user menu is `frontend/src/lib/quick-roles.svelte.ts`: changes are batched and applied to a freshly read ACL. Access keys are `#mk.<code>.<group>` rules on root, copied from the role's root permissions: they exist only in the ACL, never in the published data, do not cover channel overrides and cannot carry Write.
- Admin badge: `frontend/src/core/admins.ts`. Clients cannot read group membership without Write, so mumh5 clients that have Write on root publish the registered ids as a `<!--mumh5:admins:...-->` comment in the root description, and refresh it when Murmur announces saved root rules. Only Write holders can change that text, so the badge cannot be forged. SuperUser always has it. `stripMark` hides the comment.
- Theme creator: `frontend/src/lib/custom-themes.ts` (colors, readability, theme files; only checked hex colors and known fonts reach the page) and `frontend/src/lib/theme-studio.svelte.ts` (saved in `mumh5.customThemes`, the draft shows live on the whole app). `settings.theme` is `custom:<id>` for these, applied as inline variables on the root. `theme-window.svelte.ts` mounts `ThemeCreator.svelte` into its own popup (`mumh5-themes`, created by the Tauri shell), so the app's layout never changes; on phones or with a blocked pop-up it lies over the app. Closing that window with unsaved changes keeps them in Appearance. `ThemeLibrary.svelte` is the list there. The speaking indicator (`SpeakOrb.svelte`, drawn by `Avatar`) has its own settings per state in `theme.indicator`, apart from the palette.
- Rounded corners: `settings.corners` holds a value per group of `frontend/src/lib/corners.ts`, applied as `--r-*` variables on the root; `frontend/src/corners.css` is the only place with radius rules. An element added to a group goes there.
- Settings window: `frontend/src/lib/settings-window.svelte.ts` mounts `SettingsWindow.svelte` into an empty popup (`mumh5-settings`, created by the Tauri shell in `crates/desktop`), on the same state as the app. Code inside Settings must use the window of its own node (`node.ownerDocument.defaultView`), not the global `window`. A `ui.prompt` is shown in whichever window was used last.

Voice runs on one server at a time (where you last joined a channel); background servers are auto self-deafened and restored when voice returns.

## Conventions

- Svelte 5 runes only. Comment density: short comments that explain why, not what.
- Settings save only values that differ from the defaults (`changedFrom` in `storage.ts`), so a changed default reaches everyone who never picked that setting. A new key in `Settings` needs its place in `PARTS` (`settings.svelte.ts`), the Settings tab or Appearance heading whose reset covers it, or `kept` for window state; svelte-check fails without it. Voice and Sounds have their own `reset` / `resetChoices`.
- The protobuf codec is generated static code (no eval) because the CSP forbids `unsafe-eval`. `wasm-unsafe-eval` is allowed, for the built-in Opus codec only. Field names keep snake_case from the .proto.
- TypeScript files imported by the Bun tests use `.ts` extensions and erasable syntax only (no parameter properties, no enums).
- HTML escaping is shared in `frontend/src/core/html.ts`: `escapeText` for text nodes, `escapeHtml` also for double-quoted attributes. Sanitizing and DOM serialization stay in `frontend/src/lib/html.ts`.
- New features get an E2E step in `frontend/tools/browser-smoke.ts` and `frontend/tools/settings-smoke.ts`; protocol logic gets unit or server tests.
- Privacy rule: opening a chat must never contact hosts the user did not choose. Remote media loads at once only from user-listed hosts; other direct media links (`MediaLink.svelte`) and YouTube (`youtube-nocookie.com`) wait for a click.

## Browser and CSP pitfalls (all hit before)

- The CSP allows media only from `self`, `blob:` and http(s). `data:` audio is blocked silently: play user files through object URLs. Large user files go to IndexedDB (`frontend/src/lib/blobstore.ts`), not localStorage.
- `window.prompt` does not exist in the WebViews; use `ui.prompt`.
- A drop handler must read derived state before clearing the drag item it derives from.

## Svelte reactivity pitfalls (all hit before)

- `$state` wraps assigned objects in proxies: `this.server !== server` compares proxy to raw object and is always true. Use ids or counters.
- `(obj[key] ??= []).push(x)` pushes to the raw array; assign first, then push through `obj[key]`.
- The Mumble client mutates its objects in place. Session getters return shallow copies and read `tick`, otherwise views don't update.

## Mumble protocol pitfalls (all hit before)

- Messages or comments longer than the server's text limit (5000) are parsed by Murmur as XML; anything not well-formed is denied as TextTooLong. Always emit XHTML (`<br/>`, `<img .../>`, `toMumbleHtml`).
- Murmur silently drops own UserState, TextMessage, ChannelState, ACL and Version past a leaky bucket (burst 5, 1/s). The client paces these; don't bypass `send()`.
- 1.5 servers use the protobuf UDP voice format (type byte 0 + MumbleUDP.Audio) with clients announcing 1.5; older ones the legacy format. The UDPTunnel TCP body is the raw voice packet, not a protobuf message. Sequence numbers count 10 ms frames.
- Long comments and descriptions arrive as a hash only; a new hash invalidates the old text; fetch with RequestBlob.
- A chat message may be as long as `imagemessagelength` (131072 characters by default) only if what remains after removing `src="data:..."` values from `<img>` tags fits the text limit. Murmur counts UTF-16 units, not bytes, so BMP characters carry more than base64 (measured: U+4000 to U+BFFF pass unchanged).
- Murmur drops PluginDataTransmission over 1000 bytes and rate limits it (measured: burst 15, then 4 per second, per sender, dropped silently); keep packets at 900 bytes and few.
- Murmur gives the id of a removed channel to the next one created; anything kept per channel id must be dropped on ChannelRemove.
- Murmur ignores a new name in UserState (no error). The account name changes only by reconnecting under another username, on the server entry; the free name is the display name.
- Murmur never sends SuperUser (user id 0) PermissionQuery answers; treat SuperUser as allowed everything.
- In ACLs, Write overrides denies. Grant test rights to one user (`$<certhash>` group), not `@all`.
- Murmur caches permissions per channel object; deleting and recreating channels quickly can leave stale denials. E2E runs use a fresh server.
- The public list (publist.mumble.info) refuses non-browser HTTP clients with HTTP 501. The Electron app used Chromium's `net.fetch`; the Rust fetch (`network::public_servers`) gets the 501 too, which is an open issue.

## Running the app in this environment

- The desktop is Wayland. For hidden runs of the Tauri app use a virtual X display, `GDK_BACKEND=x11`, an empty `WAYLAND_DISPLAY`, `dbus-run-session`, and a fresh `MUMH5_PROFILE`.
- The UI follows the system language; tests that look for English text pin `locale: 'en-US'` (browser) or `LANG=en_US.UTF-8` (Tauri).
- The user may have their own mumh5 or Dream Cord running. Only stop processes you started.
- `pkill -f pattern` matches the invoking shell; use `pkill -f "[p]attern"`.

## Commits

End commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>` style attribution (the exact line comes from the session). No emojis in commit messages.
