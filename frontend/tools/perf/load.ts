// Load generator for performance comparisons: N real Mumble clients (the app's own MumbleClient),
// either straight to the server over TLS or through a web gateway's WebSocket, some of them talking
// real Opus at 50 packets per second.
//   bun tools/perf/load.ts --server 127.0.0.1:64750 [--gateway ws://127.0.0.1:8080/api/connect]
//     [--clients 20] [--talkers 5] [--seconds 30] [--name perf]
// Prints one JSON line: join times and voice packets received by the clients.
import { readFileSync } from 'node:fs';
import { createCodec } from '../../src/core/proto.ts';
import { MumbleClient } from '../../src/core/client.ts';
import type { Transport } from '../../src/core/transport.ts';
import { WebSocketTransport } from '../../src/core/ws-transport.ts';
import { encodeVoice } from '../../src/core/voice-packet.ts';
import { instantiateOpus, WasmEncoder } from '../../src/lib/audio/opus-wasm.ts';
import { openTls } from '../../tests/support/tls-transport.ts';
import { generateIdentity } from '../../tests/support/identity.ts';

const arg = (name: string, fallback: string) => { const i = Bun.argv.indexOf(`--${name}`); return i > 0 ? Bun.argv[i + 1] : fallback; };
const [host, port] = arg('server', '127.0.0.1:64750').split(':');
const gateway = arg('gateway', '');
const clients = Number(arg('clients', '20'));
const talkers = Number(arg('talkers', '5'));
const seconds = Number(arg('seconds', '30'));
const name = arg('name', 'perf');

// 1 s of a 440 Hz tone as 20 ms Opus frames, encoded once and looped
const opus = await instantiateOpus(readFileSync(new URL('../../node_modules/@evan/opus/wasm/opus.wasm', import.meta.url)));
const frames: Uint8Array[] = [];
const encoder = new WasmEncoder(opus, 40000, 20, p => frames.push(p.slice()));
const pcm = new Float32Array(48000);
for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2 * Math.sin(2 * Math.PI * 440 * i / 48000);
encoder.push(pcm);
if (frames.length < 40) throw new Error(`Opus encoder gave ${frames.length} frames`);

// Browsers send the page's origin with the WebSocket; gateways may require it (the Node proxy does)
if (gateway) {
  const origin = new URL(gateway.replace(/^ws/, 'http')).origin;
  const Native = globalThis.WebSocket;
  globalThis.WebSocket = class extends Native {
    constructor(url: string | URL) { super(url, { headers: { Origin: origin } } as unknown as string[]); }
  } as typeof WebSocket;
}

const codec = createCodec();
const identities = Array.from({ length: clients }, (_, i) => generateIdentity(`${name}-${i}`));

function direct(id: { certPem: string; keyPem: string }): Transport {
  let conn: ReturnType<typeof openTls>;
  const t: Transport = { onData: null, onClose: null, send: b => conn.send(b), close: () => conn.close() };
  conn = openTls(host, Number(port), id.certPem, id.keyPem, { onSecure: () => {}, onData: c => t.onData?.(c), onClose: r => t.onClose?.(r) });
  return t;
}

async function join(i: number): Promise<{ client: MumbleClient; ms: number; received: { n: number } }> {
  const started = performance.now();
  const id = identities[i];
  const transport = gateway ? new WebSocketTransport(gateway, { host, port: Number(port) }, id) : direct(id);
  // As the app does: log in once the gateway reports the TLS connection up
  if (transport instanceof WebSocketTransport) await transport.secure;
  const client = new MumbleClient(codec);
  client.forceTcp = true;
  const received = { n: 0 };
  client.on('voice', () => { received.n++; });
  client.connect(transport, { username: `${name}-${i}`, os: 'perf' });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`client ${i} did not sync`)), 20000);
    client.on('synced', () => { clearTimeout(timer); resolve(); });
    client.on('close', r => { clearTimeout(timer); reject(new Error(`client ${i} closed: ${r}`)); });
  });
  return { client, ms: performance.now() - started, received };
}

// Joined a few at a time, as a server's rate limit expects
const joined: Awaited<ReturnType<typeof join>>[] = [];
for (let i = 0; i < clients; i += 5) joined.push(...await Promise.all(Array.from({ length: Math.min(5, clients - i) }, (_, k) => join(i + k))));
const joinMs = joined.map(j => j.ms).sort((a, b) => a - b);

let sent = 0;
// Markers on stderr, so a caller can measure only the talking phase (compare.ts reads them)
console.error('talking');
const start = performance.now();
const timers = joined.slice(0, talkers).map(({ client }) => {
  let seq = 0;
  return setInterval(() => {
    client.sendVoice(encodeVoice({ target: 0, frame: seq, opus: frames[seq % frames.length], last: false }, client.protobufVoice));
    seq++; sent++;
  }, 20);
});
await Bun.sleep(seconds * 1000);
timers.forEach(clearInterval);
console.error('stopped');
const elapsed = (performance.now() - start) / 1000;
const received = joined.reduce((n, j) => n + j.received.n, 0);
for (const { client } of joined) client.disconnect('done');
console.log(JSON.stringify({
  mode: gateway ? 'gateway' : 'direct', clients, talkers, seconds: Math.round(elapsed),
  joinMs: { p50: Math.round(joinMs[Math.floor(joinMs.length / 2)]), max: Math.round(joinMs[joinMs.length - 1]) },
  sentPackets: sent, receivedPackets: received, receivedPerSecond: Math.round(received / elapsed)
}));
await Bun.sleep(500);
process.exit(0);
