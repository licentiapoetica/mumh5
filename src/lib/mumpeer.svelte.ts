import type { User } from '../core/client.ts';
import {
  MUMCORD_HELLO, MUMCORD_PEER, PAIR_SIGNAL, PEER_HELLO,
  decodeBot, decodePair, encodePair, requestId, requestPair, sameRelayHost,
  type BotMessage, type PairMessage, type PairUse, type RelayAnnouncement
} from '../core/mumpeer-signal.ts';
import type { RelayTransport } from '../core/transport.ts';
import type { Session } from './session.svelte.ts';
import { store } from './settings.svelte.ts';

const BOT_GRACE = 15000;
const PAIR_TIMEOUT = 7000;
const validHash = (hash: string) => /^[0-9a-f]{40}$/i.test(hash);

type Announcer = { message: RelayAnnouncement; sender: number; hash: string; departed?: ReturnType<typeof setTimeout> };
const pin = (bot: Announcer) => `${bot.hash}:${bot.message.fp}`;

interface Pair {
  peer: number;
  // Screen sharing pairs need the same channel; file pairs work across the server
  use: PairUse;
  hash: string;
  bot: Announcer;
  low: boolean;
  leases: Map<number, { share: string; fail: (reason: string) => void }>;
  request?: { rid: string; share: string; phase: 'prepared' | 'requested' | 'opening' | 'ready' };
  ready: Promise<string>;
  resolve(rid: string): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface RelayLease { config: Promise<RTCConfiguration>; close(): void }

const failures: Record<string, string> = {
  'not-registered': 'Both users must register on this Mumble server to use mumpeer.',
  'group-not-allowed': 'The server restricts mumpeer to certain groups.',
  'rate-limited': 'The relay reached its pair limit. Try again shortly.',
  'relay-full': 'Mumpeer is full.',
  'relay-down': 'Mumpeer is unavailable.',
  'use-not-allowed': 'The relay operator disabled screen sharing.',
  'peer-gone': 'The other user left the server.',
  'peer-not-mumcord': 'The relay bot has not discovered the other user.',
  'no-hello': 'The relay bot has not discovered this client.'
};

export class MumpeerSession {
  private session: Session;
  private transport: RelayTransport | null = null;
  private offClose: (() => void) | null = null;
  private announcements = $state.raw<Announcer[]>([]);
  private pairs = new Map<number, Pair>();
  // A small buffer covers a request arriving while the corresponding share signal is being decoded.
  private needs = new Map<number, string[]>();
  private forgotPin = false;
  private greeted = new Set<number>();

  constructor(session: Session) { this.session = session; }

  get enabled(): boolean {
    const route = store.settings.screenShareRoute;
    return !!this.transport && (route === 'automatic' || route === 'fallback' || route === 'relay-only' || store.settings.fileLink !== 'off');
  }

  private get key(): string | null {
    const server = this.session.server;
    const hash = this.session.client?.self?.hash;
    return server && hash ? JSON.stringify([server.host.toLowerCase(), server.port, hash.toLowerCase()]) : null;
  }

  private get eligible(): Announcer[] {
    if (store.settings.screenShareRoute !== 'automatic') return this.announcements;
    const host = this.session.server?.host ?? '';
    return this.announcements.filter(bot => sameRelayHost(host, bot.message.host));
  }

  private get candidate(): Announcer | null {
    const active = this.eligible.filter(bot => !bot.departed);
    return active.length === 1 ? active[0] : null;
  }

  get hasPin(): boolean { const key = this.key; return !!key && !!store.mumpeerPins[key]; }

  get changed(): boolean {
    const bot = this.candidate;
    const key = this.key;
    return !!bot && !!key && !!store.mumpeerPins[key] && store.mumpeerPins[key] !== pin(bot);
  }

  get status(): string {
    if (!this.enabled) return 'Discovery is off';
    const eligible = this.eligible;
    if (eligible.filter(bot => !bot.departed).length > 1) return 'Multiple relay bots announced';
    if (this.changed) return 'The relay identity changed';
    const bot = this.candidate;
    if (!bot) {
      if (eligible.length) return 'Waiting for relay bot to reconnect';
      if (this.announcements.some(bot => !bot.departed)) return 'Relay announced on a different host';
      return 'No relay announced';
    }
    if (!this.hasPin) return 'Relay trust required';
    if (bot.message.state === 'down') return 'Relay unavailable';
    if (!bot.message.screen) return 'Screen sharing is disabled on the relay';
    if (bot.message.registeredOnly && this.session.client?.self?.userId == null) return 'Server registration required';
    return `Available · ${bot.message.host}`;
  }

