import { androidVoiceStart, androidVoiceStop, inAndroidShell } from '../android-shell.ts';
import { WasmEncoder, WasmDecoder, type Opus } from './opus-wasm.ts';
import { loadOpus } from './opus-load.ts';
import captureUrl from './capture.worklet.ts?worker&url';
import playbackUrl from './playback.worklet.ts?worker&url';
import denoiseUrl from './denoise.worklet.ts?worker&url';
import { loadDeepFilter } from './denoise-load.ts';
import { encodeVoice, decodeVoice } from '../../core/voice-packet.ts';
import type { MumbleClient } from '../../core/client.ts';
import { atDefaults, changedFrom, load, save } from '../storage.ts';
import { desktop } from '../native.ts';
import { connLog } from '../conn-log.svelte.ts';

export type TransmitMode = 'vad' | 'ptt' | 'continuous';
export type NoiseEngine = 'browser' | 'deepfilter';
export type DenoiseState = 'off' | 'loading' | 'on' | 'failed' | 'overloaded';

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
  noiseEngine: NoiseEngine;  // which filter noiseSuppression uses
  autoGainControl: boolean;
  bitrate: number;           // Opus bits per second
  frameMs: 10 | 20 | 40 | 60;
  jitterMs: number;
  forceTcp: boolean;         // send voice through the TCP connection even when UDP works
  // Give the microphone back while muted. An open microphone puts a Bluetooth headset into its
  // telephone mode, which also makes what you hear sound like a phone call.
  releaseMicMuted: boolean;
  // Keep the screen on while in voice, since a locked phone loses the microphone
  keepAwake: boolean;
  // Per-user local volume and mute, keyed by certificate hash (or name without one)
  userVolumes: Record<string, number>;
  localMutes: Record<string, boolean>;
}

