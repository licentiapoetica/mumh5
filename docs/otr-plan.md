# Plan: OTR messaging for direct chats

[Back to the README](../README.md)

Status: proposal, nothing implemented. This document is for discussion; the decisions it asks for are listed at the end.

## Why

Direct messages in Mumble are TLS to the server and then plain text on the server. The server operator can read them and, with enough effort, so can anyone who gets hold of server memory or a TLS-terminating proxy (the browser build's proxy sees them too). Off-the-Record messaging gives two people:

- Encryption the server cannot read.
- Authentication of the peer (a fingerprint to compare).
- Forward secrecy: later key theft does not open past messages.
- Deniability: the transcript proves nothing to a third party (OTR v3 and v4 properties, with the usual caveats).

It is a natural fit for a "private message" feature. It is not a fit for channel chat, text channels or voice (see Non-goals).

## Non-goals

- Channel messages and text channels. OTR is strictly two parties. Group encryption is a different protocol (MLS, or sender keys) and a separate proposal.
- Voice encryption. Mumble voice is already OCB2 over UDP or TLS tunnel; end-to-end voice is out of scope.
- Files. File transfer pieces go through chat messages (`file-transfer.ts`); encrypting them end to end is a later step once direct messages work.
- Interop with other Mumble clients. None of them speak OTR (see Transport).
- Replacing the Mumble certificate identity.

## Constraints from this codebase

These shape every choice below.

1. **No delivery guarantees and no offline queue.** OTR needs both people online with a live session. A message to someone offline is not sent (the UI must say so, not queue plaintext).
2. **Murmur rate limits.** Text messages are a leaky bucket (burst 5, 1/s) and plugin data is limited to 1000 bytes per packet, burst 15 then 4/s per sender, dropped silently (see CLAUDE.md, pitfalls). OTR handshakes and DH ratchet steps have large messages (a v3 DH commit is about 200 bytes, a DH key message about 400 bytes; v4 messages are larger because of ed448 keys and ring signatures). Everything must be chunked and paced like `share-signal.ts` does.
3. **Sessions are not identities.** A session id changes on every reconnect; the stable identity is the certificate hash (`User.hash`). OTR state must be keyed by certificate hash, with a session id only as the current route. Guests without a certificate have no hash, so OTR is unavailable for them (or limited to the current connection, see decision 4).
4. **`src/core/` is browser-safe and runs in Node tests.** The protocol logic goes there (no DOM, no Electron, no Node imports). Key storage and UI go in `src/lib/` and `src/ui/`.
5. **CSP.** No `unsafe-eval`; `wasm-unsafe-eval` is allowed but documented as "for the built-in Opus codec only". Any WASM crypto would widen that sentence. Pure JS libraries must not use `eval` or `new Function`.
6. **Both interfaces.** A feature added to one of the Stacked/Rooms shells needs its place in the other.
7. **Privacy rule.** OTR must not contact any host the user did not choose; there is no key server in this plan.

## Options for the protocol

| Option | Pros | Cons |
| --- | --- | --- |
| **A. OTR v3** (libotr 4.x semantics: DH-1536, AES-128-CTR, HMAC-SHA256, DSA identity keys, SMP for authentication) | Specified and widely implemented. Real interop with libotr clients is conceivable. Deniable. | Old primitives (DH-1536, DSA, SHA-1 in places). Maintained JS implementations are scarce: `otr` (arlolra/otr, used by CryptoCat and Diaspora-era projects) is unmaintained, and uses a large-number library. Any audit must be done by us. |
| **B. OTR v4** (draft; ed448, double ratchet, ring signatures, deniable AKE) | Modern primitives, async-friendlier. | Still a draft, no maintained JS implementation I can confirm, large spec to implement and test ourselves. Highest risk. |
| **C. Double ratchet over our own handshake** (Signal-like: X25519 + Ed25519 from WebCrypto, AES-GCM or ChaCha20) | Small, built on WebCrypto (`crypto.subtle` has X25519 and Ed25519 in current Chromium and Electron), no new dependency, async-friendly with prekeys. | Not "OTR" by name or by spec. Not deniable unless designed for it (X3DH signatures prove authorship). We would own the protocol design. |
| **D. libotr compiled to WASM** | Real libotr. | Needs `wasm-unsafe-eval` for more than Opus, a build pipeline like `scripts/build-deepfilter.sh`, and libotr's dependencies (libgcrypt) are heavy. Likely poor fit for the browser build size. |

Recommendation for the exploration: **start with a prototype of A** behind a setting, keeping the protocol module (`src/core/otr/`) small and replaceable, and write the decision memo about C versus A once the prototype shows the real message sizes and how it behaves on the rate limits. Do not pick B or D without a maintained implementation. If the user-facing requirement is "the server cannot read my DMs" and not "must be OTR", C is the lower-risk way to meet it, and it should be said plainly in the UI which one it is.

Whatever is picked: no home-made primitives, WebCrypto where it covers the need, and test vectors from the spec or from libotr for every step.

## Transport

OTR messages are base64 text (`?OTR:...`). Two ways to carry them in Mumble:

1. **Private TextMessage with the `?OTR:` armor.** Visible to stock clients as gibberish, rate limited as chat (burst 5, 1/s), size limit 5000 characters, ends up in any server-side chat logging, and another client's "Poked you"-style display would show the armor. Pro: works with a plain Murmur and is the format other OTR clients expect. Con: stock Mumble users see garbage, and the 1/s limit is shared with normal chat.
2. **Plugin data** (`mumh5.otr`, like `mumh5.react` and `mumh5.share`). Invisible to stock clients, no server-side chat log, but 900 bytes per packet, 4 per second, silently dropped on overflow, and no interop.

Proposal: plugin data, chunked and paced by the existing machinery, with sequence numbers and an acknowledgement so a dropped chunk is noticed and the message is shown as "not delivered" rather than lost silently. A stock-client peer never sees anything, which is the honest result: the UI shows "this person's client does not support OTR" instead of falling back to plaintext. Armor over TextMessage is kept as an option only if interop with other OTR clients turns out to matter.

Detection that a peer supports OTR: an OTR query is sent as plugin data; no answer in a few seconds means unsupported. Never put an OTR whitespace tag or query string in a normal chat message.

## Identity and authentication

- Keep the TLS certificate as the account identity, and generate a separate OTR long-term key per identity (DSA for v3, Ed25519 for option C). The key is stored with the identity in `identity-store.ts` (desktop) or in the browser's localStorage identity blob (`web.svelte.ts`).
- Binding: sign the OTR public key with something the peer can check against the certificate hash they already know, or accept trust-on-first-use plus fingerprint comparison. The TLS key cannot be used for OTR signatures directly (it is not exposed to the renderer). Proposal: TOFU plus manual verification, as OTR clients do.
- Verification UI: show both fingerprints in `ProfileCard.svelte` with a "Verified" toggle, and optionally the SMP question/answer flow (v3) later. Verified state is stored per own identity and peer certificate hash.
- A peer whose key changes shows a clear warning and is demoted to "unverified". No silent re-trust.

## Where it goes in the code

| Piece | Location |
| --- | --- |
| Protocol state machine, message framing, chunking, test vectors | `src/core/otr/` (new), unit tests in `test/` |
| Plugin data id, pacing, ack and retry | `src/lib/otr.svelte.ts` (modelled on `reactions.ts` and `files.svelte.ts`) |
| Per-identity long-term key and peer fingerprints | `electron/identity-store.ts`, `web.svelte.ts`, exposed through `native` in `src/lib/native.ts` |
| Session state per peer (keyed by certificate hash, routed by current session id) | `src/lib/otr.svelte.ts`, dropped on disconnect |
| Settings | `settings.otr` in `settings.svelte.ts` with an entry in `PARTS` (Settings > Privacy tab or Chat) |
| UI: lock state in the private chat header, "Start private session", fingerprint and verify in `ProfileCard`, message markers | `ChatLog`, `Composer`, `ProfileCard`, both `src/ui/` and `src/ui2/` |
| i18n | All new text through `t()` and `src/locales/en.ts` |
| Docs | `docs/features.md` (Chat section), a short threat model in this file once built |

## Behavior to specify before coding

- **States** per peer: none, unencrypted, handshake in progress, encrypted (unverified), encrypted (verified), finished (the peer ended). The composer must show which one it is in at all times, and a message typed in `encrypted` must never fall back to plaintext without the user explicitly choosing it.
- **Require OTR** setting: when on, direct messages to peers without a session are not sent, and incoming plaintext direct messages from peers you have a session with are shown with a warning.
- **History.** Forward secrecy is pointless if the app stores plaintext forever. Default: OTR messages are kept in memory only for the session, or kept in IndexedDB only if the user turns on "keep encrypted chats"; `chat-retention.ts` must treat them explicitly. Needs a decision.
- **Notifications.** System notifications (`notify.ts`) must not include OTR plaintext when the window is unfocused unless the user allows it, since notification centers keep history.
- **Multiple sessions.** The same person connected twice has two session ids; OTR v3 has instance tags for exactly this. A prototype must handle it or refuse a second session cleanly.
- **Reconnect.** The session is lost with the connection. Re-establishing is automatic only if the peer was verified and the user chose "start automatically".
- **Reactions, edits, pokes and files** in an OTR chat: unsupported at first; the UI hides those actions in encrypted chats.

## Security notes and risks

- We would be implementing or integrating a cryptographic protocol in a client that renders attacker-controlled HTML. Message content in OTR chats must go through the same sanitizing (`renderIncoming`) as any chat, and the OTR layer must carry plain text or a minimal subset, not raw HTML.
- Traffic analysis: the server still sees who talks to whom, when, and message sizes. This is metadata protection no one should expect from this feature. Say so in the UI help text.
- A malicious server can drop, delay or block OTR plugin data and can suppress the handshake. It cannot read or forge messages once the keys are verified. It can refuse to deliver, which looks like "unsupported client"; verified peers should show "no answer" distinctly from "unsupported".
- The browser build's proxy is TLS-terminating for the Mumble leg only; OTR is end to end between browsers, which is a real improvement there. Keys live in localStorage in the browser build, so XSS or a malicious extension takes them; say so.
- The UI must not claim more than is tested ("Encrypted" only when the session is established and the cipher state is live).
- Needs an independent review of the protocol code before it ships outside an experimental setting.

## Staged plan

1. **Spike (1 to 2 days).** In a branch: pick the library or write the minimum for option A or C, handshake two `MumbleClient` instances in a Node test over a real Murmur (`MUMBLE_TEST_HOST`), and record real chunk counts and timings against the plugin-data limits. Output: a short results note and the decision on A versus C.
2. **Core module and tests.** `src/core/otr/` with spec test vectors, fuzzing of the parser (malformed and truncated input must never throw out of the state machine), and the pacing and ack layer with simulated loss and reordering.
3. **Key handling.** Long-term key creation per identity, storage on desktop and web, export with the identity file, fingerprint display.
4. **UI behind a setting (off by default, labeled experimental).** Private chat header state, start and end, fingerprint verification, markers on messages, in both interfaces. E2E step in `test/e2e/app.e2e.ts` with two instances.
5. **Hardening.** Require-OTR mode, history policy, notification policy, multiple sessions, review.
6. **Decide on interop and groups** separately, with real usage data.

## Decisions needed

1. A (OTR v3 proper) or C (Signal-style ratchet, not OTR by name)? The spike gives the data; the answer depends on whether interop with other OTR clients or deniability matters more than a smaller, WebCrypto-only implementation.
2. Plugin data only, or also the `?OTR:` armor over private text messages?
3. Is "no OTR for guests without a certificate" acceptable?
4. Default for history: memory only, or opt-in storage?
5. Do we accept a new dependency (or vendored, pinned source like `vendor/deepfilternet/`) for the protocol, or must it be our own code on WebCrypto?
6. Who reviews the crypto before it leaves experimental status?
