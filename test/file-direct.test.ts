import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_BYTES, PieceCollector, chunks, linkRoute, parseWant } from '../src/core/file-direct.ts';

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);
const buffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

test('a piece goes out in chunks and comes back whole', () => {
  const size = CHUNK_BYTES * 2 + 123;
  const piece = bytes(size, 3);
  const parts = [...chunks(5, piece)];
  assert.equal(parts.length, 3);
  const c = new PieceCollector(10, () => size);
  assert.equal(c.push(buffer(parts[0])), null);
  assert.equal(c.push(buffer(parts[0])), null, 'a repeated chunk counts once');
  assert.equal(c.push(buffer(parts[1])), null);
  const done = c.push(buffer(parts[2]))!;
  assert.equal(done.index, 5);
  assert.deepEqual(done.bytes, piece);
});

test('pieces of different sizes interleave', () => {
  const sizes = [CHUNK_BYTES + 1, 10];
  const c = new PieceCollector(2, i => sizes[i]);
  const a = [...chunks(0, bytes(sizes[0], 1))], b = [...chunks(1, bytes(sizes[1], 2))];
  assert.equal(c.push(buffer(a[0])), null);
  assert.equal(c.push(buffer(b[0]))!.index, 1);
  assert.equal(c.push(buffer(a[1]))!.index, 0);
});

test('chunks that do not fit the file are dropped', () => {
  const c = new PieceCollector(2, () => 100);
  const good = [...chunks(1, bytes(100, 0))][0];
  // Beyond the last piece, too long, misaligned offset, too short to have a header
  assert.equal(c.push(buffer([...chunks(2, bytes(100, 0))][0])), null);
  assert.equal(c.push(buffer([...chunks(0, bytes(101, 0))][0])), null);
  const shifted = good.slice();
  new DataView(shifted.buffer).setUint32(4, 1);
  assert.equal(c.push(buffer(shifted)), null);
  assert.equal(c.push(new ArrayBuffer(4)), null);
  assert.equal(c.push(buffer(good))!.index, 1);
});

test('requests are parsed strictly', () => {
  assert.deepEqual(parseWant('{"t":"want","r":[[0,3]]}'), { t: 'want', r: [[0, 3]] });
  for (const text of ['', 'x', '{}', '{"t":"want"}', '{"t":"other","r":[]}', '[]']) assert.equal(parseWant(text), null, text);
});

test('mumpeer when either side wants it, and only on the relay both trust', () => {
  assert.equal(linkRoute(1, 1, '', ''), 'direct');
  assert.equal(linkRoute(1, 1, 'a', 'a'), 'direct', 'both allow direct: the faster route');
  assert.equal(linkRoute(2, 1, 'a', 'a'), 'mumpeer');
  assert.equal(linkRoute(1, 2, 'a', 'a'), 'mumpeer');
  assert.equal(linkRoute(2, 2, 'a', 'b'), null, 'different relays');
  assert.equal(linkRoute(2, 1, '', ''), null, 'no relay: never direct instead');
  assert.equal(linkRoute(1, 2, 'a', ''), null);
});