// Phones and tablets, where Bluetooth headsets are the usual case
export const handheld = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
// Android stops background pages that play no media it knows about (see startOutputElement)
const android = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

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
  // In the browser the strong filter is a large download, so it is a choice there
  noiseEngine: desktop ? 'deepfilter' : 'browser',
  autoGainControl: true,
  bitrate: 40000,
  frameMs: 20,
  jitterMs: 60,
  forceTcp: false,
  releaseMicMuted: handheld,
  keepAwake: false,
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
  settings = $state<VoiceSettings>(load('mumh5.voice', structuredClone(defaults)));
  inputDevices = $state<DeviceInfo[]>([]);
  outputDevices = $state<DeviceInfo[]>([]);
  running = $state(false);
  micOpen = $state(false);     // the microphone is held right now
  error = $state('');
  denoise = $state<DenoiseState>('off');
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
  private denoiser: AudioWorkletNode | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  // Phones: voice plays through a media element, see startOutputElement
  private outputEl: HTMLAudioElement | null = null;
  private direct = false;        // the output gain also feeds the context's own destination
  playingMedia = $state(false);  // the media element is playing (Media Session controls apply)
  private denoiseRun = 0;        // a load or node from an earlier run is stale
  private micNoise = false;      // whether the open microphone uses the browser's filter
  // The browser's Opus codec (WebCodecs), or our own in WebAssembly where the browser has none
  private opus: Opus | null = null;
  private encoder: AudioEncoder | WasmEncoder | null = null;
  private decoders = new Map<number, { decoder: AudioDecoder | WasmDecoder; lastFrame: number; timer: ReturnType<typeof setTimeout> | null }>();
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
    // iOS and Android suspend the audio context on a call, a lock or a route change
    const wake = () => {
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
      if (this.outputEl?.paused) this.outputEl.play().catch(e => this.mediaNote(`blocked (${(e as Error).name}), waiting for a tap`));
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { wake(); this.syncAwake(); } });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake, { passive: true });
    navigator.mediaDevices?.addEventListener('devicechange', () => this.refreshDevices());
  }

  save(): void {
    save('mumh5.voice', changedFrom($state.snapshot(this.settings), defaults));
  }

  // Volumes and mutes set for other people are theirs, not settings of the Voice tab
  private static readonly RESET_KEYS = (Object.keys(defaults) as (keyof VoiceSettings)[]).filter(k => k !== 'userVolumes' && k !== 'localMutes');

  isDefault(): boolean { return atDefaults(this.settings, defaults, VoiceEngine.RESET_KEYS); }

  reset(): void {
    this.update(structuredClone(Object.fromEntries(VoiceEngine.RESET_KEYS.map(k => [k, defaults[k]]))) as Partial<VoiceSettings>);
  }

  update(patch: Partial<VoiceSettings>): void {
    Object.assign(this.settings, patch);
    this.save();
    if ('inputGain' in patch && this.inputGainNode) this.inputGainNode.gain.value = this.settings.inputGain;
    if ('outputVolume' in patch && this.outputGainNode) this.outputGainNode.gain.value = this.settings.outputVolume;
    if ('jitterMs' in patch) this.playback?.port.postMessage({ jitterMs: this.settings.jitterMs });
    if ('keepAwake' in patch) this.syncAwake();
    if ('outputDevice' in patch) this.applyOutputDevice();
    if ('bitrate' in patch || 'frameMs' in patch) this.configureEncoder();
    if ('noiseSuppression' in patch || 'noiseEngine' in patch) {
      // A new choice gets a new try after a failure
      if (this.denoise === 'failed' || this.denoise === 'overloaded') this.denoise = 'off';
      this.syncDenoise();
      this.applyMicNoise();
    }
    if (['inputDevice', 'echoCancellation', 'autoGainControl'].some(k => k in patch)) this.syncInput(true);
    else if ('releaseMicMuted' in patch) this.syncInput();
    if ('mode' in patch) this.syncDenoisePause();
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

  // ─── Screen wake lock ───────────────────────────────────────────────────────

  // The browser drops the lock whenever the page is hidden, so it is asked for again on return
  private async syncAwake(): Promise<void> {
    const want = this.settings.keepAwake && this.running && !!this.client && !document.hidden;
    if (!want) {
      const lock = this.wakeLock;
      this.wakeLock = null;
      await lock?.release().catch(() => {});
      return;
    }
    if (this.wakeLock || !navigator.wakeLock) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (this.wakeLock || !this.running) return void lock.release().catch(() => {});
      this.wakeLock = lock;
      lock.addEventListener('release', () => { if (this.wakeLock === lock) this.wakeLock = null; });
    } catch { /* refused: low battery or no permission */ }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  // Starts the audio graph; safe to call repeatedly
  async start(): Promise<void> {
    // A stop still closing the old context (a reconnect right after a drop) must finish first
    await this.pendingStop;
    if (this.ctx) return;
    this.error = '';
    try {
      const builtIn = typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined' &&
        (await AudioEncoder.isConfigSupported(this.encoderConfig()).catch(() => ({ supported: false }))).supported;
      // mumh5.forceWasmOpus in localStorage: use the built-in codec regardless, for testing it
      let forced = false;
      try { forced = localStorage.getItem('mumh5.forceWasmOpus') === '1'; } catch { /* storage unavailable */ }
      if (!builtIn || forced) {
        // Firefox on Android, for one, has no audio codec for pages; bring our own
        try {
          this.opus = await loadOpus();
        } catch (e) {
          throw new Error(`This browser has no Opus audio codec, and the built-in one could not be loaded (${(e as Error).message})`);
        }
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
      this.direct = true;
      if (android && !inAndroidShell()) this.startOutputElement(ctx);  // the shell has its own service notification

      this.inputGainNode = new GainNode(ctx, { gain: this.settings.inputGain });
      this.capture = new AudioWorkletNode(ctx, 'mumh5-capture', { numberOfOutputs: 0 });
      this.capture.port.onmessage = e => this.onFrame(e.data.frame, e.data.rms);
      this.inputGainNode.connect(this.capture);

      ctx.addEventListener('statechange', () => {
        if (this.ctx !== ctx) return;
        connLog.add(`audio ${ctx.state}`);
        if ((ctx.state as string) === 'interrupted') ctx.resume().catch(() => {});
      });
      await this.applyOutputDevice();
      // Not awaited: a browser may hold the request while the tab is hidden, and the watchdog
      // opens the microphone later if it did not come
      void this.syncInput();
      this.configureEncoder();
      // Safari can leave this pending outside a gesture; the wake handlers above finish it later
      ctx.resume().catch(() => {});
      this.levelTimer = setInterval(() => { this.level = this.levelRaw; this.watchdog(); }, 50);
      this.running = true;
      androidVoiceStart();
      this.syncAwake();
      // Not awaited: voice works with the browser's filter until the model is ready
      this.syncDenoise();
      await this.refreshDevices();
    } catch (e) {
      this.error = (e as Error).message;
      await this.stop();
    }
  }

  private pendingStop: Promise<void> | null = null;

  stop(): Promise<void> {
    return this.pendingStop = this.halt();
  }

  private async halt(): Promise<void> {
    this.endTransmission();
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.micOpen = false;
    for (const d of this.decoders.values()) { try { d.decoder.close(); } catch { /* closed */ } }
    this.decoders.clear();
    try { this.encoder?.close(); } catch { /* closed */ }
    this.encoder = null;
    this.denoiseRun++;
    this.denoiser = null;
    // A device that was too slow stays on the browser's filter until the setting changes
    if (this.denoise !== 'overloaded') this.denoise = 'off';
    this.stopOutputElement();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.capture = this.playback = null;
    this.running = false;
    androidVoiceStop();
    this.syncAwake();
    this.transmitting = false;
    this.talking = {};
    this.level = -100;
  }

  // The microphone is not needed while we cannot talk anyway (muted or deafened, by us or the server)
  private micWanted(): boolean {
    // The Android app cannot open the microphone again with the screen off (getUserMedia just waits),
    // so unmuting from the notification would not bring it back
    if (!this.settings.releaseMicMuted || this.testing || inAndroidShell()) return true;
    const self = this.client?.self;
    return !self || !(self.selfMute || self.mute || self.suppress || self.selfDeaf || self.deaf);
  }

  // Opens or gives back the microphone as the mute state asks. restart: open it anew (settings changed).
  private async syncInput(restart = false): Promise<void> {
    if (!this.ctx) return;
    const wanted = this.micWanted();
    if (wanted && (restart || !this.stream)) return this.restartInput();
    if (!wanted && this.stream) {
      this.endTransmission();
      this.source?.disconnect();
      this.source = null;
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.micOpen = false;
      this.levelRaw = -100;
    }
  }

  private async restartInput(): Promise<void> {
    if (!this.ctx || !this.inputGainNode) return;
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.micOpen = false;
    const s = this.settings;
    const browserNoise = this.browserNoise();
    let stream: MediaStream;
    this.openingSince = performance.now();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.inputDevice && s.inputDevice !== 'default' ? { exact: s.inputDevice } : undefined,
          echoCancellation: s.echoCancellation,
          noiseSuppression: browserNoise,
          autoGainControl: s.autoGainControl,
          channelCount: 1,
          sampleRate: SAMPLE_RATE
        }
      });
    } catch (e) {
      this.openingSince = 0;
      this.error = `Microphone unavailable: ${(e as Error).message}`;
      connLog.add(`microphone unavailable (${(e as Error).name})${document.hidden ? ' while the page was hidden' : ''}`);
      return;
    }
    this.openingSince = 0;
    this.autoOpens = 0;
    // Muted again, or opened a second time, while the browser was getting the microphone
    if (!this.ctx || !this.inputGainNode || this.stream || !this.micWanted()) return stream.getTracks().forEach(t => t.stop());
    this.stream = stream;
    this.lastFrameAt = performance.now();
    // The browser or the sound server can end the microphone (a device change, the audio service
    // restarting, suspend). Nothing else would notice: playback is a separate path.
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.stream !== stream) return;
        connLog.add('microphone ended by the browser, opening it again');
        this.reopenInput();
      });
      track.addEventListener('mute', () => { if (this.stream === stream) connLog.add('microphone muted by the system'); });
      track.addEventListener('unmute', () => { if (this.stream === stream) connLog.add('microphone unmuted by the system'); });
    }
    this.micNoise = browserNoise;
    this.micOpen = true;
    this.error = '';
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.denoiser ?? this.inputGainNode);
    this.refreshDevices();
    // The model became ready, or failed, while the browser was getting the microphone
    this.applyMicNoise();
  }

  // ─── Noise suppression ──────────────────────────────────────────────────────

  // Two filters in a row damage speech, so the browser's runs only without the model
  private browserNoise(): boolean {
    return this.settings.noiseSuppression && !this.denoiser;
  }

  private applyMicNoise(): void {
    if (this.stream && this.micNoise !== this.browserNoise()) this.syncInput(true);
  }

  private routeMic(): void {
    if (!this.source || !this.inputGainNode) return;
    this.source.disconnect();
    this.source.connect(this.denoiser ?? this.inputGainNode);
  }

  private async syncDenoise(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.inputGainNode) return;
    const s = this.settings;
    if (!s.noiseSuppression || s.noiseEngine !== 'deepfilter') {
      this.dropDenoiser();
      this.denoise = 'off';
      return;
    }
    if (this.denoiser || this.denoise === 'loading' || this.denoise === 'overloaded') return;
    const run = ++this.denoiseRun;
    this.denoise = 'loading';
    try {
      const { module, model } = await loadDeepFilter();
      if (run !== this.denoiseRun) return;
      await ctx.audioWorklet.addModule(denoiseUrl);
      if (run !== this.denoiseRun) return;
      const node = new AudioWorkletNode(ctx, 'mumh5-denoise', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit', processorOptions: { module, model }
      });
      node.port.onmessage = e => this.onDenoiser(node, run, e.data);
      node.onprocessorerror = () => this.onDenoiser(node, run, { failed: 'Processor error' });
    } catch (e) {
      console.warn('DeepFilterNet could not load:', e);
      if (run === this.denoiseRun) this.denoise = 'failed';
    }
  }

  private onDenoiser(node: AudioWorkletNode, run: number, msg: { ready?: boolean; failed?: string; overloaded?: boolean }): void {
    if (run !== this.denoiseRun || !this.inputGainNode) return this.closeDenoiser(node);
    if (msg.ready) {
      node.connect(this.inputGainNode);
      this.denoiser = node;
      this.denoise = 'on';
      this.denoisePaused = false;
      this.syncDenoisePause();
      this.routeMic();
      this.applyMicNoise();
      return;
    }
    if (msg.failed) console.warn('DeepFilterNet could not start:', msg.failed);
    this.closeDenoiser(node);
    this.dropDenoiser();
    this.denoise = msg.overloaded ? 'overloaded' : 'failed';
  }

  private denoisePaused = false;

  // The filter's output matters only while it can be sent, heard (testing) or trigger the reminder
  // for speaking while muted. Otherwise it passes the microphone unfiltered, which saves most of the
  // processing time of an idle connection. Resuming is immediate.
  private syncDenoisePause(): void {
    const self = this.client?.self;
    const silent = !!self && (self.selfMute || self.mute || self.suppress || self.selfDeaf || self.deaf);
    const reminder = this.settings.mode === 'vad' && !!self && (self.selfMute || self.mute) && !self.selfDeaf;
    const paused = !this.testing && silent && !reminder;
    if (!this.denoiser || paused === this.denoisePaused) return;
    this.denoisePaused = paused;
    this.denoiser.port.postMessage({ paused });
  }

  private dropDenoiser(): void {
    this.denoiseRun++;
    const node = this.denoiser;
    this.denoiser = null;
    this.routeMic();
    if (node) this.closeDenoiser(node);
    this.applyMicNoise();
  }

  private closeDenoiser(node: AudioWorkletNode): void {
    node.port.onmessage = null;
    node.onprocessorerror = null;
    node.disconnect();
    node.port.postMessage({ close: true });
  }

  // Android stops a page in the background unless it plays media it knows about, which shows as a
  // notification with controls. Web Audio alone does not count, so on phones the mix goes through
  // an audio element. The context's own output carries it until the element really plays, and
  // again whenever the element is paused (blocked autoplay, or the system took the audio).
  private startOutputElement(ctx: AudioContext): void {
    const out = this.outputGainNode;
    if (!out) return;
    const dest = ctx.createMediaStreamDestination();
    out.connect(dest);
    const el = new Audio();
    el.srcObject = dest.stream;
    const route = (viaElement: boolean) => {
      if (this.outputEl !== el) return;
      this.playingMedia = viaElement;
      if (viaElement && this.direct) { out.disconnect(ctx.destination); this.direct = false; }
      if (!viaElement && !this.direct) { out.connect(ctx.destination); this.direct = true; }
    };
    el.addEventListener('playing', () => { this.mediaNote('playing'); route(true); });
    el.addEventListener('pause', () => { this.mediaNote('paused'); route(false); });
    el.addEventListener('error', () => this.mediaNote(`error ${el.error?.code ?? ''}`.trim()));
    this.outputEl = el;
    this.mediaNote('started');
    el.play().catch(e => this.mediaNote(`blocked (${(e as Error).name}), waiting for a tap`));
  }

  private lastMediaNote = '';

  // One line per change, not one per tap
  private mediaNote(text: string): void {
    if (text === this.lastMediaNote) return;
    this.lastMediaNote = text;
    connLog.add(`voice media element ${text}`);
  }

  private stopOutputElement(): void {
    const el = this.outputEl;
    this.outputEl = null;
    this.lastMediaNote = '';
    this.playingMedia = false;
    if (!el) return;
    el.pause();
    el.srcObject = null;
  }

  private async applyOutputDevice(): Promise<void> {
    const device = this.settings.outputDevice === 'default' ? '' : this.settings.outputDevice;
    const el = this.outputEl as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId) await el.setSinkId(device).catch(() => {});
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(device);
    } catch (e) {
      this.error = `Output device unavailable: ${(e as Error).message}`;
    }
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  attach(client: MumbleClient): void {
    this.unsubscribe.forEach(off => off());
    this.client = client;
    this.autoOpens = 0;
    this.stats = { sent: 0, received: 0, decoded: 0, lost: 0 };
    this.unsubscribe = [
      client.on('voice', raw => { if (this.client === client) this.receive(raw); }),
      client.on('userRemove', u => this.dropSession(u.session)),
      client.on('user', u => {
        if (this.client !== client || u.session !== client.session) return;
        this.syncInput();
        this.syncDenoisePause();
      })
    ];
    this.limitBitrate();
    this.syncDenoisePause();
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
    this.syncDenoisePause();
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
    if (this.opus) {
      this.encoder = new WasmEncoder(this.opus, this.effectiveBitrate, this.settings.frameMs, packet => this.onPacket(packet));
      return;
    }
    const encoder = new AudioEncoder({
      output: chunk => this.onEncoded(chunk),
      // A browser may take back the codec of a tab in the background that sat idle (quiet in voice
      // activity mode); onFrame builds a new one when speech starts. Only real faults are shown.
      error: e => { if (e.name !== 'QuotaExceededError') this.error = `Encoder: ${e.message}`; }
    });
    encoder.configure(this.encoderConfig());
    this.encoder = encoder;
  }

  private autoOpens = 0;         // tries by the watchdog since the last connection or success
  private openingSince = 0;     // a request for the microphone is out since then, 0 when none
  private lastFrameAt = 0;       // when the capture worklet last delivered audio
  private lastSentAt = 0;        // when a voice packet last left
  private talkingSince = 0;
  private lastHeal = 0;

  // Opens the microphone anew, at most every 5 seconds so a device that cannot work does not loop
  private reopenInput(): void {
    const now = performance.now();
    if (now - this.lastHeal < 5000) return;
    this.lastHeal = now;
    this.syncInput(true);
  }

  // Two things that fail without any event: the microphone going quiet for good (no audio frames
  // although it is open), and speech that reaches the encoder but never leaves
  private watchdog(): void {
    const now = performance.now();
    // Wanted but not open: the request failed or was held while the page was hidden (a reconnect
    // that happened in the background), or never came. Only tried with the page visible, where the
    // browser answers; a request still out after 10 s is tried again.
    // At most three tries, so a microphone that is denied or missing does not ask over and over
    if (this.running && !this.stream && !document.hidden && this.autoOpens < 3 && this.micWanted() && (!this.openingSince || now - this.openingSince > 10000) && now - this.lastHeal > 5000) {
      this.autoOpens++;
      connLog.add('microphone is not open, opening it');
      this.openingSince = 0;
      this.reopenInput();
    }
    if (this.micOpen && this.ctx?.state === 'running' && now - this.lastFrameAt > 2000) {
      connLog.add('microphone gave no audio for 2 s, opening it again');
      this.lastFrameAt = now;
      this.reopenInput();
    }
    if (this.transmitting && now - this.talkingSince > 2000 && now - this.lastSentAt > 2000) {
      this.lastSentAt = now;
      this.rebuildEncoder('speech was not sent for 2 s');
    }
  }

  private lastRebuild = 0;

  // The one way to make the encoder again (closed by the browser or failed, or sending nothing).
  // At most once a second, so a codec that cannot start does not make a loop.
  private rebuildEncoder(why: string): boolean {
    const now = performance.now();
    if (!this.ctx || now - this.lastRebuild < 1000) return false;
    this.lastRebuild = now;
    connLog.add(`encoder rebuilt: ${why}`);
    try { this.configureEncoder(); } catch (e) { this.error = `Encoder: ${(e as Error).message}`; }
    return this.encoder?.state === 'configured';
  }

  private encoderReady(): boolean {
    return this.encoder?.state === 'configured' || this.rebuildEncoder('encoder was closed');
  }

  private canTalk(): boolean {
    const self = this.client?.self;
    return !!self && this.client!.synced && !self.selfMute && !self.mute && !self.suppress && !self.selfDeaf && !self.deaf;
  }

  private onFrame(frame: Float32Array<ArrayBuffer>, rms: number): void {
    this.lastFrameAt = performance.now();
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
    wanted &&= this.canTalk() && this.encoderReady();

    if (wanted && !this.open) { this.open = true; this.transmitting = true; this.talkingSince = this.lastSentAt = performance.now(); }
    if (!wanted && this.open) { this.endTransmission(); return; }
    if (!this.open) return;

    const encoder = this.encoder!;
    if (encoder instanceof WasmEncoder) return encoder.push(frame);
    const data = new AudioData({
      format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: FRAME, numberOfChannels: 1,
      timestamp: this.sampleTime, data: frame
    });
    this.sampleTime += 10000;
    encoder.encode(data);
    data.close();
  }

  private onEncoded(chunk: EncodedAudioChunk): void {
    const opus = new Uint8Array(chunk.byteLength);
    chunk.copyTo(opus);
    this.onPacket(opus);
  }

  private onPacket(opus: Uint8Array): void {
    if (this.stopping) { this.held.push(opus); return; }
    this.sendPacket(opus, false);
  }

  private sendPacket(opus: Uint8Array, last: boolean): void {
    const client = this.client;
    if (!client) return;
    this.lastSentAt = performance.now();
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
      let decoder: AudioDecoder | WasmDecoder;
      if (this.opus) decoder = new WasmDecoder(this.opus);
      else {
        decoder = new AudioDecoder({
          output: data => this.onDecoded(session, data),
          error: () => this.replaceDecoder(session, 'decoder failed')
        });
        decoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
      }
      d = { decoder, lastFrame: -1, timer: null };
      this.decoders.set(session, d);
      if (user) this.setSessionGain(session, this.settings.userVolumes[userKey(user)] ?? 1);
    }
    // The browser took the decoder back (a tab in the background): start a new one
    if (d.decoder instanceof WasmDecoder === false && (d.decoder as AudioDecoder).state === 'closed') {
      this.replaceDecoder(p.session, 'decoder was closed');
      return this.receive(raw);
    }
    if (d.lastFrame >= 0 && p.frame > d.lastFrame + 6 && p.frame - d.lastFrame < 500) this.stats.lost++;
    d.lastFrame = p.frame;

    if (p.opus.length) {
      if (d.decoder instanceof WasmDecoder) {
        const pcm = d.decoder.decode(p.opus);
        if (pcm) {
          this.stats.decoded++;
          this.playback?.port.postMessage({ session: p.session, pcm }, [pcm.buffer]);
        }
      } else {
        try { d.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: p.frame * 10000, data: p.opus })); }
        catch { this.replaceDecoder(p.session, 'decoder failed'); }
      }
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

  private lastDecoderLog = 0;

  // The one way to replace a closed or failing decoder: dropped here, made again on the next packet
  private replaceDecoder(session: number, why: string): void {
    const now = performance.now();
    if (now - this.lastDecoderLog >= 1000) {
      this.lastDecoderLog = now;
      connLog.add(`${why}, replacing it`);
    }
    this.dropSession(session);
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
    this.syncInput();
    this.syncDenoisePause();
    if (on) this.start();
    else {
      this.playback?.port.postMessage({ drop: -1 });
      if (!this.client) this.stop();
    }
  }
}

export const voice = new VoiceEngine();
