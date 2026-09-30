import { Emitter } from './emitter.ts';
import { FrameReader, frame, type Codec, type MessageName } from './proto.ts';
import type { Transport } from './transport.ts';

export const CLIENT_RELEASE = 'mumh5 0.1.0';
const VERSION = { major: 1, minor: 5, patch: 0 };
const PING_INTERVAL_MS = 15000;

// Murmur drops these messages without telling the client when they come too fast
// (leaky bucket, defaults messageburst=5 and messagelimit=1/s). Its bucket restarts its timer
// on every limited message and only leaks whole seconds, discarding the rest; the client
// mirrors exactly that and queues instead of losing messages. The margin absorbs network jitter.
const RATE_BURST = 5;
const RATE_LEAK_MS = 1000;
const RATE_MARGIN_MS = 250;
const RATE_LIMITED = new Set<MessageName>(['TextMessage', 'ChannelState', 'ACL', 'Version']);

export interface Channel {
  id: number;
  parent: number | null;
  name: string;
  description: string;
  descriptionHash: Uint8Array | null;
  position: number;
  temporary: boolean;
  links: Set<number>;
  maxUsers: number;
  canEnter: boolean;
}

export interface User {
  session: number;
  name: string;
  userId: number | null;
  channelId: number;
  mute: boolean;
  deaf: boolean;
  suppress: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  prioritySpeaker: boolean;
  recording: boolean;
  comment: string;
  commentHash: Uint8Array | null;
  texture: Uint8Array | null;
  textureHash: Uint8Array | null;
  hash: string;
}

export interface TextMessage {
  actor: number | null;
  sessions: number[];
  channels: number[];
  trees: number[];
  html: string;
  time: number;
}

export interface ServerConfig {
  allowHtml: boolean;
  messageLength: number;
  imageMessageLength: number;
  maxUsers: number;
  recordingAllowed: boolean;
}

export interface Denial {
  type: number;
  permission: number;
  reason: string;
  channelId: number | null;
  session: number | null;
  name: string;
}

// ACL permission bits, as used in PermissionDenied.permission
export const PERMISSIONS: Record<number, string> = {
  0x1: 'Write ACL', 0x2: 'Traverse', 0x4: 'Enter', 0x8: 'Speak', 0x10: 'Mute/Deafen', 0x20: 'Move',
  0x40: 'Make channel', 0x80: 'Link channel', 0x100: 'Whisper', 0x200: 'Text message',
  0x400: 'Make temporary channel', 0x800: 'Listen', 0x10000: 'Kick', 0x20000: 'Ban',
  0x40000: 'Register', 0x80000: 'Register self', 0x100000: 'Reset user content'
};

// Human-readable text for a PermissionDenied message
export function describeDenial(d: Denial, channelName?: string): string {
  switch (d.type) {
    case 0: return d.reason || 'Denied by the server';
    case 1: {
      const what = PERMISSIONS[d.permission] ?? 'this action';
      return `You do not have permission for ${what}${channelName ? ` in ${channelName}` : ''}`;
    }
    case 2: return 'The SuperUser cannot be modified';
    case 3: return 'Invalid channel name';
    case 4: return 'Message too long for this server';
    case 6: return 'Not allowed in a temporary channel';
    case 7: return 'This needs a registered certificate';
    case 8: return `Invalid user name${d.name ? `: ${d.name}` : ''}`;
    case 9: return 'The channel is full';
    case 10: return 'Channels are nested too deeply';
    case 11: return 'The server has reached its channel limit';
    default: return d.reason || 'Denied by the server';
  }
}

export interface ConnectOptions {
  username: string;
  password?: string;
  tokens?: string[];
  os?: string;
  osVersion?: string;
}

type ClientEvents = {
  synced: () => void;
  channel: (ch: Channel) => void;
  channelRemove: (id: number) => void;
  user: (user: User, changed: string[], actor: number | null, isNew: boolean) => void;
  userRemove: (user: User, actor: number | null, reason: string, ban: boolean) => void;
  text: (msg: TextMessage) => void;
  pluginData: (sender: number, dataId: string, data: Uint8Array) => void;
  permissionDenied: (msg: Denial) => void;
  reject: (type: number, reason: string) => void;
  voice: (packet: Uint8Array) => void;
  userStats: (stats: any) => void;
  ping: (rttMs: number) => void;
  close: (reason: string) => void;
  message: (name: MessageName, msg: any) => void;
};

