import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodec } from '../src/core/proto.ts';
import { MumbleClient } from '../src/core/client.ts';
import { HeldData, type Transport } from '../src/core/transport.ts';

test('data that arrives before the client attaches is delivered first, in order', () => {
  const data = new HeldData();
  const got: number[] = [];
  data.push(new Uint8Array([1]));
  data.push(new Uint8Array([2]));
  assert.equal(got.length, 0);
  data.handler = chunk => got.push(chunk[0]);
  data.push(new Uint8Array([3]));
  assert.deepEqual(got, [1, 2, 3]);
});

test('a server Version sent before connect still selects the 1.5 voice format', () => {
  const codec = createCodec();
  const data = new HeldData();
  const transport: Transport = {
    send() {},
    close() {},
    onClose: null,
    get onData() { return data.handler; },
    set onData(fn) { data.handler = fn; }
  };
  data.push(codec.encode('Version', { version_v2: 2 ** 48 + 5 * 2 ** 32 + 915 * 2 ** 16, release: 'Murmur' }));

  const client = new MumbleClient(codec);
  client.connect(transport, { username: 'early', password: '', os: 'test' });
  assert.equal(client.protobufVoice, true);
  client.disconnect();
});
