import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instantiateOpus, WasmEncoder, WasmDecoder } from '../src/lib/audio/opus-wasm.ts';

const opus = await instantiateOpus(readFileSync(new URL('../node_modules/@evan/opus/wasm/opus.wasm', import.meta.url)));

// One second of a 440 Hz tone in the engine's 10 ms frames
const tone = () => Array.from({ length: 100 }, (_, f) => Float32Array.from({ length: 480 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * (f * 480 + i) / 48000)));

for (const frameMs of [10, 20, 40, 60]) {
  test(`a tone survives encoding and decoding with ${frameMs} ms packets`, () => {
    const packets: Uint8Array[] = [];
    const encoder = new WasmEncoder(opus, 40000, frameMs, p => packets.push(p));
    for (const frame of tone()) encoder.push(frame);
    assert.equal(packets.length, Math.floor(1000 / frameMs), 'one packet per frame duration');
    // Around the asked bitrate, not raw audio
    const bytes = packets.reduce((n, p) => n + p.length, 0);
    assert.ok(bytes > 2000 && bytes < 8000, `about 40 kbit/s: ${bytes} bytes for one second`);

    const decoder = new WasmDecoder(opus);
    const out = packets.map(p => decoder.decode(p)!);
    assert.ok(out.every(pcm => pcm.length === 48 * frameMs), 'each packet decodes to its duration');
    // The tone is still there: count the zero crossings in the second half (the codec needs a moment to settle)
    const all = Float32Array.from(out.slice(out.length / 2).flatMap(pcm => [...pcm]));
    let crossings = 0;
    for (let i = 1; i < all.length; i++) if ((all[i - 1] < 0) !== (all[i] < 0)) crossings++;
    const hz = crossings / 2 / (all.length / 48000);
    assert.ok(Math.abs(hz - 440) < 15, `decoded tone at ${hz.toFixed(1)} Hz`);
    const peak = all.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.3 && peak < 0.8, `level kept: ${peak.toFixed(2)}`);
    encoder.close();
    decoder.close();
  });
}

test('an unfinished frame is dropped at the end, and garbage does not decode', () => {
  const packets: Uint8Array[] = [];
  const encoder = new WasmEncoder(opus, 40000, 20, p => packets.push(p));
  encoder.push(tone()[0]);
  assert.equal(packets.length, 0);
  encoder.flush();
  encoder.push(tone()[0]);
  assert.equal(packets.length, 0, 'the half frame before the flush is gone');
  encoder.push(tone()[1]);
  assert.equal(packets.length, 1);
  const decoder = new WasmDecoder(opus);
  assert.equal(decoder.decode(new Uint8Array(5000)), null);
  assert.equal(decoder.decode(Uint8Array.of()), null);
  encoder.close();
  encoder.push(tone()[0]);
  decoder.close();
  assert.equal(decoder.decode(packets[0]), null);
});
