# Building a bot

There are two programmatic interfaces. Neither starts a browser or display session.

| Your application | Interface |
| --- | --- |
| Node.js / TypeScript | Import `HeadlessClient`; call methods and subscribe to events. Audio streams and video frames are binary. |
| Python, Go, Rust, or another process | Start the CLI and exchange JSON lines on stdin/stdout. Use separate files/pipes for continuous media. |

## Run the example bot

From the repository, with Node 22.18+ and `npm ci` completed:

```sh
MUMBLE_HOST=localhost MUMBLE_TRUST_NEW=1 node cli/examples/chat-bot.mjs
```

The [example](examples/chat-bot.mjs) connects as `helper-bot` and prints a JSON
`ready` line. From another Mumble client, send it `!help` or `!ping` in a private
message or a channel it receives. It replies privately. No audio codec or native
video worker starts for this text-only bot.

For a standalone deployment:

```sh
npm run build:cli
# Copy dist-cli/ to your server, then from that directory:
MUMBLE_HOST=localhost MUMBLE_TRUST_NEW=1 node examples/chat-bot.mjs
```

The build includes the example, SDK, this guide, codecs, and licenses. Text and
voice need no dependency installation in that directory. For video, run
`npm install` there, or `npm run cli:setup` when running from source.

The example reads these environment variables:

| Variable | Meaning / default |
| --- | --- |
| `MUMBLE_HOST` | Required server hostname or IP; omit the port here. |
| `MUMBLE_PORT` | Server port; `64738`. |
| `MUMBLE_NAME` | Bot username; `helper-bot`. |
| `MUMBLE_STATE_DIR` | Persistent identity and certificate pins; `~/.config/mumh5-bots/helper-bot`. Choose a separate directory for each bot/server profile. |
| `MUMBLE_CHANNEL` | Initial voice channel name or full path, such as `/Lobby`. Otherwise use the channel assigned by the server. |
| `MUMBLE_PASSWORD` | Server password, when required. |
| `MUMBLE_TRUST_NEW` | Set to `1` to explicitly trust an unrecognized server certificate on first connection. |
| `MUMBLE_SERVER_FINGERPRINT` | Expected SHA-256 server certificate fingerprint, as an alternative to first-use trust. |
| `MUMBLE_ADMIN_USER_IDS` | Comma-separated registered user IDs allowed to issue administrative commands. Empty by default. |

Keep `MUMBLE_STATE_DIR` across restarts so the server recognizes the same bot.
Certificate changes are rejected even with first-use trust enabled; verify a
replacement and supply its fingerprint. The profile contains identity keys and
server pins, not chat history.

## Control the bot through chat

The command dispatcher is `cli/examples/chat-commands.ts` in the
repository; it is included in the bundled example when deployed. The commands are:

| Command | Access | Behavior |
| --- | --- | --- |
| `!help` | Everyone | List supported commands. |
| `!ping` | Everyone | Reply `pong`. |
| `!status` | Everyone | Report the bot's channel, user count and audio state. |
| `!whoami` | Everyone | Report your session and registered user ID. |
| `!join /Lobby` | Admin | Move the bot into that voice channel. Full paths can contain spaces. |
| `!mute on` / `!mute off` | Admin | Change the bot's self-mute state. |
| `!deaf on` / `!deaf off` | Admin | Change the bot's self-deafen state. |
| `!shutdown` | Admin | Reply, close the connection and exit normally. |

To enable administrative control:

1. Register your normal Mumble user on the server, if it is not registered yet.
2. Send `!whoami` to the bot and note the **registered user ID**, not the session ID.
3. Restart the bot with that ID allowlisted, for example:

   ```sh
   MUMBLE_HOST=localhost MUMBLE_ADMIN_USER_IDS=12,34 node cli/examples/chat-bot.mjs
   ```

Authorization uses the sender's registered ID supplied by the server, not their
display name or a value inside the command. IDs are specific to that server.
Allowlisting someone does not grant the bot extra server permissions: joining a
restricted channel still requires the bot's own access rights or tokens.

All replies, including errors, are private. Commands are case-sensitive and match
plain messages; rich-text wrappers around a command are not parsed. The example
ignores its own messages, server messages without an actor, and unknown commands.
It processes one command at a time with a 1.5-second pause afterward; commands
arriving while busy are ignored. This keeps the demo's queue bounded and leaves
room for Mumble's message rate limit. Adapt this policy for your bot's workload.

To add another command, extend the dispatcher's recognized command list and switch,
then put any administrative action behind its registered-ID check. Catch rejected
operations and send a useful error reply. `!mute` and `!deaf` confirm submission;
server permission failures also appear as warning events.

## Create your own Node bot

In a repository-local `.mjs` file, import the source SDK:

```js
import { HeadlessClient } from './cli/index.ts';
```

For an application next to a copied standalone build, use:

```js
import { HeadlessClient } from './dist-cli/index.mjs';
```

