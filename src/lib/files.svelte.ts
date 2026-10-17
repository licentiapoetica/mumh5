// Files sent through the Mumble server (see core/file-transfer.ts): what this computer keeps,
// downloads in progress, and the pieces it sends to others. A download asks the sender and
// everyone else on the server who has the file, and splits the pieces between them; each
// source is limited by the server to about one message a second, so more sources are faster.
// The server checked who sent each piece; the file's hash comes with the announcement.
import {
  FILE, FILE_DATA_ID, MAX_FILE, MAX_PIECES, FileAssembler, Sender, pump, encodeFileSignal, parseBody, okId, validMeta,
  pieceBytes, pieceCount, pieceSize, pieceForm, pieceMessage, parsePiece, encode15, decode15,
  toRanges, fromRanges, split, sha256, rootHash, type FileMeta, type FileType
} from '../core/file-transfer.ts';
import { newId } from '../core/text-signal.ts';
import type { Session } from './session.svelte.ts';
import { getBlob, putBlob, getData, putData, deleteBlob } from './blobstore.ts';
import { store } from './settings.svelte.ts';
import { sounds } from './audio/sounds.svelte.ts';

export interface Transfer {
  state: 'idle' | 'finding' | 'loading' | 'ready' | 'failed';
  got: number;     // bytes so far
  rate: number;    // bytes per second, recently
  sources: number; // people sending it to us
  error: string;
  url: string;     // once ready
  sending: number; // people we are sending it to
}

const BLANK: Transfer = { state: 'idle', got: 0, rate: 0, sources: 0, error: '', url: '', sending: 0 };

// What this computer keeps of files it sent and received; the oldest go first
const KEEP_BYTES = 2 * 1024 ** 3;
const INDEX = 'files:index';
const MAX_SOURCES = 4;
// How long answers to "who has it" may take
const FIND_MS = 3000;
// A source that sent nothing for this long is asked again, twice, then the download stops
const STALL_MS = 45000;
// Murmur allows 15 plugin messages at once and 4 a second; text channels use some of that
const BURST = 4;
const PER_SECOND = 1.5;

interface Kept extends FileMeta { at: number }

interface Source { pieces: Set<number>; retries: number }

interface Download {
  s: Session;
  meta: FileMeta;
  count: number;
  parts: (Blob | undefined)[];
  digests: Promise<Uint8Array>[];
  got: number;
  bytes: number;
  sources: Map<number, Source>;
  findUntil: number;
  lastAt: number;
  stalls: number;
  timer: ReturnType<typeof setInterval>;
  rebalance: ReturnType<typeof setTimeout> | undefined;
  rateFrom: { at: number; bytes: number };
}

interface Runtime {
  assembler: FileAssembler;
  sender: Sender;
  pumping: boolean;
  queue: { to: number[]; packet: Uint8Array }[];
  level: number;
  levelAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

// Only types the app can show are kept as such; anything else (HTML, SVG) stays inert data
// even if someone opens it, because object URLs carry the app's own origin
export function safeType(type: string): string {
  return /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+)$/.test(type) ? type : 'application/octet-stream';
}

