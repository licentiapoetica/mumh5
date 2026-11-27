import { createCodec } from '../core/proto.ts';
import { MumbleClient, PERM, describeDenial, type Channel, type ChannelAcl, type User, type TextMessage } from '../core/client.ts';
import { native, desktop, openTransport, relayTransport } from './native.ts';
import { MumpeerSession } from './mumpeer.svelte.ts';
import { share, type ShareKind } from './share.svelte.ts';
import { textChannels } from './text-channels.ts';
import { chatHistory, type SavedMessage } from './chat-history.ts';
import { currentChatMessage, historyHours } from '../core/chat-retention.ts';
import { chatAuthorKey, chatAuthorKeys } from '../core/chat-author.ts';
import { MAX_HTML, type TextMsg } from '../core/text-signal.ts';
import { parseAdmins, rootAdmins, withAdmins } from '../core/admins.ts';
import { docFromRoles, isBuiltinRole, parseRoles, prepareRoles, refreshDoc, roleMembers, rolesFromAcl, rolesOf, roleTint, setMember, withRoles, type RoleDoc, type RoleInfo } from '../core/roles.ts';
import { effectivePermissions } from '../core/access.ts';
import { withPassword } from '../core/channel-password.ts';
import { cleanDisplayName, withDisplayName } from '../core/display-name.ts';
import { bannerMark, withBanner, type Banner } from '../core/banner.ts';
import type { ServerCertInfo } from '../core/transport.ts';
import { store, type SavedServer } from './settings.svelte.ts';
import { renderIncoming, textToHtml, formatBytes, type Embed } from './html.ts';
import { escapeHtml } from '../core/html.ts';
import { makeInlineImage, originalImage, videoPoster } from './images.ts';
import { ownAvatar } from './avatar.svelte.ts';
import { ownBanner } from './banner.svelte.ts';
import { files, fileKind } from './files.svelte.ts';
import { announce, isPiece } from '../core/file-transfer.ts';
import { encodePoke, decodePoke } from '../core/poke.ts';
import { copyReactions, messageRef, textRef, type Reaction } from '../core/reactions.ts';
import { reactions } from './reactions.ts';
import { ui } from './ui.svelte.ts';
import { notifyPoke } from './notify.ts';
import { voice } from './audio/voice.svelte.ts';
import { connLog } from './conn-log.svelte.ts';
import { sounds } from './audio/sounds.svelte.ts';
import { planUserMove, movePending, confirmUserMove, failUserMove, remainingSelection, type UserMove } from '../core/user-move.ts';

const codec = createCodec();
const commentTag = (session: number, hash: Uint8Array) => `c:${session}:${[...hash].join(',')}`;
const COMMENT_BATCH = 20;
const COMMENT_PAUSE_MS = 500;
// How long a "connected" line may still change to the person's chosen name
const JOIN_NAME_WAIT_MS = 5000;
const NAMES_WAIT_MS = 2000;
const descriptionTag = (id: number, hash: Uint8Array) => `d:${id}:${[...hash].join(',')}`;

// A chat view is a channel ("ch:<id>") or a direct conversation with a user ("dm:<session>").
export type ViewKey = `ch:${number}` | `dm:${number}`;

export interface ChatEntry {
  id: number;
  kind: 'text' | 'system';
  author: string;
  authorSession: number | null;
  authorIdentity?: string;
  self: boolean;
  html: string;
  embeds: Embed[];
  time: number;
  // Names the message for reactions (see core/reactions.ts); unset where it cannot have any
  ref?: string;
  reactions: Reaction[];
  historyId?: string;
}

// A file being read before it is announced
export interface FileJob {
  id: number;
  key: string;
  name: string;
  progress: number;
}

export interface CertPrompt {
  server: SavedServer;
  hostPort: string;
  fingerprint: string;
  previous: string;
}

// Right-hand panel: member list, a channel (description preview or its side chat), or a user profile
export type Panel =
  | { kind: 'members' }
  | { kind: 'channel'; id: number; tab: 'info' | 'chat' }
  | { kind: 'user'; session: number };

let nextId = 1;

export class Session {
  readonly mumpeer = new MumpeerSession(this);
  status = $state<'idle' | 'connecting' | 'connected'>('idle');
  error = $state('');
  server = $state<SavedServer | null>(null);
  // Bumped on every client state change; views read it to re-derive from the client's maps
  tick = $state(0);
  view = $state<ViewKey>('ch:0');
  panel = $state<Panel>({ kind: 'members' });
  logs = $state<Record<string, ChatEntry[]>>({});
  unread = $state<Record<string, number>>({});
  dmNames = $state<Record<string, string>>({});
  preparing = $state<FileJob[]>([]);
  certPrompt = $state<CertPrompt | null>(null);
  rtt = $state(0);
  // Who in our channel is sharing their screen, by session (mumh5 clients only)
  sharing = $state<Record<number, ShareKind>>({});
  // Why the last connection ended, shown with a Reconnect button (null after a normal disconnect)
  disconnectInfo = $state<{ kind: 'kicked' | 'banned' | 'lost' | 'rejected'; by: string; reason: string } | null>(null);
  // Seconds until the next automatic reconnect, counting down; null when none is waiting
  reconnectDelay = $state<number | null>(null);
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  // When the current connection logged in; only one that stayed up a while resets the backoff
  private syncedAt = 0;
  // This connection ended in a way retrying cannot fix: a ban, or a refused login
  private noRetry = false;
  // Our channel when the connection dropped, joined again after an automatic reconnect
  private lostChannel: number | null = null;
  private removedBy: { kind: 'kicked' | 'banned'; by: string; reason: string } | null = null;
  // Last known channel per user, to tell joins from leaves of our channel for sounds
  private lastChannel = new Map<number, number>();
  // TLS details of the current server, for the certificate viewer and the trusted badge
  serverCert = $state<ServerCertInfo | null>(null);
  // Channel tree expansion the user chose; channels not in here follow the default
  expanded = $state<Record<number, boolean>>({});
  selectedUsers = $state<number[]>([]);
  selectingUsers = $state(false);
  userMove = $state<UserMove | null>(null);
  private userMoveTimer: ReturnType<typeof setTimeout> | undefined;
  get movingUsers(): boolean { return movePending(this.userMove); }
  // Channel highlighted by a single click in the tree (a double click joins)
  selectedChannel = $state<number | null>(null);

  client: MumbleClient | null = null;
  // Rebuild once per client update, rather than searching every user for every message.
  private chatAuthors = $derived.by(() => {
    void this.tick;
    return new Map([...(this.client?.users.values() ?? [])].flatMap(u => chatAuthorKeys(u).map(k => [k, u.session] as const)));
  });
  // Incremented per connect so a slow, superseded attempt can tell it is stale
  private attempt = 0;
  // Blob hashes already requested, so a preview does not ask the server repeatedly
  private requested = new Set<string>();
  // Your chosen name waits for your own long description, which must not be overwritten
  private nameTask: { set: string } | 'restore' | 'persist' | 'banner' | null = null;
  // A new name on its way to the server, undone if the server refuses the longer comment
  private nameWrite: { key: string; before: string; at: number } | null = null;
  // A comment with your banner picture on its way; if refused, it goes again without the picture
  private bannerWrite: { base: string; name: string; at: number } | null = null;
  private bannerColorOnly = false;
  private namesStarted = false;
  // Long comments to fetch for the names inside them, asked for a few at a time
  private wantedComments = new Set<number>();
  private commentTimer: ReturnType<typeof setTimeout> | null = null;
  // "connected" lines that still show the account name: the chosen name arrives in the person's
  // comment after the server first announces them, and then rewrites the line
  private joinNotes = new Map<number, { key: string; id: number; timer: ReturnType<typeof setTimeout> }>();
  // Pictures of people here as object URLs, made the first time each one is shown
  private pictures = new Map<number, { bytes: Uint8Array; url: string }>();
  // Pictures to fetch, collected while a list renders and asked for in one request
  private wantedPictures = new Set<number>();
  // Last file announcement with a preview picture, resent without it if the server refuses it
  private lastImageSend: { key: string; fallback: string; at: number } | null = null;
  // Channel we asked to move to; the chat view switches when the server confirms it
  private pendingJoin: number | null = null;
  // A password being tried on a locked channel; saved once the server lets us in
  private passwordTry: { id: number; password: string } | null = null;
  // Admins according to the root ACL, until the description they are published in has loaded
  private adminList: number[] | null = null;
  // The root rules behind adminList, to bring the published role members up to date
  private rootAcl: ChannelAcl | null = null;
  // Our own new role data is on its way: nothing may rewrite the description from the old text
  private rolesSending = false;
  private rolesTimer: ReturnType<typeof setTimeout> | undefined;
  private roleCache: { text: string; doc: RoleDoc | null } = { text: '', doc: null };
  // The root rules were saved, so the published admin list may be out of date
  private adminsStale = false;
  // Mute and deafen the app set by itself (your choice from before connecting, or restored when
  // voice comes back here); the server's confirmation of exactly that plays no sound
  private applied: { mute: boolean; deaf: boolean } | null = null;
  // Your mute and deafen as last seen, so sounds follow real changes: the server repeats fields that
  // did not change (unmuting also sends "not deafened")
  private own: { mute: boolean; deaf: boolean } | null = null;

  // ─── Derived helpers ────────────────────────────────────────────────────────
  // The client mutates its objects in place. These return shallow copies and read `tick`,
  // so every state change hands Svelte new objects and dependent views update.

  get self(): User | null {
    void this.tick;
    const u = this.client?.self;
    return u ? { ...u } : null;
  }

  channel(id: number): Channel | undefined {
    void this.tick;
    const c = this.client?.channels.get(id);
    return c && { ...c };
  }

  user(session: number): User | undefined {
    void this.tick;
    const u = this.client?.users.get(session);
    return u && { ...u };
  }

  chatAuthor(entry: ChatEntry): User | undefined {
    const id = entry.self ? this.self?.session : entry.authorIdentity ? this.chatAuthors.get(entry.authorIdentity) : undefined;
    return id != null ? this.user(id) : undefined;
  }