  private availableFor(use: PairUse): Announcer | null {
    const bot = this.candidate;
    const key = this.key;
    if (!this.enabled || !key || !bot || store.mumpeerPins[key] !== pin(bot) || bot.message.state !== 'up') return null;
    return (use === 'scr' ? bot.message.screen : bot.message.files) ? bot : null;
  }

  /** The pinned relay both sides must name for a pair with this user, or '' when there is none. */
  capability(peer: number, use: PairUse = 'scr'): string {
    const bot = this.availableFor(use);
    const client = this.session.client;
    const self = client?.self;
    const other = client?.users.get(peer);
    if (!bot || !self || !other || self.session === peer || (use === 'scr' && self.channelId !== other.channelId)) return '';
    if (!validHash(self.hash) || !validHash(other.hash) || self.hash === other.hash) return '';
    if (bot.message.registeredOnly && (self.userId == null || other.userId == null)) return '';
    return pin(bot);
  }

  trust(): void {
    const key = this.key, bot = this.candidate;
    if (!key || !bot) return;
    this.clearPairs('The mumpeer trust settings changed.');
    this.forgotPin = false;
    store.setMumpeerPin(key, pin(bot));
  }

  forget(): void {
    const key = this.key;
    if (!key) return;
    this.clearPairs('The mumpeer trust settings changed.');
    // Leave the current announcement visible so it can be trusted explicitly in this connection.
    this.forgotPin = true;
    store.setMumpeerPin(key, null);
  }

  get canTrust(): boolean { return !!this.candidate && (this.changed || !this.hasPin); }

  attach(transport: RelayTransport | null): void {
    this.close();
    this.transport = transport;
    this.offClose = transport?.onRelayClose((rid, reason) => {
      const pair = [...this.pairs.values()].find(peer => peer.request?.rid === rid);
      if (pair) this.end(pair, reason);
    }) ?? null;
  }

  hello(to?: number): void {
    const client = this.session.client;
    if (!this.enabled || !client?.synced || client.serverVersionNum < 0x010400) return;
    const peers = to == null ? [...client.users.keys()] : [to];
    // Only a registered sender can announce a relay.
    const recipients = peers.filter(id => id !== client.session && !this.greeted.has(id) && client.users.get(id)?.userId != null);
    if (!recipients.length) return;
    for (const id of recipients) this.greeted.add(id);
    client.sendPluginData(recipients, MUMCORD_HELLO, PEER_HELLO);
  }

  policyChanged(): void {
    if (this.enabled) {
      this.pinCandidate();
      this.hello();
    } else {
      // The bot remembers sessions and can send an announcement only once until it changes.
      this.clearPairs('Mumpeer was turned off.');
    }
  }

  userChanged(user: User, discover: boolean): void {
    if (discover) this.hello(user.session);
    const announcer = this.announcements.find(bot => bot.sender === user.session && !bot.departed);
    if (announcer && (announcer.hash !== user.hash.toLowerCase() || user.userId == null)) this.userLeft(user.session);
    const pair = this.pairs.get(user.session);
    if (pair && ((pair.use === 'scr' && !this.sameChannel(user.session)) || pair.hash !== user.hash.toLowerCase())) this.end(pair, 'The other user left the share.');
  }

  userLeft(id: number): void {
    this.greeted.delete(id);
    this.needs.delete(id);
    const pair = this.pairs.get(id);
    if (pair) this.end(pair, 'The other user left the server.');
    const bot = this.announcements.find(bot => bot.sender === id && !bot.departed);
    if (!bot) return;
    bot.departed = setTimeout(() => {
      this.announcements = this.announcements.filter(entry => entry !== bot);
    }, BOT_GRACE);
    this.announcements = [...this.announcements];
    this.rejectPending();
  }

  private sameChannel(peer: number): boolean {
    const client = this.session.client;
    const self = client?.self;
    return !!self && client?.users.get(peer)?.channelId === self.channelId;
  }

  receive(sender: number, dataId: string, data: Uint8Array): void {
    if (dataId === PAIR_SIGNAL) {
      // A file pair may come from another channel; peerMessage checks the pair's own use
      if (!this.enabled) return;
      const msg = decodePair(data);
      if (msg) this.peerMessage(sender, msg);
      return;
    }
    if (dataId !== MUMCORD_PEER || !this.greeted.has(sender)) return;
    const user = this.session.client?.users.get(sender);
    if (!user || user.userId == null || !validHash(user.hash) || sender === this.session.client?.session) return;
    const msg = decodeBot(data);
    if (!msg) return;
    if (msg.t === 'relay') this.announce(sender, user.hash.toLowerCase(), msg);
    else this.token(sender, user.hash.toLowerCase(), msg);
  }

