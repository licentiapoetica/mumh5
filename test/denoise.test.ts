// The DeepFilterNet worklet, run outside a browser with the globals a worklet really has
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

interface Port { onmessage: ((e: { data: unknown }) => void) | null; posted: Record<string, unknown>[]; postMessage(m: Record<string, unknown>): void }
interface Processor { port: Port; process(i: Float32Array[][], o: Float32Array[][]): boolean }

class StubProcessor {
  port: Port = { onmessage: null, posted: [], postMessage(m) { this.posted.push(m); } };
}
let Denoise: new (o: unknown) => Processor;
Object.assign(globalThis, {
  AudioWorkletProcessor: StubProcessor,
  registerProcessor: (_: string, ctor: typeof Denoise) => { Denoise = ctor; }
});
await import('../src/lib/audio/denoise.worklet.ts');

const wasm = readFileSync(new URL('../vendor/deepfilternet/df.wasm', import.meta.url));
const modelFile = readFileSync(new URL('../vendor/deepfilternet/DeepFilterNet3_onnx.bin', import.meta.url));
const model = modelFile.buffer.slice(modelFile.byteOffset, modelFile.byteOffset + modelFile.length);
const module = await WebAssembly.compile(wasm);
const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

// A worklet has neither of these, and the wasm must start without them
function withoutWindowApis<T>(fn: () => T): T {
  const saved = ['TextDecoder', 'crypto'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)!] as const);
  for (const [k] of saved) delete (globalThis as Record<string, unknown>)[k];
  try { return fn(); } finally { for (const [k, d] of saved) Object.defineProperty(globalThis, k, d); }
}

test('removes steady noise, without gaps, and closes', () => {
  const p = withoutWindowApis(() => new Denoise({ processorOptions: { module, model } }));
  assert.deepEqual(p.port.posted, [{ ready: true }]);
  let seed = 12345, low = 0;
  const sample = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    const white = seed / 0x3fffffff - 1;
    low = 0.97 * low + 0.03 * white;
    return low * 1.2 + white * 0.0075;
  };
  const input: number[] = [], output: number[] = [];
  const state = p as unknown as { started: boolean };
  let wasStarted = false, underruns = 0;
  for (let q = 0; q < 1500; q++) {
    const i = Float32Array.from({ length: 128 }, sample), o = new Float32Array(128);
    assert.equal(p.process([[i]], [[o]]), true);
    // Pure noise may rightly come out as digital silence, so gaps are read from the queue
    if (wasStarted && !state.started) underruns++;
    wasStarted = state.started;
    if (q > 400) {
      input.push(...i);
      output.push(...o);
    }
  }
  assert.ok(wasStarted);
  assert.equal(underruns, 0, 'no gaps in the output');
  const reduction = 20 * Math.log10(rms(input) / (rms(output) + 1e-9));
  assert.ok(reduction > 15, `reduced by ${reduction.toFixed(1)} dB`);

  p.port.onmessage!({ data: { close: true } });
  assert.equal(p.process([[new Float32Array(128)]], [[new Float32Array(128)]]), false);
});

test('a module it cannot start reports the failure and passes audio through', () => {
  // A valid wasm module importing a function nothing provides
  const bad = new WebAssembly.Module(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 7, 1, 1, 97, 1, 98, 0, 0]));
  const p = new Denoise({ processorOptions: { module: bad, model } });
  assert.ok(p.port.posted[0].failed);
  const i = new Float32Array(128).fill(0.25), o = new Float32Array(128);
  p.process([[i]], [[o]]);
  assert.deepEqual(o, i);
});