export class MumbleClient extends Emitter<ClientEvents> {
  readonly channels = new Map<number, Channel>();
  readonly users = new Map<number, User>();
  session: number | null = null;
  synced = false;
  welcomeText = '';
  maxBandwidth = 0;
  serverVersion = '';
  // Numeric server version (major << 16 | minor << 8 | patch), 0 until known
  serverVersionNum = 0;
  rtt = 0;
  config: ServerConfig = { allowHtml: true, messageLength: 5000, imageMessageLength: 131072, maxUsers: 0, recordingAllowed: true };

  private transport: Transport | null = null;
  private reader = new FrameReader();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private bucket = 0;          // our estimate of the server's bucket level
  private lastLimited = 0;     // when the last rate-limited message was sent
  private queue: Uint8Array[] = [];
  private queueTimer: ReturnType<typeof setTimeout> | null = null;

  private codec: Codec;

  constructor(codec: Codec) {
    super();
    this.codec = codec;
  }

  get self(): User | null {
    return this.session == null ? null : this.users.get(this.session) ?? null;
  }

  connect(transport: Transport, opts: ConnectOptions): void {
    this.transport = transport;
    transport.onData = chunk => {
      try {
        this.reader.push(chunk, (id, body) => this.handleFrame(id, body));
      } catch (e) {
        this.disconnect(`Protocol error: ${(e as Error).message}`);
      }
    };
    transport.onClose = reason => this.handleClose(reason);

    const { major, minor, patch } = VERSION;
    this.send('Version', {
      version_v1: (major << 16) | (minor << 8) | patch,
      version_v2: major * 2 ** 48 + minor * 2 ** 32 + patch * 2 ** 16,
      release: CLIENT_RELEASE,
      os: opts.os ?? 'unknown',
      os_version: opts.osVersion ?? ''
    });
    this.send('Authenticate', {
      username: opts.username,
      password: opts.password ?? '',
      tokens: opts.tokens ?? [],
      opus: true,
      client_type: 0
    });
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
  }

  disconnect(reason = 'Disconnected'): void {
    this.transport?.close();
    this.handleClose(reason);
  }

  send(name: MessageName, payload: Record<string, unknown>): void {
    if (!this.transport || this.closed) return;
    const bytes = this.codec.encode(name, payload);
    // Only changes to our own user state count against the bucket
    const ownState = name === 'UserState' && (payload.session == null || payload.session === this.session);
    if (RATE_LIMITED.has(name) || ownState) this.sendPaced(bytes);
    else this.transport.send(bytes);
  }

  // Messages still waiting for the rate limit
  get queued(): number {
    return this.queue.length;
  }

  // Bucket level the server will compute when the next message arrives now
  private levelAt(now: number): number {
    const leaked = Math.floor(Math.max(0, now - this.lastLimited - RATE_MARGIN_MS) / RATE_LEAK_MS);
    return Math.max(0, this.bucket - leaked);
  }

  private sendPaced(bytes: Uint8Array): void {
    this.queue.push(bytes);
    this.drain();
  }

