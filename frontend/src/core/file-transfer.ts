// Files between mumh5 clients, carried by the Mumble server itself, with no file host.
//
// A file is announced in an ordinary chat message: a marker other clients do not show, then
// its name, size and a preview picture, which is all regular Mumble clients get. mumh5 clients
// that want the file ask the sender, or anyone else who has it, over plugin data; the pieces
// then come as chat messages addressed only to those clients.
//
// Murmur lets a client send about one chat message a second, but one message may be as long
// as the image limit (131072 characters by default) when the bulk sits in <img src="data:...">.
// It counts characters, not bytes, so every character carries 15 bits (code points U+4000 to
// U+BFFF, all plain XML text): about 240 KB per message. A message addressed to several
// people costs the sender one message; the server copies it to each of them.
import { encodeSignal, SignalAssembler } from './share-signal.ts';
import type { MumbleClient } from './client.ts';

export const FILE_DATA_ID = 'mumh5.file';

export const FILE = {
  who: 1,    // who has file i? { i }
  have: 2,   // I have file i: { i }
  want: 3,   // send me these pieces of i: { i, r: ranges }; replaces what was asked before, none stops
  done: 4,   // everything you asked for is sent: { i }
  gone: 5    // I cannot send file i: { i }
} as const;
export type FileType = typeof FILE[keyof typeof FILE];

export const MAX_FILE = 2 * 1024 ** 3;
// Keeps the bookkeeping small even when a server's limits make pieces small
export const MAX_PIECES = 65536;

// i: id, n: name, s: size in bytes, m: type, c: bytes per piece, h: hash of the piece hashes
export interface FileMeta { i: string; n: string; s: number; m: string; c: number; h: string }

export const encodeFileSignal = (type: FileType, body: unknown) => encodeSignal(type, JSON.stringify(body));

export class FileAssembler extends SignalAssembler<FileType> {
  constructor() {
    super(Object.values(FILE));
  }
}

export function parseBody(text: string | undefined): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text ?? '');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export const okId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-z]{1,40}$/.test(v);

// ─── 15 bits per character ────────────────────────────────────────────────────

const BASE = 0x4000;

export const encodedLength = (bytes: number) => Math.ceil(bytes * 8 / 15);

export function encode15(bytes: Uint8Array): string {
  const codes = new Uint16Array(encodedLength(bytes.length));
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    if (bits >= 15) {
      bits -= 15;
      codes[o++] = BASE + (acc >>> bits);
      acc &= (1 << bits) - 1;
    }
  }
  if (bits > 0) codes[o++] = BASE + (acc << (15 - bits));
  let out = '';
  for (let i = 0; i < codes.length; i += 8192) out += String.fromCharCode(...codes.subarray(i, i + 8192));
  return out;
}

