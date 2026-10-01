import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARE, encodeShare, ShareAssembler } from '../src/core/share-signal.ts';

test('bare signals are one byte', async () => {
  const packets = await encodeShare(SHARE.on);
  assert.deepEqual(packets, [new Uint8Array([SHARE.on])]);
  assert.deepEqual(await new ShareAssembler().push(1, packets[0]), { type: SHARE.on });
});

test('session descriptions survive chunking, in any order', async () => {
  // Random-looking text compresses badly, forcing several chunks
  const sdp = Array.from({ length: 400 }, (_, i) => `a=candidate:${(i * 2654435761 >>> 0).toString(36)} 1 udp ${i} 2001:db8::${i} typ host`).join('\r\n');
  const packets = await encodeShare(SHARE.offer, sdp);
  assert.ok(packets.length > 1, 'needs more than one packet');
  // Murmur drops plugin data over 1000 bytes
  assert.ok(packets.every(p => p.length <= 1000));
  const assembler = new ShareAssembler();
  let result = null;
  for (const p of [...packets].reverse()) result = await assembler.push(7, p);
  assert.deepEqual(result, { type: SHARE.offer, text: sdp });
});

test('chunks from different senders do not mix', async () => {
  const a = await encodeShare(SHARE.answer, Array.from({ length: 400 }, (_, i) => (i * 40503 * 2654435761 >>> 0).toString(36)).join(' '));
  assert.ok(a.length > 1);
  const assembler = new ShareAssembler();
  assert.equal(await assembler.push(1, a[0]), null);
  for (const p of a.slice(1)) assert.equal(await assembler.push(2, p), null);
  let result = null;
  for (const p of a.slice(1)) result = await assembler.push(1, p);
  assert.equal(result?.type, SHARE.answer);
});

test('garbage is ignored', async () => {
  const assembler = new ShareAssembler();
  assert.equal(await assembler.push(1, new Uint8Array([99])), null);
  assert.equal(await assembler.push(1, new Uint8Array([SHARE.offer, 1])), null);
  assert.equal(await assembler.push(1, new Uint8Array([SHARE.offer, 1, 5, 2, 1, 2, 3])), null);
  // A complete transfer that is not valid compressed data
  assert.equal(await assembler.push(1, new Uint8Array([SHARE.offer, 1, 0, 1, 255, 255, 255, 255])), null);
});