  childrenOf(parent: number | null): Channel[] {
    void this.tick;
    if (!this.client) return [];
    return [...this.client.channels.values()]
      .filter(c => (parent === null ? c.id === 0 : c.parent === parent && c.id !== 0))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map(c => ({ ...c }));
  }

  usersIn(channelId: number): User[] {
    void this.tick;
    if (!this.client) return [];
    return [...this.client.users.values()]
      .filter(u => u.channelId === channelId)
      .sort((a, b) => store.displayName(a).localeCompare(store.displayName(b)))
      .map(u => ({ ...u }));
  }

  allUsers(): User[] {
    void this.tick;
    return this.client ? [...this.client.users.values()].sort((a, b) => store.displayName(a).localeCompare(store.displayName(b))).map(u => ({ ...u })) : [];
  }

  beginUserSelection(): void {
    if (this.movingUsers) return;
    this.userMove = null;
    this.selectingUsers = true;
    ui.profile = null;
  }

  // Every entry point uses the same mode, including modifier-click and person menus.
  toggleUser(id: number): void {
    if (this.movingUsers) return;
    this.beginUserSelection();
    this.selectedUsers = this.selectedUsers.includes(id) ? this.selectedUsers.filter(s => s !== id) : [...this.selectedUsers, id];
  }

  clearUserSelection(): void {
    if (this.movingUsers) return;
    if (this.selectedUsers.length) this.selectedUsers = [];
    this.selectingUsers = false;
    this.userMove = null;
  }

  selectChannelUsers(channelId: number): void {
    if (this.movingUsers) return;
    this.beginUserSelection();
    this.selectedUsers = [...new Set([...this.selectedUsers, ...this.usersIn(channelId).map(u => u.session)])];
  }

  private updateUserMove(): void {
    if (!this.userMove) return;
    this.selectedUsers = remainingSelection(this.userMove, this.selectedUsers);
    if (!this.movingUsers) {
      clearTimeout(this.userMoveTimer);
      if (!this.selectedUsers.length) this.selectingUsers = false;
    }
  }

  private resetUserMove(): void {
    clearTimeout(this.userMoveTimer);
    this.userMove = null;
  }

  private timeUserMove(): void {
    clearTimeout(this.userMoveTimer);
    const batch = this.userMove;
    if (!batch || !this.movingUsers) return;
    this.userMoveTimer = setTimeout(() => {
      if (this.userMove !== batch) return;
      // Waiting for a password is a user decision, not a network timeout.
      for (const person of batch.people) {
        if (person.status === 'pending') failUserMove(batch, 'No confirmation received. Check their channel before retrying.', person.id);
      }
      this.updateUserMove();
    }, 15000);
  }

  moveUsers(ids: number[], channelId: number): void {
    const channel = this.channel(channelId);
    if (!this.client || !channel || this.isText(channelId) || this.movingUsers) return;
    const people = [...new Set(ids)].flatMap(id => {
      const u = this.user(id);
      return u ? [{ id, name: store.displayName(u), channelId: u.channelId }] : [];
    });
    if (!people.length) return;
    this.userMove = planUserMove(people, channelId, channel.name || 'Root', this.self?.session,
      id => this.can(id, PERM.Move));
    this.timeUserMove();
    for (const person of this.userMove.people) {
      if (person.status !== 'pending') continue;
      if (person.id === this.self?.session) this.joinChannel(channelId);
      else this.moveUser(person.id, channelId);
    }
    this.updateUserMove();
  }

