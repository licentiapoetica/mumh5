import { test, setSystemTime, afterEach } from 'bun:test';
import assert from './assert.ts';
import { MumbleClient } from '../src/core/client.ts';
import { createCodec } from '../src/core/proto.ts';
import type { Transport } from '../src/core/transport.ts';

// Drives the keepalive by hand through the replaceable timer, with a mocked clock
// Bun has no per-test timer mock; a fake clock stands in for node:test's mock.timers.
let fakeNow = 0;
const clock = { tick(ms: number) { fakeNow += ms; setSystemTime(new Date(fakeNow)); } };
const cleanups: (() => void)[] = [];
afterEach(() => { setSystemTime(); cleanups.splice(0).forEach(fn => fn()); });
function setup(t: { mock: { timers: typeof clock }; after(fn: () => void): void }) {
  fakeNow = 1_800_000_000_000; setSystemTime(new Date(fakeNow));
  let tick = () => {};
  const every = MumbleClient.every;
  MumbleClient.every = (_ms, fn) => { tick = fn; return () => { tick = () => {}; }; };
  t.after(() => { MumbleClient.every = every; });
  const transport: Transport = { onData: null, onClose: null, send() {}, close() {} };
  const client = new MumbleClient(createCodec());
  client.connect(transport, { username: 'u' });
  client.synced = true;
  let reason = '';
  client.on('close', r => { reason = r; });
  return { client, transport, tick: () => tick(), closed: () => reason };
}

test('the keepalive closes a connection that stopped answering', () => { const t = { mock: { timers: clock }, after: (fn: () => void) => cleanups.push(fn) };
  const c = setup(t);
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(5000); c.tick(); }
  assert.equal(c.closed(), '');
  t.mock.timers.tick(5000); c.tick();
  assert.equal(c.closed(), 'Connection timed out');
});

test('data from the server keeps the connection open', () => { const t = { mock: { timers: clock }, after: (fn: () => void) => cleanups.push(fn) };
  const c = setup(t);
  for (let i = 0; i < 10; i++) { t.mock.timers.tick(5000); c.transport.onData?.(new Uint8Array(0)); c.tick(); }
  assert.equal(c.closed(), '');
});

test('a paused page or ticks that queued up meanwhile do not count as silence', () => { const t = { mock: { timers: clock }, after: (fn: () => void) => cleanups.push(fn) };
  const c = setup(t);
  t.mock.timers.tick(60_000);
  c.tick(); c.tick(); c.tick();
  assert.equal(c.closed(), '');
  // Back on pace, the server still says nothing
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(5000); c.tick(); }
  assert.equal(c.closed(), 'Connection timed out');
});
