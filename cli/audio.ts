import { PassThrough, Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { instantiateOpus, WasmEncoder, WasmDecoder, type Opus } from '../src/lib/audio/opus-wasm.ts';
import { decodeVoice, encodeVoice } from '../src/core/voice-packet.ts';
import type { MumbleClient } from '../src/core/client.ts';

export const AUDIO_RATE = 48000, AUDIO_SAMPLES = 480, AUDIO_BYTES = AUDIO_SAMPLES * 2;
interface Speaker { decoder: WasmDecoder; chunks: Float32Array[]; offset: number; queued: number; sequence: number; heard: number }

// The input goes only to the encoder. The output goes only to consumers: there is
// deliberately no connection from received audio back into the outgoing stream.
export class DuplexAudio {
  readonly input = new PassThrough({ highWaterMark: AUDIO_BYTES * 50 });
  readonly output = new Readable({ highWaterMark: AUDIO_BYTES * 50, read() {} });
  private client: MumbleClient;
  private opus: Opus;
  private encoder: WasmEncoder;
  private speakers = new Map<number, Speaker>();
  private timer: ReturnType<typeof setInterval>;
  private sequence = 0;
  private active = false;
  private half = false;
  private idle = 0;
  private closed = false;

  private constructor(client: MumbleClient, opus: Opus, bitrate: number) {
    this.client = client; this.opus = opus;
    this.encoder = new WasmEncoder(opus, bitrate, 20, packet => {
      client.sendVoice(encodeVoice({ target: 0, frame: this.sequence, opus: packet, last: false }, client.protobufVoice));
      this.sequence += 2;
    }, 3);
    this.timer = setInterval(() => this.tick(), 10);
  }

  static async create(client: MumbleClient, bitrate = 40000): Promise<DuplexAudio> {
    const bytes = await readFile(new URL('./opus.wasm', import.meta.url)).catch(() => readFile(new URL('../node_modules/@evan/opus/wasm/opus.wasm', import.meta.url)));
    const opus = await instantiateOpus(bytes);
    const allowed = client.maxBandwidth ? Math.max(6000, client.maxBandwidth - 28000) : bitrate;
    return new DuplexAudio(client, opus, Math.min(bitrate, allowed));
  }

  receive(packet: Uint8Array): void {
    const p = decodeVoice(packet);
    if (!p || p.session === this.client.session || !p.opus.length || this.closed) return;
    let speaker = this.speakers.get(p.session);
    if (!speaker) {
      if (this.speakers.size >= 64) this.remove(this.speakers.keys().next().value!);
      speaker = { decoder: new WasmDecoder(this.opus), chunks: [], offset: 0, queued: 0, sequence: -1, heard: Date.now() };
      this.speakers.set(p.session, speaker);
    }
    if (p.frame <= speaker.sequence) return;
    speaker.sequence = p.frame; speaker.heard = Date.now();
    const pcm = speaker.decoder.decode(p.opus);
    if (pcm) { speaker.chunks.push(pcm); speaker.queued += pcm.length; }
    // Drop old decoded chunks without repeatedly copying or boxing PCM samples.
    while (speaker.queued > AUDIO_RATE / 2 && speaker.chunks.length) {
      speaker.queued -= speaker.chunks.shift()!.length - speaker.offset; speaker.offset = 0;
    }
  }

  remove(session: number): void {
    this.speakers.get(session)?.decoder.close(); this.speakers.delete(session);
  }

  private tick(): void {
    if (this.closed) return;
    const self = this.client.self;
    const input = this.input.read(AUDIO_BYTES) as Buffer | null;
    if (input && self && !self.mute && !self.selfMute && !self.deaf && !self.selfDeaf && !self.suppress) {
      const frame = new Float32Array(AUDIO_SAMPLES);
      for (let i = 0; i < Math.floor(input.length / 2); i++) frame[i] = input.readInt16LE(i * 2) / 32768;
      this.encoder.push(frame); this.half = !this.half; this.active = true; this.idle = 0;
    } else if (this.active && ++this.idle >= 3) this.endTransmission();

    const mix = new Float32Array(AUDIO_SAMPLES);
    for (const [id, speaker] of this.speakers) {
      let at = 0;
      while (at < AUDIO_SAMPLES && speaker.chunks.length) {
        const chunk = speaker.chunks[0], count = Math.min(AUDIO_SAMPLES - at, chunk.length - speaker.offset);
        for (let i = 0; i < count; i++) mix[at + i] += chunk[speaker.offset + i];
        at += count; speaker.offset += count; speaker.queued -= count;
        if (speaker.offset === chunk.length) { speaker.chunks.shift(); speaker.offset = 0; }
      }
      if (!speaker.queued && Date.now() - speaker.heard > 2000) this.remove(id);
    }
    const out = Buffer.alloc(AUDIO_BYTES);
    for (let i = 0; i < AUDIO_SAMPLES; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i])) * 32767), i * 2);
    if (this.output.readableLength < AUDIO_BYTES * 50) this.output.push(out);
  }

  private endTransmission(): void {
    if (!this.active) return;
    if (this.half) { this.encoder.push(new Float32Array(AUDIO_SAMPLES)); this.half = false; }
    this.client.sendVoice(encodeVoice({ target: 0, frame: this.sequence, opus: new Uint8Array(), last: true }, this.client.protobufVoice));
    this.sequence += 2; this.active = false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); this.endTransmission(); this.encoder.close();
    for (const id of this.speakers.keys()) this.remove(id);
    this.input.destroy(); this.output.push(null);
  }
}
