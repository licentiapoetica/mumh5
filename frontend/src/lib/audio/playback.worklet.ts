/// <reference path="./worklet-env.d.ts" />
// Mixes decoded voice of all speakers. Each speaker has a queue that starts playing once
// `jitter` ms are buffered (absorbs network jitter), and re-buffers after running dry.

interface Speaker {
  chunks: Float32Array[];
  offset: number;     // read position in chunks[0]
  queued: number;     // samples waiting
  playing: boolean;
  gain: number;
  peak: number;
  dryAt: number;      // clock when the queue last ran empty, -1 while playing
}

class PlaybackProcessor extends AudioWorkletProcessor {
  private speakers = new Map<number, Speaker>();
  private base = Math.round(sampleRate * 0.06);   // the chosen buffer
  private jitter = this.base;                        // grows after underruns, decays while smooth
  private sinceUnderrun = 0;
  private clock = 0;                                // samples processed
  private maxQueue = Math.round(sampleRate * 0.4);
  private gains = new Map<number, number>();
  private sinceReport = 0;

  constructor() {
    super();
    this.port.onmessage = e => {
      const m = e.data;
      if (m.pcm) this.push(m.session, m.pcm);
      else if (m.gain !== undefined) {
        this.gains.set(m.session, m.gain);
        const s = this.speakers.get(m.session);
        if (s) s.gain = m.gain;
      } else if (m.jitterMs !== undefined) this.jitter = this.base = Math.round(sampleRate * m.jitterMs / 1000);
      else if (m.drop !== undefined) this.speakers.delete(m.drop);
      else if (m.clear) this.speakers.clear();
    };
  }

  private push(session: number, pcm: Float32Array) {
    let s = this.speakers.get(session);
    if (!s) {
      s = { chunks: [], offset: 0, queued: 0, playing: false, gain: this.gains.get(session) ?? 1, peak: 0, dryAt: -1 };
      this.speakers.set(session, s);
    }
    // Audio again soon after running dry is an underrun; a longer gap is the speaker pausing
    if (!s.playing && s.dryAt >= 0 && this.clock - s.dryAt < sampleRate * 0.3) {
      this.jitter = Math.min(Math.round(sampleRate * 0.24), this.jitter + Math.round(sampleRate * 0.03));
      this.sinceUnderrun = 0;
    }
    s.dryAt = -1;
    s.chunks.push(pcm);
    s.queued += pcm.length;
    // Too far behind (e.g. after a stall): drop the oldest audio to catch up
    while (s.queued > this.maxQueue && s.chunks.length > 1) {
      const c = s.chunks.shift()!;
      s.queued -= c.length - s.offset;
      s.offset = 0;
    }
    if (!s.playing && s.queued >= this.jitter) s.playing = true;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const n = out[0].length;
    const mix = out[0];
    mix.fill(0);
    for (const s of this.speakers.values()) {
      if (!s.playing) continue;
      let i = 0;
      while (i < n && s.chunks.length) {
        const c = s.chunks[0];
        const take = Math.min(n - i, c.length - s.offset);
        for (let k = 0; k < take; k++) {
          const v = c[s.offset + k] * s.gain;
          mix[i + k] += v;
          const a = v < 0 ? -v : v;
          if (a > s.peak) s.peak = a;
        }
        i += take;
        s.offset += take;
        s.queued -= take;
        if (s.offset === c.length) { s.chunks.shift(); s.offset = 0; }
      }
      if (!s.chunks.length) {
        // Ran dry: buffer again before resuming (push() widens the buffer if audio follows at once)
        s.playing = false;
        s.dryAt = this.clock + i;
      }
    }
    // Soft clip so several loud speakers do not distort harshly
    for (let i = 0; i < n; i++) {
      const v = mix[i];
      if (v > 1 || v < -1) mix[i] = Math.tanh(v);
    }
    for (let ch = 1; ch < out.length; ch++) out[ch].set(mix);

    this.clock += n;
    // Ten smooth seconds give back 10 ms
    this.sinceUnderrun += n;
    if (this.sinceUnderrun >= sampleRate * 10 && this.jitter > this.base) {
      this.jitter = Math.max(this.base, this.jitter - Math.round(sampleRate * 0.01));
      this.sinceUnderrun = 0;
    }

    this.sinceReport += n;
    if (this.sinceReport >= sampleRate / 10) {
      const levels: Record<number, number> = {};
      for (const [id, s] of this.speakers) { levels[id] = s.peak; s.peak = 0; }
      this.port.postMessage({ levels });
      this.sinceReport = 0;
    }
    return true;
  }
}

registerProcessor('mumh5-playback', PlaybackProcessor);
