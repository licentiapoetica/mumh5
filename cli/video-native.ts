import { SHARE, SHARE_DATA_ID, ShareAssembler, type ShareType } from '../src/core/share-signal.ts';
import type { MumbleClient } from '../src/core/client.ts';

export interface VideoFrame { session: number; width: number; height: number; data: Buffer }
export interface VideoSource { createTrack(): MediaStreamTrack; onFrame(frame: { width: number; height: number; data: Uint8ClampedArray }): void }
interface VideoSink { stop(): void; onframe: ((event: { frame: { width: number; height: number; data: Uint8Array } }) => void) | null }
interface Runtime {
  RTCPeerConnection: typeof RTCPeerConnection;
  MediaStream: typeof MediaStream;
  nonstandard: { RTCVideoSource: new () => VideoSource; RTCVideoSink: new (track: MediaStreamTrack) => VideoSink };
}
export type SignalSender = (receivers: number[], type: ShareType, text?: string) => Promise<void>;

export function frameBytes(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width % 2 || height % 2 || width > 4096 || height > 2160) {
    throw new Error('I420 dimensions must be even integers, 2..4096 wide and 2..2160 high');
  }
  return width * height * 3 / 2;
}

export class NativeVideo {
  private client: MumbleClient;
  private send: SignalSender;
  private event: (type: string, value: unknown) => void;
  private config: RTCConfiguration;
  private runtime?: Promise<Runtime>;
  private assembler = new ShareAssembler();
  private source?: VideoSource;
  private track?: MediaStreamTrack;
  private stream?: MediaStream;
  private peers = new Map<number, RTCPeerConnection>();
  private receiver?: { session: number; pc?: RTCPeerConnection; sinks: VideoSink[]; tracks: MediaStreamTrack[]; timer: ReturnType<typeof setTimeout> };
  private kind: 'screen' | 'camera' = 'camera';
  private width = 640;
  private height = 360;
  private closed = false;
  autoWatch = false;

  constructor(client: MumbleClient, send: SignalSender, config: RTCConfiguration, event: (type: string, value: unknown) => void) {
    this.client = client; this.send = send; this.config = config; this.event = event;
  }

  private load(): Promise<Runtime> {
    if (!this.runtime) this.runtime = (async () => {
      const module = '@roamhq/wrtc';
      try { const loaded = await import(module); return (loaded.default ?? loaded) as Runtime; }
      catch { this.runtime = undefined; throw new Error('Video needs the native runtime. Run npm run cli:setup first.'); }
    })();
    return this.runtime;
  }

  private sameChannel(session: number): boolean {
    const self = this.client.self, user = this.client.users.get(session);
    return !this.closed && !!self && !!user && session !== self.session && user.channelId === self.channelId;
  }
  private others(): number[] { return [...this.client.users.keys()].filter(id => this.sameChannel(id)); }

  async start(width = 640, height = 360, kind: 'screen' | 'camera' = 'camera'): Promise<void> {
    frameBytes(width, height);
    if (this.client.serverVersionNum < 0x010400) throw new Error('Video needs a Mumble 1.4 or newer server');
    const rtc = await this.load();
    if (this.closed) throw new Error('Client is closed');
    await this.stopSharing();
    this.width = width; this.height = height; this.kind = kind;
    this.source = new rtc.nonstandard.RTCVideoSource();
    this.track = this.source.createTrack(); this.stream = new rtc.MediaStream([this.track]);
    await this.send(this.others(), SHARE.on, kind);
    this.event('sharing', { session: this.client.session, kind, active: true });
  }

  push(data: Uint8Array): void {
    if (!this.source) throw new Error('Start video sharing before sending frames');
    if (data.byteLength !== frameBytes(this.width, this.height)) throw new Error('Video frame has the wrong I420 byte length');
    // The native binding checks the backing ArrayBuffer size, not the view size.
    // IPC buffers and file slices can share a larger backing allocation.
    const pixels = data.byteOffset === 0 && data.buffer.byteLength === data.byteLength
      ? new Uint8ClampedArray(data.buffer) : Uint8ClampedArray.from(data);
    this.source.onFrame({ width: this.width, height: this.height, data: pixels });
  }

  async stopSharing(): Promise<void> {
    if (!this.source) return;
    for (const pc of this.peers.values()) { pc.getTransceivers().forEach(t => t.stop()); pc.close(); }
    this.peers.clear(); this.track?.stop(); this.track = undefined; this.source = undefined; this.stream = undefined;
    await this.send(this.others(), SHARE.off);
    this.event('sharing', { session: this.client.session, active: false });
  }

  async watch(session: number): Promise<void> {
    if (!this.sameChannel(session)) throw new Error('Video peer must be another user in your voice channel');
    await this.load();
    await this.unwatch();
    const timer = setTimeout(() => { this.event('mediaError', { message: `Video from session ${session} timed out` }); void this.unwatch(); }, 20000);
    this.receiver = { session, sinks: [], tracks: [], timer };
    await this.send([session], SHARE.watch);
  }

