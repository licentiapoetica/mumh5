// Files sent through the Mumble server (see core/file-transfer.ts): what this computer keeps,
// downloads in progress, and the pieces it sends to others. A download asks the sender and
// everyone else on the server who has the file, and splits the pieces between them; each
// source is limited by the server to about one message a second, so more sources are faster.
// The server checked who sent each piece; the file's hash comes with the announcement.
import {
  FILE, FILE_DATA_ID, MAX_FILE, MAX_PIECES, FileAssembler, Sender, pump, encodeFileSignal, parseBody, okId, validMeta,
  pieceBytes, pieceCount, pieceSize, pieceForm, pieceMessage, parsePiece, encode15, decode15,
  toRanges, fromRanges, split, sha256, rootHash, windowSize, maxSources, SourceWindow, type FileMeta, type FileType
} from '../core/file-transfer.ts';
import { newId } from '../core/text-signal.ts';
import type { Session } from './session.svelte.ts';
import { getBlob, putBlob, getData, putData, deleteBlob } from './blobstore.ts';
import { store } from './settings.svelte.ts';
import { sounds } from './audio/sounds.svelte.ts';
import { DownLink, UpLink, linksSupported, okSdp, type LinkRoute } from './file-links.ts';
import { linkRoute, okMode, type LinkMode } from '../core/file-direct.ts';
import { isRequestId, requestId } from '../core/mumpeer-signal.ts';
import type { RelayLease } from './mumpeer.svelte.ts';
import { Meters, type LinkState, type PeerStat } from './file-meters.ts';

export interface Transfer {
  state: 'idle' | 'finding' | 'loading' | 'ready' | 'failed';
  got: number;     // bytes so far
  rate: number;    // bytes per second, recently
  sources: number; // people sending it to us
  error: string;
  url: string;     // once ready
  sending: number; // people we are sending it to
  link: '' | LinkRoute; // coming over a direct link (file-links.ts) instead of the server
  peers: PeerStat[];   // who it comes from and goes to, for the details (file-meters.ts)
  pieces: number;      // pieces here so far, of `count`
  count: number;
  started: number;     // when the download started, ms
  ended: number;       // when it finished or failed
  // Someone who could send it directly; that shows both IP addresses, so it waits for a click
  directAsk: number | null;
}

const BLANK: Transfer = { state: 'idle', got: 0, rate: 0, sources: 0, error: '', url: '', sending: 0, link: '', peers: [], pieces: 0, count: 0, started: 0, ended: 0, directAsk: null };

// What this computer keeps of files it sent and received; the oldest go first
const KEEP_BYTES = 2 * 1024 ** 3;
const INDEX = 'files:index';
// How long answers to "who has it" may take
const FIND_MS = 3000;
// A source that sent nothing for this long is asked again, twice, then the download stops
const STALL_MS = 45000;
// Direct links a computer serves at once
const MAX_UPLINKS = 8;
// Murmur allows 15 plugin messages at once and 4 a second; text channels use some of that
const BURST = 4;
const PER_SECOND = 1.5;

interface Kept extends FileMeta { at: number }

interface Download {
  s: Session;
  meta: FileMeta;
  count: number;
  parts: (Blob | undefined)[];
  digests: Promise<Uint8Array>[];
  got: number;
  bytes: number;
  // Who sends what; empty until the pieces are shared out
  sources: Map<number, SourceWindow>;
  findUntil: number;
  lastAt: number;
  stalls: number;
  timer: ReturnType<typeof setInterval>;
  rebalance: ReturnType<typeof setTimeout> | undefined;
  rateFrom: { at: number; bytes: number };
  // The direct link, while one is tried or open; it takes over from the server route once open
  direct: DownLink | null;
  // Sources that take links, with how (see linkRoute), and those tried already
  linkPeers: Map<number, { mode: LinkMode; relay: string }>;
  directTried: Set<number>;
  // How the current link attempt ended, when the other side said (a declined offer)
  linkEnd: { state: LinkState; reason: string } | null;
  // The receiver allowed a direct route for this download (allowDirect), or declined it
  // (declineDirect): then only mumpeer, which keeps the addresses apart, or the server
  directOk: boolean;
  directNo: boolean;
}

interface Runtime {
  assembler: FileAssembler;
  sender: Sender;
  pumping: boolean;
  queue: { to: number[]; packet: Uint8Array }[];
  level: number;
  levelAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  // Direct links we serve, by receiver and file
  links: Map<string, UpLink>;
  // Mumpeer pairs set up for a link whose offer is on its way, by receiver and file
  leases: Map<string, { id: string; lease: RelayLease; timer: ReturnType<typeof setTimeout> }>;
}

// A mumpeer pair asked for and never used is given up after this
const LEASE_MS = 30000;

