import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCodec } from '../src/core/proto.ts';
import { MumbleClient, type TextMessage } from '../src/core/client.ts';
import type { Transport } from '../src/core/transport.ts';
import { SHARE_DATA_ID, encodeShare, type ShareType } from '../src/core/share-signal.ts';
import { TEXT, TEXT_DATA_ID, MAX_HTML, TextAssembler, encodeText, isTextChannel, newId, parseMsg } from '../src/core/text-signal.ts';
import { escapeHtml } from '../src/core/html.ts';
import { openTls } from '../electron/tls-transport.ts';
import { udpChannel } from '../electron/udp-voice.ts';
import { botIdentity, trustServer } from './identity.ts';
import { DuplexAudio } from './audio.ts';
import { HeadlessVideo, type VideoFrame } from './video.ts';

export interface HeadlessOptions {
  host: string; port?: number; name: string; stateDir: string;
  password?: string; trustNew?: boolean; serverFingerprint?: string;
  channel?: string | number; tokens?: string[]; iceServers?: RTCIceServer[]; tcpOnly?: boolean;
}
export interface HeadlessText extends TextMessage { author: string; self: boolean; textChannel: boolean }
interface Events {
  text: [HeadlessText]; close: [string]; warning: [string];
  sharing: [{ session: number; kind?: string; active: boolean }];
  videoFrame: [VideoFrame]; videoConnection: [{ session: number; direction: 'in' | 'out'; state: string }];
  mediaError: [{ message: string }]; user: [{ session: number; name: string; channelId: number }];
}

export class HeadlessClient extends EventEmitter<Events> {
  readonly protocol = new MumbleClient(createCodec());
  readonly video: HeadlessVideo;
  audio: DuplexAudio | null = null;
  private options: HeadlessOptions;
  private tls?: ReturnType<typeof openTls>;
  private udp?: ReturnType<typeof udpChannel>;
  private queuedPackets = 0;
  private closed = false;
  private closing = false;
  private signalQueue: Promise<void> = Promise.resolve();
  private abort = new AbortController();
  private textAssembler = new TextAssembler();
  private textSeen = new Set<string>();
  private audioStarting?: Promise<DuplexAudio>;

  constructor(options: HeadlessOptions) {
    super(); this.options = options;
    this.video = new HeadlessVideo(this.protocol, (to, type, text) => this.shareSignal(to, type, text),
      { iceServers: options.iceServers ?? [] }, (type, value) => this.emit(type as keyof Events, value as never));
    const client = this.protocol;
    client.on('voice', data => this.audio?.receive(data));
    client.on('text', message => this.emit('text', { ...message, author: client.users.get(message.actor ?? -1)?.name ?? 'Server', self: message.actor === client.session, textChannel: false }));
    client.on('permissionDenied', d => this.emit('warning', `Permission denied: ${d.reason || d.type}`));
    client.on('pluginData', (sender, id, data) => {
      void this.video.receive(sender, id, data).catch(e => this.emit('mediaError', { message: (e as Error).message }));
      if (id === TEXT_DATA_ID) void this.receiveText(sender, data).catch(e => this.emit('warning', (e as Error).message));
    });
    client.on('user', (user, changed, _actor, isNew) => {
      if (!client.synced) return;
      this.emit('user', { session: user.session, name: user.name, channelId: user.channelId });
      if (!isNew && !changed.includes('channelId')) return;
      if (user.session === client.session) void this.video.entered().catch(e => this.emit('mediaError', { message: e.message }));
      else void this.video.userChanged(user.session).catch(e => this.emit('mediaError', { message: e.message }));
    });
    client.on('userRemove', user => { this.audio?.remove(user.session); void this.video.userChanged(user.session).catch(() => {}); });
    client.on('channel', channel => { if (channel.descriptionHash && !channel.description) client.requestBlob({ descriptions: [channel.id] }); });
    client.on('close', reason => {
      this.closed = true; this.abort.abort(); this.udp?.close(); this.audio?.close();
      void this.video.close().catch(() => {});
      this.emit('close', reason);
    });
  }

  static async connect(options: HeadlessOptions): Promise<HeadlessClient> {
    const bot = new HeadlessClient(options);
    try { await bot.open(); return bot; } catch (e) { await bot.close(); throw e; }
  }

