import tls from 'node:tls';
import { describeCert, type CertDetails } from './certs.ts';

export interface TlsHandlers {
  onSecure(info: { fingerprint: string; authorized: boolean; authError: string | null; chain: CertDetails[] }): void;
  onData(chunk: Uint8Array): void;
  onClose(reason: string): void;
}

// Opens a TLS connection to a Mumble server. Most servers use self-signed certificates,
// so verification is left to the caller (trust on first use via the sha256 fingerprint).
export function openTls(host: string, port: number, cert: string, key: string, h: TlsHandlers) {
  let closeReason = 'Connection closed';
  const socket = tls.connect({
    host, port, cert, key,
    rejectUnauthorized: false,
    servername: /^[\d.:]+$/.test(host) ? undefined : host
  });
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);
  socket.setTimeout(20000, () => {
    closeReason = 'Connection timed out';
    socket.destroy();
  });
  socket.on('secureConnect', () => {
    socket.setTimeout(0);
    // Leaf first, then the issuers the server sent (the root links to itself)
    const chain: CertDetails[] = [];
    let cur = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate | undefined;
    const seen = new Set<string>();
    while (cur?.raw && !seen.has(cur.fingerprint256) && chain.length < 8) {
      seen.add(cur.fingerprint256);
      chain.push(describeCert(cur.raw));
      cur = cur.issuerCertificate;
    }
    h.onSecure({
      chain,
      fingerprint: chain[0]?.fingerprint256 ?? '',
      authorized: socket.authorized,
      authError: socket.authorizationError ? String(socket.authorizationError) : null
    });
  });
  socket.on('data', (chunk: Buffer) => h.onData(new Uint8Array(chunk)));
  socket.on('error', (e: Error) => { closeReason = e.message; });
  socket.on('close', () => h.onClose(closeReason));
  return {
    send(bytes: Uint8Array) { if (!socket.destroyed) socket.write(bytes); },
    close() { closeReason = 'Disconnected'; socket.destroy(); }
  };
}