The source SDK supplies TypeScript types. The standalone build is JavaScript and
currently does not ship `.d.ts` declarations. It is a local build artifact, not an
SDK package published to npm.

Here is the core text-bot pattern; the runnable example adds configuration,
administrative commands, command pacing and disconnect handling:

```js
import { HeadlessClient } from './dist-cli/index.mjs';

const bot = await HeadlessClient.connect({
  host: 'localhost', port: 64738, name: 'my-helper',
  stateDir: './my-helper-identity', trustNew: true,
  password: process.env.MUMBLE_PASSWORD
});

bot.on('text', message => {
  if (message.self || message.actor == null || message.html.trim() !== '!ping') return;
  void bot.sendText('pong', { user: message.actor }).catch(console.error);
});
bot.on('warning', console.error);
bot.on('mediaError', error => console.error(error.message));
process.once('SIGINT', () => { void bot.close().catch(console.error); });
process.once('SIGTERM', () => { void bot.close().catch(console.error); });
```

`connect()` resolves after login and synchronization, plus the optional initial
channel join. It rejects on TLS/pinning, authentication, or initial-join failure.
After connecting, attach handlers immediately. Node event listeners do not await
async functions: catch rejections and bound concurrent work in your handlers.

### Connection options

| Option | Meaning |
| --- | --- |
| `host`, `name`, `stateDir` | Required server address, bot username and persistent identity directory. |
| `port` | `64738` by default. |
| `password` | Optional server password. |
| `channel` | Initial voice channel: numeric ID, exact name or full path. |
| `tokens` | Optional string array of channel access tokens. |
| `trustNew`, `serverFingerprint` | First-connection trust or an expected SHA-256 certificate fingerprint. |
| `tcpOnly` | Tunnel voice over TCP; otherwise attempt encrypted UDP with TCP fallback. |
| `iceServers` | Explicit `RTCIceServer[]` for video STUN/TURN; empty by default. |

### Text and channel methods

```js
await bot.sendText('Hello everyone');                    // Current voice channel
await bot.sendText('Private hello', { user: 'alice' });
await bot.sendText('Channel hello', { channel: '/Lobby' });
await bot.sendText('Notes', { channel: '/notes' });       // Existing mumh5 text channel
await bot.join('/Lobby');                               // Voice channels only

const aliceSession = bot.user('alice');
const lobbyId = bot.channel('/Lobby');
console.log(bot.channelPath(lobbyId));
console.log([...bot.protocol.users.values()]);
console.log([...bot.protocol.channels.values()]);
```

Use numbers for session/channel IDs; strings are names or paths. Ambiguous or
missing names throw. Session IDs change on reconnect; registered user IDs belong
to server accounts. `sendText()` escapes plain text and newlines. Set
`{ html: true }` only when intentionally constructing Mumble HTML. Choose either
`user` or `channel`, not both. Completion confirms submission, not delivery or
permission approval.

`text` events contain:

| Field | Meaning |
| --- | --- |
| `html` | Received Mumble HTML; it has not been converted to plain text. |
| `actor`, `author` | Sender session ID (or `null` for a server message) and display name. |
| `sessions`, `channels`, `trees` | Destination ID arrays from Mumble. |
| `textChannel` | Whether this is a mumh5 text-channel message. |
| `self` | Whether the sender is this bot. |
| `time` | Local receive time in milliseconds since the epoch. |

The example replies privately using `message.actor`. To reply in the originating
channel, explicitly use `{ channel: message.channels[0] }` when that destination
is present. Text-channel support requires a Mumble 1.4+ server. The bot receives
live text-channel messages and does not fetch or persist history.

### Events and lifecycle

| Event | Payload / use |
| --- | --- |
| `text` | A text message, as above. |
| `user` | `{ session, name, channelId }` after a user update. Initial users are already in `protocol.users`. |
| `warning` | A string describing server permissions or a protocol warning. |
| `close` | Disconnect reason string. |
| `sharing` | `{ session, active, kind? }` video announcements. |
| `videoConnection` | `{ session, direction: 'in' \| 'out', state }`. |
| `videoFrame` | `{ session, width, height, data }`, packed I420 bytes in a Buffer. |
| `mediaError` | `{ message }` for media or negotiation errors. |

The SDK uses `close`; the JSON CLI calls this event `closed`. SDK video frames are
binary `videoFrame` events; the CLI's `video` events describe recording files.
There is no SDK `ready` event: await `connect()` instead.

Call `await bot.close()` during shutdown. The example exits nonzero on unexpected
disconnect and zero after a signal or `!shutdown`. A supervisor using
`Restart=on-failure` can restart it after connection loss while leaving an explicit
shutdown stopped. The SDK does not reconnect automatically; a custom reconnect
loop must create a new client and reattach handlers. Retain the same `stateDir`.

## Audio for speech recognition and TTS

```js
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const audio = await bot.enableAudio(40000);
await Promise.all([
  pipeline(audio.output, createWriteStream('heard.s16le', { flags: 'wx' })),
  (async () => {
    try {
      await pipeline(createReadStream('speech.s16le'), audio.input, { end: false });
    } finally {
      await bot.disableAudio();
    }
  })()
]);
```