// Only types the app can show are kept as such; anything else (HTML, SVG) stays inert data
// even if someone opens it, because object URLs carry the app's own origin
export function safeType(type: string): string {
  return /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+)$/.test(type) ? type : 'application/octet-stream';
}

export function fileKind(meta: FileMeta): 'image' | 'video' | 'audio' | 'pdf' | null {
  if (meta.m.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(meta.n)) return 'pdf';
  const t = safeType(meta.m);
  return t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : null;
}

class Files {
  transfers = $state<Record<string, Transfer>>({});
  // Bytes kept on this computer, once looked at
  usage = $state<number | null>(null);

  private runtimes = new WeakMap<Session, Runtime>();
  private downloads = new Map<string, Download>();
  // Files at hand this run: sent from here, received, or read back from storage
  private local = new Map<string, { meta: FileMeta; blob: Blob }>();
  private index: Kept[] | null = null;
  private checked = new Set<string>();
  // Links we serve on any server, for the details
  private uplinks = new Set<UpLink>();
  private meters = new Meters((id, peers) => this.set(id, { peers }), (id, p) => this.linkPath(id, p));

  /** The details of a file are on screen (or not): its links' paths are read while they are. */
  details(id: string, on: boolean): void {
    this.meters.watch(id, on);
  }

  private linkPath(id: string, p: PeerStat): Promise<string> | null {
    if (p.dir === 'from') {
      const link = this.downloads.get(id)?.direct;
      return link?.peer === p.session ? link.path() : null;
    }
    for (const link of this.uplinks) if (link.file === id && link.peer === p.session) return link.path();
    return null;
  }

  // Plugin data needs a 1.4 server; older ones would not pass the requests on
  supported(s: Session): boolean {
    return !!s.client && s.client.serverVersionNum >= 0x010400;
  }

  // What this computer allows (see LinkMode); null: no links (the setting is off, or no WebRTC)
  private linkMode(): LinkMode | null {
    if (!linksSupported()) return null;
    const v = store.settings.fileLink;
    return v === 'direct' ? 1 : v === 'relay' ? 2 : null;
  }

  // The "have" answer's link part: how we take links, and the relay we would use with that person
  private linkOffer(s: Session, to: number): Record<string, unknown> {
    const mode = this.linkMode();
    if (!mode) return {};
    const relay = s.mumpeer.capability(to, 'file');
    return relay ? { p: mode, r: relay } : { p: mode };
  }

  private set(id: string, patch: Partial<Transfer>): void {
    this.transfers[id] = { ...(this.transfers[id] ?? BLANK), ...patch };
  }

  // ─── Kept files ─────────────────────────────────────────────────────────────

  private async loadIndex(): Promise<Kept[]> {
    if (this.index) return this.index;
    let list: Kept[] = [];
    try {
      const v = await getData<Kept[]>(INDEX);
      if (Array.isArray(v)) list = v.filter(k => validMeta(k) && typeof k.at === 'number');
    } catch { /* storage unavailable */ }
    // Another call may have finished first
    this.index ??= list;
    this.usage = this.index.reduce((n, k) => n + k.s, 0);
    return this.index;
  }

  private async keep(meta: FileMeta, blob: Blob): Promise<void> {
    try {
      const index = await this.loadIndex();
      await putBlob('file:' + meta.i, blob);
      const list = [...index.filter(k => k.i !== meta.i), { ...meta, at: Date.now() }];
      let total = list.reduce((n, k) => n + k.s, 0);
      // Files used this run stay; the rest goes oldest first
      for (const k of [...list]) {
        if (total <= KEEP_BYTES) break;
        if (this.local.has(k.i)) continue;
        await deleteBlob('file:' + k.i).catch(() => {});
        list.splice(list.indexOf(k), 1);
        total -= k.s;
      }
      this.index = list;
      this.usage = total;
      await putData(INDEX, list);
    } catch { /* storage unavailable: the file is still here until the app closes */ }
  }

  private async find(id: string): Promise<{ meta: FileMeta; blob: Blob } | null> {
    const at = this.local.get(id);
    if (at) return at;
    const kept = (await this.loadIndex()).find(k => k.i === id);
    if (!kept) return null;
    try {
      const blob = await getBlob('file:' + id);
      if (!blob) return null;
      const { at: _, ...meta } = kept;
      const found = { meta, blob };
      this.local.set(id, found);
      return found;
    } catch {
      return null;
    }
  }

  private ready(meta: FileMeta, blob: Blob): void {
    this.local.set(meta.i, { meta, blob });
    const url = this.transfers[meta.i]?.url || URL.createObjectURL(new Blob([blob], { type: safeType(meta.m) }));
    this.set(meta.i, { state: 'ready', got: meta.s, url, error: '', rate: 0, sources: 0, link: '' });
  }

