# Native Rust headless client

The CLI and bot library are Rust. They connect directly to Mumble using TLS,
encrypted UDP voice with TCP fallback, native Opus, Rust WebRTC, and native VP8.
There is no Node.js, Electron, browser, display server, FFmpeg process, or native
WebRTC worker at runtime. A small C binding connects Rust to libvpx for codecs.

Audio processing starts only when enabled. WebRTC peers and video codecs are
created only when sending or watching video. Queues are bounded; slow media
consumers drop frames/samples instead of accumulating an unbounded backlog.

## Build and run

Use the isolated Rust 1.100 toolchain (`source tools/env.sh`), a C compiler, pkg-config, protoc, and development headers
for OpenSSL, Opus and libvpx. On Debian/Ubuntu:

```sh
sudo apt-get install build-essential pkg-config protobuf-compiler libssl-dev libopus-dev libvpx-dev
cargo build --locked --release -p mumh5-cli
./target/release/mumh5-cli --server localhost --name helper --trust-new
```

The binary uses the platform's OpenSSL, Opus and libvpx shared libraries; deploy
on a compatible system with those runtime libraries installed. Linux x64 is
verified. Other operating systems require their corresponding native libraries
and have not been tested.

For voice and text without WebRTC/libvpx, build with `--no-default-features`.
Voice still uses native Opus. Video commands in that build return a clear error.

Use `cargo run --release -p mumh5-cli -- ...` during development. The CLI
binary runs without the frontend or Tauri libraries. See `mumh5-cli --help`
for all flags.

## Identity, certificates and credentials

The default profile is `$XDG_CONFIG_HOME/mumh5-cli/PROFILE` or
`~/.config/mumh5-cli/PROFILE`, keyed by server, port and username. Use
`--state-dir PATH` to choose a persistent bot identity explicitly. The certificate
and key are saved as private files, and the server's SHA-256 certificate is pinned
before authentication. The CLI keeps its own `identity.json` and `known-servers.json`; the desktop uses
its separate `profile.json`. Do not point both clients at the same directory.

For an unknown server certificate, verify and supply
`--server-fingerprint SHA256_HEX`, or explicitly opt into first-use trust with
`--trust-new`. A changed saved pin is rejected even with first-use trust enabled;
verify and supply the replacement fingerprint. Credentials are sent only after
this check. Set the server password in `MUMH5_PASSWORD`, or select another
variable using `--password-env NAME`. Repeat `--token TOKEN` for channel access
tokens. Profile files contain keys/pins, not saved chat history.

## JSON control

Type one JSON object per line into stdin. Stdout carries JSON events and replies;
stderr carries startup/fatal errors. Use a unique `id` for response correlation.

```json
{"id":1,"op":"list"}
{"id":2,"op":"send","text":"Hello from Rust"}
{"id":3,"op":"send","user":"alice","text":"Private hello"}
{"id":4,"op":"send","channel":"/notes","text":"Text-channel hello"}
{"id":5,"op":"join","channel":"/Lobby"}
{"id":6,"op":"mute","muted":true}
{"id":7,"op":"deaf","deafened":false}
{"id":8,"op":"share","width":640,"height":360,"fps":15,"kind":"camera"}
{"id":9,"op":"watch","user":"alice"}
{"id":10,"op":"unwatch"}
{"id":11,"op":"stop-video"}
{"id":12,"op":"quit"}
```

Names must match exactly; full channel paths resolve duplicate names. Use JSON
numbers for session/channel IDs. `send` escapes text and line breaks; set
`"html":true` to explicitly send Mumble HTML. Choose a user or a channel, not both.
`list` includes users' session IDs, registered IDs, channel IDs and current UDP
status. Session IDs change on reconnect; registered IDs belong to server accounts.

Responses are `{"id":1,"ok":true,"result":...}` or
`{"id":1,"ok":false,"error":"..."}`. Events include `ready`, `text`, `user`,
`warning`, `sharing`, `videoConnection`, `video`, `mediaError` and `closed`.
The `text` event contains `html`, `actor`, `author`, `sessions`, `channels`,
`trees`, `self`, `textChannel` and `time`. Incoming HTML is data, not terminal code.
Server permission failures also produce `warning` events. Sending confirms
submission, not delivery. `join` waits for the bot's channel state to change.

