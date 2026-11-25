// WebKitGTK 2.54 exposes capture and codecs. Rust owns ICE, DTLS, SRTP and RTP for its shares.
import type { OutgoingShare, SharePeer } from './share-peer.ts';
import { registerPainter, type Painter } from './stream-picture.ts';
import { MumbleClient } from '../core/client.ts';

export interface NativeShareRtc {
  open(id: string, config: RTCConfiguration, source: string | null, audio: boolean, notify: (event: string) => void): Promise<void>;
  negotiate(id: string, op: 'offer' | 'answer' | 'accept', sdp?: string): Promise<string>;
  stats(id: string): Promise<Record<string, RTCStats>>;
  close(id: string): Promise<void>;
  send(source: string, bytes: Uint8Array): Promise<void>;
  receive(id: string): Promise<ArrayBuffer>;
}

const VIDEO = 0, AUDIO = 1, HEADER = 5;
const VP8: VideoDecoderConfig = { codec: 'vp8' };
const OPUS = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };
const sources = new WeakMap<MediaStreamTrack, Capture>();
const audioCodecs = () => typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined';

class Capture {
  readonly id = crypto.randomUUID();
  readonly clients = new Set<NativeSharePeer>();
  readonly audio: boolean;
  private video = document.createElement('video');
  private track: MediaStreamTrack;
  private encoder: VideoEncoder | null = null;
  private audioEncoder?: AudioEncoder;
  private audioContext?: AudioContext;
  private audioInput?: ScriptProcessorNode;
  private stopTicks?: () => void;
  private ticksAt = 0;
  private copy = document.createElement('canvas');
  private copyDraw = this.copy.getContext('2d');
  private settings = '';
  private keyframe = true;
  private lastKey = 0;
  private lastFrame = 0;
  private pending = [false, false];
  private closed = false;
  private bitrate: number;

  constructor(private api: NativeShareRtc, options: OutgoingShare, track: MediaStreamTrack) {
    this.track = track;
    this.bitrate = options.bitrate;
    this.audio = options.stream.getAudioTracks().length > 0 && audioCodecs();
    // Unmuted at volume 0: WebKitGTK suspends a muted video that is not on screen. It holds
    // the picture only, so there is no sound to hear anyway.
    this.video.muted = false;
    this.video.volume = 0;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([track]);
    this.video.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;left:0;pointer-events:none';
    this.video.setAttribute('aria-hidden', 'true');
    document.body.append(this.video);
    void this.video.play().catch(() => this.fail());
    this.tick();
    if (this.audio) this.captureAudio(options.stream);
    sources.set(track, this);
  }

  private fail(): void {
    for (const peer of [...this.clients]) peer.failed();
  }

  // WebKitGTK never calls requestVideoFrameCallback for these videos, and frames taken from a
  // video element fail to encode there, so pictures are copied through a canvas at the frame
  // rate. The timer is a worker's where the app set one up, which keeps going in the background.
  private tick(): void {
    const fps = Math.min(60, Math.max(1, Math.round(this.track.getSettings().frameRate ?? 30)));
    if (this.stopTicks && this.ticksAt === fps) return;
    this.stopTicks?.();
    this.ticksAt = fps;
    this.stopTicks = MumbleClient.every(Math.round(1000 / fps), () => this.frame(performance.now()));
  }

