# Legacy Node interoperability client

The default CLI is now the [native Rust client](../rust-cli/README.md). This Node
implementation is retained as an interoperability test peer and migration reference.
The instructions below describe the legacy client; use `node cli/main.ts` directly
and `npm --prefix cli ci` for its optional video runtime. `npm run cli`,
`npm run cli:setup`, and `npm run build:cli` now build/run Rust.


The CLI connects directly to Mumble from Node. It does not launch a browser,
Electron, Chromium, or a display server. It supports voice, channel/private text,
mumh5 text channels, and mumh5-compatible WebRTC video.

Audio and video are optional. A text-only bot does not instantiate audio codecs or
load native WebRTC. Video starts one additional Node worker on demand, with bounded
binary IPC; it stays available until the client closes. Native teardown is isolated
from the bot host. Voice uses the existing Opus WebAssembly codec with a lower
encoding complexity and encrypted UDP with TCP fallback. Media buffers are bounded;
a slow consumer drops media rather than accumulating an unbounded queue.

## Run from this repository

Use Node 22.18 or newer (tested on Node 26):

```sh
npm ci
node cli/main.ts --server localhost --name helper --trust-new
```

The CLI creates a persistent client certificate and pins server certificates.
The default profile is under `$XDG_CONFIG_HOME/mumh5-cli/` or
`~/.config/mumh5-cli/`, separated by server and username. Use a distinct
`--state-dir` for each bot identity. Protect this directory: its certificate is
the bot's identity on the server.

For an unrecognized self-signed server, verify its SHA-256 fingerprint and pass
`--server-fingerprint HEX`, or explicitly trust the first certificate with
`--trust-new`. A changed pin is rejected before sending credentials, even with
`--trust-new`. To approve a verified replacement, supply its fingerprint.
Server passwords come from `MUMH5_PASSWORD` or `--password-env VARIABLE`, rather
than appearing in command-line arguments. This CLI profile is independent of the
desktop app's identity and settings; it does not automatically save chat history.

Video additionally needs the native runtime:

```sh
npm run cli:setup
```

