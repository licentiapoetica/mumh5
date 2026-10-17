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
// File pieces (bulk chat messages) use the bucket only up to here, so two of the user's own
// messages always go out at once
const BULK_CAP = RATE_BURST - 2;

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

// ACL permission bits (ChanACL::Perm)
export const PERM = {
  Write: 0x1, Traverse: 0x2, Enter: 0x4, Speak: 0x8, MuteDeafen: 0x10, Move: 0x20,
  MakeChannel: 0x40, LinkChannel: 0x80, Whisper: 0x100, TextMessage: 0x200, MakeTempChannel: 0x400,
  Listen: 0x800, Kick: 0x10000, Ban: 0x20000, Register: 0x40000, SelfRegister: 0x80000, ResetUserContent: 0x100000
} as const;

export interface AclGroup {
  name: string;
  inherited: boolean;     // exists because a parent defines it (and made it inheritable)
  inherit: boolean;       // members of the parent's group count here too
  inheritable: boolean;   // subchannels may inherit this group
  add: number[];          // user ids added here
  remove: number[];       // user ids removed here
  inheritedMembers: number[];
}

export interface AclEntry {
  applyHere: boolean;
  applySubs: boolean;
  inherited: boolean;     // defined on a parent channel, read-only here
  userId: number | null;
  group: string | null;
  grant: number;
  deny: number;
}

export interface ChannelAcl {
  channelId: number;
  inheritAcls: boolean;
  groups: AclGroup[];
  acls: AclEntry[];
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
  udp: (ok: boolean, rtt: number) => void;
  acl: (acl: ChannelAcl) => void;
  userNames: (names: Map<number, string>) => void;
  permissions: (channelId: number | null, bits: number) => void;
  ping: (rttMs: number) => void;
  close: (reason: string) => void;
  message: (name: MessageName, msg: any) => void;
};

export class MumbleClient extends Emitter<ClientEvents> {
  readonly channels = new Map<number, Channel>();
  readonly users = new Map<number, User>();
  // Our effective permissions per channel (PermissionQuery); cleared when the server flushes
  readonly permissions = new Map<number, number>();
  // Registered user names by id, learned from QueryUsers
  readonly registeredNames = new Map<number, string>();
  session: number | null = null;
  synced = false;
  welcomeText = '';
  maxBandwidth = 0;
  serverVersion = '';
  // Numeric server version (major << 16 | minor << 8 | patch), 0 until known
  serverVersionNum = 0;
  // Voice goes over encrypted UDP while the server answers our UDP pings, otherwise over TCP
  udpOk = false;
  udpRtt = 0;
  // Force the TCP tunnel even when UDP would work (for networks that mangle UDP)
  forceTcp = false;
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
  private bulkLast = 0;        // when the last bulk message was sent
  private pingWaiters: { at: number; resolve: () => void }[] = [];

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
    const udp = transport.udp;
    if (udp) {
      udp.onVoice = plain => { if (!this.closed) this.emit('voice', plain); };
      udp.onState = (ok, rtt) => {
        const changed = ok !== this.udpOk;
        this.udpOk = ok;
        this.udpRtt = rtt;
        if (changed) this.emit('udp', ok, rtt);
      };
      // Ask the server for a fresh nonce (an empty CryptSetup)
      udp.onResync = () => this.send('CryptSetup', {});
    }
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

  // How long until a bulk message may go out without delaying the user's own (0: now). Never
  // while their messages wait. Bulk goes in runs that start from an empty bucket: Murmur throws
  // away the part of a second that has not leaked each time a message arrives, so a steady
  // one-by-one pace would lose most of a second every time.
  bulkWait(now = Date.now()): number {
    if (this.queue.length) return RATE_LEAK_MS;
    const level = this.levelAt(now);
    const inRun = this.bulkLast === this.lastLimited && now - this.lastLimited < 250;
    if (level === 0 || (inRun && level < BULK_CAP)) return 0;
    return Math.max(5, this.lastLimited + level * RATE_LEAK_MS + RATE_MARGIN_MS - now + 5);
  }

  // A chat message that waits for room instead of queueing (see bulkWait). false: not now.
  sendBulk(target: { users: number[] }, html: string): boolean {
    if (!this.transport || this.closed || this.bulkWait() !== 0) return false;
    const now = Date.now();
    this.bucket = this.levelAt(now) + 1;
    this.lastLimited = this.bulkLast = now;
    this.transport.send(this.codec.encode('TextMessage', { session: target.users, channel_id: [], tree_id: [], message: html }));
    return true;
  }

  // Resolves once the server has read everything sent before (a ping and its answer), so a
  // large transfer on a slow connection waits instead of piling up in front of everything else
  flushed(): Promise<void> {
    if (!this.transport || this.closed) return Promise.resolve();
    return new Promise(resolve => {
      const at = Date.now();
      this.pingWaiters.push({ at, resolve });
      this.send('Ping', { timestamp: at });
    });
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

  // ─── Channel management ────────────────────────────────────────────────────

  requestPermissions(channelId: number): void {
    this.send('PermissionQuery', { channel_id: channelId });
  }

  can(channelId: number, bit: number): boolean | null {
    // The server never sends SuperUser (user id 0) its permissions: it may do everything
    if (this.self?.userId === 0) return true;
    const p = this.permissions.get(channelId);
    // Write on a channel implies the other channel permissions
    return p == null ? null : (p & (bit | PERM.Write)) !== 0;
  }

  createChannel(parent: number, name: string, opts: { temporary?: boolean; description?: string; position?: number; maxUsers?: number } = {}): void {
    this.send('ChannelState', {
      parent, name,
      temporary: !!opts.temporary,
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.position ? { position: opts.position } : {}),
      ...(opts.maxUsers ? { max_users: opts.maxUsers } : {})
    });
  }

