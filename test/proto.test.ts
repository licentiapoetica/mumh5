import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodec, FrameReader } from '../src/core/proto.ts';

const codec = createCodec();

test('encode/decode roundtrip with framing split across chunks', () => {
  const a = codec.encode('TextMessage', { channel_id: [0], message: 'hello <b>world</b>' });
  const b = codec.encode('Ping', { timestamp: 1790796000000 });
  const stream = new Uint8Array([...a, ...b]);
  const reader = new FrameReader();
  const out: any[] = [];
  for (let i = 0; i < stream.length; i += 3) {
    reader.push(stream.subarray(i, i + 3), (id, body) => out.push(codec.decode(id, body)));
  }
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'TextMessage');
  assert.equal(out[0].msg.message, 'hello <b>world</b>');
  assert.deepEqual(out[0].msg.channel_id, [0]);
  assert.equal(out[1].name, 'Ping');
  assert.equal(out[1].msg.timestamp, 1790796000000);
});

test('encode rejects invalid payloads', () => {
  assert.throws(() => codec.encode('ChannelRemove', { channel_id: 'nope' }));
});
