import type { LocalTurn, RelayEndpoint } from './mumpeer-signal.ts';

// A reliable, ordered byte stream to a Mumble server (TLS in Electron, WebSocket proxy on the web).
export interface Transport {
  send(bytes: Uint8Array): void;
  close(): void;
  onData: ((chunk: Uint8Array) => void) | null;
  onClose: ((reason: string) => void) | null;
  // Encrypted UDP for voice, where the platform has it (desktop); absent on the web
  udp?: UdpChannel;
}

// What a transport offers for mumpeer: a link to the relay kept for this Mumble connection (by the
// desktop app itself, or by the web proxy), and a TURN server for each of its two lanes.
export interface RelayTransport {
  relayOpen(rid: string, endpoint: RelayEndpoint, token: string, lowSide: boolean): Promise<void>;
  relayTurn(rid: string, lane: number): Promise<LocalTurn>;
  relayCloseLane(rid: string, lane: number): void;
  relayClose(rid: string): void;
  onRelayClose(fn: (rid: string, reason: string) => void): () => void;
}

// The server speaks first, and its Version can arrive before the client is attached (the
// certificate check and platform info come between). Without it, a 1.5 server gets voice in the
// old format and drops all of it, so what comes early is kept for the client.
export class HeldData {
  private held: Uint8Array[] = [];
  private receiver: ((chunk: Uint8Array) => void) | null = null;

  get handler(): ((chunk: Uint8Array) => void) | null {
    return this.receiver;
  }

  set handler(fn: ((chunk: Uint8Array) => void) | null) {
    this.receiver = fn;
    if (fn) for (const chunk of this.held.splice(0)) fn(chunk);
  }

  push(chunk: Uint8Array): void {
    if (this.receiver) this.receiver(chunk);
    else this.held.push(chunk);
  }
}

export interface UdpChannel {
  setup(key: Uint8Array, clientNonce: Uint8Array, serverNonce: Uint8Array, protobuf: boolean): void;
  setServerNonce(nonce: Uint8Array): void;
  clientNonce(): Promise<Uint8Array | null>;
  send(plain: Uint8Array): void;
  onVoice: ((plain: Uint8Array) => void) | null;
  onState: ((ok: boolean, rtt: number) => void) | null;
  onResync: (() => void) | null;
}

export interface ConnectTarget {
  host: string;
  port: number;
}

// Identity certificate the client presents; Mumble uses it to recognize registered users.
export interface Identity {
  certPem: string;
  keyPem: string;
  fingerprint: string;
}

export interface CertDetails {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  fingerprint: string;     // SHA-1, the hash Mumble uses for users
  fingerprint256: string;
  subjectAltName: string;
  keyType: string;
  keyBits: number | null;
  ca: boolean;
  selfSigned: boolean;
  pem: string;
}

export interface ServerCertInfo {
  fingerprint: string;       // sha256 of the server certificate, colon-separated hex
  authorized: boolean;       // true if it chains to a trusted CA
  authError: string | null;  // why it is not trusted, e.g. DEPTH_ZERO_SELF_SIGNED_CERT
  chain: CertDetails[];      // leaf first
  // Browser build only: this client's address as the web proxy saw it. The Mumble server
  // sees the proxy's address instead and cannot be told the original one.
  clientAddress?: string;
}