  // Shows a file as ready when this computer has it
  async check(meta: FileMeta): Promise<void> {
    if (this.checked.has(meta.i)) return;
    this.checked.add(meta.i);
    const found = await this.find(meta.i);
    if (found && found.meta.h === meta.h && !this.downloads.has(meta.i)) this.ready(found.meta, found.blob);
  }

  async measure(): Promise<void> {
    await this.loadIndex();
  }

  async clear(): Promise<void> {
    const index = await this.loadIndex();
    for (const k of index) await deleteBlob('file:' + k.i).catch(() => {});
    this.index = [];
    this.usage = 0;
    await putData(INDEX, []).catch(() => {});
    // What is on screen stays usable until the app closes
  }

  // ─── Sending a file ─────────────────────────────────────────────────────────

  // Hashes the file and keeps it at hand for whoever asks. Returns the announcement details
  // or why it cannot be sent.
  async share(s: Session, file: File, progress: (fraction: number) => void): Promise<FileMeta | string> {
    const client = s.client;
    if (!client) return 'Not connected.';
    if (!this.supported(s)) return `${file.name}: sending files needs a server running Mumble 1.4 or newer`;
    if (!file.size) return `${file.name}: the file is empty`;
    if (file.size > MAX_FILE) return `${file.name}: too large (at most 2 GB)`;
    const c = pieceBytes(client.config);
    if (c < 1500) return `${file.name}: this server's message limit is too small for files`;
    const count = pieceCount({ s: file.size, c });
    if (count > MAX_PIECES) return `${file.name}: too large for this server's message limits`;
    const digests: Uint8Array[] = [];
    try {
      for (let k = 0; k < count; k++) {
        digests.push(await sha256(new Uint8Array(await file.slice(k * c, (k + 1) * c).arrayBuffer())));
        if (k % 16 === 0) progress(k / count);
      }
    } catch {
      return `${file.name}: could not be read`;
    }
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) && file.type.length <= 100 ? file.type : '';
    const meta = validMeta({ i: newId(), n: file.name.slice(0, 255) || 'file', s: file.size, m: type, c, h: await rootHash(digests) });
    if (!meta) return `${file.name}: cannot be sent`;
    this.checked.add(meta.i);
    this.ready(meta, file);
    this.keep(meta, file);
    return meta;
  }

  // ─── Downloading ────────────────────────────────────────────────────────────

  // A file was announced live: fetch it right away when it is small enough
  offered(s: Session, meta: FileMeta, author: number | null): void {
    const limit = store.settings.autoDownload * 1024 * 1024;
    this.check(meta).then(() => {
      const t = this.transfers[meta.i];
      if (limit && meta.s <= limit && (!t || t.state === 'idle')) this.download(s, meta, author);
    });
  }

  download(s: Session, meta: FileMeta, author: number | null): void {
    const client = s.client;
    const t = this.transfers[meta.i];
    if (this.downloads.has(meta.i) || t?.state === 'ready') return;
    if (!client || !this.supported(s)) {
      this.set(meta.i, { state: 'failed', error: 'Downloading needs a server running Mumble 1.4 or newer' });
      return;
    }
    const now = Date.now();
    const d: Download = {
      s, meta, count: pieceCount(meta), parts: [], digests: [], got: 0, bytes: 0, sources: new Map(),
      findUntil: now + FIND_MS, lastAt: now, stalls: 0, timer: setInterval(() => this.watch(d), 2000),
      rebalance: undefined, rateFrom: { at: now, bytes: 0 }, direct: null, linkPeers: new Map(), directTried: new Set(), linkEnd: null, directOk: false, directNo: false
    };
    this.downloads.set(meta.i, d);
    this.meters.clear(meta.i, 'from');
    this.set(meta.i, { state: 'finding', got: 0, rate: 0, sources: 0, error: '', link: '', pieces: 0, count: d.count, started: now, ended: 0 });
    if (author != null && author !== client.session && client.users.has(author)) {
      d.sources.set(author, new SourceWindow([], 0));
      this.meters.update(s, meta.i, author, 'from', { state: 'waiting' });
      this.assign(d);
    }
    // The author is asked too when direct links are on: the answer says whether it takes one
    const others = [...client.users.keys()].filter(id => id !== client.session && (id !== author || this.linkMode()));
    this.signal(s, others, FILE.who, { i: meta.i });
  }

  cancel(id: string): void {
    const d = this.downloads.get(id);
    if (!d) return;
    this.stop(d);
    this.set(id, { state: 'idle', got: 0, rate: 0, sources: 0, link: '' });
  }

  /** The receiver allowed a direct route for this download: tried now, the server route goes on meanwhile. */
  allowDirect(id: string): void {
    const d = this.downloads.get(id);
    if (!d || d.directOk) return;
    d.directOk = true;
    this.set(id, { directAsk: null });
    void this.tryDirect(d);
  }

  /** The receiver declined a direct route for this download: mumpeer when both can use it, else the server. */
  declineDirect(id: string): void {
    const d = this.downloads.get(id);
    if (!d || d.directOk || d.directNo) return;
    d.directNo = true;
    this.set(id, { directAsk: null });
    void this.tryDirect(d);
  }

  private stop(d: Download): void {
    this.set(d.meta.i, { directAsk: null });
    clearInterval(d.timer);
    clearTimeout(d.rebalance);
    if (this.downloads.get(d.meta.i) === d) this.downloads.delete(d.meta.i);
    const link = d.direct;
    d.direct = null;
    link?.close();
    const busy = [...d.sources].filter(([, src]) => src.window.size).map(([id]) => id);
    if (d.s.client) this.signal(d.s, busy, FILE.want, { i: d.meta.i, r: [] });
  }

  private fail(d: Download, error: string): void {
    this.stop(d);
    this.meters.finish(d.meta.i, 'from', 'gone');
    this.set(d.meta.i, { state: 'failed', error, rate: 0, sources: 0, link: '', ended: Date.now() });
    sounds.play('uploadFailed');
  }

  private missing(d: Download): number[] {
    const out: number[] = [];
    for (let k = 0; k < d.count; k++) if (!d.parts[k]) out.push(k);
    return out;
  }

  // Shares out what is still missing between the sources, one stretch each. again: what was
  // asked before got lost, so pieces already sent count as missing
  private assign(d: Download, again = false): void {
    clearTimeout(d.rebalance);
    d.rebalance = undefined;
    if (d.direct?.open) {
      d.direct.want(toRanges(this.missing(d)), again);
      return;
    }
    const parts = split(this.missing(d), [...d.sources.keys()]);
    for (const [id, old] of d.sources) {
      const stretch = parts.get(id) ?? [];
      // Nothing new for a source that has nothing to do
      if (!stretch.length && !old.window.size) continue;
      const src = new SourceWindow(stretch, windowSize(d.meta.c));
      // Request numbers keep counting up, or the source would take this for a new download
      src.q = old.q;
      d.sources.set(id, src);
      this.ask(d, id, src, again);
    }
    this.set(d.meta.i, { sources: d.sources.size });
  }

  private ask(d: Download, id: number, src: SourceWindow, again: boolean): void {
    const { pieces, q } = src.ask(k => !!d.parts[k]);
    this.signal(d.s, [id], FILE.want, { i: d.meta.i, r: toRanges(pieces), q, ...again ? { a: 1 } : {} });
  }

  private dropSource(d: Download, id: number): void {
    if (d.direct?.peer === id) d.direct.close();
    if (!d.sources.delete(id)) return;
    this.meters.update(d.s, d.meta.i, id, 'from', { state: 'gone' });
    if (d.sources.size) this.assign(d);
    else if (Date.now() > d.findUntil) this.fail(d, 'Nobody online has this file right now');
  }

  private watch(d: Download): void {
    if (this.downloads.get(d.meta.i) !== d) return clearInterval(d.timer);
    const now = Date.now();
    if (!d.s.client) return this.fail(d, 'Disconnected');
    if (!d.sources.size) {
      if (now > d.findUntil) this.fail(d, 'Nobody online has this file right now');
      return;
    }
    if (now - d.lastAt > STALL_MS) {
      if (++d.stalls > 2) return this.fail(d, 'The transfer stopped');
      d.lastAt = now;
      this.assign(d, true);
    }
    // Speed over the last few seconds
    if (now - d.rateFrom.at >= 4000) {
      this.set(d.meta.i, { rate: (d.bytes - d.rateFrom.bytes) / ((now - d.rateFrom.at) / 1000) });
      d.rateFrom = { at: now, bytes: d.bytes };
    }
  }

  // A chat message carrying a piece; only from people we asked
  piece(s: Session, from: number, html: string): void {
    const p = parsePiece(html);
    const d = p && this.downloads.get(p.id);
    if (!p || !d || d.s !== s || !d.sources.has(from) || p.index >= d.count || d.parts[p.index]) return;
    const bytes = decode15(p.payload, pieceSize(d.meta, p.index));
    if (!bytes) return;
    const src = d.sources.get(from)!;
    if (this.accept(d, p.index, bytes, from, 'server')) return;
    // More before the source runs out, so it keeps sending without getting ahead of us
    if (src.got(p.index) && !d.direct?.open) this.ask(d, from, src, false);
  }

  // A piece from either route; true once the file is complete
  private accept(d: Download, index: number, bytes: Uint8Array, from: number, route: PeerStat['route']): boolean {
    if (d.parts[index] || bytes.length !== pieceSize(d.meta, index)) return false;
    this.meters.add(d.s, d.meta.i, from, 'from', bytes.length, route);
    d.parts[index] = new Blob([bytes as Uint8Array<ArrayBuffer>]);
    d.digests[index] = sha256(bytes);
    d.got++;
    d.bytes += bytes.length;
    d.lastAt = Date.now();
    d.stalls = 0;
    if (this.transfers[d.meta.i]?.state === 'finding' && d.rateFrom.bytes === 0) d.rateFrom = { at: Date.now(), bytes: 0 };
    this.set(d.meta.i, { state: 'loading', got: d.bytes, pieces: d.got });
    if (d.got < d.count) return false;
    this.finish(d);
    return true;
  }

  // ─── Direct links (file-links.ts) ───────────────────────────────────────────

  // Tries the next source that takes links; the server route goes on meanwhile
  private async tryDirect(d: Download): Promise<void> {
    const client = d.s.client;
    const setting = this.linkMode();
    // Declined direct: as if this side had chosen mumpeer only
    const mode = setting && d.directNo ? 2 : setting;
    if (d.direct || !client || !mode || this.downloads.get(d.meta.i) !== d) return;
    let peer: number | undefined, route: 'direct' | 'mumpeer' | null = null, ask: number | null = null;
    for (const [p, theirs] of d.linkPeers) {
      if (d.directTried.has(p) || !client.users.has(p)) continue;
      const mine = d.s.mumpeer.capability(p, 'file');
      const r = linkRoute(mode, theirs.mode, mine, theirs.relay);
      if (!r && d.directNo && linkRoute(setting!, theirs.mode, mine, theirs.relay) === 'direct') {
        d.directTried.add(p);
        this.meters.link(d.s, d.meta.i, p, 'from', { route: 'direct', state: 'declined', reason: 'Declined by you, so it goes through the Mumble server' });
        continue;
      }
      // A direct route shows each side the other's address: only after the receiver allowed it
      if (r === 'direct' && !d.directOk) {
        if (ask == null) ask = p;
        continue;
      }
      d.directTried.add(p);
      route = r;
      if (route) { peer = p; break; }
      // Mumpeer is wanted (by either side) and cannot be used: say why
      const reason = !mine ? d.s.mumpeer.fileBlocked(p) : !theirs.relay ? 'No usable mumpeer relay on their side' : 'You trust different mumpeer relays';
      this.meters.link(d.s, d.meta.i, p, 'from', { route: 'mumpeer', state: 'none', reason });
    }
    if (peer == null || !route) {
      this.set(d.meta.i, { directAsk: ask });
      if (ask != null) this.meters.link(d.s, d.meta.i, ask, 'from', { route: 'direct', state: 'ask', reason: '' });
      return;
    }
    this.set(d.meta.i, { directAsk: null });
    const via = peer;
    const kind: LinkRoute = route;
    d.linkEnd = null;
    // Through mumpeer both sides ask for the relay pair first; the source is the side sending
    let lease: RelayLease | null = null, why = '';
    const relayId = route === 'mumpeer' ? requestId() : '';
    if (relayId) {
      try {
        lease = d.s.mumpeer.acquire(peer, relayId, peer, reason => { why = reason; link.close(); }, 'file');
      } catch (e) {
        this.meters.link(d.s, d.meta.i, via, 'from', { route: kind, state: 'failed', reason: (e as Error).message });
        return this.tryDirect(d);
      }
    }
    this.meters.link(d.s, d.meta.i, via, 'from', { route: kind, state: 'connecting', reason: '' });
    const link: DownLink = new DownLink(peer, d.count, k => pieceSize(d.meta, k), {
      open: route => {
        if (d.direct !== link) return;
        d.lastAt = Date.now();
        this.set(d.meta.i, { link: route });
        this.meters.update(d.s, d.meta.i, via, 'from', { route, state: 'active' });
        this.meters.link(d.s, d.meta.i, via, 'from', { route, state: 'open', reason: '' });
        // The server route stops; what it already sent still counts
        const busy = [...d.sources].filter(([, src]) => src.window.size).map(([id]) => id);
        for (const src of d.sources.values()) src.window.clear();
        this.signal(d.s, busy, FILE.want, { i: d.meta.i, r: [] });
        this.assign(d);
      },
      piece: (index, bytes) => { if (d.direct === link) this.accept(d, index, bytes, via, this.transfers[d.meta.i]?.link || 'direct'); },
      closed: wasOpen => {
        lease?.close();
        if (d.direct !== link) return;
        d.direct = null;
        this.set(d.meta.i, { link: '' });
        this.meters.update(d.s, d.meta.i, via, 'from', { route: 'server', state: d.sources.has(via) ? 'waiting' : 'gone' });
        const end = d.linkEnd ?? (wasOpen ? { state: 'closed' as const, reason: why || 'The link closed before the file was complete' }
          : { state: 'failed' as const, reason: why || 'Did not connect in time' });
        this.meters.link(d.s, d.meta.i, via, 'from', { route: kind, ...end });
        if (this.downloads.get(d.meta.i) !== d) return;
        // Back to the server route for what is missing, and the next source may take a link
        if (wasOpen) this.assign(d, true);
        void this.tryDirect(d);
      }
    });
    d.direct = link;
    if (relayId) this.signal(d.s, [peer], FILE.offer, { i: d.meta.i, m: relayId });
    const sdp = await link.offer(lease?.config);
    if (d.direct !== link) return;
    if (!sdp) return link.close();
    this.signal(d.s, [peer], FILE.offer, { i: d.meta.i, sdp, ...relayId ? { m: relayId } : {} });
  }

  // Someone wants a link for a file we have: an offer, or through mumpeer first the relay pair
  // (`m` names it, no offer yet) and then the offer for that pair
  private async offerFrom(s: Session, rt: Runtime, from: number, id: string, body: Record<string, unknown>): Promise<void> {
    const sdp = okSdp(body.sdp) ? body.sdp : null;
    const relayId = isRequestId(body.m) ? body.m : null;
    const key = `${from}:${id}`;
    const kind: LinkRoute = relayId ? 'mumpeer' : 'direct';
    // here: what this side shows; there: what the receiver shows (sent along)
    const decline = (here: string, there: string) => {
      if (this.local.has(id)) this.meters.link(s, id, from, 'to', { route: kind, state: 'declined', reason: here });
      this.signal(s, [from], FILE.answer, { i: id, w: there });
    };
    const mode = this.linkMode();
    const found = await this.find(id);
    if (!found) return decline('The file is not here', 'The file is not on their side any more');
    if (!mode) return decline('Links are off here', 'Links are off on their side');
    if (!sdp && !relayId) return;
    if (rt.links.size >= MAX_UPLINKS && !rt.links.has(key)) return decline('Too many links at once', 'They serve too many links at once');
    // Someone who wants the relay never gets a direct route from us
    if (!relayId && mode !== 1) return decline('Only mumpeer is allowed here', 'They only take links through mumpeer');
    if (relayId && !sdp) {
      this.dropLease(rt, key);
      let lease: RelayLease;
      try {
        lease = s.mumpeer.acquire(from, relayId, s.client!.session!, reason => {
          this.meters.link(s, id, from, 'to', { route: 'mumpeer', state: 'failed', reason });
          this.dropLease(rt, key);
        }, 'file');
      } catch (e) {
        return decline(`Mumpeer: ${(e as Error).message}`, `Mumpeer on their side: ${(e as Error).message}`);
      }
      this.meters.link(s, id, from, 'to', { route: 'mumpeer', state: 'connecting', reason: '' });
      rt.leases.set(key, { id: relayId, lease, timer: setTimeout(() => this.dropLease(rt, key), LEASE_MS) });
      return;
    }
    const pending = relayId ? rt.leases.get(key) : null;
    if (relayId && pending?.id !== relayId) return decline('The relay pair was not set up', 'The relay pair was not set up on their side');
    if (pending) {
      clearTimeout(pending.timer);
      rt.leases.delete(key);
    }
    rt.links.get(key)?.close();
    const { meta, blob } = found;
    let route: LinkRoute = kind, opened = false;
    this.meters.link(s, id, from, 'to', { route: kind, state: 'connecting', reason: '' });
    const link: UpLink = new UpLink(from, id, pieceCount(meta), async k => {
      try {
        return new Uint8Array(await blob.slice(k * meta.c, k * meta.c + pieceSize(meta, k)).arrayBuffer());
      } catch {
        return null;
      }
    }, {
      open: r => {
        route = r;
        opened = true;
        this.meters.update(s, id, from, 'to', { route: r, state: 'active' });
        this.meters.link(s, id, from, 'to', { route: r, state: 'open', reason: '' });
      },
      sent: (_k, bytes) => this.meters.add(s, id, from, 'to', bytes, route),
      closed: () => {
        pending?.lease.close();
        this.uplinks.delete(link);
        if (rt.links.get(key) === link) rt.links.delete(key);
        // The route stays the last one used; a piece through the server changes it
        this.meters.update(s, id, from, 'to', { state: 'waiting' });
        this.meters.link(s, id, from, 'to', opened ? { route, state: 'closed', reason: 'The link closed' } : { route, state: 'failed', reason: 'Did not connect in time' });
        this.set(id, { sending: this.sending(rt, id) });
      }
    });
    this.uplinks.add(link);
    rt.links.set(key, link);
    const answer = await link.accept(sdp!, pending?.lease.config);
    if (rt.links.get(key) !== link) return;
    if (!answer) {
      link.close();
      return decline('Could not answer the offer', 'Their side could not answer the offer');
    }
    this.set(id, { sending: this.sending(rt, id) });
    this.signal(s, [from], FILE.answer, { i: id, sdp: answer });
  }

  private dropLease(rt: Runtime, key: string): void {
    const pending = rt.leases.get(key);
    if (!pending) return;
    rt.leases.delete(key);
    clearTimeout(pending.timer);
    pending.lease.close();
  }

  // People we send a file to, over the server and over direct links
  private sending(rt: Runtime, id: string): number {
    const direct = new Set([...rt.links.values()].filter(l => l.file === id).map(l => l.peer));
    return rt.sender.receivers(id) + direct.size;
  }

  private async finish(d: Download): Promise<void> {
    this.stop(d);
    const hash = await rootHash(await Promise.all(d.digests));
    if (hash !== d.meta.h) return this.fail(d, 'The file did not arrive intact');
    const blob = new Blob(d.parts as Blob[], { type: safeType(d.meta.m) });
    this.meters.finish(d.meta.i, 'from', 'done');
    this.set(d.meta.i, { ended: Date.now() });
    // The people who sent it can show that it arrived
    const senders = (this.transfers[d.meta.i]?.peers ?? []).filter(p => p.dir === 'from' && p.bytes > 0).map(p => p.session);
    this.signal(d.s, senders, FILE.got, { i: d.meta.i });
    this.ready(d.meta, blob);
    this.keep(d.meta, blob);
    sounds.play('uploadDone');
  }

  // ─── Requests between clients ───────────────────────────────────────────────

  private runtime(s: Session): Runtime {
    let rt = this.runtimes.get(s);
    if (!rt) {
      rt = { assembler: new FileAssembler(), sender: new Sender(), pumping: false, queue: [], level: 0, levelAt: Date.now(), timer: undefined, links: new Map(), leases: new Map() };
      this.runtimes.set(s, rt);
    }
    return rt;
  }

  async receive(s: Session, from: number, dataId: string, data: Uint8Array): Promise<void> {
    if (dataId !== FILE_DATA_ID || !this.supported(s)) return;
    const rt = this.runtime(s);
    const signal = await rt.assembler.push(from, data);
    const body = parseBody(signal?.text);
    const client = s.client;
    if (!signal || !body || !okId(body.i) || !client || this.runtimes.get(s) !== rt) return;
    const id = body.i;
    const d = this.downloads.get(id);
    const mine = d && d.s === s ? d : null;
    switch (signal.type) {
      case FILE.who:
        if (await this.find(id)) this.signal(s, [from], FILE.have, { i: id, ...this.linkOffer(s, from) });
        break;
      case FILE.have:
        if (mine && !okMode(body.p) && this.linkMode()) {
          this.meters.link(s, id, from, 'from', { route: this.linkMode() === 2 ? 'mumpeer' : 'direct', state: 'none', reason: 'Links are off on their side, or they run an older version' });
        }
        if (mine && okMode(body.p) && !mine.linkPeers.has(from)) {
          mine.linkPeers.set(from, { mode: body.p, relay: typeof body.r === 'string' ? body.r : '' });
          void this.tryDirect(mine);
        }
        if (!mine || mine.sources.has(from) || mine.sources.size >= maxSources(mine.meta.c)) return;
        mine.sources.set(from, new SourceWindow([], 0));
        this.meters.update(s, id, from, 'from', { state: 'waiting' });
        mine.lastAt = Date.now();
        // Answers come in together; share out once they are in
        clearTimeout(mine.rebalance);
        mine.rebalance = setTimeout(() => { if (this.downloads.get(id) === mine) this.assign(mine); }, 400);
        break;
      case FILE.want: {
        const found = await this.find(id);
        const pieces = found && fromRanges(body.r, pieceCount(found.meta));
        if (!found || found.meta.c > pieceBytes(client.config)) return this.signal(s, [from], FILE.gone, { i: id });
        if (!pieces) return;
        const q = Number.isSafeInteger(body.q) ? body.q as number : undefined;
        // At most one window, also when asked for more: the server would hold the rest
        // Older versions number nothing and only ask again for what got lost
        const idle = rt.sender.want(id, from, pieces, { cap: windowSize(found.meta.c), again: body.a === 1 || q === undefined, q });
        if (pieces.length) this.meters.update(s, id, from, 'to', {});
        this.set(id, { sending: this.sending(rt, id) });
        // Everything asked for is on its way already
        if (idle && pieces.length) this.signal(s, [from], FILE.done, { i: id, q });
        this.pump(s, rt);
        break;
      }
      case FILE.done: {
        const src = mine?.sources.get(from);
        // An answer to an earlier request; a newer one is on its way
        if (!mine || !src || (body.q !== undefined && body.q !== src.q) || mine.direct?.open) return;
        mine.lastAt = Date.now();
        const lost = [...src.window].some(k => !mine.parts[k]);
        if (!lost) {
          if (src.more) this.ask(mine, from, src, false);
          return;
        }
        // Something got lost on the way: ask again, or leave it to the others
        if (++src.retries > 2) return this.dropSource(mine, from);
        this.ask(mine, from, src, true);
        break;
      }
      case FILE.gone:
        if (mine) this.dropSource(mine, from);
        break;
      case FILE.offer:
        await this.offerFrom(s, rt, from, id, body);
        break;
      case FILE.got:
        if (this.local.has(id)) this.meters.update(s, id, from, 'to', { state: 'done' });
        break;
      case FILE.answer:
        if (mine?.direct?.peer !== from || mine.direct.open) return;
        if (okSdp(body.sdp)) await mine.direct.answer(body.sdp);
        else {
          mine.linkEnd = { state: 'declined', reason: typeof body.w === 'string' && body.w ? body.w.slice(0, 160) : 'Declined' };
          mine.direct.close();
        }
        break;
    }
  }

  private pump(s: Session, rt: Runtime): void {
    const client = s.client;
    if (rt.pumping || !client) return;
    rt.pumping = true;
    const alive = () => this.runtimes.get(s) === rt && s.client === client;
    pump({
      client, sender: rt.sender, alive,
      read: async (file, k) => {
        const found = await this.find(file);
        if (!found) return null;
        const { meta, blob } = found;
        const bytes = new Uint8Array(await blob.slice(k * meta.c, k * meta.c + pieceSize(meta, k)).arrayBuffer());
        return pieceMessage(pieceForm(client.config), file, k, encode15(bytes));
      },
      done: (r, file) => this.signal(s, [r], FILE.done, { i: file, q: rt.sender.serial(file, r) }),
      gone: (rs, file) => { this.signal(s, rs, FILE.gone, { i: file }); this.set(file, { sending: this.sending(rt, file) }); },
      sent: (file, k, to) => {
        const meta = this.local.get(file)?.meta;
        if (meta) for (const r of to) this.meters.add(s, file, r, 'to', pieceSize(meta, k), 'server');
        this.set(file, { sending: this.sending(rt, file) });
      }
    }).finally(() => {
      rt.pumping = false;
      // Asked again while the last piece went out
      if (alive() && rt.sender.busy) this.pump(s, rt);
    });
  }

  private async signal(s: Session, to: number[], type: FileType, body: unknown): Promise<void> {
    const rt = this.runtime(s);
    // Someone flooding us with questions does not get a growing pile of answers
    if (!to.length || rt.queue.length > 200) return;
    for (const packet of await encodeFileSignal(type, body)) rt.queue.push({ to, packet });
    this.flush(s, rt);
  }

  private flush(s: Session, rt: Runtime): void {
    if (rt.timer) return;
    const client = s.client;
    while (rt.queue.length && client && this.runtimes.get(s) === rt) {
      const now = Date.now();
      rt.level = Math.max(0, rt.level - (now - rt.levelAt) / 1000 * PER_SECOND);
      rt.levelAt = now;
      if (rt.level > BURST - 1) {
        rt.timer = setTimeout(() => { rt.timer = undefined; this.flush(s, rt); }, 1000 / PER_SECOND);
        return;
      }
      rt.level++;
      const { to, packet } = rt.queue.shift()!;
      const there = to.filter(id => client.users.has(id));
      if (there.length) client.sendPluginData(there, FILE_DATA_ID, packet);
    }
  }

  // ─── Called by the session ──────────────────────────────────────────────────

  userLeft(s: Session, session: number): void {
    this.meters.left(s, session);
    const rt = this.runtimes.get(s);
    if (rt) {
      rt.sender.drop(session);
      for (const link of [...rt.links.values()]) if (link.peer === session) link.close();
      for (const key of [...rt.leases.keys()]) if (key.startsWith(`${session}:`)) this.dropLease(rt, key);
      for (const id of Object.keys(this.transfers)) if (this.transfers[id].sending) this.set(id, { sending: this.sending(rt, id) });
    }
    for (const d of [...this.downloads.values()]) if (d.s === s) this.dropSource(d, session);
  }

  closed(s: Session): void {
    this.meters.closed(s);
    const rt = this.runtimes.get(s);
    if (rt) clearTimeout(rt.timer);
    this.runtimes.delete(s);
    for (const link of [...rt?.links.values() ?? []]) link.close();
    for (const key of [...rt?.leases.keys() ?? []]) this.dropLease(rt!, key);
    for (const d of [...this.downloads.values()]) if (d.s === s) this.fail(d, 'Disconnected');
    for (const id of Object.keys(this.transfers)) if (this.transfers[id].sending) this.set(id, { sending: 0 });
  }
}

export const files = new Files();