// The byte length comes from the file's size: the last character does not say how many bits it holds
export function decode15(text: string, length: number): Uint8Array | null {
  if (text.length !== encodedLength(length)) return null;
  const out = new Uint8Array(length);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - BASE;
    if (v < 0 || v > 0x7fff) return null;
    acc = (acc << 15) | v;
    bits += 15;
    while (bits >= 8 && o < length) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 255;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

// ─── Pieces as chat messages ─────────────────────────────────────────────────

export interface Limits { allowHtml: boolean; messageLength: number; imageMessageLength: number }

// 0 means no limit; stay well inside what a server reads in one go anyway
const UNLIMITED = 1 << 20;
const OVERHEAD = 128;

// Pieces travel inside <img src="data:..."> where that allows more than plain text
export function pieceForm(l: Limits): 'img' | 'text' {
  const text = l.messageLength || UNLIMITED;
  const image = l.allowHtml ? l.imageMessageLength || UNLIMITED : 0;
  return image > text ? 'img' : 'text';
}

// Bytes of a file per chat message on a server with these limits: a multiple of 15, so a
// full piece fills its characters exactly
export function pieceBytes(l: Limits): number {
  const text = l.messageLength || UNLIMITED;
  const image = l.allowHtml ? l.imageMessageLength || UNLIMITED : 0;
  const chars = Math.min(UNLIMITED, Math.max(text, image)) - OVERHEAD;
  return Math.max(0, Math.floor(chars / 8) * 15);
}

export const pieceCount = (m: { s: number; c: number }) => Math.ceil(m.s / m.c);
export const pieceSize = (m: { s: number; c: number }, k: number) => Math.min(m.c, m.s - k * m.c);

export function pieceMessage(form: 'img' | 'text', id: string, index: number, payload: string): string {
  return form === 'img' ? `<img alt="mumh5:f:${id}:${index}" src="data:,${payload}"/>` : `mumh5:f:${id}:${index}:${payload}`;
}

const IMG_HEAD = '<img alt="mumh5:f:';
const TEXT_HEAD = 'mumh5:f:';
const IMG_RE = /^<img alt="mumh5:f:([0-9a-z]{1,40}):(\d{1,7})" src="data:,/;
const TEXT_RE = /^mumh5:f:([0-9a-z]{1,40}):(\d{1,7}):/;

// Cheap enough to run on every chat message before anything else looks at it
export const isPiece = (html: string) => html.startsWith(IMG_HEAD) || html.startsWith(TEXT_HEAD);

export function parsePiece(html: string): { id: string; index: number; payload: string } | null {
  const img = html.startsWith(IMG_HEAD);
  const m = (img ? IMG_RE : TEXT_RE).exec(html.slice(0, 80));
  if (!m || (img && !html.endsWith('"/>'))) return null;
  return { id: m[1], index: Number(m[2]), payload: html.slice(m[0].length, img ? -3 : undefined) };
}

// ─── The announcement ────────────────────────────────────────────────────────

const OPEN = '<!--mumh5:file:';
const CLOSE = '<!--/mumh5:file-->';
// No "-" in the encoded part, so the comment cannot end early or contain "--"
const BLOCK = /<!--mumh5:file:([^>\-]{1,2000})-->([\s\S]*?)<!--\/mumh5:file-->/g;
const POSTER = /<img src="(data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+)"\s*\/?>/;

// What other clients show stays between the markers, so mumh5 can put its own card there
export function announce(meta: FileMeta, visible: string): string {
  return `${OPEN}${encodeURIComponent(JSON.stringify(meta)).replace(/-/g, '%2D')}-->${visible}${CLOSE}`;
}

export function validMeta(v: unknown): FileMeta | null {
  const m = v as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || !okId(m.i)) return null;
  if (typeof m.n !== 'string' || !m.n.length || m.n.length > 255) return null;
  if (!Number.isInteger(m.s) || (m.s as number) < 1 || (m.s as number) > MAX_FILE) return null;
  if (typeof m.m !== 'string' || m.m.length > 100 || (m.m && !/^[\w.+-]+\/[\w.+-]+$/.test(m.m))) return null;
  if (!Number.isInteger(m.c) || (m.c as number) < 1500 || (m.c as number) > 2 * UNLIMITED || (m.c as number) % 15) return null;
  if (Math.ceil((m.s as number) / (m.c as number)) > MAX_PIECES) return null;
  if (typeof m.h !== 'string' || !/^[0-9a-f]{64}$/.test(m.h)) return null;
  // Names come from other people: no folders, no control characters
  const n = m.n.replace(/[\u0000-\u001f\u007f/\\]/g, '_');
  return { i: m.i, n, s: m.s as number, m: m.m, c: m.c as number, h: m.h };
}

// Finds announced files and takes them out of the message, together with their preview picture
export function takeFiles(html: string): { html: string; files: { meta: FileMeta; poster: string }[] } {
  if (!html.includes(OPEN)) return { html, files: [] };
  const files: { meta: FileMeta; poster: string }[] = [];
  const rest = html.replace(BLOCK, (all, encoded: string, inner: string) => {
    let meta: FileMeta | null = null;
    try { meta = validMeta(JSON.parse(decodeURIComponent(encoded))); } catch { /* not ours */ }
    if (!meta) return all;
    if (!files.some(f => f.meta.i === meta.i)) files.push({ meta, poster: POSTER.exec(inner)?.[1] ?? '' });
    return '';
  });
  return { html: rest, files };
}

// ─── Ranges of pieces ────────────────────────────────────────────────────────

// Sorted piece numbers as [first, last + 1] pairs
export function toRanges(pieces: Iterable<number>): [number, number][] {
  const sorted = [...pieces].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === p) last[1]++;
    else if (!last || last[1] < p) out.push([p, p + 1]);
  }
  return out;
}

export function fromRanges(v: unknown, count: number): number[] | null {
  if (!Array.isArray(v) || v.length > 10000) return null;
  const out = new Set<number>();
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 2) return null;
    const [a, b] = r;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > count || a >= b) return null;
    for (let p = a; p < b; p++) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

// Splits what is missing into one stretch per source, in the order given
export function split(missing: number[], sources: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const per = Math.ceil(missing.length / Math.max(1, sources.length));
  sources.forEach((s, i) => {
    const part = missing.slice(i * per, (i + 1) * per);
    if (part.length) out.set(s, part);
  });
  return out;
}