  // Users in a channel and all of its subchannels
  subtreeUserCount(id: number): number {
    void this.tick;
    const client = this.client;
    if (!client) return 0;
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of client.channels.values()) {
        if (c.parent != null && ids.has(c.parent) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
      }
    }
    let n = 0;
    for (const u of client.users.values()) if (ids.has(u.channelId)) n++;
    return n;
  }

  // Collapsed by default; channels with people in them open up, like the desktop client
  isExpanded(id: number): boolean {
    if (id === 0) return true;
    return this.expanded[id] ?? this.subtreeUserCount(id) > 0;
  }

  toggleExpanded(id: number): void {
    this.expanded[id] = !this.isExpanded(id);
  }

  // Empty channels keep the default when collapsing, so they still open once someone joins
  setAllExpanded(open: boolean): void {
    const all: Record<number, boolean> = {};
    for (const id of this.client?.channels.keys() ?? []) {
      if (open) all[id] = true;
      else if (id !== 0 && this.subtreeUserCount(id) > 0) all[id] = false;
    }
    this.expanded = all;
  }

  // Whether every channel that has something to show is open (root always is)
  get allExpanded(): boolean {
    void this.tick;
    const client = this.client;
    if (!client) return false;
    const withPeople = new Set<number>();
    for (const u of client.users.values()) {
      let id: number | null | undefined = u.channelId;
      while (id != null && !withPeople.has(id)) {
        withPeople.add(id);
        id = client.channels.get(id)?.parent;
      }
    }
    const collapsible = new Set(withPeople);
    for (const c of client.channels.values()) if (c.parent != null) collapsible.add(c.parent);
    collapsible.delete(0);
    return [...collapsible].every(id => this.expanded[id] ?? withPeople.has(id));
  }

  // What the server told us about itself, for the server information dialog
  get serverInfo() {
    void this.tick;
    const c = this.client;
    if (!c) return null;
    return { version: c.serverVersion, maxBandwidth: c.maxBandwidth, config: { ...c.config }, users: c.users.size, channels: c.channels.size };
  }

  // How voice travels right now
  get voiceTransport(): { udp: boolean; rtt: number } {
    void this.tick;
    const c = this.client;
    // The setting (reactive) rather than the client's copy, so toggling it updates the view
    return { udp: !!c && c.udpOk && !voice.settings.forceTcp, rtt: c?.udpRtt ?? 0 };
  }

  // true / false when known, null when the server has not told us yet
  can(channelId: number, bit: number): boolean | null {
    void this.tick;
    return this.client?.can(channelId, bit) ?? null;
  }

  // Whether a channel lies somewhere below another (a channel cannot move into its own subtree)
  // A channel that is read and written without joining it (mumh5 clients only)
  isText(channelId: number): boolean {
    void this.tick;
    return textChannels.isText(this, channelId);
  }

  // SuperUser, or listed on the root channel by someone allowed to edit it (see core/admins.ts)
  isAdmin(user: { userId: number | null }): boolean {
    void this.tick;
    if (user.userId == null) return false;
    return user.userId === 0 || parseAdmins(this.client?.channels.get(0)?.description ?? '').includes(user.userId);
  }

  get roleDoc(): RoleDoc | null {
    void this.tick;
    const text = this.client?.channels.get(0)?.description ?? '';
    if (text !== this.roleCache.text) this.roleCache = { text, doc: parseRoles(text) };
    return this.roleCache.doc;
  }

  // Highest role first
  rolesFor(user: { userId: number | null }): RoleInfo[] {
    return rolesOf(this.roleDoc, user.userId);
  }

  roleColor(user: { userId: number | null }): string | undefined {
    if (store.settings.roleColors === false) return undefined;
    return roleTint(this.rolesFor(user).find(r => r.c)?.c ?? '');
  }

  roleLabel(user: { userId: number | null }): string {
    return this.rolesFor(user)[0]?.n ?? (this.isAdmin(user) ? 'Admin' : user.userId != null ? 'Registered' : 'Guest');
  }

  roleName(group: string): string | undefined {
    return this.roleDoc?.roles.find(r => r.g === group)?.n;
  }

  isInside(channelId: number, ancestor: number): boolean {
    let c = this.client?.channels.get(channelId);
    while (c && c.parent != null) {
      if (c.parent === ancestor) return true;
      c = this.client?.channels.get(c.parent);
    }
    return false;
  }

  viewTitle(key: string = this.view): string {
    const [kind, id] = key.split(':');
    if (kind === 'ch') return this.channel(Number(id))?.name || 'Root';
    const user = this.user(Number(id));
    return user ? store.displayName(user) : this.dmNames[key] ?? 'Offline user';
  }

  // Keys whose chat is on screen right now (main view and an open side chat)
  private visibleKeys(): string[] {
    const keys: string[] = [this.view];
    if (this.panel.kind === 'channel' && this.panel.tab === 'chat') keys.push(`ch:${this.panel.id}`);
    return keys;
  }

  // ─── Connection ─────────────────────────────────────────────────────────────

  // automatic: a retry after the connection dropped. It keeps the chat, the channel tree and the
  // notice of why the connection ended, and voice stays reserved for this server.
  async connect(server: SavedServer, automatic = false): Promise<void> {
    const retries = automatic ? this.reconnectAttempts : 0;
    this.disconnect(automatic);
    this.reconnectAttempts = retries;
    const attempt = ++this.attempt;
    this.server = server;
    this.error = '';
    if (automatic) {
      // Sessions are numbered anew on every login: direct chats would reach someone else
      for (const k of Object.keys(this.logs)) if (k.startsWith('dm:')) delete this.logs[k];
      for (const k of Object.keys(this.unread)) if (k.startsWith('dm:')) delete this.unread[k];
      if (this.panel.kind === 'user') this.panel = { kind: 'members' };
    } else {
      this.logs = {};
      this.unread = {};
      this.expanded = {};
      this.panel = { kind: 'members' };
      this.disconnectInfo = null;
      this.lostChannel = null;
    }
    this.selectedChannel = null;
    this.requested.clear();
    this.nameTask = null;
    this.nameWrite = null;
    this.bannerWrite = null;
    this.bannerColorOnly = false;
    this.namesStarted = false;
    this.wantedComments.clear();
    if (this.commentTimer) clearTimeout(this.commentTimer);
    this.commentTimer = null;
    for (const n of this.joinNotes.values()) clearTimeout(n.timer);
    this.joinNotes.clear();
    this.dropPictures();
    this.applied = null;
    this.own = null;
    this.passwordTry = null;
    this.adminList = null;
    this.adminsStale = false;
    this.serverCert = null;
    this.removedBy = null;
    this.noRetry = false;
    this.syncedAt = 0;
    this.status = 'connecting';

    if (!native) {
      this.fail('Connecting needs the desktop app or the web build served by a mumh5 proxy.', false);
      return;
    }

    let transport;
    let info;
    try {
      transport = (await openTransport(server.host, server.port, server.identityId))!;
      // Superseded while the identity was being prepared
      if (attempt !== this.attempt) return transport.close();
      info = await transport.secure;
    } catch (e) {
      transport?.close();
      if (attempt === this.attempt) this.fail((e as Error).message);
      return;
    }
    if (attempt !== this.attempt) return transport.close();
    this.serverCert = info;

    // Trust on first use: pin the certificate, and stop before sending credentials if it changed
    const hostPort = `${server.host.toLowerCase()}:${server.port}`;
    const pinned = store.pins[hostPort];
    if (!pinned) {
      store.pin(hostPort, info.fingerprint);
    } else if (pinned !== info.fingerprint && !info.authorized) {
      transport.close();
      this.certPrompt = { server, hostPort, fingerprint: info.fingerprint, previous: pinned };
      this.fail('The server certificate changed.', false);
      return;
    }

    const client = new MumbleClient(codec);
    client.forceTcp = voice.settings.forceTcp;
    this.client = client;
    this.mumpeer.attach(relayTransport(transport));
    this.wire(client);
    // TLS is up but the server may still never finish the login
    setTimeout(() => { if (this.client === client && !client.synced) client.disconnect('Login timed out'); }, 20000);
    try {
      const platform = await native.platformInfo();
      if (attempt !== this.attempt) return transport.close();
      client.connect(transport, {
        username: server.username,
        password: server.password,
        tokens: store.tokensFor(hostPort),
        os: platform.os,
        osVersion: platform.osVersion
      });
    } catch (e) {
      transport.close();
      if (attempt === this.attempt) client.disconnect((e as Error).message);
    }
  }

  reconnect(): void {
    if (this.server) this.connect($state.snapshot(this.server) as SavedServer);
  }

  acceptCertificate(): void {
    const p = this.certPrompt;
    if (!p) return;
    store.pin(p.hostPort, p.fingerprint);
    this.certPrompt = null;
    this.connect(p.server);
  }

  // keepVoice: an automatic reconnect follows, so voice is not handed to another server
  disconnect(keepVoice = false): void {
    this.resetUserMove();
    this.clearUserSelection();
    this.clearRetry();
    this.reconnectAttempts = 0;
    this.certPrompt = null;
    this.attempt++;
    const client = this.client;
    this.client = null;
    client?.disconnect();
    chatHistory.closed(this);
    share.closed(this);
    this.mumpeer.close();
    textChannels.closed(this);
    files.closed(this);
    reactions.closed(this);
    this.dropPictures();
    this.sharing = {};
    sessions.onClosed(this, keepVoice);
    this.status = 'idle';
    this.tick++;
  }

  // The page came back or the network returned: check a live connection, retry a waiting one now
  nudge(): void {
    if (this.client?.synced) { connLog.add(`${this.server?.label ?? 'server'}: checking the connection`); this.client.probe(); }
    else if (this.reconnectTimer !== null && this.server) {
      connLog.add(`${this.server.label}: retrying now`);
      this.clearRetry();
      void this.connect($state.snapshot(this.server) as SavedServer, true);
    }
  }

  // The user stops waiting for the next automatic reconnect
  cancelReconnect(): void {
    this.clearRetry();
    this.reconnectAttempts = 0;
    if (!this.client) sessions.onClosed(this);
  }

  private clearRetry(): void {
    if (this.reconnectTimer !== null) clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectDelay = null;
  }

  // Returns whether a retry is now waiting
  private scheduleReconnect(): boolean {
    if (!this.server || this.server.autoReconnect === false) return false;
    if (this.reconnectTimer !== null) return true;
    // A login that held for a minute was a working connection: start the backoff over. One that is
    // dropped right after login (a kick on join) keeps backing off, so Murmur's autoban never trips.
    if (this.syncedAt && Date.now() - this.syncedAt > 60_000) this.reconnectAttempts = 0;
    const server = $state.snapshot(this.server) as SavedServer;
    this.reconnectDelay = Math.min(5 * 2 ** Math.min(this.reconnectAttempts++, 3), 30);
    this.reconnectTimer = setInterval(() => {
      this.reconnectDelay = (this.reconnectDelay ?? 1) - 1;
      if (this.reconnectDelay > 0) return;
      this.clearRetry();
      void this.connect(server, true);
    }, 1000);
    return true;
  }

  private fail(msg: string, retry = true): void {
    this.status = 'idle';
    this.error = msg;
    // Voice waited for this server through an automatic attempt; without another one it moves on
    if (!retry || !this.scheduleReconnect()) sessions.onClosed(this);
  }

  private wire(client: MumbleClient): void {
    const live = () => this.client === client;
    const bump = () => { if (live()) this.tick++; };

    client.on('synced', () => {
      if (!live()) return;
      this.status = 'connected';
      connLog.add(`${this.server?.label ?? 'server'}: connected${this.reconnectAttempts ? ` (after ${this.reconnectAttempts} ${this.reconnectAttempts === 1 ? 'retry' : 'retries'})` : ''}`);
      // ServerConfig normally follows at once; a server that sends none still gets names
      setTimeout(() => { if (live() && !this.namesStarted) this.startNames(client); }, NAMES_WAIT_MS);
      void chatHistory.entered(this);
      this.syncedAt = Date.now();
      const rejoin = this.lostChannel;
      const back = this.disconnectInfo != null || rejoin != null;
      this.lostChannel = null;
      this.disconnectInfo = null;
      // After an automatic reconnect, stay on the channel chat that was open if it still exists
      const open = this.view.startsWith('ch:') && back ? Number(this.view.slice(3)) : null;
      this.view = `ch:${open != null && client.channels.has(open) ? open : client.self?.channelId ?? 0}`;
      sessions.onSynced(this);
      sounds.play('connected');
      for (const u of client.users.values()) this.lastChannel.set(u.session, u.channelId);
      // What we may do per channel, for menus (not rate limited by the server)
      for (const id of client.channels.keys()) client.requestPermissions(id);
      // The admin list is on the root channel; whoever may edit it keeps it current
      this.loadDescription(0);
      this.refreshAdmins();
      if (back) this.system(this.view, 'Reconnected');
      else if (client.welcomeText) this.system(this.view, client.welcomeText, true);
      // Back to the channel we were in; the server may still refuse it
      if (rejoin != null && rejoin !== client.self?.channelId && client.channels.has(rejoin)) {
        this.pendingJoin = rejoin;
        client.joinChannel(rejoin);
      }
      // Your picture, kept on this device (servers drop it when you leave unless you are registered)
      ownAvatar.loaded.then(() => { if (live() && ownAvatar.bytes) this.sendPicture(ownAvatar.bytes); });
      this.mumpeer.hello();
      share.entered(this);
      textChannels.entered(this);
      bump();
    });
    client.on('pluginData', (sender, dataId, data) => {
      if (!live()) return;
      this.mumpeer.receive(sender, dataId, data);
      share.receive(this, sender, dataId, data);
      textChannels.receive(this, sender, dataId, data);
      files.receive(this, sender, dataId, data);
      reactions.receive(this, sender, dataId, data);
    });
    client.on('channel', ch => {
      // A description can return to earlier text, and so to a hash that must be fetchable again
      if (ch.description && ch.descriptionHash) this.requested.delete(descriptionTag(ch.id, ch.descriptionHash));
      if (live() && client.synced && !client.permissions.has(ch.id)) client.requestPermissions(ch.id);
      if (live() && client.synced) textChannels.channelChanged(this, ch.id);
      if (live() && client.synced && ch.id === 0) {
        this.rolesSending = false;
        clearTimeout(this.rolesTimer);
        this.loadDescription(0);
        this.publishAdmins(client);
      }
      bump();
    });
    client.on('acl', acl => {
      if (!live() || acl.channelId !== 0) return;
      this.adminList = rootAdmins(acl);
      this.rootAcl = acl;
      this.publishAdmins(client);
    });
    client.on('permissions', () => {
      if (!live()) return;
      this.checkAdmins(client);
      bump();
    });
    client.on('message', (name, msg) => {
      if (!live()) return;
      // Our permissions changed. The flush carries one channel; ask again for the others
      if (name === 'PermissionQuery' && msg.flush) {
        for (const id of client.channels.keys()) if (id !== msg.channel_id) client.requestPermissions(id);
      }
      // Follows ServerSync: only now is it known whether this server keeps the name's markup
      if (name === 'ServerConfig' && client.synced && !this.namesStarted) this.startNames(client);
      // Murmur sends everyone this, without a name, after the rules of a channel were saved
      if (name === 'ChannelState' && client.synced && msg.channel_id === 0 && msg.is_enter_restricted != null && msg.name == null) {
        this.adminsStale = true;
        this.checkAdmins(client);
      }
    });
    client.on('channelRemove', id => {
      if (!live()) return;
      if (this.userMove?.channelId === id && this.movingUsers) {
        failUserMove(this.userMove, 'The destination channel was removed.');
        this.updateUserMove();
      }
      if (this.panel.kind === 'channel' && this.panel.id === id) this.panel = { kind: 'members' };
      chatHistory.forget(this, `ch:${id}`);
      textChannels.channelRemoved(this, id);
      // The chat on screen is gone: back to the channel we are in
      if (this.view === `ch:${id}`) this.view = `ch:${client.self?.channelId ?? 0}`;
      delete this.logs[`ch:${id}`];
      delete this.unread[`ch:${id}`];
      bump();
    });
    client.on('ping', rtt => { if (live()) this.rtt = rtt; });
    client.on('udp', bump);

    client.on('user', (user, changed, actor, isNew) => {
      if (!live()) return;
      if (this.movingUsers && this.userMove) {
        confirmUserMove(this.userMove, user.session, user.channelId);
        this.updateUserMove();
      }
      this.mumpeer.userChanged(user, !!isNew || changed.includes('userId'));
      chatHistory.userChanged(this, user);
      const self = client.self;
      if (changed.includes('comment') && user.commentHash) this.requested.delete(commentTag(user.session, user.commentHash));
      if (user.session === client.session) {
        if (changed.includes('comment') || changed.includes('commentHash')) this.nameWrite = this.bannerWrite = null;
        // Murmur stores only what is written after registering, not the comment a guest already had
        if (client.synced && !isNew && changed.includes('userId') && user.userId != null) this.nameTask ??= 'persist';
        this.runNameTask(client);
      }
      // Also your own: after a change the server echoes a long comment as a hash only
      if (this.namesStarted && client.config.allowHtml !== false && user.commentHash && !user.comment) this.wantComment(client, user.session);
      const before = this.lastChannel.get(user.session);
      this.lastChannel.set(user.session, user.channelId);
      if (user.session === client.session && this.passwordTry?.id === user.channelId) {
        store.addToken(this.tokenKey, this.passwordTry.password);
        this.passwordTry = null;
      }
      if (client.synced && self && (isNew || changed.includes('channelId'))) {
        if (user.session === self.session) share.entered(this);
        else share.userMoved(this, user);
      }
      if (changed.includes('comment')) this.updateJoin(user);
      let flips = { mute: false, deaf: false };
      if (self && user.session === self.session) {
        const was = this.own;
        this.own = { mute: user.selfMute, deaf: user.selfDeaf };
        if (was) flips = { mute: was.mute !== user.selfMute, deaf: was.deaf !== user.selfDeaf };
        if (this.applied && (changed.includes('selfMute') || changed.includes('selfDeaf'))) {
          if (user.selfMute === this.applied.mute && user.selfDeaf === this.applied.deaf) flips = { mute: false, deaf: false };
          this.applied = null;
        }
      }
      if (client.synced && self && this.isVoice()) this.userSound(user.session === self.session, user, changed, actor, isNew, before, self.channelId, flips);
      if (client.synced && self) {
        if (isNew) {
          if (user.channelId === self.channelId) {
            const key = `ch:${self.channelId}`;
            const id = this.system(key, this.joinText(user));
            if (!user.comment && client.config.allowHtml !== false) {
              this.joinNotes.set(user.session, { key, id, timer: setTimeout(() => this.joinNotes.delete(user.session), JOIN_NAME_WAIT_MS) });
            }
          }
        } else if (changed.includes('userId') && user.userId != null) {
          const who = user.session === self.session ? 'You are' : `${escapeHtml(store.displayName(user))} is`;
          this.system(this.view, `${who} now registered on this server`);
        } else if (changed.includes('channelId')) {
          if (user.session === self.session) {
            // Follow our own channel moves in the chat view (also from a DM when we asked to join)
            if (this.view.startsWith('ch:') || this.pendingJoin === user.channelId) this.selectView(`ch:${user.channelId}`, false);
            this.pendingJoin = null;
            this.system(`ch:${user.channelId}`, `You joined ${escapeHtml(this.channel(user.channelId)?.name || 'Root')}`);
          } else if (user.channelId === self.channelId) {
            this.system(`ch:${self.channelId}`, `${escapeHtml(store.displayName(user))} joined the channel`);
          }
        }
      }
      bump();
    });

    client.on('userRemove', (user, actor, reason, ban) => {
      if (!live()) return;
      if (this.movingUsers && this.userMove) {
        failUserMove(this.userMove, 'Disconnected before the move was confirmed.', user.session);
        this.updateUserMove();
      }
      this.updateJoin(user);
      chatHistory.userLeft(this, user);
      this.selectedUsers = this.selectedUsers.filter(id => id !== user.session);
      // We were kicked or banned; the server closes the connection right after
      if (user.session === client.session) {
        const kicker = actor != null ? client.users.get(actor) : undefined;
        const by = kicker ? store.displayName(kicker) : '';
        this.removedBy = { kind: ban ? 'banned' : 'kicked', by, reason };
        // Like the desktop client: being removed by the server ends the automatic retry
        this.noRetry = true;
      }
      const self = client.self;
      this.mumpeer.userLeft(user.session);
      share.userMoved(this, user, true);
      textChannels.userLeft(this, user.session);
      files.userLeft(this, user.session);
      if (self && user.session !== self.session && this.isVoice() && user.channelId === self.channelId) {
        const byOther = actor != null && actor !== user.session;
        sounds.play(ban ? 'userBanned' : byOther ? 'userKicked' : 'userDisconnected');
      }
      this.lastChannel.delete(user.session);
      if (self && user.channelId === self.channelId) {
        const kicker = actor != null && actor !== user.session ? client.users.get(actor) : undefined;
        const by = kicker ? store.displayName(kicker) : null;
        const what = by ? `${ban ? 'was banned' : 'was kicked'} by ${escapeHtml(by)}` : 'disconnected';
        this.system(`ch:${self.channelId}`, `${escapeHtml(store.displayName(user))} ${what}${reason ? `: ${escapeHtml(reason)}` : ''}`);
      }
      if (this.panel.kind === 'user' && this.panel.session === user.session) this.panel = { kind: 'members' };
      const pic = this.pictures.get(user.session);
      if (pic) { URL.revokeObjectURL(pic.url); this.pictures.delete(user.session); }
      bump();
    });

    client.on('text', msg => {
      if (!live()) return;
      // Pieces of a file we asked for: never shown
      if (isPiece(msg.html)) {
        if (msg.actor != null) files.piece(this, msg.actor, msg.html);
        return;
      }
      const private_ = msg.actor != null && msg.actor !== client.session && !msg.channels.length && !msg.trees.length;
      const poke = private_ ? decodePoke(msg.html) : null;
      if (poke != null && msg.actor != null) {
        this.poked(msg.actor, poke);
        return;
      }
      this.receive(client, msg);
      if (msg.actor != null && msg.actor !== client.session) sounds.play(msg.channels.length || msg.trees.length ? 'message' : 'privateMessage');
    });

    client.on('permissionDenied', d => {
      if (!live()) return;
      // Only attribute a refusal when the server names the person. Other denials
      // remain in chat; an unconfirmed move times out without claiming success.
      if (this.movingUsers && this.userMove && d.session != null
        && !(d.session === client.session && d.permission === PERM.Enter && d.channelId === this.pendingJoin)
        && (d.permission === PERM.Move || d.permission === PERM.Enter || d.type === 2 || d.type === 9)
        && (d.channelId === this.userMove.channelId || this.userMove.people.some(p => p.id === d.session && p.channelId === d.channelId))) {
        failUserMove(this.userMove, describeDenial(d, this.channel(d.channelId!)?.name), d.session);
        this.updateUserMove();
      }
      const bannerWrite = this.bannerWrite;
      if (d.type === 4 && bannerWrite && Date.now() - bannerWrite.at < 5000) {
        this.bannerWrite = null;
        this.bannerColorOnly = true;
        this.system(this.view, 'This server refused your banner picture, so it is left out here.');
        this.writeComment(client, bannerWrite.base, bannerWrite.name);
        return;
      }
      const nameWrite = this.nameWrite;
      if (d.type === 4 && nameWrite && Date.now() - nameWrite.at < 5000) {
        this.nameWrite = null;
        store.setDisplayName(nameWrite.key, nameWrite.before);
        sounds.play('denied');
        this.system(this.view, 'Your description is too long for this server to also hold a display name. Shorten it and try again.');
        return;
      }
      // A preview picture can exceed what the server accepts; the file alone still gets through
      const img = this.lastImageSend;
      if (d.type === 4 && img && Date.now() - img.at < 5000) {
        this.lastImageSend = null;
        this.system(img.key, 'The server refused the preview picture, sent the file without it');
        client.sendText(this.target(img.key), img.fallback);
        return;
      }
      // Refused at the door: the channel may have a password. Servers before 1.4 do not say
      // in advance which channels are locked, so this is also where those ask for it.
      if (d.type === 1 && d.permission === PERM.Enter && d.channelId != null && d.channelId === this.pendingJoin) {
        const wrong = this.passwordTry?.id === d.channelId;
        this.pendingJoin = null;
        this.dropPasswordTry(client);
        sounds.play('denied');
        this.askPassword(d.channelId, wrong);
        return;
      }
      if (d.channelId != null && d.channelId === this.pendingJoin) {
        this.pendingJoin = null;
        this.dropPasswordTry(client);
      }
      sounds.play('denied');
      const ch = d.channelId != null ? client.channels.get(d.channelId)?.name : undefined;
      this.system(this.view, escapeHtml(describeDenial(d, ch)));
    });

    client.on('reject', (type, reason) => {
      if (!live()) return;
      this.removedBy = null;
      // Except UsernameInUse (5), while the server still holds our dropped session, and ServerFull (6)
      this.noRetry = type !== 5 && type !== 6;
      this.disconnectInfo = { kind: 'rejected', by: '', reason };
    });

    client.on('close', reason => {
      if (this.client !== client) return;
      this.resetUserMove();
      this.clearUserSelection();
      if (this.removedBy) this.disconnectInfo = this.removedBy;
      else if (!this.disconnectInfo && reason !== 'Disconnected') this.disconnectInfo = { kind: 'lost', by: '', reason };
      const kind = this.disconnectInfo?.kind;
      // A failed automatic attempt stays quiet; the sound played when the connection first ended
      if (client.synced || !this.reconnectAttempts) {
        sounds.play(kind === 'kicked' ? 'kicked' : kind === 'banned' ? 'banned' : kind === 'lost' ? 'connectionLost' : kind === 'rejected' ? 'error' : 'disconnected');
      }
      if (client.synced) this.lostChannel = client.self?.channelId ?? null;
      this.client = null;
      chatHistory.closed(this);
      share.closed(this);
      this.mumpeer.close();
      this.sharing = {};
      textChannels.closed(this);
      files.closed(this);
      reactions.closed(this);
      this.status = 'idle';
      this.error = reason === 'Disconnected' ? '' : reason;
      const retry = !this.noRetry && this.scheduleReconnect();
      connLog.add(`${this.server?.label ?? 'server'}: connection ended (${reason}); ${client.synced ? 'was connected' : 'before login'}; ${connLog.hidden ? 'page hidden' : 'page visible'}; ${retry ? `retry in ${this.reconnectDelay} s` : this.server?.autoReconnect === false ? 'automatic reconnect is off' : 'no retry'}`);
      sessions.onClosed(this, retry);
      this.tick++;
    });
  }

  // Presence sounds only come from the server where voice runs; others would be noise
  private isVoice(): boolean {
    return sessions.voiceId === this.server?.id;
  }

  // flips: which of your own mute and deafen really changed (and not by the app itself)
  private userSound(isSelf: boolean, user: User, changed: string[], actor: number | null, isNew: boolean, before: number | undefined, mine: number, flips: { mute: boolean; deaf: boolean }): void {
    if (isSelf) {
      const byOther = actor != null && actor !== user.session;
      if (changed.includes('channelId')) sounds.play(byOther ? 'moved' : 'switchedChannel');
      if (!byOther && flips.deaf) sounds.play(user.selfDeaf ? 'deafen' : 'undeafen');
      else if (!byOther && flips.mute) sounds.play(user.selfMute ? 'mute' : 'unmute');
      return;
    }
    const self = actor == null || actor === user.session;
    if (isNew) {
      if (user.channelId === mine) sounds.play('userConnected');
    } else if (changed.includes('channelId')) {
      if (user.channelId === mine) sounds.play(self ? 'userJoined' : 'userMovedIn');
      else if (before === mine) sounds.play(self ? 'userLeft' : 'userMovedOut');
    }
    if (changed.includes('recording') && user.channelId === mine) sounds.play(user.recording ? 'recordingStarted' : 'recordingStopped');
  }

  // ─── Panels, descriptions, comments ─────────────────────────────────────────

  showChannel(id: number, tab: 'info' | 'chat' = 'info'): void {
    this.panel = { kind: 'channel', id, tab };
    if (tab === 'chat') delete this.unread[`ch:${id}`];
    this.loadDescription(id);
  }

  showUser(session: number): void {
    this.panel = { kind: 'user', session };
    this.loadComment(session);
  }

  closePanel(): void {
    this.panel = { kind: 'members' };
  }

  // Long descriptions and comments are only announced by hash; fetch the text on demand
  loadDescription(id: number): void {
    const c = this.client?.channels.get(id);
    if (!c?.descriptionHash || c.description) return;
    const tag = descriptionTag(id, c.descriptionHash);
    if (this.requested.has(tag)) return;
    this.requested.add(tag);
    this.client!.requestBlob({ descriptions: [id] });
  }

  // For changes that rewrite the root description: false if its text does not arrive
  whenRootLoaded(ms = 5000): Promise<boolean> {
    const client = this.client;
    const root = client?.channels.get(0);
    if (!client || !root) return Promise.resolve(false);
    if (!root.descriptionHash || root.description) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => { off(); resolve(false); }, ms);
      const off = client.on('channel', ch => {
        if (ch.id !== 0 || !ch.description) return;
        clearTimeout(timer);
        off();
        resolve(true);
      });
      this.requested.delete(descriptionTag(0, root.descriptionHash!));
      this.loadDescription(0);
    });
  }

  loadComment(session: number): void {
    const u = this.client?.users.get(session);
    if (!u?.commentHash || u.comment) return;
    const tag = commentTag(session, u.commentHash);
    if (this.requested.has(tag)) return;
    this.requested.add(tag);
    this.client!.requestBlob({ comments: [session] });
  }

  // Object URL of someone's picture, or null for the letter instead. Pictures are only announced
  // by hash; the first call asks the server for them, and the view updates when they arrive.
  avatar(session: number | null | undefined): string | null {
    void this.tick;
    const client = this.client;
    if (!client || session == null) return null;
    if (session === client.session && ownAvatar.url) return ownAvatar.url;
    const u = client.users.get(session);
    if (!u) return null;
    if (!u.texture) {
      if (u.textureHash) this.wantPicture(session, u.textureHash);
      return null;
    }
    // Empty: the picture was removed
    if (!u.texture.length) return null;
    const have = this.pictures.get(session);
    if (have?.bytes === u.texture) return have.url;
    if (have) URL.revokeObjectURL(have.url);
    const url = URL.createObjectURL(new Blob([u.texture as BlobPart]));
    this.pictures.set(session, { bytes: u.texture, url });
    return url;
  }

  private wantPicture(session: number, hash: Uint8Array): void {
    const tag = `t:${session}:${[...hash].join(',')}`;
    if (this.requested.has(tag)) return;
    this.requested.add(tag);
    this.wantedPictures.add(session);
    if (this.wantedPictures.size > 1) return;
    // Called while rendering: ask once the render is done, for everyone seen in it
    queueMicrotask(() => {
      const ids = [...this.wantedPictures];
      this.wantedPictures.clear();
      this.client?.requestBlob({ textures: ids });
    });
  }

  private dropPictures(): void {
    for (const p of this.pictures.values()) URL.revokeObjectURL(p.url);
    this.pictures.clear();
    this.wantedPictures.clear();
  }

  // Sends your picture if this server takes one that large (it drops larger ones without a word)
  sendPicture(bytes: Uint8Array): boolean {
    const client = this.client;
    if (!client || this.status !== 'connected') return false;
    const limit = client.config.imageMessageLength;
    if (limit > 0 && bytes.length > limit) return false;
    client.setTexture(bytes);
    return true;
  }

  register(session: number): void {
    this.client?.register(session);
  }

  // Servers without HTML remove the marker the chosen name travels in
  get canChooseName(): boolean {
    void this.tick;
    return this.status === 'connected' && this.client?.config.allowHtml !== false;
  }

  // Empty goes back to the account name
  setDisplayName(raw: string): void {
    const client = this.client;
    const self = client?.self;
    if (!client || !self || !this.canChooseName) return;
    const name = cleanDisplayName(raw);
    this.nameTask = { set: name === self.name ? '' : name };
    this.runNameTask(client);
  }

  private nameKey(self: User): string {
    return `${this.tokenKey}:${self.hash || `name:${self.name}`}`;
  }

  private startNames(client: MumbleClient): void {
    this.namesStarted = true;
    if (client.config.allowHtml === false) return;
    this.nameTask = 'restore';
    this.runNameTask(client);
    for (const u of client.users.values()) {
      if (u.session !== client.session && u.commentHash && !u.comment) this.wantComment(client, u.session);
    }
  }

  private runNameTask(client: MumbleClient): void {
    const self = client.self;
    const task = this.nameTask;
    if (!self || !task) return;
    if (self.commentHash && !self.comment) {
      this.loadComment(self.session);
      return;
    }
    // The banner is read from this device's storage, normally long before connecting
    if (!ownBanner.ready) {
      void ownBanner.loaded.then(() => { if (this.client === client) this.runNameTask(client); });
      return;
    }
    this.nameTask = null;
    const outdated = (name: string) => this.composeComment(self.comment, name) !== self.comment;
    if (task === 'persist') {
      if (self.comment || this.bannerMark()) this.writeComment(client, self.comment, self.chosenName);
      return;
    }
    if (task === 'banner') {
      if (outdated(self.chosenName)) this.writeComment(client, self.comment, self.chosenName);
      return;
    }
    const key = this.nameKey(self);
    // The server keeps a registered user's comment, so it is newer than this computer's copy,
    // also when the name was removed on another device. The banner is this device's.
    if (task === 'restore' && self.userId != null) {
      store.setDisplayName(key, self.chosenName);
      if (outdated(self.chosenName)) this.writeComment(client, self.comment, self.chosenName);
      return;
    }
    const saved = store.displayNames[key] ?? '';
    const name = task === 'restore' ? saved : task.set;
    store.setDisplayName(key, name);
    // Saved differs while an earlier change is still on its way back from the server
    if (name !== self.chosenName || name !== saved || outdated(name)) {
      if (name !== saved) this.nameWrite = { key, before: saved, at: Date.now() };
      this.writeComment(client, self.comment, name);
    }
  }

  private bannerMark(): string {
    return this.bannerColorOnly ? bannerMark({ color: ownBanner.color, image: null }) : ownBanner.mark;
  }

  private composeComment(base: string, name: string): string {
    return withBanner(withDisplayName(base, name), this.bannerMark());
  }

  // Every write of your own comment carries your chosen name and banner
  private writeComment(client: MumbleClient, base: string, name: string): void {
    this.bannerWrite = ownBanner.image && !this.bannerColorOnly ? { base, name, at: Date.now() } : null;
    client.setComment(this.composeComment(base, name));
  }

  // After the banner changed in the profile editor
  publishBanner(): void {
    const client = this.client;
    if (!client || this.status !== 'connected' || !this.namesStarted || client.config.allowHtml === false) return;
    this.bannerColorOnly = false;
    this.nameTask ??= 'banner';
    this.runNameTask(client);
  }

  private wantComment(client: MumbleClient, session: number): void {
    this.wantedComments.add(session);
    this.commentTimer ??= setTimeout(() => this.fetchComments(client), 0);
  }

  // A server full of long descriptions should not arrive all at once
  private fetchComments(client: MumbleClient): void {
    this.commentTimer = null;
    if (this.client !== client) return;
    const batch = [...this.wantedComments].slice(0, COMMENT_BATCH);
    for (const id of batch) {
      this.wantedComments.delete(id);
      this.loadComment(id);
    }
    if (this.wantedComments.size) this.commentTimer = setTimeout(() => this.fetchComments(client), COMMENT_PAUSE_MS);
  }

  // html comes from the rich editor, already sanitized XHTML
  setComment(html: string): void {
    const client = this.client;
    const self = client?.self;
    if (!client || !self) return;
    const task = typeof this.nameTask === 'object' ? this.nameTask : null;
    if (this.nameTask === 'banner') this.nameTask = null;
    if (task) {
      const key = this.nameKey(self);
      const before = store.displayNames[key] ?? '';
      if (task.set !== before) this.nameWrite = { key, before, at: Date.now() };
      store.setDisplayName(key, task.set);
      this.nameTask = null;
    }
    this.writeComment(client, html, task ? task.set : self.chosenName);
  }

  // Largest description or image message the server accepts (0: no limit)
  get htmlLimit(): number {
    void this.tick;
    return this.client?.config.imageMessageLength ?? 131072;
  }

  // ─── Chat ───────────────────────────────────────────────────────────────────

  // time: for messages from earlier, which go where they belong in the log. quiet: not counted as unread.
  private push(key: string, entry: Omit<ChatEntry, 'id' | 'time' | 'reactions'>, opts: { time?: number; quiet?: boolean; raw?: string; historyId?: string; reactions?: Reaction[] } = {}): number {
    // Assign first, then push through the stored proxy; pushing onto the raw array would not be reactive
    if (!this.logs[key]) this.logs[key] = [];
    const log = this.logs[key];
    const time = opts.time ?? Date.now();
    const author = entry.authorSession != null ? this.client?.users.get(entry.authorSession) : undefined;
    if (!entry.authorIdentity && author) entry = { ...entry, authorIdentity: chatAuthorKey(author) };
    let at = log.length;
    while (at > 0 && log[at - 1].time > time) at--;
    const id = nextId++;
    log.splice(at, 0, { ...entry, reactions: opts.reactions ?? [], id, time, historyId: opts.historyId });
    if (opts.raw !== undefined && !opts.quiet) chatHistory.record(this, key, opts.raw, log[at]);
    if (!opts.quiet && (sessions.active !== this || !this.visibleKeys().includes(key))) this.unread[key] = (this.unread[key] ?? 0) + 1;
    // Files announced just now; ones from earlier wait for a click
    if (!opts.quiet && !entry.self) for (const e of entry.embeds) if (e.file) files.offered(this, e.file, entry.authorSession);
    return id;
  }

  persistTextHistory(): Promise<void> { return textChannels.persist(this); }

  expireChat(now = Date.now()): void {
    for (const [key, entries] of Object.entries(this.logs)) {
      const kept = entries.filter(e => currentChatMessage(e.time, now, historyHours(store.settings.chatHistoryHours) * 60 * 60 * 1000));
      if (kept.length !== entries.length) this.logs[key] = kept;
      if (this.unread[key]) {
        const count = Math.min(this.unread[key], kept.filter(e => e.kind === 'text' && !e.self).length);
        if (count) this.unread[key] = count;
        else delete this.unread[key];
      }
    }
    textChannels.expire(this, now);
  }

  // Stored HTML is sanitized again; authors reconnect by identity, never by old session numbers.
  restoreChat(key: ViewKey, message: SavedMessage): void {
    const render: (raw: string, hosts: string[], inlineImages?: boolean) => ReturnType<typeof renderIncoming> = renderIncoming;
    if (!currentChatMessage(message.time, Date.now(), historyHours(store.settings.chatHistoryHours) * 60 * 60 * 1000) || this.logs[key]?.some(e => e.historyId === message.id)) return;
    this.push(key, { kind: 'text', author: message.author, authorSession: null, authorIdentity: message.authorIdentity, self: message.self,
      ref: messageRef(message.raw), ...render(message.raw, store.trustedHosts, true) },
      { time: message.time, quiet: true, historyId: message.id, reactions: message.reactions && copyReactions(message.reactions) });
  }

  // A text channel message: live, kept from earlier, or handed over by another client
  addText(m: TextMsg, self: boolean, quiet: boolean, sender: number | null = null): void {
    const client = this.client;
    if (!client) return;
    const online = sender != null ? client.users.get(sender) : self ? client.self : m.k ? [...client.users.values()].find(u => u.hash === m.k) : undefined;
    this.push(`ch:${m.c}`, {
      kind: 'text', author: online ? store.displayName(online) : m.n, authorSession: online?.session ?? null, self, ref: textRef(m.i),
      authorIdentity: online ? chatAuthorKey(online) : m.k ? `hash:${m.k}` : undefined,
      ...renderIncoming(m.h, store.trustedHosts, true)
    }, { time: m.t, quiet, reactions: m.x && copyReactions(m.x) });
  }

  private joinText(user: User): string {
    return `${escapeHtml(store.displayName(user))} connected`;
  }

  // Rewrites the person's "connected" line once their chosen name is known
  private updateJoin(user: User): void {
    const note = this.joinNotes.get(user.session);
    if (!note) return;
    clearTimeout(note.timer);
    this.joinNotes.delete(user.session);
    const entry = this.logs[note.key]?.find(e => e.id === note.id);
    if (entry) entry.html = this.joinText(user);
  }

  private system(key: string, html: string, trusted = false): number {
    const rendered = trusted ? renderIncoming(html, store.trustedHosts) : { html, embeds: [] };
    return this.push(key, { kind: 'system', author: '', authorSession: null, self: false, ...rendered });
  }

  private receive(client: MumbleClient, msg: TextMessage): void {
    const self = client.self;
    const sender = msg.actor != null ? client.users.get(msg.actor) : undefined;
    let key: string;
    if (msg.actor == null) key = this.view;
    else if (msg.channels.length || msg.trees.length) key = `ch:${msg.channels[0] ?? self?.channelId ?? 0}`;
    else key = `dm:${msg.actor}`;

    const rendered = renderIncoming(msg.html, store.trustedHosts, msg.actor != null);
    if (msg.actor == null) {
      this.push(key, { kind: 'system', author: '', authorSession: null, self: false, ...rendered });
    } else {
      this.push(key, { kind: 'text', author: sender ? store.displayName(sender) : `#${msg.actor}`, authorSession: msg.actor, self: false, ref: messageRef(msg.html), ...rendered }, { raw: msg.html });
    }
  }

  // A poke: a popup for them in mumh5, a private message in other clients
  poke(target: number, text: string): void {
    const client = this.client;
    const user = client?.users.get(target);
    if (!client || !user || this.status !== 'connected') return;
    client.sendText({ users: [target] }, encodePoke(text));
    sounds.play('messageSent');
    const note = text.trim();
    this.system(`dm:${target}`, `You poked ${escapeHtml(store.displayName(user))}${note ? ': ' + escapeHtml(note) : ''}`);
  }

  private poked(from: number, note: string): void {
    const user = this.client?.users.get(from);
    const name = user ? store.displayName(user) : `#${from}`;
    this.system(`dm:${from}`, `${escapeHtml(name)} poked you${note ? ': ' + escapeHtml(note) : ''}`);
    // Newest last; a flood keeps only the most recent ones
    ui.pokes = [...ui.pokes, { id: nextId++, server: this.server?.id ?? '', serverName: this.server?.label || this.server?.host || '', from, name, note, time: Date.now() }].slice(-20);
    sounds.play('poke');
    desktop?.attention();
    notifyPoke(`${name} poked you`, note);
  }

  // Opening a server marks what is on screen as read
  markVisibleRead(): void {
    for (const k of this.visibleKeys()) delete this.unread[k];
  }

  // reveal: false when the server moved you, which should not pull you off the home screen
  selectView(key: ViewKey, reveal = true): void {
    this.view = key;
    if (key.startsWith('dm:')) {
      if (!this.logs[key]) this.logs[key] = [];
      chatHistory.record(this, key, '');
    }
    delete this.unread[key];
    if (reveal) sessions.homeShown = false;
  }

  // Hides a direct chat; opening it or receiving a message restores its retained history.
  closeDm(key: `dm:${number}`): void {
    chatHistory.hide(this, key);
    delete this.logs[key];
    delete this.unread[key];
    if (this.view === key) this.view = `ch:${this.self?.channelId ?? 0}`;
  }

  deleteDm(key: `dm:${number}`): void {
    chatHistory.forget(this, key);
    this.closeDm(key);
  }

  // The view follows once the server confirms the move (see the 'user' handler). Murmur
  // silently drops own state changes sent too quickly (leaky bucket, about one per second),
  // so an unconfirmed join is sent once more before giving up.
  joinChannel(id: number): void {
    const client = this.client;
    if (!client) return;
    if (this.self?.channelId !== id && client.channels.get(id)?.canEnter === false && this.passwordTry?.id !== id) {
      this.askPassword(id);
      return;
    }
    // Joining a channel is where you want to talk: voice moves to this server
    sessions.setVoice(this);
    if (this.self?.channelId === id) {
      this.selectView(`ch:${id}`);
      return;
    }
    this.pendingJoin = id;
    client.joinChannel(id);
    const moved = () => this.client !== client || this.pendingJoin !== id || client.self?.channelId === id;
    setTimeout(() => {
      if (moved()) return;
      client.joinChannel(id);
      setTimeout(() => {
        if (moved()) return;
        this.pendingJoin = null;
        this.dropPasswordTry(client);
        this.system(this.view, `The server did not move you to ${escapeHtml(client.channels.get(id)?.name || 'Root')}. Try again in a moment.`);
      }, 1500);
    }, 1200);
  }

  // ─── Channel passwords and admins ───────────────────────────────────────────

  // Passwords are kept per address, so editing a saved server never sends them somewhere else
  private get tokenKey(): string {
    const s = this.server;
    return s ? `${s.host.toLowerCase()}:${s.port}` : '';
  }

  ownTokens(): string[] {
    return store.tokensFor(this.tokenKey);
  }

  // A client cannot tell a password from a channel that is simply closed to it
  private askPassword(id: number, wrong = false): void {
    const client = this.client;
    const name = this.client?.channels.get(id)?.name || 'Root';
    const batch = this.userMove?.channelId === id ? this.userMove : null;
    const person = batch?.people.find(p => p.id === this.self?.session && (p.status === 'pending' || p.status === 'password'));
    if (person) person.status = 'password';
    let submitted = false;
    ui.prompt = {
      title: `Join ${name}`, label: 'Channel password', confirm: 'Join', input: 'password',
      text: wrong ? 'Wrong password, or this channel is closed to you.' : 'This channel is locked.',
      onsubmit: password => {
        if (!password || this.client !== client || (person && this.userMove !== batch)) return;
        submitted = true;
        if (person && this.userMove === batch) { person.status = 'pending'; this.timeUserMove(); }
        this.enterWithPassword(id, password);
      },
      oncancel: () => {
        if (!submitted && person && this.userMove === batch) {
          failUserMove(batch!, 'You cancelled joining the channel.', person.id);
          this.updateUserMove();
        }
      }
    };
  }

  // The token goes first: the server handles it before the move that follows
  private enterWithPassword(id: number, password: string): void {
    const client = this.client;
    if (!client || !password) return;
    this.passwordTry = { id, password };
    client.setTokens([...store.tokensFor(this.tokenKey), password]);
    this.joinChannel(id);
  }

  private dropPasswordTry(client: MumbleClient): void {
    if (!this.passwordTry) return;
    this.passwordTry = null;
    client.setTokens(store.tokensFor(this.tokenKey));
  }

  // After setting a password: keep it, so this person is not locked out without Write later
  rememberChannelPassword(password: string, previous = ''): void {
    if (previous) store.removeToken(this.tokenKey, previous);
    if (password) store.addToken(this.tokenKey, password);
    this.client?.setTokens(store.tokensFor(this.tokenKey));
  }

  // Call before creating the channel: the server only takes rules on a channel that exists
  passwordForNewChannel(parent: number, name: string, password: string): void {
    const client = this.client;
    if (!client) return;
    this.rememberChannelPassword(password);
    const known = new Set(client.channels.keys());
    let id: number | null = null;
    const offs: (() => void)[] = [];
    const done = () => { clearTimeout(timer); offs.forEach(off => off()); };
    const timer = setTimeout(() => {
      done();
      // A channel that looks protected but is not must not go unnoticed
      if (id != null && this.client === client) this.system(this.view, `The password for ${escapeHtml(name)} was not set.`);
    }, 8000);
    offs.push(client.on('channel', ch => {
      if (id != null || known.has(ch.id) || ch.parent !== parent || ch.name !== name) return;
      id = ch.id;
      client.queryAcl(id);
    }));
    offs.push(client.on('acl', acl => {
      if (acl.channelId !== id) return;
      done();
      client.saveAcl(withPassword(acl, password));
    }));
  }

  // Asks for the root rules if we may read them; the answer updates the published list
  refreshAdmins(): void {
    const client = this.client;
    if (client?.can(0, PERM.Write)) client.queryAcl(0);
  }

  // Waits until we know again whether we may read the root rules
  private checkAdmins(client: MumbleClient): void {
    if (!this.adminsStale || client.can(0, PERM.Write) == null) return;
    this.adminsStale = false;
    this.refreshAdmins();
  }

  private publishAdmins(client: MumbleClient): void {
    const ids = this.adminList;
    const root = client.channels.get(0);
    if (!ids || !root || client.config.allowHtml === false || this.rolesSending) return;
    // Rewriting a description we have not read yet would erase it
    if (root.descriptionHash && !root.description) {
      this.loadDescription(0);
      return;
    }
    this.adminList = null;
    const acl = this.rootAcl;
    this.rootAcl = null;
    const doc = parseRoles(root.description);
    const next = withRoles(withAdmins(root.description, ids), doc && acl ? refreshDoc(doc, acl) : doc);
    const limit = /<img/i.test(next) ? client.config.imageMessageLength : client.config.messageLength;
    if (next !== root.description && (!limit || next.length <= limit)) client.updateChannel(0, { description: next });
  }

  // Rules first, then the names and members everyone can read. A problem comes back as text.
  saveRoles(acl: ChannelAcl, doc: RoleDoc): string | null {
    const client = this.client;
    const root = client?.channels.get(0);
    if (!client || !root) return 'Not connected.';
    if (root.descriptionHash && !root.description) {
      this.loadDescription(0);
      return 'The server description is still loading. Try again in a moment.';
    }
    if (client.config.allowHtml === false) {
      client.saveAcl(acl);
      this.system(this.view, 'Roles saved. This server does not allow HTML, so their names and icons are not kept.');
      return null;
    }
    const next = withRoles(withAdmins(root.description, parseAdmins(root.description)), doc);
    const limit = client.config.imageMessageLength;
    if (limit && next.length > limit) return `Too much role data for this server (${next.length} / ${limit} characters). Remove some uploaded icons.`;
    this.adminList = null;
    this.rootAcl = null;
    client.saveAcl(acl);
    if (next !== root.description) {
      this.rolesSending = true;
      clearTimeout(this.rolesTimer);
      // If the server refuses it no answer comes
      this.rolesTimer = setTimeout(() => { this.rolesSending = false; }, 8000);
      client.updateChannel(0, { description: next });
    }
    this.refreshAdmins();
    return null;
  }

  // The root rules as they are now. The ping comes first: the answer to an earlier query could
  // still be on its way and would hide a change just saved.
  async readRootAcl(ms = 5000): Promise<ChannelAcl | null> {
    const client = this.client;
    if (!client) return null;
    await Promise.race([client.flushed(), new Promise(r => setTimeout(r, ms))]);
    return new Promise(resolve => {
      const timer = setTimeout(() => { off(); resolve(null); }, ms);
      const off = client.on('acl', a => {
        if (a.channelId !== 0) return;
        clearTimeout(timer);
        off();
        resolve(a);
      });
      client.queryAcl(0);
    });
  }

  keepsRootWrite(acl: ChannelAcl): boolean {
    const me = this.client?.self;
    if (!me || me.userId === 0) return true;
    const level = { channelId: 0, name: 'Root', inheritAcls: acl.inheritAcls, rules: acl.acls, groups: acl.groups };
    const who = { userId: me.userId, hash: me.hash, channelId: me.channelId, tokens: this.ownTokens(), strong: false };
    return !!(effectivePermissions([level], who, () => null) & PERM.Write);
  }

  // Applied to the newest rules, so what another admin saved meanwhile stays
  async changeMembers(changes: { group: string; userId: number; on: boolean }[]): Promise<ChannelAcl | null> {
    const fresh = await this.readRootAcl();
    if (!fresh || !(await this.whenRootLoaded())) {
      this.system(this.view, 'Could not read the roles. Nothing was changed.');
      return null;
    }
    const next = changes.reduce((acl, c) => setMember(acl, c.group, c.userId, c.on), fresh);
    const roles = rolesFromAcl(next, this.roleDoc);
    const ready = prepareRoles(next, roles);
    if (this.keepsRootWrite(fresh) && !this.keepsRootWrite(ready)) {
      this.system(this.view, 'That would remove your own admin access. Nothing was changed.');
      return null;
    }
    const problem = this.saveRoles(ready, docFromRoles(roles.map(r => ({ ...r, m: isBuiltinRole(r.g) ? [] : roleMembers(ready, r.g) }))));
    if (problem) {
      this.system(this.view, escapeHtml(problem));
      return null;
    }
    return ready;
  }

  private target(key: string): { channels?: number[]; users?: number[] } {
    const [kind, id] = key.split(':');
    return kind === 'ch' ? { channels: [Number(id)] } : { users: [Number(id)] };
  }

  // Send HTML to a view and echo it locally (the server does not echo our messages).
  sendHtml(html: string, key: string = this.view): boolean {
    const client = this.client;
    if (!client || this.status !== 'connected') return false;
    if (key.startsWith('dm:') && !this.user(Number(key.slice(3)))) return false;
    if (key.startsWith('ch:') && this.isText(Number(key.slice(3)))) {
      if (html.length > MAX_HTML) {
        this.system(key, `Message too long for a text channel (${html.length} / ${MAX_HTML} characters)`);
        return false;
      }
      // Shown in the log by the text channel code once it is on its way
      textChannels.post(this, Number(key.slice(3)), html).then(problem => { if (problem) this.system(key, escapeHtml(problem)); });
      sounds.play('messageSent');
      return true;
    }
    const limit = /<img/i.test(html) ? client.config.imageMessageLength : client.config.messageLength;
    if (limit && html.length > limit) {
      this.system(key, `Message too long for this server (${html.length} / ${limit} characters)`);
      return false;
    }
    const entryId = nextId;
    client.sendText(this.target(key), html);
    sounds.play('messageSent');
    const rendered = renderIncoming(html, store.trustedHosts, true);
    this.push(key, { kind: 'text', author: client.self ? store.displayName(client.self) : '', authorSession: client.session, self: true, ref: messageRef(html), ...rendered });
    chatHistory.record(this, key, html, this.logs[key].find(e => e.id === entryId));
    return true;
  }

  // The reactions of a message changed: keep them with the saved history
  reacted(key: string, entry: ChatEntry): void {
    const channel = key.startsWith('ch:') ? Number(key.slice(3)) : NaN;
    if (this.isText(channel) && entry.ref?.startsWith('t:')) textChannels.reacted(this, channel, entry.ref.slice(2), entry.reactions);
    else chatHistory.reacted(this, key, entry);
  }

  // Reactions need plugin data, so a 1.4 server; only mumh5 clients see them
  get canReact(): boolean {
    void this.tick;
    return reactions.supported(this);
  }

  // Adds or removes your reaction to a message; on left out toggles it
  react(key: string, entryId: number, emoji: string, on?: boolean): void {
    reactions.toggle(this, key, entryId, emoji, on);
  }

  // The longest text message (HTML, no pictures) the chat at `key` takes; 0 when not known
  messageLimit(key: string = this.view): number {
    if (key.startsWith('ch:') && this.isText(Number(key.slice(3)))) return MAX_HTML;
    return this.client?.config.messageLength ?? 0;
  }

  sendText(text: string, key: string = this.view): boolean {
    const trimmed = text.trim();
    return trimmed ? this.sendHtml(textToHtml(trimmed), key) : false;
  }

  // Pictures that fit as they are go inline, like a pasted picture in the desktop client, and
  // everyone sees them. Everything else is announced in the chat and sent to mumh5 users who
  // ask for it, through the server (see files.svelte.ts); other clients get a preview picture.
  async sendFiles(list: File[], key: string = this.view): Promise<void> {
    const client = this.client;
    if (!client || (key.startsWith('dm:') && !this.user(Number(key.slice(3))))) return;
    const textKey = key.startsWith('ch:') && this.isText(Number(key.slice(3)));
    const cfg = client.config;
    // 0 means no limit; stay reasonable anyway
    const limit = textKey ? MAX_HTML : cfg.imageMessageLength || 1024 * 1024;
    for (const file of list) {
      const alt = escapeHtml(file.name);
      if (!textKey && cfg.allowHtml === false) {
        this.system(key, 'This server does not allow pictures or files in messages. Text channels can still carry files.');
        return;
      }
      if (file.type.startsWith('image/')) {
        const uri = await originalImage(file, limit - 64 - alt.length);
        if (uri) { this.sendHtml(`<img src="${uri}" alt="${alt}"/>`, key); continue; }
      }
      if (!files.supported(this)) {
        // Old servers: no requests between clients, so pictures go scaled and other files not at all
        const uri = file.type.startsWith('image/') ? await makeInlineImage(file, limit - 64 - alt.length) : null;
        if (uri) this.sendHtml(`<img src="${uri}" alt="${alt}"/>`, key);
        else this.system(key, `${escapeHtml(file.name)}: sending files needs a server running Mumble 1.4 or newer`);
        continue;
      }
      const job: FileJob = { id: nextId++, key, name: file.name, progress: 0 };
      this.preparing.push(job);
      const meta = await files.share(this, file, p => {
        const live = this.preparing.find(j => j.id === job.id);
        if (live) live.progress = p;
      });
      this.preparing = this.preparing.filter(j => j.id !== job.id);
      if (typeof meta === 'string') {
        this.system(key, escapeHtml(meta));
        sounds.play('uploadFailed');
        continue;
      }
      // What other clients show; mumh5 shows its own card instead
      const visible = `<b>${escapeHtml(meta.n)}</b> (${formatBytes(meta.s)}, file shared with mumh5)`;
      const plain = announce(meta, visible);
      let preview: string | null = null;
      if (store.settings.sendThumbnails) {
        const budget = Math.min(limit, 100000) - plain.length - 64;
        const kind = fileKind(meta);
        preview = kind === 'image' ? await makeInlineImage(file, budget) : kind === 'video' ? await videoPoster(file, budget) : null;
      }
      const html = preview ? announce(meta, `${visible}<br/><img src="${preview}"/>`) : plain;
      if (preview) this.lastImageSend = { key, fallback: plain, at: Date.now() };
      this.sendHtml(html, key);
    }
  }

  // ─── Voice state and moderation ─────────────────────────────────────────────

  setSharing(session: number, kind: ShareKind | false): void {
    if (kind) this.sharing[session] = kind;
    else delete this.sharing[session];
  }
  clearSharing(): void { this.sharing = {}; }

  // The choice is remembered, so it also works while disconnected and carries to the next connect
  setSelfMute(v: boolean) {
    sessions.mute = v;
    if (!v) sessions.deaf = false;
    this.client?.setSelfMute(v);
  }
  setSelfDeaf(v: boolean) {
    sessions.deaf = v;
    if (v) sessions.mute = true;
    this.client?.setSelfDeaf(v);
  }

  // Mute and deafen set by the app rather than by a click, confirmed without a sound
  applyOwnState(mute: boolean, deaf: boolean): void {
    if (!this.client) return;
    const mark = { mute, deaf };
    this.applied = mark;
    this.client.send('UserState', { self_mute: mute, self_deaf: deaf });
    // No confirmation comes when nothing changed; a later click must not be silenced by this
    setTimeout(() => { if (this.applied === mark) this.applied = null; }, 3000);
  }

  kick(session: number, reason: string, ban = false) { this.client?.kick(session, reason, ban); }
  setServerMute(session: number, v: boolean) { this.client?.setUserState(session, { mute: v }); }
  setServerDeaf(session: number, v: boolean) { this.client?.setUserState(session, { deaf: v }); }
  setPrioritySpeaker(session: number, v: boolean) { this.client?.setUserState(session, { priority_speaker: v }); }
  moveUser(session: number, channelId: number) { this.client?.setUserState(session, { channel_id: channelId }); }
}

