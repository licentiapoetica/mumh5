// Files over a WebRTC data channel between two mumh5 clients that both turned it on, instead of
// through the Mumble server (see file-transfer.ts). The offer and answer travel as file signals
// over the server, which checked who sent them, so the channel's encryption is tied to that
// user. The receiver asks for pieces as text, the source answers with binary chunks; the file's
// hash from the announcement still decides whether the result is kept.

// A data channel message may be at most 256 KB between Chromium peers; smaller chunks keep the
// sender's buffer moving in small steps
export const CHUNK_BYTES = 64 * 1024;
const HEAD = 8;

// Receiver to source: the pieces it still wants, as ranges (see toRanges); none stops
// a: pieces sent before got lost, send them again
export interface DirectWant { t: 'want'; r: [number, number][]; a?: true }

export function parseWant(text: string): DirectWant | null {
  try {
    const v = JSON.parse(text);
    if (!v || v.t !== 'want' || !Array.isArray(v.r)) return null;
    return v.a === 1 ? { t: 'want', r: v.r, a: true } : { t: 'want', r: v.r };
  } catch {
    return null;
  }
}

/** One piece as data channel messages: its index and the offset, then the bytes. */
export function* chunks(index: number, bytes: Uint8Array): Generator<Uint8Array<ArrayBuffer>> {
  for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
    const part = bytes.subarray(at, at + CHUNK_BYTES);
    const out = new Uint8Array(HEAD + part.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, index);
    view.setUint32(4, at);
    out.set(part, HEAD);
    yield out;
  }
}

/** Puts pieces back together from chunks; anything that does not fit the file is dropped. */
export class PieceCollector {
  private open = new Map<number, { bytes: Uint8Array; got: number; seen: Set<number> }>();
  private size: (index: number) => number;
  private count: number;

  constructor(count: number, size: (index: number) => number) {
    this.count = count;
    this.size = size;
  }

  /** A whole piece once its last chunk is in, else null. */
  push(message: ArrayBuffer): { index: number; bytes: Uint8Array } | null {
    if (message.byteLength < HEAD) return null;
    const view = new DataView(message);
    const index = view.getUint32(0), at = view.getUint32(4);
    if (index >= this.count) return null;
    const size = this.size(index);
    const data = new Uint8Array(message, HEAD);
    if (at % CHUNK_BYTES || at + data.length > size || (data.length !== Math.min(CHUNK_BYTES, size - at))) return null;
    let piece = this.open.get(index);
    if (!piece) this.open.set(index, piece = { bytes: new Uint8Array(size), got: 0, seen: new Set() });
    // A chunk sent twice counts once
    if (piece.seen.has(at)) return null;
    piece.seen.add(at);
    piece.bytes.set(data, at);
    piece.got += data.length;
    if (piece.got < size) return null;
    this.open.delete(index);
    return { index, bytes: piece.bytes };
  }

  // Pieces started and not finished, after the link broke
  clear(): void {
    this.open.clear();
  }
}

// What a side allows, as said in its "have" answer: 1 a direct route (and mumpeer when the other
// side wants it), 2 only the server's mumpeer relay, which keeps the IP addresses apart
export type LinkMode = 1 | 2;
export const okMode = (v: unknown): v is LinkMode => v === 1 || v === 2;

/**
 * How two sides connect, or null when they cannot: mumpeer as soon as either wants it, and then
 * only when both name the same pinned relay; otherwise directly.
 */
export function linkRoute(mine: LinkMode, theirs: LinkMode, myRelay: string, theirRelay: string): 'direct' | 'mumpeer' | null {
  if (mine === 2 || theirs === 2) return myRelay && myRelay === theirRelay ? 'mumpeer' : null;
  return 'direct';
}
