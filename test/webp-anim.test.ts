import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitstreamChunks, writeAnimatedWebp } from '../src/lib/webp-anim.ts';

const tag = (s: string) => [...s].map(c => c.charCodeAt(0));
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const chunkOf = (name: string, body: number[]) => [...tag(name), ...le32(body.length), ...body, ...(body.length & 1 ? [0] : [])];
const riff = (chunks: number[][]) => { const body = chunks.flat(); return Uint8Array.from([...tag('RIFF'), ...le32(body.length + 4), ...tag('WEBP'), ...body]); };

// Chunks of an animated WebP: [tag, body] at the top level, and inside each ANMF
function chunks(b: Uint8Array, from = 12, to = b.length): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  for (let at = from; at + 8 <= to;) {
    const size = b[at + 4] | (b[at + 5] << 8) | (b[at + 6] << 16) | (b[at + 7] << 24);
    out.push([String.fromCharCode(...b.subarray(at, at + 4)), b.subarray(at + 8, at + 8 + size)]);
    at += 8 + size + (size & 1);
  }
  return out;
}
const u24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

test('the image chunks of a still WebP are taken, the rest left', () => {
  const simple = riff([chunkOf('VP8 ', [1, 2, 3])]);
  assert.deepEqual([...bitstreamChunks(simple)], chunkOf('VP8 ', [1, 2, 3]));
  const withAlpha = riff([chunkOf('VP8X', Array(10).fill(0)), chunkOf('ALPH', [9]), chunkOf('VP8 ', [1, 2]), chunkOf('EXIF', [5, 5])]);
  assert.deepEqual([...bitstreamChunks(withAlpha)], [...chunkOf('ALPH', [9]), ...chunkOf('VP8 ', [1, 2])]);
  assert.throws(() => bitstreamChunks(Uint8Array.from(tag('GIF89a'))));
  assert.throws(() => bitstreamChunks(riff([chunkOf('ALPH', [1])])));
});

test('frames become a looping animated WebP', () => {
  const still = riff([chunkOf('VP8L', [7, 7, 7])]);
  const out = writeAnimatedWebp(320, 64, true, [
    { x: 0, y: 0, width: 320, height: 64, duration: 40, still },
    { x: 10, y: 4, width: 33, height: 9, duration: 120, still },
  ]);
  assert.equal(String.fromCharCode(...out.subarray(8, 12)), 'WEBP');
  assert.equal(out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24), out.length - 8, 'RIFF size');
  const top = chunks(out);
  assert.deepEqual(top.map(c => c[0]), ['VP8X', 'ANIM', 'ANMF', 'ANMF']);
  const vp8x = top[0][1];
  assert.equal(vp8x[0], 0x12, 'animation and alpha');
  assert.equal(u24(vp8x, 4) + 1, 320);
  assert.equal(u24(vp8x, 7) + 1, 64);
  assert.equal(top[1][1][4] | (top[1][1][5] << 8), 0, 'loops forever');
  const second = top[3][1];
  assert.deepEqual([u24(second, 0) * 2, u24(second, 3) * 2, u24(second, 6) + 1, u24(second, 9) + 1, u24(second, 12)], [10, 4, 33, 9, 120]);
  assert.equal(second[15], 0x02, 'replaces, no blending');
  assert.deepEqual(chunks(second, 16).map(c => c[0]), ['VP8L']);
});
