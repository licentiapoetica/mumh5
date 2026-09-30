// A reliable, ordered byte stream to a Mumble server (TLS in Electron, WebSocket proxy on the web).
export interface Transport {
  send(bytes: Uint8Array): void;
  close(): void;
  onData: ((chunk: Uint8Array) => void) | null;
  onClose: ((reason: string) => void) | null;
  // Encrypted UDP for voice, where the platform has it (desktop); absent on the web
  udp?: UdpChannel;
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
}
