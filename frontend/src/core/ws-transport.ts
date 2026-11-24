import { debugLog } from './debug-log.ts';
import { HeldData, type Transport, type ServerCertInfo } from './transport.ts';

// Transport through the mumh5 web proxy: one WebSocket per Mumble connection. The proxy opens
// the TLS socket and presents the client certificate, since a browser can do neither.
// `secure` resolves once the proxy has finished the TLS handshake, before any Mumble data is
// sent, so the caller can check the server certificate before sending a password.
// There is no UDP here; voice goes through the TCP tunnel.
export class WebSocketTransport implements Transport {
  onClose: ((reason: string) => void) | null = null;
  readonly secure: Promise<ServerCertInfo>;
  private ws: WebSocket;
  private incoming = new HeldData();

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
      }
    };
    ws.onerror = () => debugLog.record('error', 'websocket', 'Gateway WebSocket error', { host: target.host, port: target.port, online: navigator.onLine });
    ws.onclose = e => {
      reason ||= e.reason || (opened ? `WebSocket closed (code ${e.code}${e.wasClean ? '' : ', unclean'})` : `Could not reach the gateway (code ${e.code})`);
      debugLog.record(e.wasClean ? 'info' : 'warn', 'websocket', 'Gateway WebSocket closed', { host: target.host, port: target.port, code: e.code, clean: e.wasClean, reason });
      rejectSecure(new Error(reason));
      this.onClose?.(reason);
    };
  }

  send(bytes: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes as Uint8Array<ArrayBuffer>);
  }

  close(): void {
    this.ws.close();
  }
}
