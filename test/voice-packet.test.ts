import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeVarint, readVarint, encodeVoice, decodeVoice, relayAsServer } from '../src/core/voice-packet.ts';

test('Mumble varints round trip at every size boundary', () => {
  for (const v of [0, 1, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000, 0xfffffff, 0x10000000, 0xffffffff, 0x100000000, 2 ** 40 + 5]) {
    const out: number[] = [];
    writeVarint(out, v);
    assert.deepEqual(readVarint(new Uint8Array(out), 0), [v, out.length], `value ${v}`);
  }
  const small: number[] = [];
  writeVarint(small, 300);
  assert.deepEqual(small, [0x81, 0x2c], 'matches PacketDataStream encoding');
});

for (const protobuf of [false, true]) {
  test(`${protobuf ? 'protobuf' : 'legacy'} voice packets survive a server relay`, () => {
    const opus = new Uint8Array([0xfc, 1, 2, 3, 250]);
    for (const last of [false, true]) {
      const sent = encodeVoice({ target: 0, frame: 1234, opus, last }, protobuf);
      const got = decodeVoice(relayAsServer(sent, 42, protobuf));
      assert.deepEqual(got, { session: 42, target: 0, frame: 1234, opus, last });
    }
  });
}

test('legacy header layout: opus type, terminator bit in the size field', () => {
  const p = encodeVoice({ target: 3, frame: 5, opus: new Uint8Array(10), last: true }, false);
  assert.equal(p[0], (4 << 5) | 3);
  assert.equal(p[1], 5);
  assert.deepEqual([p[2], p[3]], [0x80 | 0x20, 10], 'size 10 | 0x2000 as a 2-byte varint');
});

test('non-audio packets are ignored', () => {
  assert.equal(decodeVoice(new Uint8Array([1, 2, 3])), null, 'protobuf ping');
  assert.equal(decodeVoice(new Uint8Array([0x20, 5])), null, 'legacy ping');
  assert.equal(decodeVoice(new Uint8Array([0x80, 1])), null, 'truncated');
});
