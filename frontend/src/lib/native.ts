import type { LocalTurn, RelayEndpoint } from '../core/mumpeer-signal.ts';
import { HeldData, type Transport, type ServerCertInfo, type CertDetails, type UdpChannel, type RelayTransport } from '../core/transport.ts';
import type { LoadedSoundSettings, SoundSettings } from '../core/sound-events.ts';
import { webApi, openWebTransport, proxyInfo } from './web.svelte.ts';
import { WebSocketTransport } from '../core/ws-transport.ts';

// What both the desktop app and the browser build (through the web proxy) provide
export interface PlatformApi {
  platformInfo(): Promise<{ os: string; osVersion: string }>;
  describeCerts(ders: Uint8Array[]): Promise<CertDetails[]>;
  // People on a server without connecting (UDP ping; in the browser the proxy sends it, for its own servers)
  pingServer(host: string, port: number): Promise<PingResult | null>;
  identities: {
    // damaged: profile files the desktop app could not read and set aside (only while no identity exists)
    list(): Promise<{ identities: IdentitySummary[]; setupDone: boolean; damaged?: string[]; directory?: string }>;
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

// The desktop app's native API
export interface NativeApi extends PlatformApi {
  relaySupported: boolean;
  testServer?: string | null;
  // Saved servers and the like, in a file in the profile (used by storage.ts)
  savedState: {
    sync(key: string, local: string | null, merge: boolean): string | null;
    write(key: string, raw: string): boolean;
  };
  sounds: {
    load(): Promise<LoadedSoundSettings | null>;
    save(settings: SoundSettings): Promise<void>;
    read(key: string): Promise<Uint8Array | null>;
    write(key: string, bytes: Uint8Array): Promise<void>;
    remove(key: string): Promise<void>;
  };
  updateTray(state: { icon: string; alertIcon: string; tooltip: string; connected: boolean; server: string; muted: boolean; deafened: boolean; mode: string }): void;
  onTrayAction(fn: (action: string) => void): void;
  // Flash the taskbar entry and blink the tray icon until the window is focused
  attention(): void;
  // Restore and focus the window (a click on a system notification)
  showWindow(): void;
  // Whether the window is on screen (not minimized or in the tray), now and on every change
  onWindowShown(fn: (shown: boolean) => void): () => void;
  linkPreview(url: string): Promise<LinkPreviewData | null>;
  publicServers(url: string): Promise<PublicServer[]>;
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
  // Whether mumh5 offers its own pipette: the desktop's color picker, where Chromium's cannot read the screen (Wayland)
  canPickColor(): Promise<boolean>;
  // '#rrggbb', or null when cancelled; rejects when the desktop has no color picker portal
  pickColor(): Promise<string | null>;
  // Linux: route one program, or everything but this app, into a virtual microphone named micLabel
  shareAudioStart(target: { kind: 'all' } | { kind: 'app'; name: string }): Promise<void>;
  shareAudioStop(): Promise<void>;
  // Named audio outputs where the WebView lists none (Linux WebKitGTK): null when the sound server
  // cannot be asked. setAudioOutput moves this app's playback there ('default' for the system's).
  audioOutputs?(): Promise<{ id: string; label: string }[] | null>;
  // System-wide hotkeys through the desktop portal: the triggers the desktop settled on per id
  hotkeysBind?(shortcuts: { id: string; description: string; trigger: string | null }[]): Promise<{ id: string; trigger: string }[]>;
  hotkeysUnbind?(): Promise<void>;
  // Page zoom of every window of the desktop app (1 = 100 %)
  setZoom?(factor: number): Promise<number>;
  onHotkey?(fn: (id: string, pressed: boolean) => void): () => void;
  setAudioOutput?(id: string): Promise<void>;
  open(connId: string, host: string, port: number, identityId?: string): Promise<void>;
  send(connId: string, bytes: Uint8Array): void;
  close(connId: string): void;
  relayOpen(connId: string, rid: string, endpoint: RelayEndpoint, token: string, lowSide: boolean): Promise<void>;
  relayTurn(connId: string, rid: string, lane: number): Promise<LocalTurn>;
  relayCloseLane(connId: string, rid: string, lane: number): void;
  relayClose(connId: string, rid: string): void;
  on(event: 'relayClose' | 'secure' | 'data' | 'close' | 'udpVoice' | 'udpState' | 'udpResync', fn: (connId: string, ...args: any[]) => void): () => void;
  udpSetup(connId: string, key: Uint8Array, cn: Uint8Array, sn: Uint8Array, protobuf: boolean): void;
  udpNonce(connId: string, sn: Uint8Array): void;
  udpSend(connId: string, bytes: Uint8Array): void;
  udpClientNonce(connId: string): Promise<Uint8Array | null>;
}

// What Tauri reports for a right-click without a custom menu
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
// The browser build talks to the Rust WebSocket gateway
export const isWeb = !desktop;
export const native: PlatformApi | null = desktop ?? (isWeb ? webApi : null);

// The transport mumpeer can use: the desktop app's own, or the proxy's when it offers it
export function relayTransport(transport: unknown): RelayTransport | null {
  if (transport instanceof TauriTransport) return transport;
  return transport instanceof WebSocketTransport && transport.relayAvailable ? transport : null;
}

// Whether this build can use mumpeer at all: the desktop app, or a browser whose proxy keeps the links
export const mumpeerSupported = (): boolean => !!desktop || (isWeb && proxyInfo.mumpeer);

// A connection to a Mumble server: TLS in the desktop app, the proxy's WebSocket in the browser
export async function openTransport(host: string, port: number, identityId?: string): Promise<(Transport & { secure: Promise<ServerCertInfo> }) | null> {
  if (desktop) return new TauriTransport(desktop, host, port, identityId);
  if (isWeb) return openWebTransport(host, port, identityId);
  return null;
}

// Transport backed by a TLS socket in the Tauri main process.
// `secure` resolves once the TLS handshake is done, before any Mumble data is sent,
// so the caller can check the server certificate before sending a password.
export class TauriTransport implements Transport, RelayTransport {
  onClose: ((reason: string) => void) | null = null;
  readonly secure: Promise<ServerCertInfo>;
  udp: UdpChannel;
  private id = crypto.randomUUID();
  private offs: (() => void)[] = [];
  private api: NativeApi;
  private incoming = new HeldData();

  get onData(): ((chunk: Uint8Array) => void) | null { return this.incoming.handler; }
  set onData(fn: ((chunk: Uint8Array) => void) | null) { this.incoming.handler = fn; }

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
      api.on('data', (cid, chunk) => { if (cid === id) this.incoming.push(chunk); }),
      api.on('close', (cid, reason) => {
        if (cid !== id) return;
        this.offs.forEach(off => off());
        rejectSecure(new Error(reason));
        this.onClose?.(reason);
      })
    );
    api.open(id, host, port, identityId).catch(e => rejectSecure(e));
  }

  relayOpen(rid: string, endpoint: RelayEndpoint, token: string, lowSide: boolean): Promise<void> {
    return this.api.relayOpen(this.id, rid, endpoint, token, lowSide);
  }

  relayTurn(rid: string, lane: number): Promise<LocalTurn> { return this.api.relayTurn(this.id, rid, lane); }
  relayCloseLane(rid: string, lane: number): void { this.api.relayCloseLane(this.id, rid, lane); }
  relayClose(rid: string): void { this.api.relayClose(this.id, rid); }

  onRelayClose(fn: (rid: string, reason: string) => void): () => void {
    return this.api.on('relayClose', (id, rid, reason) => { if (id === this.id) fn(rid, reason); });
  }

  send(bytes: Uint8Array): void { this.api.send(this.id, bytes); }
  close(): void { this.api.close(this.id); }
}