// ─── Several servers at once ───────────────────────────────────────────────────
// Every server has its own Session. Text works on all of them; voice runs on one (like
// Discord): the server where you last joined a channel. On the others you are shown as
// deafened, so nobody expects you to hear them, and your state is restored when voice returns.

class Sessions {
  list = $state<Session[]>([]);
  activeId = $state<string | null>(null);
  voiceId = $state<string | null>(null);
  private idle = new Session();
  // Self mute/deaf as the user last chose it, like the desktop client: shown and toggled
  // while disconnected and applied to servers when they connect
  mute = $state(false);
  deaf = $state(false);
  // Self mute/deaf before we deafened a background server, to restore later
  private saved = new Map<Session, { mute: boolean; deaf: boolean }>();

  // The home screen over a connected server, which keeps running behind it
  homeShown = $state(false);

  get active(): Session {
    return this.list.find(s => s.server?.id === this.activeId) ?? this.idle;
  }

  byServer(id: string): Session | undefined {
    return this.list.find(s => s.server?.id === id);
  }

  // Your picture for every server: saved here and sent to the ones you are on (null removes it)
  async setAvatar(bytes: Uint8Array | null): Promise<void> {
    await ownAvatar.save(bytes);
    for (const s of this.list) if (s.status === 'connected') s.sendPicture(bytes ?? new Uint8Array(0));
  }