  private frame = (now: number) => {
    if (this.closed) return;
    this.tick();
    if (this.pending[VIDEO] || (this.encoder?.encodeQueueSize ?? 0) > 1) return;
    const { videoWidth: inputWidth, videoHeight: inputHeight } = this.video;
    if (!inputWidth || !inputHeight) return;
    const scale = Math.min(1, 1920 / inputWidth, 1080 / inputHeight);
    const width = Math.max(2, 2 * Math.round(inputWidth * scale / 2));
    const height = Math.max(2, 2 * Math.round(inputHeight * scale / 2));
    const fps = Math.max(1, this.track.getSettings().frameRate ?? 30);
    const duration = Math.min(250000, Math.max(1, Math.round(this.lastFrame ? (now - this.lastFrame) * 1000 : 1000000 / fps)));
    this.lastFrame = now;
    try {
      const settings = `${width}:${height}:${fps}:${this.bitrate}`;
      if (!this.encoder || this.encoder.state === 'closed') {
        this.encoder = new VideoEncoder({
          output: chunk => this.send(VIDEO, chunk, Math.round(1000000 / fps)),
          error: () => this.fail()
        });
        this.settings = '';
      }
      if (this.settings !== settings) {
        this.encoder.configure({ ...VP8, width, height, bitrate: this.bitrate, framerate: fps, latencyMode: 'realtime' });
        this.settings = settings;
        this.keyframe = true;
      }
      if (this.copy.width !== width || this.copy.height !== height) {
        this.copy.width = width;
        this.copy.height = height;
      }
      this.copyDraw?.drawImage(this.video, 0, 0, width, height);
      const image = new VideoFrame(this.copy, { timestamp: Math.round(now * 1000), duration });
      const keyFrame = this.keyframe || now - this.lastKey >= 2000;
      try {
        this.encoder.encode(image, { keyFrame });
        if (keyFrame) { this.keyframe = false; this.lastKey = now; }
      } finally {
        image.close();
      }
    } catch {
      this.fail();
    }
  };

  private captureAudio(stream: MediaStream): void {
    const context = this.audioContext = new AudioContext({ sampleRate: OPUS.sampleRate });
    const encoder = this.audioEncoder = new AudioEncoder({
      output: chunk => this.send(AUDIO, chunk, 20000),
      error: () => this.fail()
    });
    encoder.configure({ ...OPUS, bitrate: 96000 });
    const input = context.createMediaStreamSource(stream);
    const processor = this.audioInput = context.createScriptProcessor(1024, 2, 1);
    let frames = 0;
    processor.onaudioprocess = e => {
      const { inputBuffer } = e;
      const timestamp = Math.round(frames * 1000000 / OPUS.sampleRate);
      frames += inputBuffer.length;
      if (this.closed || encoder.state !== 'configured' || encoder.encodeQueueSize > 4) return;
      const data = new Float32Array(inputBuffer.length * 2);
      data.set(inputBuffer.getChannelData(0));
      data.set(inputBuffer.getChannelData(1), inputBuffer.length);
      const audio = new AudioData({
        ...OPUS, format: 'f32-planar', numberOfFrames: inputBuffer.length, timestamp, data
      });
      try { encoder.encode(audio); } finally { audio.close(); }
    };
    const silent = context.createGain();
    silent.gain.value = 0;
    input.connect(processor).connect(silent).connect(context.destination);
    void context.resume().catch(() => {});
  }

  private send(kind: number, chunk: EncodedVideoChunk | EncodedAudioChunk, fallbackDuration: number): void {
    if (this.closed) return;
    if (this.pending[kind]) {
      if (kind === VIDEO) this.keyframe = true;
      return;
    }
    const bytes = new Uint8Array(HEADER + chunk.byteLength);
    bytes[0] = kind;
    new DataView(bytes.buffer).setUint32(1, Math.max(1, Math.min(250000, chunk.duration ?? fallbackDuration)), true);
    chunk.copyTo(bytes.subarray(HEADER));
    this.pending[kind] = true;
    void this.api.send(this.id, bytes).catch(() => this.fail()).finally(() => { this.pending[kind] = false; });
  }

  requestKeyframe(): void { this.keyframe = true; }
  setBitrate(bitrate: number): void { this.bitrate = bitrate; }

  async replace(track: MediaStreamTrack): Promise<void> {
    if (this.closed || this.track === track) return;
    sources.delete(this.track);
    this.track = track;
    sources.set(track, this);
    this.video.srcObject = new MediaStream([track]);
    this.keyframe = true;
    await this.video.play();
  }

