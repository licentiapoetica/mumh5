/// <reference path="./worklet-env.d.ts" />
// DeepFilterNet3 on the microphone signal, in 10 ms frames at 48 kHz. The engine is upstream's
// libDF (vendor/deepfilternet). Its generated JavaScript cannot run here: a worklet has no
// TextDecoder or crypto, and the CSP forbids its new Function fallback. So the imports are below.

const FRAME = 480;
const RING = 2048;
// Frames arrive in steps of 480 and leave in steps of 128; this much queued never runs dry
const START = FRAME + 128;
// Give up when processing takes over 70% of the time, three seconds in a row
const WINDOW_FRAMES = 100;
const MAX_BUSY_MS = 700;
const MAX_SLOW_WINDOWS = 3;

interface DfExports {
  memory: WebAssembly.Memory;
  __wbindgen_malloc(size: number, align: number): number;
  __wbindgen_exn_store(index: number): void;
  __wbg_dfstate_free(handle: number): void;
  df_create(ptr: number, length: number, attenuationLimit: number): number;
  df_process_frame(handle: number, ptr: number, length: number): number;
}

interface Df {
  process(frame: Float32Array): Float32Array;
  free(): void;
}

function createDf(module: WebAssembly.Module, model: ArrayBuffer): Df {
  let w: DfExports;
  // wasm-bindgen's table of JavaScript values; the first 132 entries are reserved
  const heap: unknown[] = new Array(128).fill(undefined);
  heap.push(undefined, null, true, false);
  let next = heap.length;
  const get = (i: number) => heap[i] as any;
  const add = (value: unknown) => {
    if (next === heap.length) heap.push(heap.length + 1);
    const i = next;
    next = heap[i] as number;
    heap[i] = value;
    return i;
  };
  const take = (i: number) => {
    const value = heap[i];
    if (i >= 132) { heap[i] = next; next = i; }
    return value;
  };
  const text = (ptr: number, length: number) => String.fromCharCode(...new Uint8Array(w.memory.buffer, ptr >>> 0, length));
  const guarded = (fn: (...args: number[]) => unknown) => (...args: number[]) => {
    try { return fn(...args); } catch (e) { w.__wbindgen_exn_store(add(e)); }
  };
  const missing = guarded(() => { throw new Error('Not available in a worklet'); });
  // What the engine sees as the global object. Nothing here is secret, so Math.random will do.
  const scope = {
    crypto: {
      getRandomValues(bytes: Uint8Array) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.random() * 256;
      }
    }
  };
  // The names carry hashes from this exact build; a rebuilt engine with others fails visibly
  const handlers: Record<string, (...args: number[]) => unknown> = {
    __wbindgen_object_drop_ref: i => { take(i); },
    __wbindgen_object_clone_ref: i => add(get(i)),
    __wbindgen_is_object: i => { const v = get(i); return typeof v === 'object' && v !== null; },
    __wbindgen_is_string: i => typeof get(i) === 'string',
    __wbindgen_is_function: i => typeof get(i) === 'function',
    __wbindgen_is_undefined: i => get(i) === undefined,
    __wbindgen_string_new: (ptr, length) => add(text(ptr, length)),
    __wbindgen_memory: () => add(w.memory),
    __wbindgen_throw: (ptr, length) => { throw new Error(text(ptr, length)); },
    __wbg_crypto_566d7465cdbb6b7a: i => add(get(i).crypto),
    __wbg_msCrypto_0b84745e9245cdf6: i => add(get(i).msCrypto),
    __wbg_process_dc09a8c7d59982f6: i => add(get(i).process),
    __wbg_versions_d98c6400c6ca2bd8: i => add(get(i).versions),
    __wbg_node_caaf83d002149bd5: i => add(get(i).node),
    __wbg_require_94a9da52636aacbf: missing,
    __wbg_randomFillSync_290977693942bf03: missing,
    __wbg_getRandomValues_260cc23a41afad9a: guarded((c, bytes) => { get(c).getRandomValues(get(bytes)); }),
    __wbg_call_27c0f87801dedf93: guarded((f, self) => add(get(f).call(get(self)))),
    __wbg_call_b3ca7c6051f9bec1: guarded((f, self, a) => add(get(f).call(get(self), get(a)))),
    __wbg_newnoargs_e258087cd0daa0ea: () => { throw new Error('new Function is not allowed'); },
    __wbg_buffer_12d079cc21e14bdb: i => add(get(i).buffer),
    __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb: (b, offset, length) => add(new Uint8Array(get(b), offset >>> 0, length >>> 0)),
    __wbg_new_63b92bc8671ed464: i => add(new Uint8Array(get(i))),
    __wbg_set_a47bac70306a19a7: (target, source, offset) => { get(target).set(get(source), offset >>> 0); },
    __wbg_newwithbyteoffsetandlength_4a659d079a1650e0: (b, offset, length) => add(new Float32Array(get(b), offset >>> 0, length >>> 0)),
    __wbg_new_9efabd6b6d2ce46d: i => add(new Float32Array(get(i))),
    __wbg_newwithlength_e9b4878cebadb3d3: length => add(new Uint8Array(length >>> 0)),
    __wbg_subarray_a1f73cd4b5b42fe1: (i, begin, end) => add(get(i).subarray(begin >>> 0, end >>> 0)),
    __wbg_self_ce0dbfc45cf2f5be: missing,
    __wbg_window_c6fb939a7f436783: missing,
    __wbg_globalThis_d1e6af4856ba331b: () => add(scope),
    __wbg_global_207b558942527489: missing
  };
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const item of WebAssembly.Module.imports(module)) {
    const handler = handlers[item.name];
    if (!handler) throw new Error(`Unknown import ${item.name}`);
    imports[item.module] ??= {};
    imports[item.module][item.name] = handler as WebAssembly.ImportValue;
  }
  w = new WebAssembly.Instance(module, imports).exports as unknown as DfExports;

  const bytes = new Uint8Array(model);
  const modelPtr = w.__wbindgen_malloc(bytes.length, 1) >>> 0;
  new Uint8Array(w.memory.buffer).set(bytes, modelPtr);
  const handle = w.df_create(modelPtr, bytes.length, 100) >>> 0;
  return {
    process(frame) {
      const ptr = w.__wbindgen_malloc(frame.length * 4, 4) >>> 0;
      new Float32Array(w.memory.buffer).set(frame, ptr / 4);
      return take(w.df_process_frame(handle, ptr, frame.length)) as Float32Array;
    },
    free: () => w.__wbg_dfstate_free(handle)
  };
}

