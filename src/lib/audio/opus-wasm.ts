// Opus in WebAssembly (libopus, from the @evan/opus package), for browsers without WebCodecs
// audio, such as Firefox on Android. Only loaded there; everywhere else the browser's own
// codec is used. The two classes offer the small part of the WebCodecs interface the voice
// engine needs. No DOM or bundler imports here, so the tests can run it in Node.

interface Exports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  opus_encoder_get_size(channels: number): number;
  opus_encoder_init(ptr: number, rate: number, channels: number, application: number): number;
  opus_encoder_ctl_set(ptr: number, request: number, value: number): number;
  opus_encode(ptr: number, pcm: number, frameSize: number, out: number, max: number): number;
  opus_decoder_get_size(channels: number): number;
  opus_decoder_init(ptr: number, rate: number, channels: number): number;
  opus_decode(ptr: number, data: number, length: number, pcm: number, frameSize: number, fec: number): number;
}

export interface Opus { wasm: Exports }

const RATE = 48000;
const MAX_PACKET = 4000;
// The longest Opus frame is 120 ms
const MAX_SAMPLES = 5760;
const APPLICATION_VOIP = 2048, SET_BITRATE = 4002, SET_COMPLEXITY = 4010, SET_INBAND_FEC = 4012, SET_PACKET_LOSS = 4014, SET_SIGNAL = 4024, SIGNAL_VOICE = 3001;

// bytes: the contents of opus.wasm (fetched by opus-load.ts in the app, read from disk in tests)
export async function instantiateOpus(bytes: BufferSource): Promise<Opus> {
  const imports = {
    wasi_snapshot_preview1: { fd_seek() { return 0; }, fd_write() { return 0; }, fd_close() { return 0; }, proc_exit() {} },
    // Memory is read through fresh views every call, so growth needs no bookkeeping
    env: { emscripten_notify_memory_growth() {} }
  };
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  return { wasm: instance.exports as unknown as Exports };
}

// Takes the engine's 10 ms frames and gives out one packet per frame duration
export class WasmEncoder {
  state: 'configured' | 'closed' = 'configured';
  private wasm: Exports;
  private ptr: number;
  private pcm: number;
  private out: number;
  private samples: number;
  private filled = 0;
  private output: (packet: Uint8Array) => void;

  constructor(opus: Opus, bitrate: number, frameMs: number, output: (packet: Uint8Array) => void) {
    const w = this.wasm = opus.wasm;
    this.output = output;
    this.samples = RATE * frameMs / 1000;
    this.ptr = w.malloc(w.opus_encoder_get_size(1));
    this.pcm = w.malloc(this.samples * 2);
    this.out = w.malloc(MAX_PACKET);
    if (w.opus_encoder_init(this.ptr, RATE, 1, APPLICATION_VOIP) < 0) { this.close(); throw new Error('Could not start the Opus encoder'); }
    w.opus_encoder_ctl_set(this.ptr, SET_BITRATE, Math.round(bitrate));
    // A notch below the maximum: phones are the ones without a codec of their own
    w.opus_encoder_ctl_set(this.ptr, SET_COMPLEXITY, 8);
    w.opus_encoder_ctl_set(this.ptr, SET_INBAND_FEC, 1);
    w.opus_encoder_ctl_set(this.ptr, SET_PACKET_LOSS, 10);
    w.opus_encoder_ctl_set(this.ptr, SET_SIGNAL, SIGNAL_VOICE);
  }

  push(frame: Float32Array): void {
    if (this.state !== 'configured') return;
    let view = new Int16Array(this.wasm.memory.buffer, this.pcm, this.samples);
    for (let i = 0; i < frame.length; i++) {
      const v = Math.max(-1, Math.min(1, frame[i]));
      view[this.filled++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.filled < this.samples) continue;
      this.filled = 0;
      const length = this.wasm.opus_encode(this.ptr, this.pcm, this.samples, this.out, MAX_PACKET);
      if (length > 0) this.output(new Uint8Array(this.wasm.memory.buffer, this.out, length).slice());
      // Encoding may have grown the memory, which detaches the view
      view = new Int16Array(this.wasm.memory.buffer, this.pcm, this.samples);
    }
  }

  // An unfinished frame at the end of a transmission is dropped
  flush(): Promise<void> {
    this.filled = 0;
    return Promise.resolve();
  }

  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    for (const p of [this.ptr, this.pcm, this.out]) if (p) this.wasm.free(p);
  }
}

export class WasmDecoder {
  private wasm: Exports;
  private ptr: number;
  private data: number;
  private pcm: number;
  private closed = false;

  constructor(opus: Opus) {
    const w = this.wasm = opus.wasm;
    this.ptr = w.malloc(w.opus_decoder_get_size(1));
    this.data = w.malloc(MAX_PACKET);
    this.pcm = w.malloc(MAX_SAMPLES * 2);
    if (w.opus_decoder_init(this.ptr, RATE, 1) < 0) { this.close(); throw new Error('Could not start the Opus decoder'); }
  }

  // Mono samples for the playback worklet, or null for a packet that does not decode
  decode(packet: Uint8Array): Float32Array<ArrayBuffer> | null {
    // An empty packet would make libopus invent audio (loss concealment)
    if (this.closed || !packet.length || packet.length > MAX_PACKET) return null;
    new Uint8Array(this.wasm.memory.buffer, this.data, packet.length).set(packet);
    const n = this.wasm.opus_decode(this.ptr, this.data, packet.length, this.pcm, MAX_SAMPLES, 0);
    if (n <= 0) return null;
    const samples = new Int16Array(this.wasm.memory.buffer, this.pcm, n);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = samples[i] / 0x8000;
    return out;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of [this.ptr, this.data, this.pcm]) if (p) this.wasm.free(p);
  }
}