  detach(peer: NativeSharePeer): void {
    this.clients.delete(peer);
    if (this.clients.size || this.closed) return;
    this.closed = true;
    sources.delete(this.track);
    this.stopTicks?.();
    this.video.srcObject = null;
    this.video.remove();
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    if (this.audioEncoder && this.audioEncoder.state !== 'closed') this.audioEncoder.close();
    if (this.audioInput) this.audioInput.onaudioprocess = null;
    void this.audioContext?.close().catch(() => {});
  }
}

// Decoded pictures go onto the canvases of the views showing them and sound straight to the
// speakers: WebKitGTK plays no stream made by the page (see stream-picture.ts). The stream
// handed to the app carries placeholder tracks, so it knows there is a picture and sound.
class Playback implements Painter {
  private canvases = new Set<HTMLCanvasElement>();
  private stream?: MediaStream;
  private placeholder = document.createElement('canvas');
  private videoTrack?: MediaStreamTrack;
  private audioTrack?: MediaStreamTrack;
  private video?: VideoDecoder;
  private audio?: AudioDecoder;
  private audioContext?: AudioContext;
  private audioOutput?: GainNode;
  private volume = 1;
  private last?: VideoFrame;
  private playAt = 0;
  private timestamp = [0, 0];
  private needsKeyframe = true;
  width = 0;
  height = 0;

  constructor(private changed: (stream: MediaStream) => void) {}

  private emit(): void {
    if (!this.videoTrack) return;
    this.stream = new MediaStream(this.audioTrack ? [this.videoTrack, this.audioTrack] : [this.videoTrack]);
    registerPainter(this.stream, this);
    this.changed(this.stream);
  }

  add(canvas: HTMLCanvasElement): void {
    this.canvases.add(canvas);
    if (this.last) this.paint(canvas, this.last);
  }
  remove(canvas: HTMLCanvasElement): void { this.canvases.delete(canvas); }
  setVolume(volume: number): void {
    this.volume = volume;
    if (this.audioOutput) this.audioOutput.gain.value = volume;
  }

  private paint(canvas: HTMLCanvasElement, frame: VideoFrame): void {
    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
    }
    canvas.getContext('2d')?.drawImage(frame, 0, 0);
  }

  private drawFrame = (frame: VideoFrame) => {
    this.last?.close();
    this.last = frame;
    this.width = frame.displayWidth;
    this.height = frame.displayHeight;
    for (const canvas of this.canvases) {
      try { this.paint(canvas, frame); } catch { /* a canvas of a closed window */ }
    }
    if (!this.videoTrack) {
      this.videoTrack = this.placeholder.captureStream(0).getVideoTracks()[0];
      this.emit();
    }
  };

  private playAudio = (data: AudioData) => {
    try {
      const context = this.audioContext!;
      const now = context.currentTime;
      if (this.playAt > now + 0.4) return;
      if (this.playAt < now) this.playAt = now + 0.08;
      const buffer = context.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate);
      for (let i = 0; i < data.numberOfChannels; i++) data.copyTo(buffer.getChannelData(i), { planeIndex: i, format: 'f32-planar' });
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioOutput!);
      source.start(this.playAt);
      this.playAt += buffer.duration;
    } finally {
      data.close();
    }
  };

  decode(bytes: ArrayBuffer): void {
    if (bytes.byteLength <= HEADER) return;
    const header = new DataView(bytes);
    const kind = header.getUint8(0), duration = header.getUint32(1, true);
    if (kind !== VIDEO && kind !== AUDIO) return;
    const timestamp = this.timestamp[kind];
    this.timestamp[kind] += duration;
    const data = new Uint8Array(bytes, HEADER);
    if (kind === VIDEO) {
      const key = !(data[0] & 1);
      if (!key && this.needsKeyframe) return;
      if ((this.video?.decodeQueueSize ?? 0) > 4) {
        this.video?.reset();
        this.video?.configure(VP8);
        this.needsKeyframe = true;
        if (!key) return;
      }
      if (!this.video || this.video.state === 'closed') {
        this.video = new VideoDecoder({ output: this.drawFrame, error: () => { this.needsKeyframe = true; } });
        this.video.configure(VP8);
      }
      this.video.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, duration, data }));
      this.needsKeyframe = false;
    } else if (audioCodecs()) {
      if (!this.audioContext) {
        const context = this.audioContext = new AudioContext({ sampleRate: OPUS.sampleRate });
        this.audioOutput = context.createGain();
        this.audioOutput.gain.value = this.volume;
        this.audioOutput.connect(context.destination);
        // Only marks the stream as having sound; nothing plays through it
        this.audioTrack = context.createMediaStreamDestination().stream.getAudioTracks()[0];
        void context.resume().catch(() => {});
        this.emit();
      }
      if (!this.audio || this.audio.state === 'closed') {
        this.audio = new AudioDecoder({ output: this.playAudio, error: () => {} });
        this.audio.configure(OPUS);
      }
      if (this.audio.decodeQueueSize < 8) this.audio.decode(new EncodedAudioChunk({ type: 'key', timestamp, duration, data }));
    }
  }

  close(): void {
    this.canvases.clear();
    this.last?.close();
    this.last = undefined;
    this.videoTrack?.stop();
    this.audioTrack?.stop();
    if (this.video && this.video.state !== 'closed') this.video.close();
    if (this.audio && this.audio.state !== 'closed') this.audio.close();
    void this.audioContext?.close().catch(() => {});
  }
}

