import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MumbleClient } from '../src/core/client.ts';
import { createCodec } from '../src/core/proto.ts';
import type { Transport } from '../src/core/transport.ts';

// Drives the keepalive by hand through the replaceable timer, with a mocked clock
function setup(t: import('node:test').TestContext) {
  t.mock.timers.enable({ apis: ['Date'] });
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

test('the keepalive closes a connection that stopped answering', t => {
  const c = setup(t);
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(5000); c.tick(); }
  assert.equal(c.closed(), '');
  t.mock.timers.tick(5000); c.tick();
  assert.equal(c.closed(), 'Connection timed out');
});

test('data from the server keeps the connection open', t => {
  const c = setup(t);
  for (let i = 0; i < 10; i++) { t.mock.timers.tick(5000); c.transport.onData?.(new Uint8Array(0)); c.tick(); }
  assert.equal(c.closed(), '');
});

test('a paused page or ticks that queued up meanwhile do not count as silence', t => {
  const c = setup(t);
  t.mock.timers.tick(60_000);
  c.tick(); c.tick(); c.tick();
  assert.equal(c.closed(), '');
  // Back on pace, the server still says nothing
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(5000); c.tick(); }
  assert.equal(c.closed(), 'Connection timed out');
});