  async unwatch(): Promise<void> {
    const old = this.receiver;
    this.receiver = undefined;
    if (!old) return;
    clearTimeout(old.timer); old.sinks.forEach(s => { s.onframe = null; s.stop(); }); old.tracks.forEach(t => t.stop()); old.pc?.getTransceivers().forEach(t => t.stop()); old.pc?.close();
    await this.send([old.session], SHARE.leave);
  }

  private gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete' || pc.signalingState === 'closed') done(); };
      const timer = setTimeout(done, 3000); pc.addEventListener('icegatheringstatechange', check);
    });
  }

  private async offer(session: number): Promise<void> {
    if (!this.stream || !this.sameChannel(session)) return;
    const stream = this.stream, rtc = await this.load();
    if (stream !== this.stream || this.closed) return;
    if (!this.peers.has(session) && this.peers.size >= 8) return;
    this.peers.get(session)?.close();
    const pc = new rtc.RTCPeerConnection(this.config); this.peers.set(session, pc);
    pc.addEventListener('connectionstatechange', () => {
      if (this.peers.get(session) !== pc) return;
      this.event('videoConnection', { session, direction: 'out', state: pc.connectionState });
      if (['failed', 'closed'].includes(pc.connectionState)) { pc.close(); this.peers.delete(session); }
    });
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    try {
      await pc.setLocalDescription(await pc.createOffer()); await this.gathered(pc);
      if (this.peers.get(session) === pc && pc.localDescription) await this.send([session], SHARE.offer, pc.localDescription.sdp);
    } catch (e) { pc.close(); if (this.peers.get(session) === pc) this.peers.delete(session); throw e; }
  }

  private async answer(session: number, sdp: string): Promise<void> {
    const receiver = this.receiver;
    if (receiver?.session !== session) return;
    const rtc = await this.load();
    if (receiver !== this.receiver) return;
    receiver.sinks.forEach(s => { s.onframe = null; s.stop(); }); receiver.tracks.forEach(t => t.stop()); receiver.pc?.getTransceivers().forEach(t => t.stop()); receiver.pc?.close(); receiver.sinks = []; receiver.tracks = [];
    const pc = new rtc.RTCPeerConnection(this.config); receiver.pc = pc;
    pc.addEventListener('track', e => {
      if (receiver !== this.receiver || e.track.kind !== 'video') return;
      const sink = new rtc.nonstandard.RTCVideoSink(e.track); receiver.sinks.push(sink); receiver.tracks.push(e.track);
      sink.onframe = ({ frame }) => {
        if (receiver !== this.receiver) return;
        try { if (frame.data.byteLength !== frameBytes(frame.width, frame.height)) return; } catch { return; }
        clearTimeout(receiver.timer);
        this.event('videoFrame', { session, width: frame.width, height: frame.height,
          data: Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength) } satisfies VideoFrame);
      };
    });
    pc.addEventListener('connectionstatechange', () => {
      if (receiver !== this.receiver) return;
      this.event('videoConnection', { session, direction: 'in', state: pc.connectionState });
      if (pc.connectionState === 'failed') void this.unwatch();
    });
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer()); await this.gathered(pc);
      if (receiver === this.receiver && pc.localDescription) await this.send([session], SHARE.answer, pc.localDescription.sdp);
    } catch (e) { await this.unwatch(); throw e; }
  }

  async receive(sender: number, id: string, data: Uint8Array): Promise<void> {
    if (id !== SHARE_DATA_ID || !this.sameChannel(sender)) return;
    const msg = await this.assembler.push(sender, data);
    if (!msg || !this.sameChannel(sender)) return;
    switch (msg.type) {
      case SHARE.on:
        this.event('sharing', { session: sender, kind: msg.text === 'camera' ? 'camera' : 'screen', active: true });
        if (this.autoWatch && !this.receiver) await this.watch(sender);
        break;
      case SHARE.off:
        this.event('sharing', { session: sender, active: false });
        if (this.receiver?.session === sender) await this.unwatch();
        break;
      case SHARE.who: if (this.source) await this.send([sender], SHARE.on, this.kind); break;
      case SHARE.watch: await this.offer(sender); break;
      case SHARE.leave: this.peers.get(sender)?.close(); this.peers.delete(sender); break;
      case SHARE.offer: if (msg.text) await this.answer(sender, msg.text); break;
      case SHARE.answer: if (msg.text) await this.peers.get(sender)?.setRemoteDescription({ type: 'answer', sdp: msg.text }); break;
    }
  }

  async entered(): Promise<void> {
    await this.unwatch();
    for (const pc of this.peers.values()) { pc.getTransceivers().forEach(t => t.stop()); pc.close(); } this.peers.clear();
    if (this.client.serverVersionNum < 0x010400) return;
    if (this.source) await this.send(this.others(), SHARE.on, this.kind);
    await this.send(this.others(), SHARE.who);
  }

  async userChanged(session: number): Promise<void> {
    if (this.sameChannel(session)) { if (this.source) await this.send([session], SHARE.on, this.kind); }
    else {
      this.peers.get(session)?.close(); this.peers.delete(session);
      if (this.receiver?.session === session) await this.unwatch();
    }
  }

  async close(): Promise<void> {
    await this.stopSharing(); await this.unwatch(); this.closed = true;
  }
}
