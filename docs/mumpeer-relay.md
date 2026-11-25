# Mumpeer relay for desktop screen sharing

Protocol references from the original research note include `Mumcord/mumcord` at 1a36296 (`specs/04-mumpeer-relay-specification.md`, `crates/p2p`, `crates/engine/src/mumcord.rs`, `crates/engine/src/screen_share/broadcast/`), `Mumcord/mumpeer` 0.3.1 (`docs/protocol.md`, `docs/api.md`), `Mumcord/mumbot` `docs/peer.md`.

## Enable the relay

The desktop and Android apps and the browser build (through its gateway, see below) discover mumpeer on login. By default, when both participants use **Automatic**, a usable relay announced on the Mumble server’s own host is tried first. If it fails, the app retries with the regular ICE routes. Match the announced relay hostname to the address people use to connect to Mumble. The relay and Mumble can listen on different ports.

**Settings → Screen sharing → Screen sharing connection** also lets you choose direct-first mumpeer fallback or Mumpeer only. Those modes can use a relay announced on a separate host. Mumpeer only fails if either participant cannot use the relay. The relay operator can see connection addresses and timing. WebRTC encrypts the streams between participants.

The Mumble server needs a registered [mumbot peer](https://github.com/Mumcord/mumbot/blob/v0.6.0/docs/peer.md) connected to [mumpeer](https://github.com/Mumcord/mumpeer/tree/v0.3.0). By default both participants must register on that Mumble server, and mumbot limits each certificate to four open pairs. An operator can adjust these policies. The app shows discovery and trust under **Server information → Mumpeer relay**. A new bot certificate or relay certificate requires approval after first use.

## What it is

Three parts, none of them touches the Mumble server:

| Part | Job |
|---|---|
| mumpeer (Rust, AGPL-3.0) | Relay. Listens on QUIC/UDP and TLS/TCP (both 443 by default). Forwards only between sides the bot registered. |
| mumbot `peer` | A registered bot user on the Mumble server. Announces the relay to Mumcord clients and asks mumpeer for tokens through a secret HTTP API on loopback. |
| Mumcord client | Asks the bot for a token, connects to mumpeer with its Mumble certificate, sends its already end-to-end encrypted packets through it. |

A community runs mumpeer and mumbot alongside stock Murmur. Eligible clients discover the relay through Mumble plugin data.

## The contracts a client has to speak

There are two. The bot API (`/v1/status`, `/v1/pairs`, `/v1/broadcasts`, `DELETE /v1/peers/{hash}`) is between bot and relay only; a client never calls it, and it needs the operator's secret.

### 1. Plugin data with the bot (over Murmur)

- **Hello**, data id `mumcord.hello`, to everyone: `{"app":"mumcord","v":1,"features":[...],"ask":false}`. The bot only announces to sessions whose hello lists `p2p`, and only gives tokens to pairs where both did. The decoder rejects any `app` other than `mumcord`.
- **`mumcord.peer`**, compact JSON, at most 1000 bytes:
  - bot to client: `{"v":1,"t":"relay","host","udp","tcp","fp","state":"up"|"down","seq","u":[...],"bc","pk","reg"}`. `fp` is the SHA-256 of the relay certificate. Accept only from a registered sender with a cert hash; pin (bot hash, fp) on first use per server.
  - client to bot: `{"v":1,"t":"token-req","rid":"<16 hex>","peer":<session>,"use":"scr"}`.
  - bot to both: `{"v":1,"t":"token","rid","a","b","tok":"<43 base64url>","ttl"}`; or to the requester `{"v":1,"t":"token-err","rid","r"}` (`denied`, `peer-gone`, `peer-not-mumcord`, `no-hello`, `not-registered`, `group-not-allowed`, `rate-limited`, `relay-down`, `relay-full`, `use-not-allowed`).
  - Broadcasts add `bcast-req`, `bcast`, `bcast-admit`, `bcast-tok`, `bcast-kick`, `bcast-err`.
- Bot defaults: `registered_only = true`, so guests never get a token, also not as the other side of someone else's request. 6 token requests per session per minute.

### 2. The outer link to mumpeer

- TLS 1.3, ALPN `mumpeer/1`, client certificate required (the Mumble identity; the relay identifies it by SHA-1 of the DER, like Murmur). Server certificate is self-signed and checked against the pinned `fp`, not a CA.
- TCP framing: `type u8 | length u16 BE | payload (<= 1500)`. Type 0 is control JSON, type 1 is a packet.
- Control: client sends `{"v":1,"t":"bind","tok":"..."}` within 5 s; relay answers `waiting`, then `ready` once the other side bound, or `error` with a code (`unknown_token`, `expired`, `not_allowed`, `bot_gone`, `relay_full`, `peer_limit`, `rate_limited`, `version`, `bad_request`).
- After `ready`, every type-1 payload is copied unchanged to the partner. The relay never parses it. One side may be on QUIC and the other on TCP.
- Session ends on close, 60 s idle, revoke, or bot gone. Default limit 10 Mbit/s each direction per session.

QUIC is only needed for the UDP path. mumh5 connects over TCP, which is a valid client: Mumcord itself falls back to it, and mixed UDP/TCP pairs are allowed.

## How the desktop and Android apps connect

1. An eligible desktop client sends the mumbot-compatible `mumcord.hello` with the `p2p` feature to registered users on login and as they join. Discovery pins the registered bot's certificate hash and the relay's fingerprint for this server and local identity.
2. The watch request advertises the pinned relay and the viewer's routing requirement before SDP is exchanged. The sharer uses relay-only ICE up front when either side requires it or both prefer the same-host relay. When both can use mumpeer and choose direct-first fallback, an ICE failure can trigger a new offer through the relay.
3. The lower Mumble session number requests the pair after both clients confirm the same share attempt. A new token replaces any existing link for the certificate pair, so reciprocal shares reuse the same link and tag their packets with a one-byte direction.
4. The native Rust core (`crates/platform/src/mumpeer.rs`, called from Tauri) connects over TLS 1.3, verifies ALPN and the pinned relay fingerprint before sending the token, and binds with the exact client identity from the Mumble connection. After both endpoints bind, it starts a credentialed TURN listener on loopback for each active share direction. Its relay address and peer address are virtual. Each TURN allocation forwards media and ICE packets to its one permitted peer over the paired TLS link.
5. The app closes the allocation when the share ends and closes the link when its last allocation is no longer needed. A TCP-only relay path can add latency on lossy links.

## Browser build

A browser cannot open TLS sockets or present a client certificate, so the web gateway (`mumh5-web`, `crates/web/src/relay.rs`) keeps the link to the relay for it. It needs the gateway's relay on (`MUMH5_TURN`, on by default, and a STUN port) and at least one relay port in `MUMH5_MUMPEER_PORTS`; then `/api/config` says `mumpeer: true` and the app offers the same settings and the Server information section as the desktop app. The Tauri Android app uses the native path above, not the gateway.

1. After the Mumble connection is secure, the page sends `relay-open` (relay address, fingerprint, token) as a text frame on its WebSocket. The proxy binds with the certificate of that same connection and answers when the relay says ready.
2. `relay-turn` returns a credential for one lane on the proxy's public relay (`<expiry>:lane-<id>`). That credential reaches only the virtual address of its lane, one allocation at a time, and never a normal relay. The page uses it as the only ICE server of the mumpeer route, over UDP or TCP like the proxy's other relay credentials.
3. `relay-lane-close` and `relay-close` end a lane or the link; the proxy also ends all links when the WebSocket closes and reports a link that ends with `relay-closed`. At most nine links per connection.

Where the proxy may dial: the relay's TLS port has to be one the operator lists (`MUMH5_MUMPEER_PORTS`, default 443), since browsers name the port and an unlisted private server must not become a port scanner. The relay has to be on the same host as the Mumble server being used. Only a proxy that allows any server (`MUMH5_ALLOW_ANY`) also takes a relay on another host, and then never one that resolves to a private address, as for Mumble servers. On a proxy with a fixed server list, "Direct first, with mumpeer fallback" and "Mumpeer only" therefore work only for relays on the server's own host.

The proxy operator carries the traffic between the browser and the relay link and can see the connection addresses; WebRTC still encrypts the streams between the two participants. The relay sees the proxy's address, not the browser's. Cameras use the existing WebRTC routes. Mumpeer's camera policy applies to broadcasts, and its pair API supports screen sharing. Mumcord screen-share interoperability would require its separate broadcast signaling, key exchange and media format.

## Test with stock Mumble and upstream services

Automated coverage without a real relay:

- `cargo test -p mumh5-platform mumpeer` runs the pinned TLS link against a local relay: bind and token, pin and ALPN rejection before the token is sent, relay refusal, teardown and lane reallocation.
- `cargo test -p mumh5-platform turn` covers the loopback lane adapter and public-relay lane credentials (one allocation at a time, unknown and removed lanes refused).
- With a disposable Mumble server, `MUMH5_TEST_HOST=127.0.0.1 MUMH5_TEST_PORT=64750 cargo test -p mumh5-web --test mumpeer_gateway` drives the gateway's `relay-*` frames end to end and moves media through a lane.

For an end-to-end test with the real services, start [mumbot's peer-with-relay example](https://github.com/Mumcord/mumbot/tree/v0.6.0/examples/peer-with-relay) or run the release binaries on loopback, on an idle relay. Use the relay’s configured `public_host` as the Mumble host so same-host discovery is exercised, connect two mumh5 clients with registered identities, and share a screen with the route set to "Mumpeer only". This manual check has not yet been automated for the Rust/Tauri build.