// ─── Hashes ──────────────────────────────────────────────────────────────────

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
}

// The file's hash: SHA-256 over the SHA-256 of every piece, so pieces can be hashed as they come
export async function rootHash(digests: Uint8Array[]): Promise<string> {
  const all = new Uint8Array(digests.length * 32);
  digests.forEach((d, i) => all.set(d, i * 32));
  return [...await sha256(all)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── What a source sends next ────────────────────────────────────────────────

// Takes turns between the people asking, so one large download does not hold up the others,
// and sends each piece to everyone who wants it at once
export class Sender {
  private wants = new Map<string, Map<number, Set<number>>>();
  private turns: [string, number][] = [];

  want(file: string, receiver: number, pieces: number[]): void {
    let byReceiver = this.wants.get(file);
    if (!pieces.length) {
      byReceiver?.delete(receiver);
      if (byReceiver && !byReceiver.size) this.wants.delete(file);
      this.turns = this.turns.filter(([f, r]) => f !== file || r !== receiver);
      return;
    }
    if (!byReceiver) this.wants.set(file, byReceiver = new Map());
    byReceiver.set(receiver, new Set(pieces));
    if (!this.turns.some(([f, r]) => f === file && r === receiver)) this.turns.push([file, receiver]);
  }

  // Someone left
  drop(receiver: number): void {
    for (const file of [...this.wants.keys()]) this.want(file, receiver, []);
  }

  // The file cannot be sent; returns who was waiting for it
  dropFile(file: string): number[] {
    const waiting = [...this.wants.get(file)?.keys() ?? []];
    this.wants.delete(file);
    this.turns = this.turns.filter(([f]) => f !== file);
    return waiting;
  }

  get busy(): boolean {
    return this.turns.length > 0;
  }

  // People waiting for pieces of a file
  receivers(file: string): number {
    return this.wants.get(file)?.size ?? 0;
  }

  // The next piece, who it goes to, and who has everything they asked for once it is sent
  next(): { file: string; piece: number; to: number[]; finished: number[] } | null {
    const turn = this.turns.shift();
    if (!turn) return null;
    const [file, receiver] = turn;
    const byReceiver = this.wants.get(file)!;
    let piece = Infinity;
    for (const p of byReceiver.get(receiver)!) if (p < piece) piece = p;
    const to: number[] = [], finished: number[] = [];
    for (const [r, set] of byReceiver) {
      if (!set.delete(piece)) continue;
      to.push(r);
      if (!set.size) finished.push(r);
    }
    for (const r of finished) {
      byReceiver.delete(r);
      if (r !== receiver) this.turns = this.turns.filter(([f, x]) => f !== file || x !== r);
    }
    if (!byReceiver.size) this.wants.delete(file);
    if (!finished.includes(receiver)) this.turns.push(turn);
    return { file, piece, to, finished };
  }
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export interface PumpHost {
  client: Pick<MumbleClient, 'bulkWait' | 'sendBulk' | 'flushed' | 'users'>;
  sender: Sender;
  // The chat message carrying a piece, or null when the file cannot be read any more
  read(file: string, piece: number): Promise<string | null>;
  done(receiver: number, file: string): void;
  gone(receivers: number[], file: string): void;
  alive(): boolean;
  sent?(file: string, piece: number, to: number[]): void;
}

// Pieces sent before the server confirmed it has read them
const UNCONFIRMED = 3;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Sends pieces while anyone wants some, as fast as the server's message limit allows
export async function pump(h: PumpHost): Promise<void> {
  let unconfirmed = 0;
  while (h.alive() && h.sender.busy) {
    const job = h.sender.next();
    if (!job) break;
    const html = await h.read(job.file, job.piece).catch(() => null);
    if (html == null) {
      h.gone([...new Set([...job.to, ...h.sender.dropFile(job.file)])], job.file);
      continue;
    }
    // A slow upload slows the transfer down instead of piling up in front of chat and voice
    if (unconfirmed >= UNCONFIRMED) {
      await h.client.flushed();
      unconfirmed = 0;
    }
    for (let w = h.client.bulkWait(); w > 0; w = h.client.bulkWait()) {
      await sleep(w);
      if (!h.alive()) return;
    }
    const to = job.to.filter(r => h.client.users.has(r));
    if (to.length && h.client.sendBulk({ users: to }, html)) unconfirmed++;
    h.sent?.(job.file, job.piece, to);
    for (const r of job.finished) if (h.client.users.has(r)) h.done(r, job.file);
  }
}
