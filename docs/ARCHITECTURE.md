# Architecture

| Package | Responsibility |
| --- | --- |
| `crates/core` | Native Mumble protocol state, TLS/identity connector, OCB2 UDP crypto, native Opus, WebRTC/VP8, bot commands; bounded raw TLS and UDP transports for the desktop/gateway |
| `crates/cli` | Native executable; JSON stdin/stdout control, separate PCM/video inputs and outputs |
| `crates/platform` | Certificate creation/import/export, atomic private profile storage, ping, public list and link metadata |
| `crates/desktop` | Tauri shell, Rust IPC, TLS/UDP sessions, tray, native backup dialog and private sound storage |
| `crates/web` | Axum static asset server, stateless certificate endpoints and allowlisted TLS/WebSocket gateway |
| `frontend` | Reused Svelte 5/TypeScript interface, themes, browser media and protocol presentation; Bun build plugin |

The Rust CLI is the native protocol/bot library foundation. Tauri replaces the
old main/preload application; Axum replaces the JavaScript proxy. Neither desktop
nor browser deployment runs Bun or Node. The frontend intentionally remains
Svelte/TypeScript so its UI and features can be reused rather than rewritten.
Its protocol/state layer still interprets Mumble frames in the WebView. Desktop
networking and crypto are native Rust, shared with the CLI. This is a foundation
for further consolidation of protocol state behind a typed Rust API, not a claim
that the reused frontend has been translated to Rust.

Desktop initialization reads saved state before Svelte stores mount. Private
keys remain in the Rust profile; the UI gets certificate summaries and opaque
identity IDs. TLS completes before authentication and exposes the server chain.
The existing UI checks its saved SHA-256 pin before sending credentials. The
CLI likewise checks pins before authentication; changed pins need explicit
verified replacement. Desktop profile files are atomic and mode 0600 in a 0700
directory on Unix. Do not run multiple desktop processes on the same profile.
Set `DREAM_CORD_PROFILE` for a separate desktop profile. CLI `--state-dir` is a
separate identity/pin format, intended for persistent individual bots.

TLS byte queues are bounded. Desktop packets use Tauri IPC channels and explicit
acknowledgements so a stalled WebView applies backpressure. UDP voice uses the
shared Rust OCB2 implementation, periodic encrypted probes and frontend TCP
fallback. CLI audio/video queues drop stale media instead of increasing latency.
Input audio is never implicitly connected to output audio. Native video codecs
are created on demand; libvpx uses a small C adapter while WebRTC is Rust.

Tauri capabilities are restricted to the local main window. External links open
in the system browser, and untrusted remote documents never receive native IPC.
PKCS#12 export writes through a native save dialog; callers cannot supply an
arbitrary destination. The web gateway has an explicit target allowlist, same
origin checks, body/message size limits and bounded connection/identity workers.
Use HTTPS and a trusted operator: the web gateway necessarily receives browser
identity keys to establish a client-authenticated TLS connection.

Bun compiles Svelte components/runes, bundles local CSS/fonts and prebuilds audio
worklets. WASM/model/PDF worker assets are copied explicitly. No Vite, Electron,
JavaScript server, native JS addon, or Node build script is carried over. Bun's
package ecosystem still uses `package.json`, `bun.lock`, and `node_modules`;
these are browser/build dependencies, not a Node runtime dependency.

The legacy `mumh5.*` wire identifiers and local-storage keys are retained for
interoperability. Original source/asset attribution is preserved. Visible product
and release identification are Dream Cord; updates point to this repository.
