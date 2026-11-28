// The WebRTC side of direct file transfers (see core/file-direct.ts): one data channel per
// download and source. The receiver offers, the source answers; both only when the person
// turned direct files on, since each side learns the other's IP address on a direct route.
import { CHUNK_BYTES, PieceCollector, chunks, parseWant } from '../core/file-direct.ts';
import { fromRanges } from '../core/file-transfer.ts';
import { gathered, iceServers } from './ice.ts';

export const linksSupported = () => typeof RTCPeerConnection !== 'undefined';

// A link that is not open by then is given up; the server route carries on meanwhile
const CONNECT_MS = 15000;
// What the source lets wait in the channel's buffer: enough to keep a fast link busy
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;
const MAX_SDP = 20000;

export const okSdp = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_SDP;

export type LinkRoute = 'direct' | 'relay';

// Whether the connection that came up goes through a relay (TURN) or straight to the other side
async function routeOf(pc: RTCPeerConnection): Promise<LinkRoute> {
  try {
    const stats = await pc.getStats();
    let pairId = '';
    stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
    let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
    stats.forEach(r => {
      if (r.type === 'candidate-pair' && (r.id === pairId || (!pairId && r.state === 'succeeded' && r.nominated))) pair = r;
    });
    const types = [pair?.localCandidateId, pair?.remoteCandidateId].map(id => id ? stats.get(id)?.candidateType : undefined);
    return types.includes('relay') ? 'relay' : 'direct';
  } catch {
    return 'direct';
  }
}

export interface DownHandlers {
  open(route: LinkRoute): void;
  piece(index: number, bytes: Uint8Array): void;
  // Gave up, broke or was closed; `wasOpen` when pieces may have come over it
  closed(wasOpen: boolean): void;
}

/** The receiving end: offers, asks for pieces and puts them together. */
export class DownLink {
  readonly peer: number;
  open = false;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private collector: PieceCollector;
  private h: DownHandlers;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private done = false;

  constructor(peer: number, count: number, size: (index: number) => number, h: DownHandlers) {
    this.peer = peer;
    this.collector = new PieceCollector(count, size);
    this.h = h;
  }

  /** The offer to send to the source, or null when none could be made. */
  async offer(): Promise<string | null> {
    try {
      const pc = this.pc = new RTCPeerConnection({ iceServers: await iceServers() });
      if (this.done) { pc.close(); return null; }
      const dc = this.dc = pc.createDataChannel('mumh5-file', { ordered: true });
      dc.binaryType = 'arraybuffer';
      dc.onopen = async () => {
        if (this.done) return;
        clearTimeout(this.timer);
        this.open = true;
        this.h.open(await routeOf(pc));
      };
      dc.onmessage = e => {
        if (!(e.data instanceof ArrayBuffer)) return;
        const piece = this.collector.push(e.data);
        if (piece) this.h.piece(piece.index, piece.bytes);
      };
      dc.onclose = () => this.close();
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close(); };
      this.timer = setTimeout(() => this.close(), CONNECT_MS);
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      return this.done ? null : pc.localDescription?.sdp ?? null;
    } catch {
      this.close();
      return null;
    }
  }

  async answer(sdp: string): Promise<void> {
    try {
      if (this.pc && !this.done) await this.pc.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      this.close();
    }
  }

  /** Replaces what was asked before; `again` when pieces sent earlier got lost. */
  want(ranges: [number, number][], again = false): void {
    if (this.open && this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ t: 'want', r: ranges, ...again ? { a: 1 } : {} }));
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    const wasOpen = this.open;
    this.open = false;
    this.collector.clear();
    try { this.dc?.close(); } catch { /* already closed */ }
    try { this.pc?.close(); } catch { /* already closed */ }
    this.h.closed(wasOpen);
  }
}

/** The sending end: answers an offer, then sends what the receiver asks for. */
export class UpLink {
  readonly peer: number;
  readonly file: string;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private count: number;
  private read: (index: number) => Promise<Uint8Array | null>;
  private onclosed: () => void;
  private queue: number[] = [];
  private sent = new Set<number>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private done = false;

  constructor(peer: number, file: string, count: number, read: (index: number) => Promise<Uint8Array | null>, onclosed: () => void) {
    this.peer = peer;
    this.file = file;
    this.count = count;
    this.read = read;
    this.onclosed = onclosed;
  }

  /** The answer to send back, or null when the offer cannot be taken. */
  async accept(offer: string): Promise<string | null> {
    try {
      const pc = this.pc = new RTCPeerConnection({ iceServers: await iceServers() });
      if (this.done) { pc.close(); return null; }
      pc.ondatachannel = e => {
        if (this.dc) return e.channel.close();
        const dc = this.dc = e.channel;
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = LOW_WATER;
        dc.onopen = () => clearTimeout(this.timer);
        dc.onmessage = m => { if (typeof m.data === 'string') this.wanted(m.data); };
        dc.onclose = () => this.close();
      };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close(); };
      this.timer = setTimeout(() => this.close(), CONNECT_MS);
      await pc.setRemoteDescription({ type: 'offer', sdp: offer });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      return this.done ? null : pc.localDescription?.sdp ?? null;
    } catch {
      this.close();
      return null;
    }
  }

  private wanted(text: string): void {
    const want = parseWant(text);
    const pieces = want && fromRanges(want.r, this.count);
    if (!pieces) return;
    if (want.a) for (const k of pieces) this.sent.delete(k);
    this.queue = pieces.filter(k => !this.sent.has(k));
    void this.run();
  }

  // Waits until the channel's buffer has room again
  private drained(): Promise<void> {
    const dc = this.dc!;
    if (dc.bufferedAmount <= HIGH_WATER - CHUNK_BYTES) return Promise.resolve();
    return new Promise(resolve => {
      const go = () => { dc.removeEventListener('bufferedamountlow', go); dc.removeEventListener('close', go); resolve(); };
      dc.addEventListener('bufferedamountlow', go);
      dc.addEventListener('close', go);
    });
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.done && this.dc?.readyState === 'open') {
        const k = this.queue.shift()!;
        if (this.sent.has(k)) continue;
        const bytes = await this.read(k);
        if (!bytes) return this.close();
        for (const chunk of chunks(k, bytes)) {
          await this.drained();
          if (this.done || this.dc.readyState !== 'open') return;
          this.dc.send(chunk);
        }
        this.sent.add(k);
      }
    } catch {
      this.close();
    } finally {
      this.running = false;
    }
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    this.queue = [];
    try { this.dc?.close(); } catch { /* already closed */ }
    try { this.pc?.close(); } catch { /* already closed */ }
    this.onclosed();
  }
}