  // Your banner for every server, published in your comment on the ones you are on
  async setBanner(banner: Banner): Promise<void> {
    await ownBanner.save(banner);
    for (const s of this.list) s.publishBanner();
  }

  // Show a server, connecting if needed
  open(server: SavedServer): void {
    // A server added for you (the site's default) has no name yet; pick one first
    if (!server.username.trim()) {
      ui.editServer = server;
      return;
    }
    let s = this.byServer(server.id);
    this.activeId = server.id;
    this.homeShown = false;
    s?.markVisibleRead();
    if (!s) {
      s = new Session();
      this.list.push(s);
      s = this.list[this.list.length - 1];
    }
    if (s.status === 'idle') s.connect(server);
  }

  // At start: connect the servers marked for it, showing the first of them
  connectOnStart(servers: SavedServer[]): void {
    const auto = servers.filter(s => s.autoConnect);
    for (const s of auto) this.open(s);
    if (auto.length) this.select(auto[0].id);
  }

  select(id: string): void {
    this.activeId = id;
    this.homeShown = false;
    this.active.markVisibleRead();
  }

  close(id: string): void {
    const s = this.byServer(id);
    if (!s) return;
    s.disconnect();
    this.list = this.list.filter(x => x !== s);
    if (this.activeId === id) this.activeId = this.list.find(x => x.status !== 'idle')?.server?.id ?? null;
  }

