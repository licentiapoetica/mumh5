# mumpeer relay: what it is and how mumh5 could use it

Research note, 2026-11-21. Sources: `Mumcord/mumcord` at 1a36296 (`specs/04-mumpeer-relay-specification.md`, `crates/p2p`, `crates/engine/src/mumcord.rs`, `crates/engine/src/screen_share/broadcast/`), `Mumcord/mumpeer` 0.3.1 (`docs/protocol.md`, `docs/api.md`), `Mumcord/mumbot` `docs/peer.md`. Nothing here is implemented or tested yet.

## What it is

Three parts, none of them touches the Mumble server:

| Part | Job |
|---|---|
| mumpeer (Rust, AGPL-3.0) | Relay. Listens on QUIC/UDP and TLS/TCP (both 443 by default). Forwards only between sides the bot registered. |
| mumbot `peer` | A registered bot user on the Mumble server. Announces the relay to Mumcord clients and asks mumpeer for tokens through a secret HTTP API on loopback. |
| Mumcord client | Asks the bot for a token, connects to mumpeer with its Mumble certificate, sends its already end-to-end encrypted packets through it. |

So a community runs mumpeer + mumbot next to a stock Murmur, and every client that speaks the protocol gets a relay without configuring anything. That is the part we lack: our desktop app only gets a relay when the user types a mumh5 proxy into `settings.relayServer`.

## The contracts a client has to speak

There are two. The bot API (`/v1/status`, `/v1/pairs`, `/v1/broadcasts`, `DELETE /v1/peers/{hash}`) is between bot and relay only; a client never calls it, and it needs the operator's secret.

### 1. Plugin data with the bot (over Murmur)

- **Hello**, data id `mumcord.hello`, to everyone: `{"app":"mumcord","v":1,"features":[...],"ask":false}`. The bot only announces to sessions whose hello lists `p2p`, and only gives tokens to pairs where both did. The decoder rejects any `app` other than `mumcord`.
- **`mumcord.peer`**, compact JSON, at most 1000 bytes:
  - bot to client: `{"v":1,"t":"relay","host","udp","tcp","fp","state":"up"|"down","seq","u":[...],"bc","pk"}`. `fp` is the SHA-256 of the relay certificate. Accept only from a registered sender with a cert hash; pin (bot hash, fp) on first use per server.
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

QUIC is only needed for the UDP path. Node has no usable QUIC, but TCP alone is a valid client: Mumcord itself falls back to it, and mixed UDP/TCP pairs are allowed.

## What fits mumh5 and what does not

Mumcord uses the pair link to carry an inner QUIC connection (`mumcord-p2p`). We use WebRTC. The relay does not care: the payload is opaque. The question is only how to get WebRTC packets into the link, since an `RTCPeerConnection` cannot be given a custom socket.

| Option | Verdict |
|---|---|
| **A. Use mumpeer pairs as a pipe for our WebRTC** (desktop first) | Recommended. Small, fits our architecture, gives desktop users a relay on any server that runs mumbot `peer`. Details below. |
| B. Watch and send screens with Mumcord users through their broadcasts | Possible, but large: their key exchange (X25519, signed with the Mumble cert key, chunked over `keyreq`/`key`), SFrame (RFC 9605) AES-GCM, the Bovnar media document (`varint(channel) varint(length)`), VP9/AV1 via WebCodecs. Their format changed in 0.9.0 already (legacy 14-byte header to Bovnar profile). A separate project, only if interop with Mumcord users becomes a goal. |
| C. Make our proxy a mumpeer-compatible relay | Not worth it. mumpeer is one Docker image; we would need QUIC to match it. |
| D. Copy the security model into `server/turn.ts` | Worth noting: `GET /api/relay` gives credentials to any origin, while mumpeer only forwards between certificates the bot paired. Separate topic. |

## Option A in detail

### Idea

Electron main runs a small TURN server on `127.0.0.1` whose relayed side is the mumpeer link instead of a UDP socket. The share connection for that viewer is restarted with `iceTransportPolicy: 'relay'` and only this loopback TURN as ICE server. Chromium sends its SRTP/DTLS through TURN as usual; main wraps each packet in a type-1 frame; the other side's main hands it to its browser as coming from the one permitted peer address. WebRTC encryption stays end to end; mumpeer sees bytes, sizes and timing.