class DenoiseProcessor extends AudioWorkletProcessor {
  private df: Df | null = null;
  private closed = false;
  private frame = new Float32Array(FRAME);
  private fill = 0;
  private ring = new Float32Array(RING);
  private readPos = 0;
  private queued = 0;
  private started = false;
  private busyMs = 0;
  private frames = 0;
  private slowWindows = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.port.onmessage = e => { if (e.data?.close) this.close(); };
    try {
      this.df = createDf(options.processorOptions.module, options.processorOptions.model);
      this.port.postMessage({ ready: true });
    } catch (e) {
      this.port.postMessage({ failed: (e as Error).message });
    }
  }

  private close(): void {
    this.closed = true;
    this.release();
  }

  private release(): void {
    try { this.df?.free(); } catch { /* already gone */ }
    this.df = null;
  }

  private reset(): void {
    this.fill = this.readPos = this.queued = 0;
    this.started = false;
  }

  private runFrame(df: Df): void {
    const begin = Date.now();
    const out = df.process(this.frame);
    this.busyMs += Date.now() - begin;
    let pos = (this.readPos + this.queued) % RING;
    for (let i = 0; i < out.length; i++) {
      this.ring[pos] = out[i];
      pos = (pos + 1) % RING;
    }
    this.queued += out.length;
    if (++this.frames < WINDOW_FRAMES) return;
    this.slowWindows = this.busyMs > MAX_BUSY_MS ? this.slowWindows + 1 : 0;
    this.frames = this.busyMs = 0;
    if (this.slowWindows >= MAX_SLOW_WINDOWS) {
      this.release();
      this.port.postMessage({ overloaded: true });
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.closed) return false;
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    // No microphone connected: start clean when it comes back
    if (!input) { this.reset(); return true; }
    if (!this.df) { output.set(input); return true; }

    for (let i = 0; i < input.length && this.df; i++) {
      this.frame[this.fill++] = input[i];
      if (this.fill === FRAME) {
        this.fill = 0;
        this.runFrame(this.df);
      }
    }
    if (!this.df) { output.set(input); return true; }

    if (!this.started && this.queued >= START) this.started = true;
    if (!this.started) return true;
    if (this.queued < output.length) { this.started = false; return true; }
    for (let i = 0; i < output.length; i++) output[i] = this.ring[(this.readPos + i) % RING];
    this.readPos = (this.readPos + output.length) % RING;
    this.queued -= output.length;
    return true;
  }
}

registerProcessor('mumh5-denoise', DenoiseProcessor);

export {};