  private async open(): Promise<void> {
    const opts = this.options, port = opts.port ?? 64738;
    const identity = await botIdentity(opts.stateDir, opts.name);
    await new Promise<void>((resolve, reject) => {
      const client = this.protocol;
      const transport: Transport = { onData: null, onClose: null, send: bytes => connection.send(bytes), close: () => { this.udp?.close(); connection.close(); } };
      const timer = setTimeout(() => { reject(new Error('Login timed out')); client.disconnect('Login timed out'); }, 20000);
      const synced = client.on('synced', () => { clearTimeout(timer); synced(); rejected(); ended(); resolve(); });
      const rejected = client.on('reject', (_type, reason) => { clearTimeout(timer); reject(new Error(`Login rejected: ${reason}`)); });
      const ended = client.on('close', reason => { clearTimeout(timer); synced(); rejected(); ended(); reject(new Error(reason)); });
      const connection = this.tls = openTls(opts.host, port, identity.certPem, identity.keyPem, {
        onSecure: info => {
          void trustServer(opts.stateDir, opts.host, port, info, opts.trustNew ?? false, opts.serverFingerprint).then(() => {
            if (this.closed) return;
            if (!opts.tcpOnly) { this.udp = udpChannel(info.address, info.port); transport.udp = this.udp; }
            client.forceTcp = opts.tcpOnly ?? false;
            client.connect(transport, { username: opts.name, password: opts.password, tokens: opts.tokens, os: 'mumh5 headless' });
          }).catch(e => { clearTimeout(timer); reject(e); connection.close(); });
        },
        onData: bytes => transport.onData?.(bytes),
        onClose: reason => { transport.onClose?.(reason); clearTimeout(timer); reject(new Error(reason)); }
      });
    });
    if (opts.channel != null) await this.join(opts.channel);
    await this.video.entered();
  }

  private connected(): void { if (!this.protocol.synced || this.closed || this.closing) throw new Error('Not connected'); }

  user(value: string | number): number {
    if (typeof value === 'number') { if (this.protocol.users.has(value)) return value; }
    else {
      const matches = [...this.protocol.users.values()].filter(u => u.name === value);
      if (matches.length === 1) return matches[0].session;
    }
    throw new Error(`User not found or ambiguous: ${value}`);
  }

  channel(value: string | number): number {
    if (typeof value === 'number') { if (this.protocol.channels.has(value)) return value; }
    else {
      const matches = [...this.protocol.channels.values()].filter(c => c.name === value || this.channelPath(c.id) === value);
      if (matches.length === 1) return matches[0].id;
    }
    throw new Error(`Channel not found or ambiguous: ${value}`);
  }

  channelPath(id: number): string {
    const names: string[] = [], seen = new Set<number>(); let channel = this.protocol.channels.get(id);
    while (channel && !seen.has(channel.id)) {
      seen.add(channel.id); if (channel.id !== 0) names.unshift(channel.name);
      channel = channel.parent == null ? undefined : this.protocol.channels.get(channel.parent);
    }
    return `/${names.join('/')}`;
  }