Keep consuming stdout; the client disconnects if its output queue exceeds 1 MiB.
Commands are bounded to 8 MiB and processed sequentially with stdin backpressure.
EOF keeps the client connected unless `--exit-on-eof` is set. `quit`, SIGINT and
SIGTERM release transports, codecs and files. Unexpected connection failures exit
nonzero. Automatic reconnect is left to the application or service manager.

## Independent audio input and output

There is one outgoing PCM input and one incoming mixed PCM output: **signed
16-bit little-endian, 48 kHz, mono**. They never feed into one another. Received
packets from the bot's own session are ignored. No microphone or speaker opens
automatically.

```sh
ffmpeg -i speech.wav -f s16le -ar 48000 -ac 1 speech.s16le
./target/release/mumh5-cli --server localhost --name helper --trust-new \
  --audio-in speech.s16le --audio-out received.s16le
# After quitting:
ffplay -f s16le -ar 48000 -ac 1 received.s16le
```

Use independent files or named pipes. Existing regular output files are not
overwritten. Input is paced in real time; incoming output contains silence when
idle. `--bitrate` selects 6000..128000 bits/s (default 40000, adjusted for the
server's bandwidth limit). `--tcp-only` disables UDP attempts.

JSON `{"op":"audio","data":"BASE64_S16LE"}` enables audio on demand. For
continuous bot media, prefer the Rust library's binary `send_audio()` interface
or files/pipes. Pace chunks of 10–100 ms and honor queue-full errors. Commands
`enable-audio` and `disable-audio` also control codec lifetime explicitly.

## Native video

Video uses the existing `mumh5.share` signaling and direct WebRTC transport.
Both sides must be in the same voice channel, with a Mumble 1.4+ server for plugin
signaling. Classic Mumble clients do not display these streams. Codec work runs
off the async I/O workers, using native libvpx VP8 and I420 frames. Opus for voice
is independent of WebRTC video audio; shared WebRTC audio is not mixed into voice.

```sh
ffmpeg -i source.mp4 -vf scale=640:360 -r 15 -pix_fmt yuv420p -f rawvideo video.i420
./target/release/mumh5-cli --server localhost --name camera-bot --trust-new \
  --video-in video.i420 --width 640 --height 360 --fps 15
./target/release/mumh5-cli --server localhost --name viewer-bot --trust-new \
  --video-out recordings --watch camera-bot --fps 15
```

Packed I420 contains Y, U and V planes, `width * height * 3 / 2` bytes. Dimensions
must be even and at most 4096×2160. Input files are paced at `--fps` (1..60);
EOF stops sharing. Use a live pipe for continuous input. Alternatively, start
`share` and send JSON `video` commands containing one base64 I420 frame, or use
binary `Client::push_video()` calls. The 8 MiB JSON limit accommodates 1080p;
larger frames need files/pipes or the Rust API. Encoded incoming frames are capped
at 4 MiB; decoded frame queues and RTP reorder buffers are bounded.

One incoming stream and up to eight outgoing viewers are supported. Without
`--watch`, `--video-out` discovers the first sharer. Received video is saved as
`.y4m` segments, with a new file/event for a session or resolution change. The
recording header uses nominal `--fps`; set it to the sender's rate. Files are not
overwritten, and slow recording drops frames.

No STUN/TURN service is contacted unless configured using `--stun URL` (repeatable)
or `--ice-config FILE`, containing an `RTCIceServer[]` with `urls` and optional
`username`/`credential`. Peers see one another's IP addresses. Local interoperability
is tested; Internet/NAT traversal is not covered by that test.

## Bots

See [BOTS.md](BOTS.md) for the Rust API, an executable bot example, chat command
authorization and JSON subprocess control from Python. Use `--bot` to enable
built-in chat commands, and `--admin-user-ids ID,...` for privileged controls.

## Verification

```sh
cargo test --locked -p mumh5-core
cargo test --locked -p mumh5-core --no-default-features
MUMH5_TEST_HOST=127.0.0.1 MUMH5_TEST_PORT=64750 \
  cargo test --locked -p mumh5-core --test live_server -- --nocapture
```

The last command requires a disposable local Mumble server and checks channel
and private text, encrypted UDP, TCP voice fallback, and stream separation.