export function fileKind(meta: FileMeta): 'image' | 'video' | 'audio' | null {
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

  // Plugin data needs a 1.4 server; older ones would not pass the requests on
  supported(s: Session): boolean {
    return !!s.client && s.client.serverVersionNum >= 0x010400;
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
    this.set(meta.i, { state: 'ready', got: meta.s, url, error: '', rate: 0, sources: 0 });
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
      rebalance: undefined, rateFrom: { at: now, bytes: 0 }
    };
    this.downloads.set(meta.i, d);
    this.set(meta.i, { state: 'finding', got: 0, rate: 0, sources: 0, error: '' });
    if (author != null && author !== client.session && client.users.has(author)) {
      d.sources.set(author, { pieces: new Set(), retries: 0 });
      this.assign(d);
    }
    const others = [...client.users.keys()].filter(id => id !== client.session && id !== author);
    this.signal(s, others, FILE.who, { i: meta.i });
  }

  cancel(id: string): void {
    const d = this.downloads.get(id);
    if (!d) return;
    this.stop(d);
    this.set(id, { state: 'idle', got: 0, rate: 0, sources: 0 });
  }

  private stop(d: Download): void {
    clearInterval(d.timer);
    clearTimeout(d.rebalance);
    if (this.downloads.get(d.meta.i) === d) this.downloads.delete(d.meta.i);
    const busy = [...d.sources].filter(([, src]) => src.pieces.size).map(([id]) => id);
    if (d.s.client) this.signal(d.s, busy, FILE.want, { i: d.meta.i, r: [] });
  }

  private fail(d: Download, error: string): void {
    this.stop(d);
    this.set(d.meta.i, { state: 'failed', error, rate: 0, sources: 0 });
    sounds.play('uploadFailed');
  }

  private missing(d: Download): number[] {
    const out: number[] = [];
    for (let k = 0; k < d.count; k++) if (!d.parts[k]) out.push(k);
    return out;
  }

  // Shares out what is still missing between the sources, one stretch each
  private assign(d: Download): void {
    clearTimeout(d.rebalance);
    d.rebalance = undefined;
    const parts = split(this.missing(d), [...d.sources.keys()]);
    for (const [id, src] of d.sources) {
      const pieces = parts.get(id) ?? [];
      // Nothing new for a source that has nothing to do
      if (!pieces.length && !src.pieces.size) continue;
      src.pieces = new Set(pieces);
      this.signal(d.s, [id], FILE.want, { i: d.meta.i, r: toRanges(pieces) });
    }
    this.set(d.meta.i, { sources: d.sources.size });
  }

  private dropSource(d: Download, id: number): void {
    if (!d.sources.delete(id)) return;
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
      this.assign(d);
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
    d.parts[p.index] = new Blob([bytes as Uint8Array<ArrayBuffer>]);
    d.digests[p.index] = sha256(bytes);
    d.got++;
    d.bytes += bytes.length;
    d.lastAt = Date.now();
    d.stalls = 0;
    d.sources.get(from)!.pieces.delete(p.index);
    if (this.transfers[d.meta.i]?.state === 'finding' && d.rateFrom.bytes === 0) d.rateFrom = { at: Date.now(), bytes: 0 };
    this.set(d.meta.i, { state: 'loading', got: d.bytes });
    if (d.got === d.count) this.finish(d);
  }

  private async finish(d: Download): Promise<void> {
    this.stop(d);
    const hash = await rootHash(await Promise.all(d.digests));
    if (hash !== d.meta.h) return this.fail(d, 'The file did not arrive intact');
    const blob = new Blob(d.parts as Blob[], { type: safeType(d.meta.m) });
    this.ready(d.meta, blob);
    this.keep(d.meta, blob);
    sounds.play('uploadDone');
  }

  // ─── Requests between clients ───────────────────────────────────────────────

  private runtime(s: Session): Runtime {
    let rt = this.runtimes.get(s);
    if (!rt) {
      rt = { assembler: new FileAssembler(), sender: new Sender(), pumping: false, queue: [], level: 0, levelAt: Date.now(), timer: undefined };
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
        if (await this.find(id)) this.signal(s, [from], FILE.have, { i: id });
        break;
      case FILE.have:
        if (!mine || mine.sources.has(from) || mine.sources.size >= MAX_SOURCES) return;
        mine.sources.set(from, { pieces: new Set(), retries: 0 });
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
        rt.sender.want(id, from, pieces);
        this.set(id, { sending: rt.sender.receivers(id) });
        this.pump(s, rt);
        break;
      }
      case FILE.done: {
        const src = mine?.sources.get(from);
        if (!mine || !src) return;
        mine.lastAt = Date.now();
        const left = [...src.pieces].filter(k => !mine.parts[k]);
        if (!left.length) return;
        // Something got lost on the way: ask again, or leave it to the others
        if (++src.retries > 2) return this.dropSource(mine, from);
        src.pieces = new Set(left);
        this.signal(s, [from], FILE.want, { i: id, r: toRanges(left) });
        break;
      }
      case FILE.gone:
        if (mine) this.dropSource(mine, from);
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
      done: (r, file) => this.signal(s, [r], FILE.done, { i: file }),
      gone: (rs, file) => { this.signal(s, rs, FILE.gone, { i: file }); this.set(file, { sending: 0 }); },
      sent: file => this.set(file, { sending: rt.sender.receivers(file) })
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
    const rt = this.runtimes.get(s);
    if (rt) {
      rt.sender.drop(session);
      for (const id of Object.keys(this.transfers)) if (this.transfers[id].sending) this.set(id, { sending: rt.sender.receivers(id) });
    }
    for (const d of [...this.downloads.values()]) if (d.s === s) this.dropSource(d, session);
  }

  closed(s: Session): void {
    const rt = this.runtimes.get(s);
    if (rt) clearTimeout(rt.timer);
    this.runtimes.delete(s);
    for (const d of [...this.downloads.values()]) if (d.s === s) this.fail(d, 'Disconnected');
    for (const id of Object.keys(this.transfers)) if (this.transfers[id].sending) this.set(id, { sending: 0 });
  }
}

export const files = new Files();