  private drain(): void {
    if (this.queueTimer || this.closed) return;
    while (this.queue.length) {
      const now = Date.now();
      const level = this.levelAt(now);
      if (level + 1 > RATE_BURST) break;
      this.bucket = level + 1;
      this.lastLimited = now;
      this.transport?.send(this.queue.shift()!);
    }
    if (this.queue.length) {
      // A full bucket leaks one message once a whole second (plus margin) has passed
      const wait = this.lastLimited + RATE_LEAK_MS + RATE_MARGIN_MS - Date.now() + 5;
      this.queueTimer = setTimeout(() => { this.queueTimer = null; this.drain(); }, Math.max(5, wait));
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  sendText(target: { channels?: number[]; users?: number[]; trees?: number[] }, html: string): void {
    this.send('TextMessage', {
      session: target.users ?? [],
      channel_id: target.channels ?? [],
      tree_id: target.trees ?? [],
      message: html
    });
  }

  joinChannel(channelId: number): void {
    if (this.session == null) return;
    this.send('UserState', { session: this.session, channel_id: channelId });
  }

  setSelfMute(mute: boolean): void {
    // Unmuting also undeafens, matching the desktop client
    this.send('UserState', mute ? { self_mute: true } : { self_mute: false, self_deaf: false });
  }

  setSelfDeaf(deaf: boolean): void {
    // Deafening implies muting
    this.send('UserState', deaf ? { self_mute: true, self_deaf: true } : { self_deaf: false });
  }

  setComment(comment: string): void {
    if (this.session == null) return;
    this.send('UserState', { session: this.session, comment });
  }

  kick(session: number, reason: string, ban = false): void {
    this.send('UserRemove', { session, reason, ban });
  }

  // Server-side (admin) state of another user
  setUserState(session: number, state: { mute?: boolean; deaf?: boolean; priority_speaker?: boolean; channel_id?: number }): void {
    this.send('UserState', { session, ...state });
  }

  // Connection details of a user; the server decides how much we may see
  requestUserStats(session: number, statsOnly = false): void {
    this.send('UserStats', { session, stats_only: statsOnly });
  }

  // Fetch comments/descriptions/textures that the server only announced by hash.
  requestBlob(req: { textures?: number[]; comments?: number[]; descriptions?: number[] }): void {
    this.send('RequestBlob', {
      session_texture: req.textures ?? [],
      session_comment: req.comments ?? [],
      channel_description: req.descriptions ?? []
    });
  }

  sendPluginData(receivers: number[], dataId: string, data: Uint8Array): void {
    if (this.session == null || !receivers.length) return;
    this.send('PluginDataTransmission', {
      senderSession: this.session,
      receiverSessions: receivers,
      data,
      dataID: dataId
    });
  }

  // Voice over TCP: the UDPTunnel body is the raw voice packet, not a protobuf message
  sendVoiceTunnel(packet: Uint8Array): void {
    if (!this.transport || this.closed) return;
    this.transport.send(frame(1, packet));
  }

  // 1.5+ servers talk to 1.5+ clients in the protobuf voice format
  get protobufVoice(): boolean {
    return this.serverVersionNum >= 0x010500;
  }

  // Registers a user (ourselves or, with the Register permission, someone else) on the server
  register(session: number): void {
    this.send('UserState', { session, user_id: 0 });
  }

  // ─── Incoming ──────────────────────────────────────────────────────────────

  private ping(): void {
    this.send('Ping', { timestamp: Date.now() });
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.pingTimer = null;
    this.queueTimer = null;
    this.queue = [];
    this.emit('close', reason);
  }

  private handleFrame(typeId: number, body: Uint8Array): void {
    // UDPTunnel carries a raw voice packet, not a protobuf message
    if (typeId === 1) {
      this.emit('voice', body.slice());
      return;
    }
    const decoded = this.codec.decode(typeId, body);
    if (!decoded) return;
    const { name, msg } = decoded;

    switch (name) {
      case 'Version':
        this.serverVersion = msg.release ?? '';
        if (msg.version_v2) {
          const v = Number(msg.version_v2);
          this.serverVersionNum = (Math.floor(v / 2 ** 48) << 16) | ((Math.floor(v / 2 ** 32) & 0xffff) << 8) | (Math.floor(v / 2 ** 16) & 0xffff);
        } else if (msg.version_v1) {
          this.serverVersionNum = msg.version_v1;
        }
        break;
      case 'Ping':
        if (msg.timestamp) {
          this.rtt = Date.now() - Number(msg.timestamp);
          this.emit('ping', this.rtt);
        }
        break;
      case 'Reject':
        this.emit('reject', msg.type ?? 0, msg.reason ?? 'Rejected');
        this.disconnect(msg.reason || 'Connection rejected');
        break;
      case 'ServerSync':
        this.session = msg.session;
        this.maxBandwidth = msg.max_bandwidth ?? 0;
        this.welcomeText = msg.welcome_text ?? '';
        this.synced = true;
        this.ping();
        this.emit('synced');
        break;
      case 'ServerConfig':
        if (msg.allow_html != null) this.config.allowHtml = msg.allow_html;
        if (msg.message_length != null) this.config.messageLength = msg.message_length;
        if (msg.image_message_length != null) this.config.imageMessageLength = msg.image_message_length;
        if (msg.max_users != null) this.config.maxUsers = msg.max_users;
        if (msg.recording_allowed != null) this.config.recordingAllowed = msg.recording_allowed;
        break;
      case 'ChannelState':
        this.applyChannelState(msg);
        break;
      case 'ChannelRemove':
        this.channels.delete(msg.channel_id);
        this.emit('channelRemove', msg.channel_id);
        break;
      case 'UserState':
        this.applyUserState(msg);
        break;
      case 'UserRemove': {
        const user = this.users.get(msg.session);
        if (user) {
          this.users.delete(msg.session);
          this.emit('userRemove', user, msg.actor ?? null, msg.reason ?? '', !!msg.ban);
        }
        break;
      }
      case 'TextMessage':
        this.emit('text', {
          actor: msg.actor ?? null,
          sessions: msg.session ?? [],
          channels: msg.channel_id ?? [],
          trees: msg.tree_id ?? [],
          html: msg.message ?? '',
          time: Date.now()
        });
        break;
      case 'PermissionDenied':
        this.emit('permissionDenied', {
          type: msg.type ?? 0,
          permission: msg.permission ?? 0,
          reason: msg.reason ?? '',
          channelId: msg.channel_id ?? null,
          session: msg.session ?? null,
          name: msg.name ?? ''
        });
        break;
      case 'UserStats':
        this.emit('userStats', msg);
        break;
      case 'PluginDataTransmission':
        if (msg.senderSession != null && msg.dataID) {
          this.emit('pluginData', msg.senderSession, msg.dataID, msg.data ?? new Uint8Array(0));
        }
        break;
    }
    this.emit('message', name, msg);
  }

  private applyChannelState(msg: any): void {
    const id: number = msg.channel_id;
    let ch = this.channels.get(id);
    if (!ch) {
      ch = {
        id, parent: null, name: '', description: '', descriptionHash: null, position: 0,
        temporary: false, links: new Set(), maxUsers: 0, canEnter: true
      };
      this.channels.set(id, ch);
    }
    if (msg.parent != null) ch.parent = msg.parent;
    if (msg.name != null) ch.name = msg.name;
    if (msg.description_hash != null && msg.description == null) ch.description = '';
    if (msg.description != null) ch.description = msg.description;
    if (msg.description_hash != null) ch.descriptionHash = msg.description_hash;
    if (msg.position != null) ch.position = msg.position;
    if (msg.temporary != null) ch.temporary = msg.temporary;
    if (msg.max_users != null) ch.maxUsers = msg.max_users;
    if (msg.can_enter != null) ch.canEnter = msg.can_enter;
    if (msg.links?.length) ch.links = new Set(msg.links);
    for (const l of msg.links_add ?? []) ch.links.add(l);
    for (const l of msg.links_remove ?? []) ch.links.delete(l);
    this.emit('channel', ch);
  }

  private applyUserState(msg: any): void {
    const session: number = msg.session ?? this.session;
    let user = this.users.get(session);
    const isNew = !user;
    if (!user) {
      user = {
        session, name: '', userId: null, channelId: 0, mute: false, deaf: false, suppress: false,
        selfMute: false, selfDeaf: false, prioritySpeaker: false, recording: false,
        comment: '', commentHash: null, texture: null, textureHash: null, hash: ''
      };
      this.users.set(session, user);
    }
    const fields: [string, keyof User][] = [
      ['name', 'name'], ['user_id', 'userId'], ['channel_id', 'channelId'], ['mute', 'mute'],
      ['deaf', 'deaf'], ['suppress', 'suppress'], ['self_mute', 'selfMute'], ['self_deaf', 'selfDeaf'],
      ['priority_speaker', 'prioritySpeaker'], ['recording', 'recording'], ['comment', 'comment'],
      ['comment_hash', 'commentHash'], ['texture', 'texture'], ['texture_hash', 'textureHash'], ['hash', 'hash']
    ];
    // A new hash without text means the text changed and must be fetched (RequestBlob)
    if (msg.comment_hash != null && msg.comment == null) user.comment = '';
    const changed: string[] = [];
    for (const [src, dst] of fields) {
      if (msg[src] != null) {
        (user as any)[dst] = msg[src];
        changed.push(dst);
      }
    }
    this.emit('user', user, changed, msg.actor ?? null, isNew);
  }
}
