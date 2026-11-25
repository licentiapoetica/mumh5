import { debugLog } from './debug-log.ts';
import { HeldData, type Transport, type ServerCertInfo, type RelayTransport } from './transport.ts';
import type { LaneTurn, LocalTurn, RelayEndpoint } from './mumpeer-signal.ts';

// Transport through the mumh5 web proxy: one WebSocket per Mumble connection. The proxy opens
// the TLS socket and presents the client certificate, since a browser can do neither.
// `secure` resolves once the proxy has finished the TLS handshake, before any Mumble data is
// sent, so the caller can check the server certificate before sending a password.
// There is no UDP here; voice goes through the TCP tunnel.
export class WebSocketTransport implements Transport, RelayTransport {
  onClose: ((reason: string) => void) | null = null;
  readonly secure: Promise<ServerCertInfo>;
  private ws: WebSocket;
  private incoming = new HeldData();
  // Mumpeer runs in the proxy: requests go as text frames and are answered by number
  private host: string;
  private calls = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private nextCall = 1;
  private relayEnded = new Set<(rid: string, reason: string) => void>();
  // Set by the caller when the proxy says it can keep mumpeer links
  relayAvailable = false;

  get onData(): ((chunk: Uint8Array) => void) | null { return this.incoming.handler; }
  set onData(fn: ((chunk: Uint8Array) => void) | null) { this.incoming.handler = fn; }

  constructor(url: string, target: { host: string; port: number }, identity: { certPem: string; keyPem: string }) {
    let resolveSecure!: (i: ServerCertInfo) => void;
    let rejectSecure!: (e: Error) => void;
    this.secure = new Promise((res, rej) => { resolveSecure = res; rejectSecure = rej; });
    // Callers that never await `secure` still get onClose
    this.secure.catch(() => {});
    let reason = '';
    let opened = false;
    debugLog.record('info', 'websocket', 'Opening gateway connection', { host: target.host, port: target.port });
    this.host = new URL(url).hostname;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      opened = true;
      debugLog.record('info', 'websocket', 'Gateway WebSocket opened', { host: target.host, port: target.port });
      ws.send(JSON.stringify({ host: target.host, port: target.port, certPem: identity.certPem, keyPem: identity.keyPem }));
    };
    ws.onmessage = e => {
      if (typeof e.data !== 'string') return this.incoming.push(new Uint8Array(e.data as ArrayBuffer));
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'secure') resolveSecure(msg.info);
      else if (msg.type === 'close') {
        reason = String(msg.reason ?? '');
        debugLog.record('warn', 'websocket', 'Gateway closed upstream connection', { host: target.host, port: target.port, reason });
      } else if (msg.type === 'relay-ok' || msg.type === 'relay-fail') {
        const call = this.calls.get(msg.n);
        this.calls.delete(msg.n);
        if (msg.type === 'relay-ok') call?.resolve(msg.result);
        else call?.reject(new Error(String(msg.reason ?? 'Mumpeer failed')));
      } else if (msg.type === 'relay-closed') for (const fn of this.relayEnded) fn(String(msg.rid), String(msg.reason ?? ''));
    };
    ws.onerror = () => debugLog.record('error', 'websocket', 'Gateway WebSocket error', { host: target.host, port: target.port, online: navigator.onLine });
    ws.onclose = e => {
      reason ||= e.reason || (opened ? `WebSocket closed (code ${e.code}${e.wasClean ? '' : ', unclean'})` : `Could not reach the gateway (code ${e.code})`);
      debugLog.record(e.wasClean ? 'info' : 'warn', 'websocket', 'Gateway WebSocket closed', { host: target.host, port: target.port, code: e.code, clean: e.wasClean, reason });
      for (const call of this.calls.values()) call.reject(new Error(reason));
      this.calls.clear();
      rejectSecure(new Error(reason));
      this.onClose?.(reason);
    };
  }

  private call<T>(message: object): Promise<T> {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The connection is closed'));
    const n = this.nextCall++;
    return new Promise<T>((resolve, reject) => {
      this.calls.set(n, { resolve, reject });
      this.ws.send(JSON.stringify({ ...message, n }));
    });
  }

  relayOpen(rid: string, endpoint: RelayEndpoint, token: string, lowSide: boolean): Promise<void> {
    return this.call<void>({ type: 'relay-open', rid, address: endpoint, token, lowSide });
  }

  async relayTurn(rid: string, lane: number): Promise<LocalTurn> {
    const t = await this.call<LaneTurn>({ type: 'relay-turn', rid, lane });
    // The lane is a credential on the proxy's own relay, which speaks UDP and TCP on one port
    const host = this.host;
    return {
      urls: [`turn:${host}:${t.port}?transport=udp`, `turn:${host}:${t.port}?transport=tcp`, ...(t.extra ?? [])],
      username: t.username, credential: t.credential
    };
  }

  relayCloseLane(rid: string, lane: number): void {
    this.call({ type: 'relay-lane-close', rid, lane }).catch(() => {});
  }

  relayClose(rid: string): void {
    this.call({ type: 'relay-close', rid }).catch(() => {});
  }

  onRelayClose(fn: (rid: string, reason: string) => void): () => void {
    this.relayEnded.add(fn);
    return () => { this.relayEnded.delete(fn); };
  }

  send(bytes: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes as Uint8Array<ArrayBuffer>);
  }

  close(): void {
    this.ws.close();
  }
}