  private announce(sender: number, hash: string, message: RelayAnnouncement): void {
    if (!this.key) return;
    const current = this.announcements.find(bot => bot.sender === sender && !bot.departed);
    if (current && message.seq <= current.message.seq) return;
    for (const bot of this.announcements) if (bot.hash === hash && bot.departed) clearTimeout(bot.departed);
    const bot = { sender, hash, message };
    this.announcements = [...this.announcements.filter(entry => entry !== current && !(entry.hash === hash && entry.departed)), bot];
    this.pinCandidate();
    this.rejectPending();
  }

  private pinCandidate(): void {
    const key = this.key, bot = this.candidate;
    // Forgetting within this connection requires explicit trust.
    if (this.enabled && key && bot && !store.mumpeerPins[key] && !this.forgotPin) store.setMumpeerPin(key, pin(bot));
  }

  private rejectPending(): void {
    for (const pair of this.pairs.values()) {
      if (pair.request?.phase === 'ready') continue;
      const bot = this.availableFor(pair.use);
      if (!bot || bot.sender !== pair.bot.sender || pin(bot) !== pin(pair.bot)) this.end(pair, 'The mumpeer announcement changed.');
    }
  }

  // sharer: the side whose data goes out (the sharer, or the side sending the file); it picks the lane
  acquire(peer: number, share: string, sharer: number, fail: (reason: string) => void, use: PairUse = 'scr'): RelayLease {
    const bot = this.availableFor(use);
    const client = this.session.client;
    const self = client?.self;
    const other = client?.users.get(peer);
    const transport = this.transport;
    if (!bot || !self || !other || !transport || !this.capability(peer, use)) throw new Error('Mumpeer is unavailable for this user.');
    const low = self.session < peer;
    const lane = sharer === Math.min(self.session, peer) ? 0 : 1;
    let pair = this.pairs.get(peer);
    // One link per pair of people, asked for one use: the relay operator allows each use on its own
    if (pair && pair.use !== use) throw new Error('Mumpeer is in use between you for something else.');
    if (!pair) {
      const hash = other.hash.toLowerCase();
      if ([...this.pairs.values()].some(entry => entry.hash === hash)) throw new Error('Mumpeer is in use by another session of this user.');
      pair = this.newPair(peer, hash, bot, low, use);
    }
    if (pair.leases.has(lane)) throw new Error('A mumpeer connection for this share already exists.');
    const entry = { share, fail };
    pair.leases.set(lane, entry);
    const active = pair;
    if (low) this.prepare(active);
    else this.send(peer, { t: 'need', share });
    return {
      config: active.ready.then(async rid => {
        if (active.leases.get(lane) !== entry) throw new Error('The share ended.');
        const ice = await transport.relayTurn(rid, lane);
        if (active.leases.get(lane) !== entry) throw new Error('The share ended.');
        return { iceServers: [ice], iceTransportPolicy: 'relay' };
      }),
      close: () => {
        if (active.leases.get(lane) !== entry) return;
        active.leases.delete(lane);
        this.forgetNeed(peer, share);
        if (active.request?.phase === 'ready') transport.relayCloseLane(active.request.rid, lane);
        if (!active.leases.size) this.end(active);
      }
    };
  }

  private newPair(peer: number, hash: string, bot: Announcer, low: boolean, use: PairUse): Pair {
    let resolve!: Pair['resolve'];
    let reject!: Pair['reject'];
    const ready = new Promise<string>((ok, fail) => { resolve = ok; reject = fail; });
    // Nobody may be waiting on it yet (the other side has not answered); a failure is reported to the leases
    ready.catch(() => {});
    const pair: Pair = { peer, use, hash, bot, low, ready, resolve, reject, leases: new Map() };
    pair.timer = setTimeout(() => {
      const reason = pair.request?.phase === 'requested' ? 'The relay bot did not supply a token in time.' : 'The other client did not confirm the relay in time.';
      this.end(pair, reason);
    }, PAIR_TIMEOUT);
    this.pairs.set(peer, pair);
    return pair;
  }