This plays a file in real time and records incoming voice until the file finishes.
Both streams use **signed 16-bit little-endian PCM, 48 kHz, mono**, with complete
16-bit samples. Convert audio beforehand, for example:

```sh
ffmpeg -i speech.wav -f s16le -ar 48000 -ac 1 speech.s16le
```

For a continuous speech bot, keep the audio enabled. Connect your TTS/capture
producer to `audio.input` and your recognition/playback consumer to `audio.output`.
Observe writable backpressure; short chunks of 10–100 ms work well. Use one
outgoing producer at a time and serialize utterances. `{ end: false }` lets the
next utterance reuse the input. Ending or destroying the input prevents more
writes until audio is disabled and enabled again.

The incoming stream mixes remote speakers and includes silence when idle. It is
never routed to the outgoing encoder; own voice packets are also ignored. Do not
connect `audio.output` to `audio.input`. No microphone, speaker, ASR model or TTS
service is opened automatically. `disableAudio()` releases its codecs and timer;
`close()` also releases audio. Media queues are bounded and slow consumers lose
audio rather than accumulating unlimited data.

## Video for a bot

After installing the optional runtime, send packed I420 frames at your chosen
rate. This example generates ten seconds of gray video:

```js
import { setTimeout as delay } from 'node:timers/promises';
import { frameBytes } from './dist-cli/index.mjs';

const width = 320, height = 180;
const frame = Buffer.alloc(frameBytes(width, height), 128);
await bot.video.start(width, height, 'camera');
try {
  for (let n = 0; n < 150; n++) {
    bot.video.push(frame);
    await delay(1000 / 15);
  }
} finally {
  await bot.video.stopSharing();
}
```

Frames contain the Y plane, then U, then V, with total length
`width * height * 3 / 2`. Dimensions must be even, at most 4096×2160. `push()`
returns `false` when binary IPC is busy; drop that frame and continue pacing.
It throws if sharing has not started or the byte length is wrong. The SDK does
not pace calls automatically. Also stop your frame producer when the bot closes.

To receive a user's video, keep only the latest frame for a slower consumer:

```js
let latestFrame;
const rememberFrame = frame => { latestFrame = frame; };
bot.on('videoFrame', rememberFrame);
await bot.video.watch(bot.user('alice'));
// Your consumer can read latestFrame without queuing every frame.
// When finished:
// await bot.video.unwatch();
// bot.off('videoFrame', rememberFrame);
```

`bot.video.autoWatch = true; await bot.video.entered()` discovers and watches the
first sharer in the bot's voice channel. One incoming stream and up to eight
outgoing viewers are supported. Video requires a Mumble 1.4+ server for signaling
and a mumh5-compatible peer; classic Mumble clients do not display these streams.
The optional native Node worker starts on demand and stays available until
`close()`. Stopping sharing or watching releases the associated tracks and peers.
Shared WebRTC audio is not mixed into the Mumble voice stream.

Video payloads use WebRTC, separately from the Mumble server. Across networks,
configure your own STUN/TURN through `iceServers`; none is selected automatically.
The integration tests cover local connections, not Internet/NAT traversal.

## Control the CLI from Python or another language

Use stdin/stdout JSON when embedding the Node SDK is inconvenient. This Python
example connects, sends one channel message after `ready`, checks its response,
then quits:

```python
import json
import subprocess

process = subprocess.Popen(
    ["node", "dist-cli/main.mjs", "--server", "localhost",
     "--name", "python-helper", "--trust-new"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
)

def send(command):
    process.stdin.write(json.dumps(command) + "\n")
    process.stdin.flush()

try:
    for line in process.stdout:
        event = json.loads(line)
        if event.get("event") == "ready":
            send({"id": "hello", "op": "send", "text": "Hello from Python"})
        elif event.get("id") == "hello":
            if not event["ok"]:
                raise RuntimeError(event["error"])
            send({"id": "stop", "op": "quit"})
        elif event.get("id") == "stop":
            break
    if process.wait(timeout=10) != 0:
        raise RuntimeError("CLI exited unsuccessfully; see stderr")
finally:
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
```

For a chat-controlled Python bot, keep reading events, match `event == 'text'`,
and send `{"op":"send","user":actor,"text":"..."}` responses. Apply the same
authorization and pacing rules as in the Node example. JSON text events contain
session IDs; authoritative registered IDs for administrative commands are
available through the Node SDK's `protocol.users` map. The CLI's compact `list`
response currently exposes session IDs/names/channels, not registered IDs.

Use a unique request `id` to correlate each response, and distinguish replies from
unsolicited events. Keep draining stdout and stderr when piping them; the CLI
closes if stdout backs up past 1 MiB. Prefer binary files/pipes for continuous
audio/video; the JSON `audio` and `video` commands use base64. The full command
format and media CLI options are in [README.md](README.md).
