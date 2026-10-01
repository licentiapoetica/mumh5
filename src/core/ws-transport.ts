import type { Transport, ServerCertInfo } from './transport.ts';

// Transport through the mumh5 web proxy: one WebSocket per Mumble connection. The proxy opens
// the TLS socket and presents the client certificate, since a browser can do neither.
// `secure` resolves once the proxy has finished the TLS handshake, before any Mumble data is
// sent, so the caller can check the server certificate before sending a password.
// There is no UDP here; voice goes through the TCP tunnel.
export class WebSocketTransport implements Transport {
  onData: ((chunk: Uint8Array) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  readonly secure: Promise<ServerCertInfo>;
  private ws: WebSocket;

  constructor(url: string, target: { host: string; port: number }, identity: { certPem: string; keyPem: string }) {
    let resolveSecure!: (i: ServerCertInfo) => void;
    let rejectSecure!: (e: Error) => void;
    this.secure = new Promise((res, rej) => { resolveSecure = res; rejectSecure = rej; });
    // Callers that never await `secure` still get onClose
    this.secure.catch(() => {});
    let reason = '';
    let opened = false;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({ host: target.host, port: target.port, certPem: identity.certPem, keyPem: identity.keyPem }));
    };
    ws.onmessage = e => {
      if (typeof e.data !== 'string') return this.onData?.(new Uint8Array(e.data as ArrayBuffer));
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'secure') resolveSecure(msg.info);
      else if (msg.type === 'close') reason = String(msg.reason ?? '');
    };
    ws.onclose = () => {
      reason ||= opened ? 'Connection closed' : 'Could not reach the proxy';
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