  private send(peer: number, msg: PairMessage): void {
    this.session.client?.sendPluginData([peer], PAIR_SIGNAL, encodePair(msg));
  }

  private prepare(pair: Pair): void {
    if (pair.request) return;
    const received = this.needs.get(pair.peer);
    const lease = [...pair.leases.values()].find(entry => received?.includes(entry.share));
    if (!lease) return;
    const rid = requestId();
    pair.request = { rid, share: lease.share, phase: 'prepared' };
    this.send(pair.peer, { t: 'prepare', share: lease.share, rid });
  }

  private peerMessage(peer: number, msg: PairMessage): void {
    const self = this.session.client?.session;
    const pair = this.pairs.get(peer);
    // Before a pair exists here, either use may be what the other side asks for
    const usable = pair ? !!this.capability(peer, pair.use) : !!(this.capability(peer, 'scr') || this.capability(peer, 'file'));
    if (self == null || peer === self || !usable) return;
    if (msg.t === 'need' && self < peer) {
      const current = this.needs.get(peer) ?? [];
      this.needs.set(peer, [...current.filter(id => id !== msg.share).slice(-3), msg.share]);
      if (pair) this.prepare(pair);
      return;
    }
    if (!pair) return;
    if (msg.t === 'prepare' && !pair.low && !pair.request && [...pair.leases.values()].some(entry => entry.share === msg.share)) {
      pair.request = { share: msg.share, rid: msg.rid, phase: 'requested' };
      this.send(peer, { t: 'ack', share: msg.share, rid: msg.rid });
      return;
    }
    const pending = pair.request;
    if (msg.t === 'ack' && pair.low && pending?.phase === 'prepared' && pending.share === msg.share && pending.rid === msg.rid) {
      pending.phase = 'requested';
      this.session.client?.sendPluginData([pair.bot.sender], MUMCORD_PEER, requestPair(peer, pending.rid, pair.use));
    }
  }

  private token(sender: number, hash: string, msg: Exclude<BotMessage, RelayAnnouncement>): void {
    const self = this.session.client?.session;
    const pair = [...this.pairs.values()].find(pair => pair.request?.rid === msg.rid);
    const current = pair && this.availableFor(pair.use), transport = this.transport;
    if (!pair || self == null || !transport || !current || current.sender !== sender || current.hash !== hash) return;
    if (pair.bot.sender !== sender || pin(pair.bot) !== pin(current) || pair.request?.phase !== 'requested' || !this.capability(pair.peer, pair.use)) return;
    if (msg.t === 'token-err') {
      if (pair.low) this.end(pair, failures[msg.reason] ?? 'The relay bot refused the request.');
      return;
    }
    if (msg.a !== Math.min(self, pair.peer) || msg.b !== Math.max(self, pair.peer)) return;
    pair.request.phase = 'opening';
    clearTimeout(pair.timer); // The TLS link has its own deadline.
    void transport.relayOpen(msg.rid, current.message, msg.tok, pair.low).then(() => {
      if (this.pairs.get(pair.peer) !== pair || pair.request?.phase !== 'opening') return;
      pair.request.phase = 'ready';
      pair.resolve(msg.rid);
    }, (error: Error) => this.end(pair, error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')));
  }

  private forgetNeed(peer: number, share: string): void {
    const remaining = this.needs.get(peer)?.filter(id => id !== share);
    if (remaining?.length) this.needs.set(peer, remaining);
    else this.needs.delete(peer);
  }

  private end(pair: Pair, reason?: string): void {
    if (this.pairs.get(pair.peer) !== pair) return;
    this.pairs.delete(pair.peer);
    this.needs.delete(pair.peer);
    clearTimeout(pair.timer);
    if (pair.request?.phase === 'opening' || pair.request?.phase === 'ready') this.transport?.relayClose(pair.request.rid);
    pair.reject(new Error(reason ?? 'The share ended.'));
    const leases = [...pair.leases.values()];
    pair.leases.clear();
    if (reason) for (const lease of leases) lease.fail(reason);
  }

  private clearPairs(reason: string): void {
    for (const pair of this.pairs.values()) this.end(pair, reason);
    this.needs.clear();
  }

  private clearAnnouncements(): void {
    for (const bot of this.announcements) clearTimeout(bot.departed);
    this.announcements = [];
  }

  close(): void {
    this.clearPairs('Disconnected from the Mumble server.');
    this.clearAnnouncements();
    this.offClose?.();
    this.offClose = null;
    this.transport = null;
    this.forgotPin = false;
    this.greeted.clear();
  }
}
