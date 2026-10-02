// Screen-share signalling between mumh5 clients, carried as Mumble plugin data so it works on
// any server and other clients ignore it. Murmur drops plugin data over 1000 bytes, so session
// descriptions are compressed and split into chunks.
export const SHARE_DATA_ID = 'mumh5.share';

export const SHARE = {
  on: 1,      // I am sharing my screen
  off: 2,     // I stopped
  who: 3,     // I just got here: who is sharing?
  watch: 4,   // let me watch
  leave: 5,   // I stopped watching
  offer: 6,   // session description from the sharer
  answer: 7   // session description from the viewer
} as const;
export type ShareType = typeof SHARE[keyof typeof SHARE];

const CHUNK = 900;
const MAX_CHUNKS = 32;
const MAX_TEXT = 256 * 1024;
let nextId = 0;

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// Stops reading once the output passes the cap, so a tiny message cannot expand without bound
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_TEXT) { await reader.cancel(); return null; }
      parts.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}

// One packet for a bare signal, several for a signal with text: [type, id, index, total, ...data]
export async function encodeSignal(type: number, text?: string): Promise<Uint8Array[]> {
  if (text == null) return [new Uint8Array([type])];
  const data = await deflate(new TextEncoder().encode(text));
  const total = Math.max(1, Math.ceil(data.length / CHUNK));
  if (total > MAX_CHUNKS) throw new Error('Signal too large');
  const id = nextId = (nextId + 1) & 255;
  return Array.from({ length: total }, (_, i) => {
    const part = data.subarray(i * CHUNK, (i + 1) * CHUNK);
    const packet = new Uint8Array(4 + part.length);
    packet.set([type, id, i, total]);
    packet.set(part, 4);
    return packet;
  });
}

export const encodeShare = (type: ShareType, text?: string) => encodeSignal(type, text);

export interface Signal<T extends number> { type: T; text?: string }
export type ShareSignal = Signal<ShareType>;

// Puts chunked signals back together, per sender
export class SignalAssembler<T extends number> {
  private pending = new Map<string, { parts: (Uint8Array | undefined)[]; got: number; at: number }>();
  private types: readonly T[];

  constructor(types: readonly T[]) {
    this.types = types;
  }

  async push(sender: number, packet: Uint8Array, now = Date.now()): Promise<Signal<T> | null> {
    const type = packet[0] as T;
    if (!this.types.includes(type)) return null;
    if (packet.length === 1) return { type };
    if (packet.length < 4) return null;
    const [, id, index, total] = packet;
    if (!total || total > MAX_CHUNKS || index >= total) return null;
    // Abandoned transfers must not pile up
    for (const [k, v] of this.pending) if (now - v.at > 15000) this.pending.delete(k);
    if (this.pending.size > 64) this.pending.clear();
    const key = `${sender}:${type}:${id}`;
    let entry = this.pending.get(key);
    if (!entry || entry.parts.length !== total) {
      entry = { parts: new Array(total), got: 0, at: now };
      this.pending.set(key, entry);
    }
    if (!entry.parts[index]) entry.got++;
    entry.parts[index] = packet.slice(4);
    if (entry.got < total) return null;
    this.pending.delete(key);
    const joined = new Uint8Array(entry.parts.reduce((n, p) => n + p!.length, 0));
    let at = 0;
    for (const p of entry.parts) { joined.set(p!, at); at += p!.length; }
    const plain = await inflate(joined);
    return plain ? { type, text: new TextDecoder().decode(plain) } : null;
  }
}

export class ShareAssembler extends SignalAssembler<ShareType> {
  constructor() {
    super(Object.values(SHARE));
  }
}