One link per pair of people per server, shared by all their streams (screen, cameras): a 1-byte stream index in front of each payload, which only our two clients read. WebRTC packets stay under about 1250 bytes, so they fit the 1500-byte frame. STUN consent checks every few seconds keep the 60 s idle timer from firing.

### Flow

1. On connect, send the hello with `p2p` (see the open decision below). Receive `relay` announcements, validate, pin, keep availability per server (gone 15 s after the bot leaves, at once on `state: "down"`).
2. Our share signal (`mumh5.share`) gets a flag "I can use this server's relay", like Mumcord's `rl`.
3. When a share connection fails (ICE `failed`), or the user chose to hide their IP, and both sides set the flag: the sharer sends `token-req` with `use: "scr"`. The bot sends `token` to both.
4. Each side's main opens TLS to `host:tcp`, checks `fp`, sends `bind`, waits for `ready`, then starts the loopback TURN for that link.
5. Both renderers rebuild that viewer's connection against the loopback TURN.

### Code

| Where | What |
|---|---|
| `src/core/peer-signal.ts` (new) | `mumcord.hello` and `mumcord.peer` encode/decode with Mumcord's limits (size checked before parsing, unknown fields ignored, host/port/fp/rid/tok validated). Unit tests with their example messages. |
| `src/lib/relay.svelte.ts` (new) | Per server: announcement state machine (none, available, down, bot gone, changed and not trusted, conflict), TOFU pin in `store`, pending token requests with 5 s timeout, reason texts. |
| `electron/mumpeer.ts` (new) | TLS client (reuse `openTls` with ALPN and `minVersion: 'TLSv1.3'` added, fingerprint check in `onSecure`), framing, bind/ready, errors. Exposed through `preload.ts` as a narrow `relay:open` / `relay:close`. |
| `electron/turn-bridge.ts` (new) or a refactor of `server/turn.ts` | Allocation, permissions, channels and Send/ChannelData already exist in `turn.ts`; split out the relayed side behind an interface so one implementation is a UDP socket (proxy) and the other a mumpeer link (desktop). |
| `src/lib/share.svelte.ts` | The flag in offers and answers, the fallback decision, rebuilding the connection with the loopback TURN, "via relay" state for the tile tooltip. |
| UI, both interfaces | Server info: relay available or why not, Trust new relay / Forget relay. Settings: a peer-to-peer mode (direct then relay, always relay, direct only, off). |

The browser build already has its proxy's TURN. If wanted later, the proxy can open the mumpeer link for it: it already receives the user's identity with each connect, and the same TURN refactor serves both.

### Tests

- Unit: codec round trips and rejects, framing, the availability state machine.
- Server test: mumbot's `examples/peer-with-relay` compose (Murmur, mumpeer, mumbot `peer`) plus two `MumbleClient`s that send the hello, get the announcement, request a token, bind over TLS and pass bytes. Relay tokens need registered users, so the test registers both.
- E2E: `test:e2e:share` with that compose and `mumh5.iceDebug` forcing the fallback, so the share has to go through mumpeer.

## Open decisions

1. **The hello.** mumbot only serves clients whose `mumcord.hello` says `app: "mumcord"` and lists `p2p`. Sending that makes Mumcord users see us as Mumcord clients (badge, feature checks). Listing only `p2p` keeps them from sending us screen-share, file or image requests, but it is still misrepresenting. Options: (a) send it anyway with `features: ["p2p"]`; (b) ask Mumcord/mumbot to accept another app in the hello, or a relay-only feature, and wait for that; (c) do (a) behind a setting until (b) lands.
2. **Desktop only, or the browser build too** (through the proxy).
3. **Whether to also do option B** (watching Mumcord users' screens). It is what would make mumpeer useful between us and Mumcord users, not only between mumh5 users.
4. **Licence.** mumpeer and Mumcord are AGPL-3.0, mumh5 is MIT. Implementing the documented protocol is fine; their code must not be copied into mumh5. Their test vectors and message examples are facts we can test against.
