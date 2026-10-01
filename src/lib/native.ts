import type { Transport, ServerCertInfo, CertDetails, UdpChannel } from '../core/transport.ts';
import { webApi, openWebTransport } from './web.svelte.ts';

// What both the desktop app and the browser build (through the web proxy) provide
export interface PlatformApi {
  platformInfo(): Promise<{ os: string; osVersion: string }>;
  describeCerts(ders: Uint8Array[]): Promise<CertDetails[]>;
  identities: {
    list(): Promise<{ identities: IdentitySummary[]; setupDone: boolean }>;
    create(name: string, email: string): Promise<IdentitySummary>;
    importP12(bytes: Uint8Array, password: string, name: string): Promise<IdentitySummary>;
    findMumble(): Promise<{ name: string } | null>;
    importMumble(name: string): Promise<IdentitySummary>;
    // Where the backup was saved, or null when cancelled
    exportP12(id: string, password: string): Promise<string | null>;
    setDefault(id: string): Promise<void>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    finishSetup(): Promise<void>;
  };
}

// The desktop app's preload API
interface NativeApi extends PlatformApi {
  updateTray(state: { icon: string; tooltip: string; connected: boolean; server: string; muted: boolean; deafened: boolean; mode: string }): void;
  onTrayAction(fn: (action: string) => void): void;
  linkPreview(url: string): Promise<LinkPreviewData | null>;
  publicServers(url: string): Promise<PublicServer[]>;
  pingServer(host: string, port: number): Promise<PingResult | null>;
  onContextMenu(fn: (params: ContextParams) => void): void;
  editAction(action: string, arg?: unknown): void;
  // Screens and windows that can be shared; pick one before calling getDisplayMedia
  // chosen: the system's own picker already asked (Wayland), so `sources` is the one answer
  // Thumbnails are slower to get and can fail; ask for the names first
  screenSources(thumbnails: boolean): Promise<{ sources: ScreenSource[]; chosen: boolean }>;
  pickScreenSource(id: string): void;
  // portal: the system shows its own source picker (Wayland). audio: how other programs' sound can be captured.
  shareInfo(): Promise<{ portal: boolean; audio: 'pipewire' | 'loopback' | 'none'; micLabel: string }>;
  shareAudioApps(): Promise<string[]>;
  // Linux: route one program, or everything but this app, into a virtual microphone named micLabel
  shareAudioStart(target: { kind: 'all' } | { kind: 'app'; name: string }): Promise<void>;
  shareAudioStop(): Promise<void>;
  open(connId: string, host: string, port: number, identityId?: string): Promise<void>;
  send(connId: string, bytes: Uint8Array): void;
  close(connId: string): void;
  on(event: 'secure' | 'data' | 'close' | 'udpVoice' | 'udpState' | 'udpResync', fn: (connId: string, ...args: any[]) => void): () => void;
  udpSetup(connId: string, key: Uint8Array, cn: Uint8Array, sn: Uint8Array, protobuf: boolean): void;
  udpNonce(connId: string, sn: Uint8Array): void;
  udpSend(connId: string, bytes: Uint8Array): void;
  udpClientNonce(connId: string): Promise<Uint8Array | null>;
}

// What Electron reports for a right-click without a custom menu
export interface ContextParams {
  x: number;
  y: number;
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  mediaType: string;
  srcURL: string;
  misspelledWord: string;
  suggestions: string[];
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export interface ScreenSource { id: string; name: string; thumbnail: string }
export interface PublicServer { name: string; host: string; port: number; url: string; country: string; countryCode: string; continent: string; ca: boolean }
export interface PingResult { ping: number; users: number; maxUsers: number; bandwidth: number; version: string }

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

// Desktop-only features (tray, UDP voice, public list, direct link previews) check `desktop`
export const desktop: NativeApi | null = typeof window !== 'undefined' ? window.mumh5Native ?? null : null;
// The browser build (vite --mode web) talks to the web proxy instead
export const isWeb = !desktop && import.meta.env?.MODE === 'web';
export const native: PlatformApi | null = desktop ?? (isWeb ? webApi : null);

// A connection to a Mumble server: TLS in the desktop app, the proxy's WebSocket in the browser
export async function openTransport(host: string, port: number, identityId?: string): Promise<(Transport & { secure: Promise<ServerCertInfo> }) | null> {
  if (desktop) return new ElectronTransport(desktop, host, port, identityId);
  if (isWeb) return openWebTransport(host, port, identityId);
  return null;
}

// Transport backed by a TLS socket in the Electron main process.
// `secure` resolves once the TLS handshake is done, before any Mumble data is sent,
// so the caller can check the server certificate before sending a password.
export class ElectronTransport implements Transport {
  onData: ((chunk: Uint8Array) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  readonly secure: Promise<ServerCertInfo>;
  udp: UdpChannel;
  private id = crypto.randomUUID();
  private offs: (() => void)[] = [];
  private api: NativeApi;

  constructor(api: NativeApi, host: string, port: number, identityId?: string) {
    this.api = api;
    let resolveSecure!: (i: ServerCertInfo) => void;
    let rejectSecure!: (e: Error) => void;
    this.secure = new Promise((res, rej) => { resolveSecure = res; rejectSecure = rej; });
    const id = this.id;
    // UDP voice lives in the main process; this bridges it to the client's UdpChannel
    const udp: UdpChannel = {
      onVoice: null, onState: null, onResync: null,
      setup: (k, c, s, p) => api.udpSetup(id, k, c, s, p),
      setServerNonce: n => api.udpNonce(id, n),
      clientNonce: () => api.udpClientNonce(id),
      send: p => api.udpSend(id, p)
    };
    this.udp = udp;
    this.offs.push(
      api.on('udpVoice', (cid, p) => { if (cid === id) udp.onVoice?.(p); }),
      api.on('udpState', (cid, ok, rtt) => { if (cid === id) udp.onState?.(ok, rtt); }),
      api.on('udpResync', cid => { if (cid === id) udp.onResync?.(); }),
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
