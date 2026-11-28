import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BulkPace, MIN_RATE, MAX_RATE } from '../src/core/bulk-pace.ts';
import { MumbleClient } from '../src/core/client.ts';
import { createCodec, FrameReader } from '../src/core/proto.ts';
import type { Transport } from '../src/core/transport.ts';

test('the pace rises quickly until a piece leaves a queue, then follows what the uplink carried', () => {
  const p = new BulkPace();
  p.idle(40);
  p.idle(30);
  assert.equal(p.base, 30);
  const start = p.rate;
  p.after(45, 400_000, start);
  assert.equal(p.rate, start * 1.5);
  // 400 KB written in 0.4 s at 1 MB/s left 600 ms of queue: the uplink carried 400 KB a second
  p.after(630, 400_000, 1_000_000);
  assert.ok(Math.abs(p.rate - 400_000 * 0.85) < 1, `${p.rate}`);
  // From then on it rises slowly
  const known = p.rate;
  p.after(35, 400_000, known);
  assert.ok(Math.abs(p.rate - known * 1.1) < 1);
});

test('the pace stays within its bounds and waits for a usual round trip', () => {
  const p = new BulkPace();
  const start = p.rate;
  p.after(5000, 400_000, start);
  assert.equal(p.rate, start, 'without a clean round trip there is nothing to compare with');
  p.idle(20);
  p.after(60_000, 400_000, start);
  assert.equal(p.rate, MIN_RATE);
  for (let i = 0; i < 100; i++) p.after(20, 400_000, p.rate);
  assert.equal(p.rate, MAX_RATE);
});

function setup(t: import('node:test').TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  // Only the bulk writer's ticks; the keepalive stays still
  const ticks = new Set<() => void>();
  const every = MumbleClient.every;
  MumbleClient.every = (ms, fn) => {
    if (ms !== 10) return () => {};
    ticks.add(fn);
    return () => { ticks.delete(fn); };
  };
  t.after(() => { MumbleClient.every = every; });
  const written: Uint8Array[] = [];
  const transport: Transport = { onData: null, onClose: null, send: b => { written.push(b); }, close() {} };
  const codec = createCodec();
  const client = new MumbleClient(codec);
  client.connect(transport, { username: 'u' });
  client.session = 1;
  client.users.set(2, { session: 2 } as never);
  // Version went against the message limit; let it leak
  t.mock.timers.tick(2000);
  written.length = 0;
  const advance = (ms: number) => {
    for (let i = 0; i < ms / 10; i++) { t.mock.timers.tick(10); for (const fn of [...ticks]) fn(); }
  };
  // Messages in the order they left
  const sent = () => {
    const names: string[] = [];
    new FrameReader().push(concat(written), (id, body) => names.push(id === 1 ? 'UDPTunnel' : codec.decode(id, body)!.name));
    return names;
  };
  const bytes = () => written.reduce((n, b) => n + b.length, 0);
  return { client, advance, sent, bytes };
}

const concat = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let off = 0;
  for (const b of parts) { all.set(b, off); off += b.length; }
  return all;
};

test('a bulk message is written a slice at a time; what comes meanwhile waits behind it, a fresh ping first', t => {
  const { client, advance, sent, bytes } = setup(t);
  const html = 'x'.repeat(200_000);
  assert.equal(client.bulkWait(html), 0);
  assert.ok(client.sendBulk({ users: [2] }, html));
  assert.equal(bytes(), 0);
  const rate = client.pace.rate;
  advance(100);
  const part = bytes();
  assert.ok(part > 0 && part <= rate * 0.1 + 1, `${part} bytes after 100 ms at ${rate}/s`);
  assert.ok(client.bulkWait(html) > 0, 'the next piece waits');

  client.sendText({ channels: [0] }, 'hello');
  client.sendVoiceTunnel(new Uint8Array([1, 2, 3]));
  client.flushed();
  assert.equal(bytes(), part, 'nothing interleaves with the bulk message');

  advance(1000);
  assert.deepEqual(sent(), ['TextMessage', 'Ping', 'UDPTunnel', 'TextMessage']);
});

test('the next piece may start early by the time writing it takes, never arriving before the bucket has room', t => {
  const { client, advance, sent } = setup(t);
  const html = 'x'.repeat(200_000);
  const writeMs = 200_000 / client.pace.rate * 1000;
  // A run of three pieces is only worth it for quick ones; these take longer, so each waits
  // until the one before has leaked
  assert.ok(client.sendBulk({ users: [2] }, html));
  while (!sent().length) advance(10);
  const end = Date.now();
  const wait = client.bulkWait(html);
  assert.ok(wait > 0);
  // It arrives a whole second and the margin after the last one
  assert.ok(Date.now() + wait + writeMs >= end + 1250, `${wait} ms`);
});