export class NativeSharePeer implements SharePeer {
  private id = crypto.randomUUID();
  private ready: Promise<void>;
  private source?: Capture;
  private player?: Playback;
  private closed = false;
  waitingForAnswer = false;
  onState?: (state: RTCPeerConnectionState) => void;
  onStream?: (stream: MediaStream) => void;

  constructor(private api: NativeShareRtc, config: RTCConfiguration, outgoing?: OutgoingShare) {
    if (outgoing) {
      const track = outgoing.stream.getVideoTracks()[0];
      if (!track) throw new Error('No video track to share');
      this.source = sources.get(track) ?? new Capture(api, outgoing, track);
      this.source.clients.add(this);
    } else {
      this.player = new Playback(stream => { if (!this.closed) this.onStream?.(stream); });
    }
    this.ready = api.open(this.id, config, this.source?.id ?? null, this.source?.audio ?? false, event => {
      if (this.closed) return;
      if (event === 'keyframe') this.source?.requestKeyframe();
      else {
        if (event === 'connected') this.source?.requestKeyframe();
        this.onState?.(event as RTCPeerConnectionState);
      }
    });
  }

  async offer(): Promise<string> {
    await this.ready;
    const sdp = await this.api.negotiate(this.id, 'offer');
    this.waitingForAnswer = true;
    return sdp;
  }

  async answer(sdp: string): Promise<string> {
    await this.ready;
    if (!this.closed) void this.receive();
    return this.api.negotiate(this.id, 'answer', sdp);
  }

  async accept(sdp: string): Promise<void> {
    this.waitingForAnswer = false;
    await this.api.negotiate(this.id, 'accept', sdp);
  }

  private async receive(): Promise<void> {
    try {
      while (!this.closed) {
        const bytes = await this.api.receive(this.id);
        if (this.closed || !bytes.byteLength) return;
        this.player?.decode(bytes);
      }
    } catch {
      if (!this.closed) this.failed();
    }
  }

  failed(): void { if (!this.closed) this.onState?.('failed'); }
  async replaceVideo(track: MediaStreamTrack): Promise<void> { await this.source?.replace(track); }
  async setBitrate(bitrate: number): Promise<void> { this.source?.setBitrate(bitrate); }
  async stats(): Promise<RTCStatsReport> {
    await this.ready;
    return new Map(Object.entries(await this.api.stats(this.id))) as RTCStatsReport;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waitingForAnswer = false;
    this.source?.detach(this);
    this.player?.close();
    void this.ready.then(() => this.api.close(this.id)).catch(() => {});
  }
}
