# Building a Rust bot

Use the Rust crate directly for binary audio/video and typed connection handles,
or control the native CLI with JSON lines from any language. Both connect directly
to Mumble; neither runs Node.js, a browser, or a display server.

## Control a bot through chat

Start the built-in bot:

```sh
./target/release/dream-cord-cli --server localhost --name helper --trust-new --bot
```

Send `!help` or `!ping` from another Mumble client. Commands can arrive privately
or through a channel the bot receives, including live mumh5 text channels. All
replies are private. Deafening also mutes; unmuting also undeafens, matching the GUI. Without `--bot`, incoming chat is only emitted as events;
it does not execute commands.

| Command | Access | Behavior |
| --- | --- | --- |
| `!help` | Everyone | List commands. |
| `!ping` | Everyone | Reply `pong`. |
| `!status` | Everyone | Show username, channel, user count and UDP state. |
| `!whoami` | Everyone | Show your session ID and registered user ID. |
| `!join /Lobby` | Allowlisted admin | Move the bot to a voice channel. Full paths may contain spaces. |
| `!mute on` / `!mute off` | Allowlisted admin | Change the bot's self-mute state. |
| `!deaf on` / `!deaf off` | Allowlisted admin | Change its self-deafen state. |
| `!shutdown` | Allowlisted admin | Send a reply, close resources and exit normally. |

Register your ordinary Mumble user on the server, send `!whoami`, then restart the
bot with the reported **registered user ID**:

```sh
./target/release/dream-cord-cli --server localhost --name helper --bot \
  --admin-user-ids 12,34
# Alternatively: DREAM_CORD_ADMIN_USER_IDS=12,34 ... --bot
```

Authorization uses registered IDs supplied by the server. Display names, session
IDs and IDs typed into a command do not authorize control. The allowlist is empty
by default, and IDs are specific to the server. The bot still needs its own
permissions/access tokens to enter restricted channels.

Commands are case-sensitive, with plain Mumble HTML text; rich-text wrappers are
not parsed. Unknown commands and own/server messages are ignored. The CLI handles
commands sequentially with a 1.5-second cooldown and ignores commands during that
cooldown. Keep the same `--state-dir` across restarts to retain the bot's identity
and pins. Unexpected disconnections exit nonzero; `Restart=on-failure` can restart
the service while respecting an explicit normal shutdown. It does not reconnect
automatically.

## Import the Rust library

Add the crate from a checkout:

```sh
cargo add dream-cord-core --path ../dream-cord/crates/core
cargo add anyhow serde_json
cargo add tokio --features macros,rt-multi-thread,signal,time
```

Native build dependencies are listed in [CLI.md](CLI.md). Add
`--no-default-features` when adding `dream-cord-core` if your bot needs only text and
voice, without WebRTC/libvpx. A runnable library example is
`crates/core/examples/chat_bot.rs` in the repository:

```sh
DREAM_CORD_HOST=localhost DREAM_CORD_STATE_DIR=./helper-profile DREAM_CORD_TRUST_NEW=1 \
  cargo run -p dream-cord-core --example chat_bot
```

The example accepts `DREAM_CORD_PORT`, `DREAM_CORD_PASSWORD`, `DREAM_CORD_SERVER_FINGERPRINT` and
`DREAM_CORD_ADMIN_USER_IDS`. Use distinct profile directories for different bots/server
profiles. It delegates chat control to the public `bot::handle()` helper, applies
command pacing and calls `close()` on shutdown. `bot::handle()` returns `true`
after an authorized shutdown command; the caller then closes the connection.

A minimal custom ping bot looks like this:

```rust,no_run
use anyhow::Result;
use dream_cord_core::{Client, Options, Target};

#[tokio::main(worker_threads = 2)]
async fn main() -> Result<()> {
    let mut options = Options::new("localhost", "my-helper", "./my-helper-profile");
    options.trust_new = true; // Or use a verified options.server_fingerprint.
    options.password = std::env::var("DREAM_CORD_PASSWORD").ok();
    let mut connection = Client::connect(options).await?;
    let client = connection.client.clone();
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            event = connection.events.recv() => {
                let Some(event) = event else { break; };
                if event["event"] == "closed" { break; }
                if event["event"] == "text" && event["self"] != true
                    && event["html"].as_str() == Some("!ping")
                    && let Some(actor) = event["actor"].as_u64().and_then(|n| u32::try_from(n).ok())
                {
                    if let Err(error) = client.send_text("pong", Some(Target::Id(actor)), None).await {
                        eprintln!("Reply failed: {error}");
                    }
                }
            }
        }
    }
    client.close().await?;
    Ok(())
}
```

For sustained command traffic, bound work and pace replies as in the runnable
example rather than spawning an unlimited task per message. Add administrative
commands to `crates/core/src/bot.rs`, keeping them behind the registered-ID check,
or implement your own policy using `client.state().users`.

## API reference

`Client::connect(Options)` returns a `Connection` with:

| Field | Type / purpose |
| --- | --- |
| `client` | Cloneable `Client` handle. |
| `events` | Bounded `mpsc::Receiver<serde_json::Value>` containing control events. |
| `audio` | Bounded `mpsc::Receiver<Vec<i16>>` for incoming mixed PCM. |
| `video` | Bounded `mpsc::Receiver<VideoFrame>` containing binary I420 frames. |

Control events use the same field names as CLI stdout: `text`, `user`, `warning`,
`sharing`, `videoConnection`, `mediaError`, and `closed`. Text contains Mumble HTML
in `html`, the sender's session in `actor` (or null for server messages), display
name `author`, destination arrays, `self`, `textChannel`, and receive `time` in
milliseconds since the epoch. There is no library `ready` event: await `connect()`.
CLI `video` events describe recording files; library frames arrive on the separate
binary `video` receiver instead.

`Options::new(host, name, state_dir)` requires a persistent profile directory.
Optional public fields are `port` (64738), `password`, `trust_new`,
`server_fingerprint`, `tokens: Vec<String>`, `tcp_only`, and
`ice_servers: serde_json::Value` (an `RTCIceServer[]`, empty by default). TLS trust
and identity behavior match the CLI. Keep a persistent CLI profile directory for each bot.

```rust,no_run
# use dream_cord_core::{Client, Target};
# async fn example(client: &Client) -> anyhow::Result<()> {
client.send_text("Hello channel", None, None).await?;
client.send_text("Private hello", Some(Target::Name("alice".into())), None).await?;
client.send_text("Notes", None, Some(Target::Name("/notes".into()))).await?;
client.join(Target::Name("/Lobby".into())).await?;
let state = client.state();
let alice = state.user(&Target::Name("alice".into()))?;
let lobby = state.channel(&Target::Name("/Lobby".into()))?;
println!("{alice}: {}", state.path(lobby));
# Ok(()) }
```

`Target::Id` means a session/channel ID, not a registered user ID. Exact names and
full paths are accepted; missing or ambiguous targets fail. Text is escaped by
default; `client.command(json!({"op":"send", "text":"...", "html":true}))`
explicitly sends HTML. Do not pass both a user and a channel. Text channels are
messaged without joining and require a Mumble 1.4+ server. History is neither
requested nor persisted.

`send_text()` waits for queued outgoing messages to be submitted and a server
ping round trip; this is not a delivery/permission receipt. Raw JSON `send` replies
confirm enqueueing. `client.flush()` explicitly waits for outgoing text/plugin
queues and that round trip. `join()` waits for the server to confirm the channel
change, or returns an error/timeout. Server permission errors also arrive through
`warning` events.

`client.command(serde_json::Value)` exposes all CLI commands, including
`list`, `mute`, `deaf`, `share`, `watch`, `unwatch` and `stop-video`. `client.state()`
returns a snapshot containing users, channels, your session, connection/server
version, UDP status and current outgoing video dimensions. Events should be
consumed continuously; a saturated control-event queue disconnects the client.

Call `client.close().await` to release codecs, peers, sockets and tasks. Dropping
the final client handle also requests cancellation, but awaiting `close()` makes
cleanup completion explicit. After connection loss, create a new connection and
reattach your event/media consumers. Preserve the same profile directory.

