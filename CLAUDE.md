# CLAUDE.md

## Style rules

- No rounded corners anywhere. No `border-radius` (a global `border-radius: 0 !important` backs this up in `src/app.css`).
- No emojis in code, UI text, comments, commit messages or docs. Emoji inside chat content from users is fine.
- UI copy is short, plain and honest. Don't claim something works if it is not tested. Explanations go in tooltips or help text, not in big callouts.
- Colors come from the CSS variables in `src/app.css`; icons from `src/lib/icons.ts` via `<Icon>`.
- Sizes and effects too: `--header-h`, `--control-h`, `--line-strong` (borders of fields and buttons), `--shadow-pop` (menus, popups), `--shadow-modal`, `--ease`. Form labels are sentence case; small uppercase headings are 11px, weight 650, 0.07em spacing.
- The font is Inter, bundled from `@fontsource-variable/inter` (imported in `src/main.ts`), so no font is fetched from outside.

## Project overview

mumh5 is a Mumble client: Electron desktop app (Windows, macOS, Linux), Svelte 5 + TypeScript + Vite UI, Discord-like layout, responsive down to phone width. It must stay compatible with stock Murmur servers and with people on the desktop Mumble client. There is also a browser build that connects through a self-hosted WebSocket proxy with a server allowlist (`server/`).

Files go through the Mumble server itself, no file host (see File transfer below).

## Commands

```bash
npm run dev            # Vite + Electron, restarts Electron when main/preload change
npm run check          # svelte-check; must report 0 errors and 0 warnings
npm test               # unit tests; server tests too when MUMBLE_TEST_HOST is set
npm run build          # renderer to dist/, main+preload to dist-electron/ (esbuild)
npm run test:e2e       # drives the built app (needs npm run build first)
npm run screenshots    # regenerates docs/screenshots (see test/e2e/screenshots.ts)
npm run build:web      # browser build to dist-web/, proxy bundle to dist-proxy/proxy.mjs
npm run dev:web        # browser build with hot reload: starts the proxy (any server allowed) and Vite
npm run proxy          # run the proxy from source (MUMH5_SERVERS=host:port required)
npm run test:e2e:web   # drives the browser build through the proxy (needs npm run build:web first)
npm run test:e2e:share # screen sharing between two instances of the built app
npm run themes         # regenerate src/themes-generated.css and src/lib/themes-generated.ts (scripts/gen-themes.mjs)
npm run proto          # regenerate src/core/mumble-pb.js and mumble-udp-pb.js from proto/
```

Test server (autoban off because tests reconnect a lot; SuperUser for channel setup):

```bash
docker run -d --name mumh5-test-murmur -p 64739:64738 -p 64739:64738/udp \
  -e MUMBLE_CONFIG_AUTOBANATTEMPTS=0 -e MUMBLE_SUPERUSER_PASSWORD=testsuper mumblevoip/mumble-server
MUMBLE_TEST_HOST=localhost:64739 MUMBLE_SUPERUSER_PASSWORD=testsuper npm run test:e2e
```

A reused test server keeps registrations and channels from earlier runs; tests must use unique names or clean up (the E2E removes its channels first).

## Architecture