It uses [node-webrtc's native sources and sinks](https://github.com/WonderInventions/node-webrtc/blob/develop/docs/nonstandard-apis.md),
installed only under `cli/node_modules/`. The desktop application does not acquire
this dependency. The published runtime provides platform-specific native binaries;
check its [supported platforms](https://github.com/WonderInventions/node-webrtc#supported-platforms)
before deploying to a different architecture. Linux x64 is tested here.

## Small server deployment

Build a standalone CLI and SDK:

```sh
npm run build:cli
```

Copy `dist-cli/` to the server. Text and voice need only Node and the files in that
directory: no Electron, UI assets, root `node_modules`, or dependency installation.
Run `node main.mjs --server HOST --name BOT ...` from the copied directory.
For video, run `npm install` there to install the optional native runtime. Neither
deployment mode starts a browser. The SDK entry point is `index.mjs`.

## JSON control protocol

Send one JSON object per line to stdin. Stdout contains only JSON events and
responses when invoking `node cli/main.ts` or the standalone executable directly.
`npm run cli` also prints npm's script preamble; use `npm run --silent cli` if
feeding its output to another program.

Every command can carry an `id`, which is echoed in its response:

```json
{"id":"users","op":"list"}
{"id":"hello","op":"send","text":"Hello from a bot"}
{"id":"pm","op":"send","user":"alice","text":"A private message"}
{"id":"notes","op":"send","channel":"notes","text":"A text-channel message"}
{"id":"join","op":"join","channel":"/Lobby"}
{"id":"mute","op":"mute","muted":true}
{"id":"deaf","op":"deaf","deafened":false}
{"id":"camera","op":"share","kind":"camera","width":640,"height":360}
{"id":"watch","op":"watch","user":"alice"}
{"id":"stop","op":"stop-video"}
{"id":"leave-video","op":"unwatch"}
{"id":"quit","op":"quit"}
```

Use numeric channel/session IDs as JSON numbers, or exact names/full channel paths
as strings. Ambiguous names are rejected. `send` escapes text; `"html":true`
explicitly sends Mumble HTML. A successful response confirms submission, not a
delivery receipt. Server permission failures also produce `warning` events.
Mumble plugin messages require a 1.4 or newer server and are paced below its rate
limit. Text channels use the existing mumh5 protocol; the bot receives live text
channel messages but does not request or retain past text-channel history.

Responses look like `{"id":"hello","ok":true}` or
`{"id":"hello","ok":false,"error":"..."}`. Unsolicited events include
`ready`, `text`, `user`, `sharing`, `videoConnection`, `video`, `mediaError`,
`warning`, and `closed`. A `text` event contains Mumble HTML in `html`, the author,
actor session, destination arrays, and `textChannel`/`self` flags. Remote text is
data; it is never interpreted as terminal commands.

Keep reading stdout. If it blocks with more than 1 MiB queued, the CLI shuts down
instead of consuming unbounded memory. Commands are limited to 8 MiB per line.
Stdin EOF leaves the bot connected unless `--exit-on-eof` is set. SIGINT, SIGTERM,
and `quit` close transports, media tracks, files and codecs. Connection failures
exit nonzero; a service manager or bot application can reconnect with the same
profile. Automatic reconnect is not enabled by the CLI.

## Independent incoming and outgoing audio

There is **one outgoing input** and **one incoming output**. Both use signed
16-bit little-endian PCM, 48 kHz, mono. The incoming output mixes other users;
it is never passed to the outgoing encoder. The client also discards its own
looped-back voice packets. No microphone or speaker is opened automatically.

```sh
ffmpeg -i speech.wav -f s16le -ar 48000 -ac 1 speech.s16le
node cli/main.ts --server localhost --name helper --trust-new \
  --audio-in speech.s16le --audio-out received.s16le
ffplay -f s16le -ar 48000 -ac 1 received.s16le
```

Input can be a file or a named pipe connected to an external capture/TTS process.
Output must be a new file or an existing named pipe. The input and output paths
must differ. They do not share stdin/stdout with JSON. File input is backpressured
and encoded in real time. The output contains silence when nobody is talking.
`--tcp-only` disables UDP attempts for restrictive networks or testing.

Programs may submit PCM with `{"op":"audio","data":"BASE64_S16LE"}`.
Use chunks of 10–100 ms and read command responses. The reusable Node API below
avoids base64 overhead and is preferable for high-rate bot media.

## Sending and receiving video

Video uses the same `mumh5.share` negotiation as the GUI app. The payload travels
directly over WebRTC, not through Mumble. No STUN/TURN host is contacted unless
configured with `--stun URL` or `--ice-config ice.json` containing an
`RTCIceServer[]`. Across networks, both peers may need compatible STUN/TURN
configuration. Internet/NAT traversal is not part of the local integration test.

```sh
ffmpeg -i source.mp4 -vf scale=640:360 -r 15 -pix_fmt yuv420p -f rawvideo video.i420
node cli/main.ts --server localhost --name camera-bot --trust-new \
  --video-in video.i420 --width 640 --height 360 --fps 15

node cli/main.ts --server localhost --name viewer-bot --trust-new \
  --video-out recordings --watch camera-bot --fps 15
```

Outgoing files contain packed I420 frames. File frames are paced at `--fps`;
EOF stops sharing. For continuous input, use a live pipe or an external FFmpeg
loop. Alternatively, start sharing with `share` and submit one I420 frame per
`{"op":"video","data":"BASE64_I420"}` command, paced by the caller.
Dimensions must be even. The SDK supports up to 4096×2160; the JSON line cap
accommodates 1080p frames, so larger frames should use file/stream input or the SDK.

`--video-out DIRECTORY` records one incoming video at a time. Without `--watch`,
it watches the first announced sharer in the same voice channel. `watch` switches
to another user. The sender supports up to eight viewers. A new `.y4m` file and
`video` event are created when the received session or resolution changes.
`--fps` is the nominal playback rate written into the recording header; choose
the sender's frame rate for correctly timed playback. Files are not overwritten.
Slow disk writes drop frames rather than growing an unbounded recording queue.
Shared WebRTC audio tracks are not mixed into the Mumble voice output.

## Reusable bot API

For a complete walkthrough, API reference, audio/video recipes and controlling the
CLI from another language, see [Building a bot](BOTS.md). The
[runnable chat bot](examples/chat-bot.mjs) uses the SDK directly:

```sh
MUMBLE_HOST=localhost MUMBLE_TRUST_NEW=1 node cli/examples/chat-bot.mjs
```

Send `!help` or `!ping` from another client. Configure `MUMBLE_ADMIN_USER_IDS` to
allow registered users to control its channel, mute/deafen state, and shutdown.
The example also ships in `dist-cli/examples/chat-bot.mjs` after `npm run build:cli`.

Import `cli/index.ts` from source, or `index.mjs` from the standalone build:

```ts
import { HeadlessClient } from './dist-cli/index.mjs';

const bot = await HeadlessClient.connect({
  host: 'localhost', name: 'helper', stateDir: './helper-identity', trustNew: true
});
bot.on('text', message => {
  if (!message.self && message.actor != null && message.html === '!ping') {
    void bot.sendText('pong', { user: message.actor }).catch(console.error);
  }
});
process.once('SIGTERM', () => { void bot.close(); });
```

`await bot.enableAudio()` gives `audio.input` (a Node writable stream) and
`audio.output` (a Node readable stream). Connect TTS/capture to `input`, and
recognition/playback to `output`. Observe Node stream backpressure; do not connect
the two streams to each other. `await bot.disableAudio()` releases codecs and its
audio timer when a bot no longer needs voice.

`await bot.video.start(width, height, 'camera')` starts a generated video source;
`bot.video.push(i420Bytes)` submits a frame. `await bot.video.watch(bot.user(name))`
receives video via `bot.on('videoFrame', ({ session, width, height, data }) => ...)`.
Frame buffers avoid JSON/base64 conversion. `push()` returns false if the previous
frame is still being sent to the worker; pace input and drop that frame.
`video.stopSharing()`,
`video.unwatch()` and `bot.close()` release their resources. Peer IP addresses are
visible to both sides, as with the app's existing screen sharing.

## Verification

`npm test` covers CLI arguments, identities, framing and audio direction isolation.
The real-server integration test also checks bidirectional text, audio and video:

```sh
npm run cli:setup
MUMBLE_TEST_HOST=127.0.0.1:64749 npm run test:e2e:cli
```
