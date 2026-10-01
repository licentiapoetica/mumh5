import captureUrl from './capture.worklet.ts?worker&url';
import playbackUrl from './playback.worklet.ts?worker&url';
import { encodeVoice, decodeVoice } from '../../core/voice-packet.ts';
import type { MumbleClient } from '../../core/client.ts';
import { load, save } from '../storage.ts';

export type TransmitMode = 'vad' | 'ptt' | 'continuous';

export interface VoiceSettings {
  inputDevice: string;
  outputDevice: string;
  mode: TransmitMode;
  pttKey: string;            // KeyboardEvent.code
  vadThreshold: number;      // dBFS; louder frames open the voice activity gate
  vadHoldMs: number;         // keep sending this long after the level drops
  inputGain: number;         // 0..3
  outputVolume: number;      // 0..2
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  bitrate: number;           // Opus bits per second
  frameMs: 10 | 20 | 40 | 60;
  jitterMs: number;
  forceTcp: boolean;         // send voice through the TCP connection even when UDP works
  // Per-user local volume and mute, keyed by certificate hash (or name without one)
  userVolumes: Record<string, number>;
  localMutes: Record<string, boolean>;
}

const defaults: VoiceSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  mode: 'vad',
  pttKey: 'Backquote',
  vadThreshold: -45,
  vadHoldMs: 350,
  inputGain: 1,
  outputVolume: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  bitrate: 40000,
  frameMs: 20,
  jitterMs: 60,
  forceTcp: false,
  userVolumes: {},
  localMutes: {}
};

const SAMPLE_RATE = 48000;
const FRAME = 480; // 10 ms
// Rough per-packet cost of IP, TCP/TLS or UDP, and Mumble headers, for the bandwidth limit
const PACKET_OVERHEAD_BYTES = 60;

export const userKey = (u: { hash: string; name: string }) => u.hash || `name:${u.name}`;

export interface DeviceInfo { id: string; label: string }

class VoiceEngine {
  settings = $state<VoiceSettings>(load('mumh5.voice', defaults));
  inputDevices = $state<DeviceInfo[]>([]);
  outputDevices = $state<DeviceInfo[]>([]);
  running = $state(false);
  error = $state('');
  level = $state(-100);        // current input level, dBFS
  transmitting = $state(false);
  pttDown = $state(false);
  testing = $state(false);     // hear yourself
  talking = $state<Record<number, boolean>>({});
  effectiveBitrate = $state(0);
  stats = $state({ sent: 0, received: 0, decoded: 0, lost: 0 });

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private inputGainNode: GainNode | null = null;
  private outputGainNode: GainNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private playback: AudioWorkletNode | null = null;
  private encoder: AudioEncoder | null = null;
  private decoders = new Map<number, { decoder: AudioDecoder; lastFrame: number; timer: ReturnType<typeof setTimeout> | null }>();
  private client: MumbleClient | null = null;
  private sessionGains = new Map<number, number>();
  private unsubscribe: (() => void)[] = [];
  // Push-to-talk press/release, for the notification sounds
  onPtt: ((down: boolean) => void) | null = null;
  // Speaking (or pressing push to talk) while muted, for the reminder sound
  onTalkingWhileMuted: (() => void) | null = null;
  private lastMutedReminder = 0;