  updateChannel(channelId: number, fields: { name?: string; description?: string; position?: number; maxUsers?: number; parent?: number }): void {
    const msg: Record<string, unknown> = { channel_id: channelId };
    if (fields.name != null) msg.name = fields.name;
    if (fields.description != null) msg.description = fields.description;
    if (fields.position != null) msg.position = fields.position;
    if (fields.maxUsers != null) msg.max_users = fields.maxUsers;
    if (fields.parent != null) msg.parent = fields.parent;
    this.send('ChannelState', msg);
  }

  removeChannel(channelId: number): void {
    this.send('ChannelRemove', { channel_id: channelId });
  }

  setLinks(channelId: number, add: number[], remove: number[]): void {
    this.send('ChannelState', { channel_id: channelId, links_add: add, links_remove: remove });
  }

  queryAcl(channelId: number): void {
    this.send('ACL', { channel_id: channelId, query: true });
  }

  // Sends the channel's own rules and groups; inherited ones stay with their channel
  saveAcl(acl: ChannelAcl): void {
    this.send('ACL', {
      channel_id: acl.channelId,
      inherit_acls: acl.inheritAcls,
      groups: acl.groups
        // Same rule as the desktop client: skip groups that only exist by inheritance
        .filter(g => !(g.inherited && g.inherit && g.inheritable && !g.add.length && !g.remove.length))
        .map(g => ({ name: g.name, inherit: g.inherit, inheritable: g.inheritable, add: g.add, remove: g.remove })),
      acls: acl.acls.filter(a => !a.inherited).map(a => ({
        apply_here: a.applyHere, apply_subs: a.applySubs,
        ...(a.userId != null ? { user_id: a.userId } : { group: a.group ?? 'all' }),
        grant: a.grant, deny: a.deny
      }))
    });
  }

  // Resolves registered user ids to names and names to ids
  queryUsers(q: { ids?: number[]; names?: string[] }): void {
    this.send('QueryUsers', { ids: q.ids ?? [], names: q.names ?? [] });
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

  // Voice over UDP when it works, else through the TCP tunnel
  sendVoice(packet: Uint8Array): void {
    if (this.udpOk && !this.forceTcp && this.transport?.udp) this.transport.udp.send(packet);
    else this.sendVoiceTunnel(packet);
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
    for (const w of this.pingWaiters.splice(0)) w.resolve();
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
          const at = Number(msg.timestamp);
          this.rtt = Date.now() - at;
          this.emit('ping', this.rtt);
          if (this.pingWaiters.length) {
            const done = this.pingWaiters.filter(w => w.at <= at);
            this.pingWaiters = this.pingWaiters.filter(w => w.at > at);
            for (const w of done) w.resolve();
          }
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
        if (msg.permissions != null) this.permissions.set(0, Number(msg.permissions));
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
      case 'CryptSetup': {
        const udp = this.transport?.udp;
        if (!udp || this.forceTcp) break;
        if (msg.key?.length && msg.client_nonce?.length && msg.server_nonce?.length) {
          udp.setup(msg.key, msg.client_nonce, msg.server_nonce, this.protobufVoice);
        } else if (msg.server_nonce?.length) {
          udp.setServerNonce(msg.server_nonce);
        } else {
          // The server asks for our nonce to resync its side
          udp.clientNonce().then(n => { if (n) this.send('CryptSetup', { client_nonce: n }); });
        }
        break;
      }
      case 'ACL': {
        // proto2 defaults: missing booleans are true
        const t = (v: unknown) => v !== false;
        this.emit('acl', {
          channelId: msg.channel_id,
          inheritAcls: t(msg.inherit_acls),
          groups: (msg.groups ?? []).map((g: any) => ({
            name: g.name, inherited: t(g.inherited), inherit: t(g.inherit), inheritable: t(g.inheritable),
            add: g.add ?? [], remove: g.remove ?? [], inheritedMembers: g.inherited_members ?? []
          })),
          acls: (msg.acls ?? []).map((a: any) => ({
            applyHere: t(a.apply_here), applySubs: t(a.apply_subs), inherited: t(a.inherited),
            userId: a.user_id ?? null, group: a.user_id != null ? null : (a.group ?? 'all'),
            grant: a.grant ?? 0, deny: a.deny ?? 0
          }))
        });
        break;
      }
      case 'QueryUsers': {
        const ids: number[] = msg.ids ?? [], names: string[] = msg.names ?? [];
        ids.forEach((id, i) => { if (names[i]) this.registeredNames.set(id, names[i]); });
        this.emit('userNames', this.registeredNames);
        break;
      }
      case 'PermissionQuery':
        if (msg.flush) this.permissions.clear();
        if (msg.channel_id != null && msg.permissions != null) this.permissions.set(msg.channel_id, msg.permissions);
        this.emit('permissions', msg.channel_id ?? null, msg.permissions ?? 0);
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