  get voiceSession(): Session | undefined {
    return this.list.find(s => s.server?.id === this.voiceId);
  }

  onSynced(s: Session): void {
    const want = { mute: this.mute, deaf: this.deaf };
    // Voice may have waited here through an automatic reconnect
    if (!this.voiceId || this.voiceId === s.server?.id || !this.voiceSession?.client) {
      this.setVoice(s, true);
      if (want.mute) s.applyOwnState(true, want.deaf);
    } else {
      this.toBackground(s);
      // A fresh login is unmuted; restore the user's choice when voice comes here
      if (this.saved.has(s)) this.saved.set(s, want);
    }
  }

  // retrying: the server reconnects by itself, so voice waits for it (joining a channel elsewhere takes it)
  onClosed(s: Session, retrying = false): void {
    this.saved.delete(s);
    if (this.voiceId !== s.server?.id) return;
    voice.detach();
    if (retrying) return;
    // Hand voice to another connected server, if any
    const next = this.list.find(x => x !== s && x.client && x.status === 'connected');
    this.voiceId = null;
    if (next) this.setVoice(next);
  }

  setVoice(s: Session, first = false): void {
    const id = s.server?.id ?? null;
    if (!id || (this.voiceId === id && !first)) return;
    const prev = this.voiceSession;
    if (prev && prev !== s) {
      voice.detach();
      this.toBackground(prev);
    }
    this.voiceId = id;
    this.fromBackground(s);
    if (s.client) voice.attach(s.client);
  }