  private frameCounter = 0;      // Mumble sequence, in 10 ms frames
  private sampleTime = 0;        // encoder timestamps, microseconds
  private lastVoiceAt = 0;       // for VAD hold
  private open = false;          // gate state
  private stopping = false;      // flushing the last packet of a transmission
  private held: Uint8Array[] = [];
  private levelRaw = -100;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    // Released keys are not reported while the window is in the background
    window.addEventListener('blur', () => { this.pttDown = false; });
    navigator.mediaDevices?.addEventListener('devicechange', () => this.refreshDevices());
  }

  save(): void {
    save('mumh5.voice', $state.snapshot(this.settings));
  }

  update(patch: Partial<VoiceSettings>): void {
    Object.assign(this.settings, patch);
    this.save();
    if ('inputGain' in patch && this.inputGainNode) this.inputGainNode.gain.value = this.settings.inputGain;
    if ('outputVolume' in patch && this.outputGainNode) this.outputGainNode.gain.value = this.settings.outputVolume;
    if ('jitterMs' in patch) this.playback?.port.postMessage({ jitterMs: this.settings.jitterMs });
    if ('outputDevice' in patch) this.applyOutputDevice();
    if ('bitrate' in patch || 'frameMs' in patch) this.configureEncoder();
    if (['inputDevice', 'echoCancellation', 'noiseSuppression', 'autoGainControl'].some(k => k in patch)) this.restartInput();
  }

  // ─── Devices ────────────────────────────────────────────────────────────────

  async refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const map = (kind: MediaDeviceKind) => all.filter(d => d.kind === kind && d.deviceId !== 'communications')
      .map(d => ({ id: d.deviceId, label: d.label || (d.deviceId === 'default' ? 'System default' : 'Unnamed device') }));
    this.inputDevices = map('audioinput');
    this.outputDevices = map('audiooutput');
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  // Starts the audio graph; safe to call repeatedly
  async start(): Promise<void> {
    if (this.ctx) return;
    this.error = '';
    try {
      if (typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported(this.encoderConfig())).supported) {
        throw new Error('This browser cannot encode Opus audio (WebCodecs is missing), so you cannot talk or hear others here. Chromium-based browsers and the desktop app can.');
      }
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(captureUrl);
      await ctx.audioWorklet.addModule(playbackUrl);

      this.outputGainNode = new GainNode(ctx, { gain: this.settings.outputVolume });
      this.playback = new AudioWorkletNode(ctx, 'mumh5-playback', { numberOfInputs: 0, outputChannelCount: [2] });
      this.playback.port.onmessage = e => this.onLevels(e.data.levels);
      this.playback.port.postMessage({ jitterMs: this.settings.jitterMs });
      for (const [s, g] of this.sessionGains) this.playback.port.postMessage({ session: s, gain: g });
      this.playback.connect(this.outputGainNode).connect(ctx.destination);

      this.inputGainNode = new GainNode(ctx, { gain: this.settings.inputGain });
      this.capture = new AudioWorkletNode(ctx, 'mumh5-capture', { numberOfOutputs: 0 });
      this.capture.port.onmessage = e => this.onFrame(e.data.frame, e.data.rms);
      this.inputGainNode.connect(this.capture);

      await this.applyOutputDevice();
      await this.restartInput();
      this.configureEncoder();
      await ctx.resume();
      this.levelTimer = setInterval(() => { this.level = this.levelRaw; }, 50);
      this.running = true;
      await this.refreshDevices();
    } catch (e) {
      this.error = (e as Error).message;
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.endTransmission();
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    for (const d of this.decoders.values()) { try { d.decoder.close(); } catch { /* closed */ } }
    this.decoders.clear();
    try { this.encoder?.close(); } catch { /* closed */ }
    this.encoder = null;
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.capture = this.playback = null;
    this.running = false;
    this.transmitting = false;
    this.talking = {};
    this.level = -100;
  }

  private async restartInput(): Promise<void> {
    if (!this.ctx || !this.inputGainNode) return;
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    const s = this.settings;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.inputDevice && s.inputDevice !== 'default' ? { exact: s.inputDevice } : undefined,
          echoCancellation: s.echoCancellation,
          noiseSuppression: s.noiseSuppression,
          autoGainControl: s.autoGainControl,
          channelCount: 1,
          sampleRate: SAMPLE_RATE
        }
      });
    } catch (e) {
      this.error = `Microphone unavailable: ${(e as Error).message}`;
      return;
    }
    this.error = '';
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.inputGainNode);
    this.refreshDevices();
  }

  private async applyOutputDevice(): Promise<void> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(this.settings.outputDevice === 'default' ? '' : this.settings.outputDevice);
    } catch (e) {
      this.error = `Output device unavailable: ${(e as Error).message}`;
    }
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  attach(client: MumbleClient): void {
    this.unsubscribe.forEach(off => off());
    this.client = client;
    this.stats = { sent: 0, received: 0, decoded: 0, lost: 0 };
    this.unsubscribe = [
      client.on('voice', raw => { if (this.client === client) this.receive(raw); }),
      client.on('userRemove', u => this.dropSession(u.session))
    ];
    this.limitBitrate();
    this.start();
  }

  detach(): void {
    this.endTransmission();
    this.unsubscribe.forEach(off => off());
    this.unsubscribe = [];
    this.client = null;
    for (const s of [...this.decoders.keys()]) this.dropSession(s);
    this.playback?.port.postMessage({ clear: true });
    this.talking = {};
    this.transmitting = false;
    // Release the microphone while not connected (unless testing it)
    if (!this.testing) this.stop();
  }

  // Opus bitrate that keeps bitrate plus packet overhead inside the server's per-user limit
  private allowedBitrate(): number {
    const max = this.client?.maxBandwidth ?? 0;
    const overhead = PACKET_OVERHEAD_BYTES * 8 * (1000 / this.settings.frameMs);
    return Math.min(this.settings.bitrate, max ? Math.max(8000, max - overhead) : Infinity);
  }

  private limitBitrate(): void {
    if (this.allowedBitrate() !== this.effectiveBitrate) this.configureEncoder();
  }

  // ─── Sending ────────────────────────────────────────────────────────────────

  private encoderConfig(): AudioEncoderConfig {
    return {
      codec: 'opus',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: this.effectiveBitrate || this.allowedBitrate(),
      opus: { frameDuration: this.settings.frameMs * 1000, complexity: 10, useinbandfec: true, usedtx: false }
    } as AudioEncoderConfig;
  }

  private configureEncoder(): void {
    this.effectiveBitrate = this.allowedBitrate();
    if (!this.ctx) return;
    try { this.encoder?.close(); } catch { /* closed */ }
    this.encoder = new AudioEncoder({
      output: chunk => this.onEncoded(chunk),
      error: e => { this.error = `Encoder: ${e.message}`; }
    });
    this.encoder.configure(this.encoderConfig());
  }

  private canTalk(): boolean {
    const self = this.client?.self;
    return !!self && this.client!.synced && !self.selfMute && !self.mute && !self.suppress && !self.selfDeaf && !self.deaf;
  }

  private onFrame(frame: Float32Array<ArrayBuffer>, rms: number): void {
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    this.levelRaw = Math.max(-100, db);
    const now = performance.now();
    const s = this.settings;

    if (this.testing) this.playback?.port.postMessage({ session: -1, pcm: frame.slice() });

    let wanted: boolean;
    if (s.mode === 'continuous') wanted = true;
    else if (s.mode === 'ptt') wanted = this.pttDown;
    else {
      if (db > s.vadThreshold) this.lastVoiceAt = now;
      wanted = now - this.lastVoiceAt < s.vadHoldMs;
    }
    // Speaking into a muted microphone: remind, at most every 8 seconds
    const self = this.client?.self;
    if (wanted && s.mode === 'vad' && self && (self.selfMute || self.mute) && !self.selfDeaf && now - this.lastMutedReminder > 8000) {
      this.lastMutedReminder = now;
      this.onTalkingWhileMuted?.();
    }
    wanted &&= this.canTalk() && !!this.encoder && this.encoder.state === 'configured';

    if (wanted && !this.open) { this.open = true; this.transmitting = true; }
    if (!wanted && this.open) { this.endTransmission(); return; }
    if (!this.open) return;

    const data = new AudioData({
      format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: FRAME, numberOfChannels: 1,
      timestamp: this.sampleTime, data: frame
    });
    this.sampleTime += 10000;
    this.encoder!.encode(data);
    data.close();
  }

  private onEncoded(chunk: EncodedAudioChunk): void {
    const opus = new Uint8Array(chunk.byteLength);
    chunk.copyTo(opus);
    if (this.stopping) { this.held.push(opus); return; }
    this.sendPacket(opus, false);
  }

  private sendPacket(opus: Uint8Array, last: boolean): void {
    const client = this.client;
    if (!client) return;
    client.sendVoice(encodeVoice({ target: 0, frame: this.frameCounter, opus, last }, client.protobufVoice));
    this.frameCounter += this.settings.frameMs / 10;
    this.stats.sent++;
  }

  // Flush what the encoder still holds and mark the final packet, so receivers end the stream cleanly
  private endTransmission(): void {
    if (!this.open) return;
    this.open = false;
    this.transmitting = false;
    const enc = this.encoder;
    if (!enc || enc.state !== 'configured') return;
    this.stopping = true;
    enc.flush().then(() => {
      const held = this.held;
      this.held = [];
      this.stopping = false;
      held.forEach((opus, i) => this.sendPacket(opus, i === held.length - 1));
      if (!held.length) this.sendPacket(new Uint8Array(0), true);
    }).catch(() => { this.stopping = false; this.held = []; });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code !== this.settings.pttKey || e.repeat) return;
    // Typing in a text field does not trigger push to talk
    const t = e.target as HTMLElement | null;
    if (down && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (this.pttDown === down) return;
    this.pttDown = down;
    if (this.settings.mode === 'ptt' && this.client) {
      const self = this.client.self;
      if (down && self && (self.selfMute || self.mute)) this.onTalkingWhileMuted?.();
      else this.onPtt?.(down);
    }
  }

  // ─── Receiving ──────────────────────────────────────────────────────────────

  private receive(raw: Uint8Array): void {
    const p = decodeVoice(raw);
    if (!p) return;
    this.stats.received++;
    const self = this.client?.self;
    if (!this.ctx || !this.playback || self?.selfDeaf || self?.deaf) return;
    const user = this.client?.users.get(p.session);
    if (user && this.settings.localMutes[userKey(user)]) return;

    let d = this.decoders.get(p.session);
    if (!d) {
      const session = p.session;
      const decoder = new AudioDecoder({
        output: data => this.onDecoded(session, data),
        error: () => this.dropSession(session)
      });
      decoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
      d = { decoder, lastFrame: -1, timer: null };
      this.decoders.set(session, d);
      if (user) this.setSessionGain(session, this.settings.userVolumes[userKey(user)] ?? 1);
    }
    if (d.lastFrame >= 0 && p.frame > d.lastFrame + 6 && p.frame - d.lastFrame < 500) this.stats.lost++;
    d.lastFrame = p.frame;

    if (p.opus.length) {
      d.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: p.frame * 10000, data: p.opus }));
    }
    if (!this.talking[p.session]) this.talking[p.session] = true;
    if (d.timer) clearTimeout(d.timer);
    // Speaking ends with the terminator, or when packets stop arriving
    d.timer = setTimeout(() => { delete this.talking[p.session]; }, p.last ? this.settings.jitterMs + 60 : 400);
  }

  private onDecoded(session: number, data: AudioData): void {
    const pcm = new Float32Array(data.numberOfFrames);
    data.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
    data.close();
    this.stats.decoded++;
    this.playback?.port.postMessage({ session, pcm }, [pcm.buffer]);
  }

  private dropSession(session: number): void {
    const d = this.decoders.get(session);
    if (d) {
      if (d.timer) clearTimeout(d.timer);
      try { d.decoder.close(); } catch { /* closed */ }
      this.decoders.delete(session);
    }
    this.playback?.port.postMessage({ drop: session });
    delete this.talking[session];
  }

  private onLevels(_levels: Record<number, number>): void {
    // Per-speaker peaks from the playback worklet, for future meters
  }

  // ─── Per-user controls ──────────────────────────────────────────────────────

  private setSessionGain(session: number, gain: number): void {
    this.sessionGains.set(session, gain);
    this.playback?.port.postMessage({ session, gain });
  }

  setUserVolume(user: { session: number; hash: string; name: string }, volume: number): void {
    this.settings.userVolumes[userKey(user)] = volume;
    this.save();
    this.setSessionGain(user.session, volume);
  }

  setLocalMute(user: { session: number; hash: string; name: string }, muted: boolean): void {
    if (muted) this.settings.localMutes[userKey(user)] = true;
    else delete this.settings.localMutes[userKey(user)];
    this.save();
    if (muted) this.dropSession(user.session);
  }

  setTesting(on: boolean): void {
    this.testing = on;
    if (on) this.start();
    else {
      this.playback?.port.postMessage({ drop: -1 });
      if (!this.client) this.stop();
    }
  }
}

export const voice = new VoiceEngine();