  async join(value: string | number): Promise<void> {
    this.connected(); const id = this.channel(value), client = this.protocol;
    if (isTextChannel(client.channels.get(id)?.description ?? '')) throw new Error('Text channels can be messaged without joining');
    if (client.self?.channelId === id) return;
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => { clearTimeout(timer); off(); denied(); closed(); error ? reject(error) : resolve(); };
      const off = client.on('user', user => { if (user.session === client.session && user.channelId === id) done(); });
      const denied = client.on('permissionDenied', d => done(new Error(`Could not join: ${d.reason || d.type}`)));
      const closed = client.on('close', reason => done(new Error(reason)));
      const timer = setTimeout(() => done(new Error('Joining channel timed out')), 10000);
      client.joinChannel(id);
    });
  }

  async sendText(text: string, target: { user?: string | number; channel?: string | number; html?: boolean } = {}): Promise<void> {
    this.connected();
    if (target.user != null && target.channel != null) throw new Error('Choose a user or channel, not both');
    if (typeof text !== 'string' || !text.trim()) throw new Error('Message text must not be empty');
    const html = target.html ? text : escapeHtml(text).replace(/\r?\n/g, '<br/>');
    const channel = target.channel != null ? this.channel(target.channel) : this.protocol.self?.channelId ?? 0;
    if (target.user == null && isTextChannel(this.protocol.channels.get(channel)?.description ?? '')) {
      if (html.length > MAX_HTML) throw new Error('Text-channel message is too long');
      const id = newId(); this.textSeen.add(id);
      if (this.textSeen.size > 2000) this.textSeen.delete(this.textSeen.values().next().value!);
      const packets = await encodeText(TEXT.msg, { i: id, c: channel, h: html });
      await this.plugins([...this.protocol.users.keys()].filter(id => id !== this.protocol.session), TEXT_DATA_ID, packets);
    } else {
      const limit = /<img/i.test(html) ? this.protocol.config.imageMessageLength : this.protocol.config.messageLength;
      if (limit && html.length > limit) throw new Error(`Message exceeds server limit (${limit} characters)`);
      this.protocol.sendText(target.user != null ? { users: [this.user(target.user)] } : { channels: [channel] }, html);
      await this.protocol.flushed();
    }
  }

  async enableAudio(bitrate = 40000): Promise<DuplexAudio> {
    this.connected();
    if (!Number.isInteger(bitrate) || bitrate < 6000 || bitrate > 128000) throw new Error('Audio bitrate must be 6000..128000');
    if (this.audio) return this.audio;
    if (!this.audioStarting) this.audioStarting = DuplexAudio.create(this.protocol, bitrate).then(audio => {
      if (this.closed) { audio.close(); throw new Error('Client closed while audio was loading'); }
      this.audio = audio; return audio;
    }).finally(() => { this.audioStarting = undefined; });
    return this.audioStarting;
  }

  async disableAudio(): Promise<void> {
    await this.audioStarting?.catch(() => {});
    this.audio?.close(); this.audio = null;
  }

  private shareSignal(to: number[], type: ShareType, text?: string): Promise<void> {
    return encodeShare(type, text).then(packets => this.plugins(to, SHARE_DATA_ID, packets));
  }

  private plugins(to: number[], id: string, packets: Uint8Array[]): Promise<void> {
    if (!to.length || this.closed) return Promise.resolve();
    if (this.protocol.serverVersionNum < 0x010400) return Promise.reject(new Error('Plugin messages need a Mumble 1.4 or newer server'));
    if (this.queuedPackets + packets.length > 64) return Promise.reject(new Error('Plugin message queue is full'));
    this.queuedPackets += packets.length;
    const send = this.signalQueue.then(async () => {
      for (const packet of packets) {
        if (this.closed) return;
        const live = to.filter(id => this.protocol.users.has(id));
        if (live.length) this.protocol.sendPluginData(live, id, packet);
        await delay(300, undefined, { signal: this.abort.signal });
      }
    });
    this.signalQueue = send.finally(() => { this.queuedPackets -= packets.length; }).catch(() => {});
    return send;
  }

  private async receiveText(sender: number, data: Uint8Array): Promise<void> {
    const signal = await this.textAssembler.push(sender, data);
    const user = this.protocol.users.get(sender);
    if (!signal || !user || this.closed) return;
    if (signal.type === TEXT.hello) { await this.plugins([sender], TEXT_DATA_ID, await encodeText(TEXT.here)); return; }
    if (signal.type !== TEXT.msg) return;
    const message = parseMsg(signal.text);
    if (!message || this.textSeen.has(message.i) || !isTextChannel(this.protocol.channels.get(message.c)?.description ?? '')) return;
    this.textSeen.add(message.i); if (this.textSeen.size > 2000) this.textSeen.delete(this.textSeen.values().next().value!);
    this.emit('text', { actor: sender, author: user.name, self: sender === this.protocol.session, textChannel: true,
      channels: [message.c], sessions: [], trees: [], html: message.h, time: Date.now() });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true; this.closed = true; this.abort.abort();
    this.audio?.close();
    await this.video.close().catch(() => {});
    this.protocol.disconnect(); this.tls?.close();
  }
}
