import dgram from 'node:dgram';
import net from 'node:net';
import { CryptState } from './ocb2.ts';
import { writeVarint, readVarint } from '../src/core/voice-packet.ts';
import { MumbleUDP } from '../src/core/mumble-udp-pb.js';
import type { UdpChannel } from '../src/core/transport.ts';

// Encrypted UDP voice channel to a Mumble server. Voice uses UDP only while the server
// answers our UDP pings; until then (and if it stops) the client keeps using the TCP tunnel.

export interface UdpCallbacks {
  onVoice(plain: Uint8Array): void;
  onState(ok: boolean, rtt: number): void;
  onResync(): void;          // too many decrypt failures: ask the server for a fresh nonce
}

const PING_MS = 2000;
const DEAD_MS = 8000;

export class UdpVoice {
  readonly crypt = new CryptState();
  ok = false;
  rtt = 0;
  private sock: dgram.Socket;
  private protobuf = true;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private failures = 0;
  private lastResync = 0;
  private closed = false;
  private host: string;
  private port: number;
  private cb: UdpCallbacks;

  constructor(host: string, port: number, cb: UdpCallbacks) {
    this.host = host;
    this.port = port;
    this.cb = cb;
    this.sock = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
    this.sock.on('message', msg => this.receive(msg));
    this.sock.on('error', () => this.setOk(false));
  }

  setup(key: Uint8Array, clientNonce: Uint8Array, serverNonce: Uint8Array, protobuf: boolean): void {
    this.crypt.setKey(key, clientNonce, serverNonce);
    this.protobuf = protobuf;
    if (!this.pingTimer) {
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), PING_MS);
    }
  }

  setServerNonce(nonce: Uint8Array): void {
    this.crypt.setDecryptIv(nonce);
    this.failures = 0;
  }

  send(plain: Uint8Array): void {
    if (this.closed || !this.crypt.valid) return;
    const packet = this.crypt.encrypt(plain);
    this.sock.send(packet, this.port, this.host);
  }

  private ping(): void {
    if (this.lastPong && Date.now() - this.lastPong > DEAD_MS) this.setOk(false);
    const ts = Date.now();
    if (this.protobuf) {
      const body: Uint8Array = MumbleUDP.Ping.encode(MumbleUDP.Ping.fromObject({ timestamp: ts })).finish();
      const out = new Uint8Array(body.length + 1);
      out[0] = 1;
      out.set(body, 1);
      this.send(out);
    } else {
      const out: number[] = [1 << 5];
      writeVarint(out, ts);
      this.send(new Uint8Array(out));
    }
  }

  private receive(msg: Buffer): void {
    const plain = this.crypt.decrypt(msg);
    if (!plain) {
      // Repeated failures mean the nonces drifted apart; ask for a resync now and then
      if (++this.failures > 8 && Date.now() - this.lastResync > 5000) {
        this.lastResync = Date.now();
        this.failures = 0;
        this.cb.onResync();
      }
      return;
    }
    this.failures = 0;
    const pingTs = this.pingTimestamp(plain);
    if (pingTs != null) {
      this.lastPong = Date.now();
      this.rtt = Math.max(0, Date.now() - pingTs);
      this.setOk(true);
      return;
    }
    this.cb.onVoice(new Uint8Array(plain));
  }

  private pingTimestamp(p: Buffer): number | null {
    try {
      if (p[0] === 1 && this.protobuf) return Number(MumbleUDP.Ping.toObject(MumbleUDP.Ping.decode(p.subarray(1)), { longs: Number }).timestamp);
      if (p[0] >> 5 === 1 && !this.protobuf) return readVarint(p, 1)[0];
    } catch { /* not a ping */ }
    return null;
  }

  private setOk(ok: boolean): void {
    if (ok === this.ok) {
      if (ok) this.cb.onState(true, this.rtt);
      return;
    }
    this.ok = ok;
    this.cb.onState(ok, this.rtt);
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.sock.close(); } catch { /* closed */ }
  }
}

// UdpVoice behind the client's UdpChannel interface (used directly in Node, bridged over IPC in the app)
export function udpChannel(host: string, port: number): UdpChannel & { close(): void; voice: UdpVoice } {
  const ch: UdpChannel & { close(): void; voice: UdpVoice } = {
    onVoice: null, onState: null, onResync: null,
    setup: (k, c, s, p) => voice.setup(k, c, s, p),
    setServerNonce: n => voice.setServerNonce(n),
    clientNonce: () => Promise.resolve(voice.crypt.valid ? new Uint8Array(voice.crypt.encryptIv) : null),
    send: p => voice.send(p),
    close: () => voice.close(),
    voice: null as unknown as UdpVoice
  };
  const voice = new UdpVoice(host, port, {
    onVoice: p => ch.onVoice?.(p),
    onState: (ok, rtt) => ch.onState?.(ok, rtt),
    onResync: () => ch.onResync?.()
  });
  ch.voice = voice;
  return ch;
}

