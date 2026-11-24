import tls from 'node:tls';
import net from 'node:net';
import { describeCert, type CertDetails } from './certs.ts';

export interface TlsHandlers {
  onSecure(info: { fingerprint: string; authorized: boolean; authError: string | null; chain: CertDetails[]; address: string; port: number }): void;
  onData(chunk: Uint8Array): void;
  onClose(reason: string): void;
}

// Opens a TLS connection to a Mumble server. Most servers use self-signed certificates,
// so verification is left to the caller (trust on first use via the sha256 fingerprint).
export interface TlsOptions {
  // Custom DNS resolution (the web proxy uses it to refuse private addresses)
  lookup?: net.LookupFunction;
  // Announce this client address with a PROXY protocol v1 line before TLS starts, for a
  // receiver such as go-mmproxy that passes it on to a server without PROXY support
  proxyClient?: string;
}

// PROXY protocol v1 line. Source and destination must be the same family; an IPv4 client is
// written as a mapped address towards an IPv6 destination, anything else is announced as unknown.
export function proxyLine(client: string, clientPort: number, dest: string, destPort: number): string {
  const d = dest.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  const c = client.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  if (net.isIPv4(c) && net.isIPv4(d)) return `PROXY TCP4 ${c} ${d} ${clientPort} ${destPort}\r\n`;
  if (net.isIPv6(d) && net.isIP(c)) return `PROXY TCP6 ${net.isIPv4(c) ? `::ffff:${c}` : c} ${d} ${clientPort} ${destPort}\r\n`;
  return 'PROXY UNKNOWN\r\n';
}

export function openTls(host: string, port: number, cert: string, key: string, h: TlsHandlers, opts: TlsOptions = {}) {
  let closeReason = 'Connection closed';
  const servername = /^[\d.:]+$/.test(host) ? undefined : host;
  let socket: tls.TLSSocket;
  if (opts.proxyClient) {
    // The PROXY line goes first, in the clear; TLS then runs over the same connection
    const raw = net.connect({ host, port, lookup: opts.lookup });
    raw.once('connect', () => raw.write(proxyLine(opts.proxyClient!, raw.localPort ?? 0, raw.remoteAddress ?? '', raw.remotePort ?? port)));
    raw.on('error', (e: Error) => { closeReason = e.message; socket.destroy(); });
    socket = tls.connect({ socket: raw, cert, key, rejectUnauthorized: false, servername });
  } else {
    socket = tls.connect({ host, port, cert, key, lookup: opts.lookup, rejectUnauthorized: false, servername });
  }
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
      // The server's actual IP, so UDP voice goes to the same machine as the TCP connection
      address: socket.remoteAddress ?? host,
      port: socket.remotePort ?? port,
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