- `electron/` (Node, main process): window, TLS sockets to Mumble servers (`tls-transport.ts`), encrypted UDP voice (`udp-voice.ts`, `ocb2.ts`, tested against Mumble's OCB2 vectors), identities and PKCS#12 (`identity.ts`, `identity-store.ts`), certificate parsing (`certs.ts`), tray (`tray.ts`). The renderer only gets the narrow `window.mumh5Native` API from `preload.ts` (context isolation, sandbox).
- `server/` (Node): the web proxy. `proxy.ts` serves `dist-web`, bridges WebSocket connections to Mumble over TLS (reusing `electron/tls-transport.ts`) and has stateless identity endpoints. It stores nothing; the browser keeps identities in localStorage and sends one with each connect. `turn.ts` is its STUN and TURN server for screen sharing between browser users (UDP and TCP on one port, credentials from `GET /api/relay`, which any origin may read so the desktop app can use a proxy as its relay; secret made up at start). `localStorage mumh5.iceDebug = relay` or `relay-tcp` limits a client to relayed routes, which is how the E2E exercises the relay.
- PWA (web build only): the `pwa()` plugin in `vite.config.ts` emits `manifest.webmanifest`, the install icons and `sw.js` from `build/web/` (icons rendered from `build/icon.svg` with rsvg-convert). The service worker caches exactly the files of the build, network first for the page, never `api/`. The proxy marks only `assets/` immutable.
- `src/core/` (browser-safe TypeScript, also runs in Node for tests): framing and codec (`proto.ts`), the Mumble client state machine (`client.ts`), voice packet formats (`voice-packet.ts`). No DOM, no Electron, no Node imports here.
- `src/lib/native.ts`: `desktop` is the Electron preload API or null; `native` is what both platforms provide (identities, certificates), backed by `web.svelte.ts` in the browser build (`isWeb`, vite `--mode web`). Desktop-only features check `desktop`.
- `src/lib/`: app state. `session.svelte.ts` has one `Session` per server plus the `sessions` manager; `session` is a Proxy to the active one. `audio/voice.svelte.ts` is the voice engine (WebCodecs Opus, capture and playback AudioWorklets); where a browser has no WebCodecs audio it uses libopus in WebAssembly (`audio/opus-wasm.ts`, `localStorage mumh5.forceWasmOpus = 1` forces it). `html.ts` sanitizes incoming HTML and serializes outgoing rich text.
- Screen sharing: `src/core/share-signal.ts` (signals as Mumble plugin data, id `mumh5.share`, compressed and chunked) and `src/lib/share.svelte.ts` (one WebRTC connection per viewer and stream, candidates inside the description, no trickle; a viewer holds one screen and any number of cameras in `share.watches`). The start dialog is `ShareDialog.svelte`, the tiles and the large view are `VoiceStage.svelte`. Desktop source listing is `share:sources` / `share:pick` in `electron/main.ts`; Linux sound is `electron/pipewire.ts` (a virtual microphone fed with pw-link, never with this app's own playback).
- `src/ui/`: Svelte components. `App.svelte` owns layout and global dialogs (`ui.svelte.ts` store). Stacked is the default layout (`settings.arrangement`). While the shown server is not connected, `Home.svelte` (saved servers, people counts, the kicked or lost-connection notice) replaces channels and chat in every layout. `UserBar.svelte` is your name and the mute, deafen and other buttons, under the channel list, as the stacked toolbar, and on the start screen.
- `src/ui2/`: the Rooms interface (`settings.interface === 'rooms'`), a second shell on the same state: `Shell.svelte` (screens and bar, rooms beside the screen from 900px), `Rooms`, `ChatScreen`, `VoiceScreen`, `People`, `You`, `Dock`. It reuses `ChatLog`, `Composer`, `VoiceStage` (`fill`), `RightPanel` (as a sheet) and every dialog and menu from `src/ui/`. A feature added to one interface needs its place in the other. Class names there must not collide with ones `themes.css` styles (`.tabs`, `.rail`, `.tile`).

- File transfer: `src/core/file-transfer.ts` (announcement marker in a chat message, pieces as chat messages addressed to the downloaders with 15 bits per character inside `<img src="data:,...">`, requests as plugin data `mumh5.file`, the `Sender` scheduler and `pump`) and `src/lib/files.svelte.ts` (downloads split between up to four holders, serving, files kept in IndexedDB up to 2 GB). Pieces use `MumbleClient.sendBulk`, which leaves two messages of the rate limit to the user and waits for `flushed()` (a ping round trip) every three pieces. The card is `FileCard.svelte`. Small pictures still go inline as `<img>`.
- Profiles and pictures: a click on a person opens `ProfileCard.svelte` (`openProfile` in `actions.ts`, state `ui.profile`), placed beside what was clicked; the side panel is only for editing your description. Pictures are Mumble textures (`MumbleClient.setTexture`): servers announce a hash, `session.avatar(id)` fetches with RequestBlob and returns an object URL; your own is kept in IndexedDB (`avatar.svelte.ts`) and sent on every connect, since servers do not echo it and forget it for unregistered users. Over `imagemessagelength` it is dropped silently.
- People on saved servers: `server-status.svelte.ts` pings each one (desktop: UDP from main; browser: `POST /api/ping` on the proxy, listed servers only) at start and every minute; connected servers count live. Shown on the start screen and the Rooms server tiles, not in the server rail.
- Update check: `vite.config.ts` bakes the version, commit (`GITHUB_SHA` or git) and repository (`GITHUB_REPOSITORY`, else `licentiapoetica/mumh5`) into `__MUMH5_BUILD__`. Desktop: `checkForUpdate` in `src/core/update-check.ts` asks GitHub's compare API whether the rolling `snapshot` release tag is ahead of that commit (the version number never changes between snapshots), every 6 hours, Download button. Browser: never GitHub; `checkDeployed` fetches `version.json` from the site and compares its `build` with `<meta name="mumh5-build">` in the page (both the content hash the `pwa()` plugin also names the service worker cache after, so Docker builds without a commit work too), every 15 minutes and when the tab comes back, Reload button, nothing kept in localStorage. `src/lib/updates.svelte.ts` runs both, checks 5 s after start, shows the bar on top of `App.svelte` (both interfaces) and the Settings > About tab; off with `settings.updateCheck`. The desktop E2E answers for GitHub with a Playwright route; the web E2E rewrites `dist-web/version.json` (service worker requests bypass routes).
- Pokes: `src/core/poke.ts`. A private TextMessage starting with `<!--mumh5:poke-->` and reading "Poked you: ...", so other clients show a normal private message. `Session.poke` sends, received ones go to `ui.pokes` and `PokeDialog.svelte` (sound `poke`). While the window is not focused: a system notification (`notify.ts`, setting `pokeNotify`; a browser asks permission when the poke popup is closed or the setting is turned on), and on desktop `window:attention` flashes the taskbar entry and blinks the tray icon (`tray.blink`) until the window is focused.
- Code snippets: `src/core/code.ts` (highlight.js with a fixed language set, detection, ```` ``` ```` fences). Sent as `<pre title="language">` (stock clients show plain preformatted text); a `<pre>` without a known title, as the desktop client's Markdown sends it (with `<br/>`), is detected. `renderIncoming` turns every `<pre>` into a `.code` block after sanitizing; the copy button is handled in `App.svelte`. `CodeDialog.svelte` is the editor behind the composer's code button. Token colors (`.hl` in `app.css`) derive from `--text`; `themes.test.ts` checks their contrast in every scheme.
- Text channels: `src/core/text-signal.ts` (a marker in the channel description, messages as plugin data, id `mumh5.text`, sent to everyone on the server) and `src/lib/text-channels.ts` (pacing under Murmur's plugin limit, messages kept in IndexedDB per server, catch-up from one other client after connecting). They share the `ch:<id>` chat view; `session.isText(id)` tells them apart. Channel order for drag and drop is `src/core/channel-order.ts`.
- Channel passwords: `src/core/channel-password.ts` writes the desktop client's ACL form (deny `@all`, grant `#<password>`). Passwords that worked are access tokens in `store.tokens` per host:port, sent on connect and live with `MumbleClient.setTokens`. A password may not start with `!`, `~`, `#` or `$`: Murmur parses those as operators, and `#!x` admits everyone without `x`. Text channels cannot have one, since their messages go to the whole server.
- Admin badge: `src/core/admins.ts`. Clients cannot read group membership without Write, so mumh5 clients that have Write on root publish the registered ids as a `<!--mumh5:admins:...-->` comment in the root description, and refresh it when Murmur announces saved root rules. Only Write holders can change that text, so the badge cannot be forged. SuperUser always has it. `stripMark` hides the comment.

Voice runs on one server at a time (where you last joined a channel); background servers are auto self-deafened and restored when voice returns.

## Conventions

- Svelte 5 runes only. Comment density: short comments that explain why, not what.
- The protobuf codec is generated static code (no eval) because the CSP forbids `unsafe-eval`. `wasm-unsafe-eval` is allowed, for the built-in Opus codec only. Field names keep snake_case from the .proto.
- TypeScript files imported by Node tests use `.ts` extensions and erasable syntax only (no parameter properties, no enums).
- New features get an E2E step in `test/e2e/app.e2e.ts`; protocol logic gets unit or server tests.
- Privacy rule: opening a chat must never contact hosts the user did not choose. Remote media loads at once only from user-listed hosts; other direct media links (`MediaLink.svelte`) and YouTube (`youtube-nocookie.com`) wait for a click.

## Browser and CSP pitfalls (all hit before)

- The CSP allows media only from `self`, `blob:` and http(s). `data:` audio is blocked silently: play user files through object URLs. Large user files go to IndexedDB (`src/lib/blobstore.ts`), not localStorage.
- `window.prompt` does not exist in Electron; use `ui.prompt`.
- `desktopCapturer.getSources` can return an empty list on its first calls under X11 and takes seconds on the bare Xvfb test display; main retries and the dialog has Refresh. With `--use-fake-device-for-media-stream` the captured picture is Chromium's test pattern, not the screen. On Wayland the call itself opens the system picker, so it is never repeated.
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
- Renaming while connected is not possible; mumh5 reconnects with the new name.
- Murmur never sends SuperUser (user id 0) PermissionQuery answers; treat SuperUser as allowed everything.
- In ACLs, Write overrides denies. Grant test rights to one user (`$<certhash>` group), not `@all`.
- Murmur caches permissions per channel object; deleting and recreating channels quickly can leave stale denials. E2E runs use a fresh server.
- The public list (publist.mumble.info) refuses non-browser TLS clients with HTTP 501; fetch it with Electron's `net.fetch`, not Node https.

## Running the app in this environment

- The shell has `ELECTRON_RUN_AS_NODE=1` set; strip it when launching Electron (the dev script and tests do).
- The desktop is Wayland and Electron picks it automatically, so windows appear on the user's screen even with `DISPLAY=:99`. For hidden runs: `Xvfb :99`, `--ozone-platform=x11`, and unset `WAYLAND_DISPLAY` and `XDG_SESSION_TYPE`.
- The user often has their own mumh5 (`npm run dev`) running. Only stop processes started with a `mumh5-e2e` profile; never kill Electron processes in general.
- `pkill -f pattern` matches the invoking shell; use `pkill -f "[p]attern"`.

## Commits

End commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>` style attribution (the exact line comes from the session). No emojis in commit messages.