  private toBackground(s: Session): void {
    const self = s.client?.self;
    if (!s.client || !self || this.saved.has(s)) return;
    this.saved.set(s, { mute: self.selfMute, deaf: self.selfDeaf });
    if (!self.selfDeaf) s.client.setSelfDeaf(true);
  }

  nudgeAll(): void {
    for (const s of this.list) s.nudge();
  }

  private fromBackground(s: Session): void {
    const prev = this.saved.get(s);
    this.saved.delete(s);
    if (!prev || !s.client || prev.deaf) return;
    s.applyOwnState(prev.mute, false);
  }
}

export const sessions = new Sessions();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sessions.nudgeAll(); });
  window.addEventListener('online', () => sessions.nudgeAll());
  window.addEventListener('pageshow', e => { if (e.persisted) sessions.nudgeAll(); });
}

// The session of the server on screen. Forwards to the active Session so components keep
// using `session.x`; methods are bound to the real instance so async work stays with its server.
export const session = new Proxy({} as Session, {
  get(_t, prop) {
    const a = sessions.active;
    const v = Reflect.get(a, prop, a);
    return typeof v === 'function' ? v.bind(a) : v;
  },
  set(_t, prop, value) {
    return Reflect.set(sessions.active, prop, value, sessions.active);
  }
});
