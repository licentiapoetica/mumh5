import type { Transport, ServerCertInfo, CertDetails } from '../core/transport.ts';

interface NativeApi {
  platformInfo(): Promise<{ os: string; osVersion: string }>;
  describeCerts(ders: Uint8Array[]): Promise<CertDetails[]>;
  updateTray(state: { icon: string; tooltip: string; connected: boolean; server: string; muted: boolean; deafened: boolean; mode: string }): void;
  onTrayAction(fn: (action: string) => void): void;
  linkPreview(url: string): Promise<LinkPreviewData | null>;
  identities: {
    list(): Promise<{ identities: IdentitySummary[]; setupDone: boolean }>;
    create(name: string, email: string): Promise<IdentitySummary>;
    importP12(bytes: Uint8Array, password: string, name: string): Promise<IdentitySummary>;
    findMumble(): Promise<{ name: string } | null>;
    importMumble(name: string): Promise<IdentitySummary>;
    exportP12(id: string, password: string): Promise<string | null>;
    setDefault(id: string): Promise<void>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    finishSetup(): Promise<void>;
  };
  open(connId: string, host: string, port: number, identityId?: string): Promise<void>;
  send(connId: string, bytes: Uint8Array): void;
  close(connId: string): void;
  on(event: 'secure' | 'data' | 'close', fn: (connId: string, ...args: any[]) => void): () => void;
}

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  site: string;
  image: string;
  large: boolean;
  color: string;
}

export interface IdentitySummary {
  id: string;
  name: string;
  fingerprint: string;
  isDefault: boolean;
  cert: CertDetails;
}

declare global {
  interface Window { mumh5Native?: NativeApi }
}

export const native: NativeApi | null = typeof window !== 'undefined' ? window.mumh5Native ?? null : null;

// Transport backed by a TLS socket in the Electron main process.
// `secure` resolves once the TLS handshake is done, before any Mumble data is sent,
// so the caller can check the server certificate before sending a password.
export class ElectronTransport implements Transport {
  onData: ((chunk: Uint8Array) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  readonly secure: Promise<ServerCertInfo>;
  private id = crypto.randomUUID();
  private offs: (() => void)[] = [];
  private api: NativeApi;

  constructor(api: NativeApi, host: string, port: number, identityId?: string) {
    this.api = api;
    let resolveSecure!: (i: ServerCertInfo) => void;
    let rejectSecure!: (e: Error) => void;
    this.secure = new Promise((res, rej) => { resolveSecure = res; rejectSecure = rej; });
    const id = this.id;
    this.offs.push(
      api.on('secure', (cid, info) => { if (cid === id) resolveSecure(info); }),
      api.on('data', (cid, chunk) => { if (cid === id) this.onData?.(chunk); }),
      api.on('close', (cid, reason) => {
        if (cid !== id) return;
        this.offs.forEach(off => off());
        rejectSecure(new Error(reason));
        this.onClose?.(reason);
      })
    );
    api.open(id, host, port, identityId).catch(e => rejectSecure(e));
  }

  send(bytes: Uint8Array): void { this.api.send(this.id, bytes); }
  close(): void { this.api.close(this.id); }
}