## Independent incoming and outgoing voice

Enable audio explicitly; text-only bots do not initialize codecs or the audio tick.
The outgoing input is `send_audio(Vec<i16>)`; incoming samples arrive on the
`Connection::audio` receiver. Both use **48 kHz mono signed 16-bit PCM**.

```rust,no_run
# use dream_cord_core::Connection;
# async fn example(mut connection: Connection) -> anyhow::Result<()> {
connection.client.enable_audio(40000).await?;
// Send 10 ms of silence; replace with your capture/TTS samples.
connection.client.send_audio(vec![0_i16; 480]).await?;
// Independently consume what other users said:
if let Some(samples) = connection.audio.recv().await {
    // Feed samples to an ASR engine or other bounded consumer.
    println!("{} incoming samples", samples.len());
}
connection.client.disable_audio().await?;
connection.client.close().await?;
# Ok(()) }
```

Pace outgoing chunks in real time (10–100 ms) and use one producer at a time.
A full input queue returns an error; avoid busy retry loops. Received audio mixes
other users, includes silence when idle, and never feeds the outgoing encoder.
Own session packets are discarded. A slow incoming consumer loses samples rather
than accumulating an unbounded queue. Native input/output contain sample values;
JSON/file/pipe PCM uses their little-endian byte representation.

## Binary video

Start sharing, pace packed I420 frames, then stop sharing:

```rust,no_run
# use dream_cord_core::{Client, video::frame_bytes};
# use serde_json::json;
# async fn example(client: &Client) -> anyhow::Result<()> {
client.video_command(json!({"op":"share","width":320,"height":180,"fps":15,"kind":"camera"})).await?;
for _ in 0..150 {
    let frame = vec![128; frame_bytes(320, 180)?];
    // false means the bounded input queue is busy: drop this frame.
    let _accepted = client.push_video(frame)?;
    tokio::time::sleep(std::time::Duration::from_secs_f64(1.0/15.0)).await;
}
client.video_command(json!({"op":"stop-video"})).await?;
# Ok(()) }
```

Receive with `client.video_command(json!({"op":"watch","user":"alice"}))`, then
consume `connection.video.recv().await`. `VideoFrame` contains `session`, `width`,
`height`, and `data: Vec<u8>`. Keep a bounded downstream queue or only the latest
frame. `{"op":"auto-watch","enabled":true}` discovers the first sharer in your
voice channel; `unwatch` releases the incoming peer. Stop your producer when the
connection closes. The default build supports one incoming video and eight
outgoing viewers. WebRTC signaling requires Mumble 1.4+; transport uses explicit
STUN/TURN from `Options::ice_servers` if configured. No relay is selected
implicitly. See the CLI guide for codec, frame-size and recording limits.

## Python or other languages

Launch the native executable as a subprocess. This
Python bot receives JSON text events and sends private replies:

```python
import json
import subprocess
import time

process = subprocess.Popen(
    ["./target/release/dream-cord-cli", "--server", "localhost",
     "--name", "python-helper", "--trust-new"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
)
next_reply = 0.0
try:
    for line in process.stdout:
        event = json.loads(line)
        if (event.get("event") == "text" and not event.get("self")
                and event.get("actor") is not None and event.get("html") == "!ping"
                and time.monotonic() >= next_reply):
            process.stdin.write(json.dumps({"op": "send", "user": event["actor"], "text": "pong"}) + "\n")
            process.stdin.flush()
            next_reply = time.monotonic() + 1.5
finally:
    if process.poll() is None:
        process.terminate()
    process.wait(timeout=10)
```

Use request IDs to correlate responses when issuing concurrent commands. Keep
reading stdout and stderr if you pipe them. For administrative chat controls,
prefer the built-in `--bot --admin-user-ids ...`, or resolve authoritative
registered IDs from `list` and `user` events before acting. Continue updating that
session-to-registered-ID mapping as people reconnect. Use distinct files/pipes for
continuous media rather than base64 JSON. Formats and options are in
[CLI.md](CLI.md).
