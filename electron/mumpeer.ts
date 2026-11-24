import { randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import type { LocalTurn, RelayEndpoint } from '../src/core/mumpeer-signal.ts';

export type { LocalTurn };
import { CREDENTIAL_TTL, startTurn, turnCredential, type VirtualTurnPeer } from '../server/turn.ts';

const ALPN = 'mumpeer/1';
const MAX_FRAME = 1500;
const MAX_BACKLOG = 128 * 1024;
const SETUP_TIMEOUT = 10000;

// Opens the TURN endpoint of one lane: packets to and from the pair go through `peer`
export type LaneHost = (peer: VirtualTurnPeer, lane: number) => Promise<{ ice: LocalTurn; close(): void }>;

export interface LinkOptions {
  lanes?: LaneHost;
  // Resolves the relay's address; the proxy uses it to refuse private networks
  lookup?: net.LookupFunction;
}

// The desktop app: a TURN server on loopback for each lane, never reachable from outside
export const loopbackLanes: LaneHost = async peer => {
  const secret = randomBytes(32).toString('hex');
  const turn = await startTurn({
    port: 0, bind: '127.0.0.1', relay: true, publicIp: null, minPort: 0, maxPort: 0,
    maxAllocations: 1, maxPerAddress: 1, peerAllowed: () => false
  }, secret, peer);
  const username = String(Math.floor(Date.now() / 1000) + CREDENTIAL_TTL);
  const ice = { urls: `turn:127.0.0.1:${turn.port}?transport=tcp`, username, credential: turnCredential(secret, username) };
  return { ice, close: () => turn.close() };
};

export class MumpeerLink {
  readonly ready: Promise<void>;
  private socket: tls.TLSSocket;
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private connected = false;
  private ended = false;
  private lanes = new Map<number, Promise<{ ice: LocalTurn; close(): void }>>();
  private receivers = new Map<number, (data: Uint8Array) => void>();
  private finishReady!: () => void;
  private failReady!: (error: Error) => void;
  private timer: ReturnType<typeof setTimeout>;
  private endedLink: (reason: string) => void;
  private laneHost: LaneHost;

  constructor(endpoint: RelayEndpoint, token: string, cert: string, key: string, endedLink: (reason: string) => void, options: LinkOptions = {}) {
    this.endedLink = endedLink;
    this.laneHost = options.lanes ?? loopbackLanes;
    this.ready = new Promise((resolve, reject) => { this.finishReady = resolve; this.failReady = reject; });
    this.socket = tls.connect({
      host: endpoint.host, port: endpoint.tcp,
      servername: net.isIP(endpoint.host) ? undefined : endpoint.host,
      cert, key, minVersion: 'TLSv1.3', ALPNProtocols: [ALPN], rejectUnauthorized: false,
      ...(options.lookup ? { lookup: options.lookup } : {})
    });
    this.socket.setNoDelay(true);
    this.timer = setTimeout(() => this.close('Mumpeer setup timed out'), SETUP_TIMEOUT);
    this.socket.once('secureConnect', () => {
      const actual = this.socket.getPeerX509Certificate()?.fingerprint256.replaceAll(':', '').toLowerCase();
      if (actual !== endpoint.fp || this.socket.alpnProtocol !== ALPN) {
        this.close('Mumpeer certificate or protocol did not match');
        return;
      }
      this.write(0, Buffer.from(JSON.stringify({ v: 1, t: 'bind', tok: token })));
    });
    this.socket.on('data', (chunk: Buffer) => this.read(chunk));
    this.socket.once('error', () => this.close('Could not connect to mumpeer over TLS'));
    this.socket.once('close', () => this.close('The mumpeer link closed'));
  }

  private write(type: number, data: Uint8Array): void {
    const header = Buffer.from([type, data.length >> 8, data.length & 255]);
    this.socket.write(Buffer.concat([header, data]));
  }

  private read(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.ended && this.buffer.length >= 3) {
      const type = this.buffer[0];
      const length = this.buffer.readUInt16BE(1);
      if (length > MAX_FRAME || (type !== 0 && type !== 1)) {
        this.close('Invalid mumpeer frame');
        return;
      }
      if (this.buffer.length < length + 3) return;
      const data = this.buffer.subarray(3, length + 3);
      this.buffer = this.buffer.subarray(length + 3);
      if (type === 0) this.control(data);
      else if (this.connected && data.length > 1) this.receivers.get(data[0])?.(data.subarray(1));
    }
  }

  private control(data: Buffer): void {
    try {
      const msg = JSON.parse(data.toString('utf8'));
      if (msg.v === 1) {
        if (msg.t === 'waiting' && !this.connected) return;
        if (msg.t === 'ready' && !this.connected) {
          this.connected = true;
          clearTimeout(this.timer);
          this.finishReady();
          return;
        }
        if (msg.t === 'error' && typeof msg.code === 'string' && /^[a-z_]{1,32}$/.test(msg.code)) {
          this.close(`Mumpeer refused the link (${msg.code})`);
          return;
        }
      }
    } catch { /* handled as an invalid control frame */ }
    this.close('Invalid mumpeer control message');
  }

  private startLane(lane: number, lowSide: boolean): Promise<{ ice: LocalTurn; close(): void }> {
    // These addresses appear in SDP and inside TURN. They are never dialed or bound.
    const port = 40000 + lane;
    const low = { ip: '192.0.2.1', port };
    const high = { ip: '192.0.2.2', port };
    return this.laneHost({
      local: lowSide ? low : high, remote: lowSide ? high : low,
      send: data => {
        if (!this.ended && data.length < MAX_FRAME && this.socket.writableLength < MAX_BACKLOG) {
          this.write(1, Buffer.concat([Buffer.from([lane]), data]));
        }
      },
      receive: fn => {
        this.receivers.set(lane, fn);
        return () => { if (this.receivers.get(lane) === fn) this.receivers.delete(lane); };
      }
    }, lane);
  }

  async turn(lane: number, lowSide: boolean): Promise<LocalTurn> {
    await this.ready;
    if (this.ended) throw new Error('The mumpeer link closed');
    let pending = this.lanes.get(lane);
    if (!pending) {
      pending = this.startLane(lane, lowSide);
      this.lanes.set(lane, pending);
    }
    try {
      const result = await pending;
      if (this.lanes.get(lane) !== pending) throw new Error('The mumpeer allocation closed');
      return result.ice;
    } catch (error) {
      if (this.lanes.get(lane) === pending) this.lanes.delete(lane);
      throw error;
    }
  }

  closeLane(lane: number): void {
    const pending = this.lanes.get(lane);
    this.lanes.delete(lane);
    void pending?.then(turn => turn.close(), () => {});
  }

  close(reason = 'The mumpeer link closed'): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timer);
    this.buffer = Buffer.alloc(0);
    this.socket.destroy();
    for (const lane of this.lanes.keys()) this.closeLane(lane);
    this.failReady(new Error(reason));
    this.endedLink(reason);
  }
}
