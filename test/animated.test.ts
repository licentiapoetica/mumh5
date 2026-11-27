import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif } from '../src/lib/animated.ts';

// Graphic control extensions: one per frame, delay in hundredths
function controls(gif: Uint8Array): { delay: number; transparent: boolean; dispose: number }[] {
  const out = [];
  for (let i = 0; i + 7 < gif.length; i++) {
    if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4 && gif[i + 7] === 0) {
      out.push({ delay: gif[i + 4] | (gif[i + 5] << 8), transparent: !!(gif[i + 3] & 1), dispose: (gif[i + 3] >> 2) & 7 });
    }
  }
  return out;
}

const frame = (r: number, alpha = 255, delay = 50) => ({ rgba: new Uint8ClampedArray(Array.from({ length: 16 }, () => [r, 0, 0, alpha]).flat()), delay });

test('frames become a looping GIF with their timing', () => {
  const gif = encodeGif({ width: 4, height: 4, frames: [frame(255), frame(0), frame(128)] }, 32, 1, false);
  assert.equal(new TextDecoder().decode(gif.subarray(0, 6)), 'GIF89a');
  assert.ok(new TextDecoder().decode(gif).includes('NETSCAPE2.0'), 'loops');
  assert.deepEqual(controls(gif).map(c => c.delay), [5, 5, 5]);
  assert.equal(gif[gif.length - 1], 0x3b, 'trailer');
});

test('fewer frames last as long as the ones they replace, never too short', () => {
  const gif = encodeGif({ width: 4, height: 4, frames: [frame(255, 255, 40), frame(0, 255, 40), frame(9, 255, 5)] }, 32, 2, false);
  assert.deepEqual(controls(gif).map(c => c.delay), [8, 2]);
});

test('transparency is kept and each frame clears the one before', () => {
  const gif = encodeGif({ width: 4, height: 4, frames: [frame(255, 0), frame(0)] }, 32, 1, true);
  const c = controls(gif);
  assert.equal(c[0].transparent, true);
  assert.ok(c.every(x => x.dispose === 2));
});

test('an opaque frame carries only what changed', () => {
  let seed = 1;
  const noise = new Uint8ClampedArray(128 * 128 * 4).map((_, i) => (i % 4 === 3 ? 255 : (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24));
  const moved = noise.slice();
  for (let i = 0; i < 8 * 4; i++) moved[i] = 255 - moved[i] | (i % 4 === 3 ? 255 : 0);
  const one = encodeGif({ width: 128, height: 128, frames: [{ rgba: noise, delay: 50 }] }, 64, 1, false).length;
  const ten = encodeGif({ width: 128, height: 128, frames: Array.from({ length: 10 }, (_, i) => ({ rgba: i % 2 ? moved : noise, delay: 50 })) }, 64, 1, false);
  assert.ok(ten.length < one * 1.5, `${ten.length} bytes for ten frames, ${one} for one`);
  const c = controls(ten);
  assert.equal(c[0].transparent, false);
  assert.ok(c.slice(1).every(x => x.transparent && x.dispose === 1), 'later frames keep what is shown');
});
