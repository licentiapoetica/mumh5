import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SHARE, SHARE_DATA_ID, ShareAssembler } from '../src/core/share-signal.ts';
import type { MumbleClient } from '../src/core/client.ts';
import type { SignalSender } from './video-native.ts';
import { frameBytes } from './video-native.ts';
export { frameBytes, type VideoFrame } from './video-native.ts';

// A native video failure must not take down a long-running bot's text/voice host.
// Only active video starts this Node worker; no browser or display is involved.
export class HeadlessVideo {
  private client: MumbleClient;
  private send: SignalSender;
  private config: RTCConfiguration;
  private event: (type: string, value: unknown) => void;
  private worker?: ChildProcess;
  private exited?: Promise<void>;
  private nextId = 0;
  private pending = new Map<number, { resolve(value?: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private assembler = new ShareAssembler();
  private watching?: number;
  private closed = false;
  private inputBusy = false;
  private automatic = false;
  private frameSize = 0;

  constructor(client: MumbleClient, send: SignalSender, config: RTCConfiguration, event: (type: string, value: unknown) => void) {
    this.client = client; this.send = send; this.config = config; this.event = event;
  }
  get autoWatch(): boolean { return this.automatic; }
  set autoWatch(value: boolean) { this.automatic = value; this.worker?.send({ op: 'automatic', value }); }

  private sameChannel(session: number): boolean {
    const self = this.client.self, user = this.client.users.get(session);
    return !this.closed && !!self && !!user && session !== self.session && user.channelId === self.channelId;
  }
  private others(): number[] { return [...this.client.users.keys()].filter(id => this.sameChannel(id)); }

  private sync(): void {
    this.worker?.send({ op: 'state', session: this.client.session, version: this.client.serverVersionNum,
      users: [...this.client.users.values()].map(u => ({ session: u.session, name: u.name, channelId: u.channelId })) });
  }

  private ensure(): void {
    if (this.closed) throw new Error('Video client is closed');
    if (this.worker) return;
    const bundled = new URL('./video-worker.mjs', import.meta.url);
    const worker = fork(existsSync(bundled) ? bundled : new URL('./video-worker.ts', import.meta.url), [], {
      serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [],
      env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' }
    });
    this.worker = worker;
    worker.stderr?.on('data', bytes => this.event('mediaError', { message: String(bytes).slice(0, 4000) }));
    worker.on('error', error => this.event('mediaError', { message: error.message }));
    worker.on('message', (message: any) => {
      if (message.op === 'signal') {
        void this.send(message.to, message.type, message.text).then(() => {
          if (worker.connected) worker.send({ op: 'signal-reply', id: message.id });
        }, e => { if (worker.connected) worker.send({ op: 'signal-reply', id: message.id, error: e.message }); });
      } else if (message.op === 'event') this.event(message.type, message.value);
      else if (message.op === 'reply') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value);
      }
    });
    this.exited = new Promise(resolve => worker.on('exit', (code, signal) => {
      if (this.worker === worker) { this.worker = undefined; this.watching = undefined; this.inputBusy = false; this.frameSize = 0; }
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Native video worker stopped')); }
      this.pending.clear();
      if (!this.closed && (code !== 0 || signal)) this.event('mediaError', { message: `Native video worker exited (${signal ?? code})` });
      resolve();
    }));
    this.sync();
    worker.send({ op: 'config', config: this.config, automatic: this.automatic });
  }

  private request(op: string, values: Record<string, unknown> = {}): Promise<unknown> {
    this.ensure();
    if (this.pending.size >= 64) return Promise.reject(new Error('Native video command queue is full'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Native video ${op} timed out`)); }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.send({ op, id, ...values }, error => {
        if (!error) return;
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }

  async start(width = 640, height = 360, kind: 'screen' | 'camera' = 'camera'): Promise<void> {
    const size = frameBytes(width, height);
    if (this.client.serverVersionNum < 0x010400) throw new Error('Video needs a Mumble 1.4 or newer server');
    this.frameSize = 0;
    this.ensure(); this.sync(); await this.request('start', { width, height, kind }); this.frameSize = size;
  }

  push(data: Uint8Array): boolean {
    if (!this.worker || this.closed || !this.frameSize) throw new Error('Start sharing video before pushing frames');
    if (data.byteLength !== this.frameSize) throw new Error('Video frame has the wrong I420 byte length');
    if (this.inputBusy) return false;
    this.inputBusy = true;
    this.worker.send({ op: 'frame', data }, error => {
      this.inputBusy = false;
      if (error && !this.closed) this.event('mediaError', { message: error.message });
    });
    return true;
  }

  async stopSharing(): Promise<void> { this.frameSize = 0; if (this.worker) await this.request('stop'); }
  async watch(session: number): Promise<void> {
    if (!this.sameChannel(session)) throw new Error('Video peer must be another user in your voice channel');
    this.ensure(); this.sync(); await this.request('watch', { session }); this.watching = session;
  }
  async unwatch(): Promise<void> { if (this.worker) await this.request('unwatch'); this.watching = undefined; }

  async receive(sender: number, id: string, data: Uint8Array): Promise<void> {
    if (id !== SHARE_DATA_ID || !this.sameChannel(sender)) return;
    if (this.worker) { await this.request('receive', { sender, data }); return; }
    const msg = await this.assembler.push(sender, data);
    if (!msg || !this.sameChannel(sender)) return;
    if (msg.type === SHARE.on || msg.type === SHARE.off) {
      this.event('sharing', { session: sender, kind: msg.text === 'camera' ? 'camera' : 'screen', active: msg.type === SHARE.on });
      if (msg.type === SHARE.on && this.automatic && !this.watching) await this.watch(sender);
    }
  }

  async entered(): Promise<void> {
    if (this.worker) { this.sync(); await this.request('entered'); }
    else if (this.client.serverVersionNum >= 0x010400) await this.send(this.others(), SHARE.who);
  }
  async userChanged(session: number): Promise<void> { if (this.worker) { this.sync(); await this.request('user', { session }); } }

  async close(): Promise<void> {
    if (this.closed) return;
    const worker = this.worker;
    if (!worker) { this.closed = true; return; }
    const request = this.request('close'); this.closed = true;
    const timer = setTimeout(() => worker.kill('SIGKILL'), 5000);
    try { await request.catch(() => {}); await this.exited; }
    finally { clearTimeout(timer); }
  }
}
