// Web proxy for the browser build: serves the web app and bridges WebSocket connections to
// Mumble servers over TLS. Browsers cannot open TLS sockets or present a client certificate,
// so the proxy does both. It only connects to the servers on its allowlist.
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import { openTls } from '../electron/tls-transport.ts';
import { generateIdentity, identityFromP12, identityToP12, certCommonName } from '../electron/identity.ts';
import { describeCert } from '../electron/certs.ts';

export interface AllowedServer { host: string; port: number; label: string }

export interface ProxyConfig {
  port: number;
  bind: string;
  servers: AllowedServer[];
  // Connect anywhere on the public internet instead of only to `servers`
  allowAny: boolean;
  // With allowAny: also allow loopback and private addresses
  allowPrivate: boolean;
  // Allowed Origin headers; empty means the origin must match the Host header, '*' allows all
  origins: string[];
  // Take the client address from X-Forwarded-For (behind a reverse proxy)
  trustProxy: boolean;
  // Start every server connection with a PROXY protocol line naming the client's address.
  // Only for servers behind something that understands it (go-mmproxy); plain Mumble does not.
  sendProxy: boolean;
  staticDir: string | null;
  // UDP port of the built-in STUN responder for screen sharing between browser users; null turns it off
  stunPort: number | null;
  stunBind: string;
  maxConnections: number;
  maxPerAddress: number;
}

export const defaults: ProxyConfig = {
  port: 8080, bind: '127.0.0.1', servers: [], allowAny: false, allowPrivate: false, origins: [],
  trustProxy: false, sendProxy: false, staticDir: null, stunPort: null, stunBind: '::', maxConnections: 200, maxPerAddress: 8
};

// "host", "host:port", "[v6]:port", each optionally followed by "=Label"
export function parseServers(list: string): AllowedServer[] {
  return list.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const eq = entry.indexOf('=');
    const addr = eq === -1 ? entry : entry.slice(0, eq);
    const label = eq === -1 ? '' : entry.slice(eq + 1).trim();
    const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(addr) ?? /^([^:]+)(?::(\d+))?$/.exec(addr);
    if (!m) throw new Error(`Invalid server "${entry}"`);
    const host = m[1].trim().toLowerCase();
    return { host, port: Number(m[2] ?? 64738), label: label || host };
  });
}

export function configFromEnv(env: NodeJS.ProcessEnv): ProxyConfig {
  const on = (v?: string) => v === '1' || v === 'true';
  return {
    ...defaults,
    port: Number(env.MUMH5_PORT ?? defaults.port),
    bind: env.MUMH5_BIND ?? defaults.bind,
    servers: parseServers(env.MUMH5_SERVERS ?? ''),
    allowAny: on(env.MUMH5_ALLOW_ANY),
    allowPrivate: on(env.MUMH5_ALLOW_PRIVATE),
    origins: (env.MUMH5_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: on(env.MUMH5_TRUST_PROXY),
    sendProxy: on(env.MUMH5_SEND_PROXY),
    staticDir: env.MUMH5_STATIC ?? null,
    stunPort: Number(env.MUMH5_STUN_PORT ?? 3478) || null,
    stunBind: env.MUMH5_STUN_BIND ?? defaults.stunBind,
    maxConnections: Number(env.MUMH5_MAX_CONNECTIONS ?? defaults.maxConnections),
    maxPerAddress: Number(env.MUMH5_MAX_PER_ADDRESS ?? defaults.maxPerAddress)
  };
}

// Loopback, private, link-local and other addresses that are not on the public internet
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

// DNS lookup that fails for private addresses, so a public name cannot point the proxy inward
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  // With `all` the result is a list of addresses, otherwise one address string
  (dns.lookup as Function)(hostname, options, (err: Error | null, result: string | dns.LookupAddress[], family?: number) => {
    if (err) return (callback as Function)(err);
    const list = Array.isArray(result) ? result : [{ address: result, family }];
    if (list.some(r => isPrivateAddress(r.address))) return (callback as Function)(new Error('This proxy does not connect to private addresses'));
    (callback as Function)(null, result, family);
  });
};

// Answer to a STUN binding request (RFC 5389): tells the sender the address its packet came
// from, which is how two browsers behind routers find a direct route for screen sharing.
// Returns null for anything that is not a binding request. The answer is about as small as
// the request, so the port is of no use for amplifying traffic.
export function stunResponse(msg: Uint8Array, address: string, port: number): Uint8Array | null {
  const COOKIE = 0x2112a442;
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  if (msg.length < 20 || view.getUint16(0) !== 0x0001 || view.getUint32(4) !== COOKIE) return null;
  if (view.getUint16(2) !== msg.length - 20) return null;
  const v4 = address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  let bytes: number[];
  if (net.isIPv4(v4)) bytes = v4.split('.').map(Number);
  else if (net.isIPv6(address)) {
    // Expand "::" and write the eight groups out as bytes
    const [head, tail = ''] = address.split('%')[0].split('::');
    const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
    const groups = address.includes('::') ? [...h, ...new Array(8 - h.length - t.length).fill('0'), ...t] : h;
    bytes = groups.flatMap(g => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
  } else return null;
  const out = new Uint8Array(20 + 8 + bytes.length);
  const o = new DataView(out.buffer);
  o.setUint16(0, 0x0101);                 // binding success
  o.setUint16(2, 8 + bytes.length);
  out.set(msg.subarray(4, 20), 4);        // cookie and transaction id
  o.setUint16(20, 0x0020);                // XOR-MAPPED-ADDRESS
  o.setUint16(22, 4 + bytes.length);
  out[25] = bytes.length === 4 ? 1 : 2;
  o.setUint16(26, port ^ (COOKIE >>> 16));
  // The address is masked with the cookie, and for IPv6 with the transaction id after it
  for (let i = 0; i < bytes.length; i++) out[28 + i] = bytes[i] ^ msg[4 + i];
  return out;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm'
};

const MAX_BODY = 256 * 1024;
// Mumble frames are at most 8 MiB; a WebSocket message carries a chunk of that stream
const MAX_WS_MESSAGE = 8 * 1024 * 1024 + 64;
const MAX_BUFFERED = 32 * 1024 * 1024;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function startProxy(config: ProxyConfig): Promise<{ port: number; stunPort: number | null; close(): Promise<void> }> {
  if (!config.allowAny && !config.servers.length) {
    throw new Error('No servers allowed. Set MUMH5_SERVERS=host[:port][=Label],... or MUMH5_ALLOW_ANY=1.');
  }
  const staticDir = config.staticDir ? path.resolve(config.staticDir) : null;
  const perAddress = new Map<string, number>();
  let stunPort: number | null = null;
  // Identity requests per address in the current minute; key generation is the costly part
  const identityUse = new Map<string, number>();
  const sweep = setInterval(() => identityUse.clear(), 60000);
  sweep.unref();

  const addressOf = (req: http.IncomingMessage): string => {
    // The last entry is the one our own reverse proxy added; earlier ones come from the client and can be made up
    const fwd = config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)!.trim() : '';
    return fwd || req.socket.remoteAddress || 'unknown';
  };

  const originOk = (req: http.IncomingMessage): boolean => {
    if (config.origins.includes('*')) return true;
    const origin = req.headers.origin;
    if (!origin) return false;
    if (config.origins.length) return config.origins.includes(origin);
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };

  const listed = (host: string, port: number): boolean => config.servers.some(s => s.host === host.toLowerCase() && s.port === port);
  const allowed = (host: string, port: number): boolean => config.allowAny || listed(host, port);

  async function readJson(req: http.IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
      chunks.push(chunk as Buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
  }

  const withCert = (id: { certPem: string; keyPem: string; fingerprint: string }) =>
    ({ ...id, cert: describeCert(id.certPem), commonName: certCommonName(id.certPem) });

  async function api(req: http.IncomingMessage, route: string): Promise<unknown> {
    if (route === 'config' && req.method === 'GET') {
      return { servers: config.servers, any: config.allowAny, stun: stunPort };
    }
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    if (!originOk(req)) throw new HttpError(403, 'Origin not allowed');
    const body = await readJson(req);
    if (route.startsWith('identity/')) {
      const addr = addressOf(req);
      const used = (identityUse.get(addr) ?? 0) + 1;
      identityUse.set(addr, used);
      if (used > 20) throw new HttpError(429, 'Too many requests, try again in a minute');
    }
    switch (route) {
      // Nothing is stored here: the browser keeps its identities and sends one along when it connects
      case 'identity/create':
        return withCert(generateIdentity(String(body.name ?? '').slice(0, 128), String(body.email ?? '').slice(0, 128)));
      case 'identity/import':
        return withCert(identityFromP12(new Uint8Array(Buffer.from(String(body.p12 ?? ''), 'base64')), String(body.password ?? '')));
      case 'identity/export': {
        const id = { certPem: String(body.certPem), keyPem: String(body.keyPem), fingerprint: '' };
        return { p12: Buffer.from(identityToP12(id, String(body.password ?? ''), String(body.name ?? 'Identity').slice(0, 128))).toString('base64') };
      }
      case 'certs/describe':
        return (Array.isArray(body.ders) ? body.ders.slice(0, 8) : []).flatMap((d: unknown) => {
          try { return [describeCert(Buffer.from(String(d), 'base64'))]; } catch { return []; }
        });
    }
    throw new HttpError(404, 'Not found');
  }

  async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    if (!staticDir || (req.method !== 'GET' && req.method !== 'HEAD')) throw new HttpError(404, 'Not found');
    let rel: string;
    try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Bad path'); }
    let file = path.join(staticDir, path.normalize('/' + rel));
    if (file !== staticDir && !file.startsWith(staticDir + path.sep)) throw new HttpError(404, 'Not found');
    let data: Buffer;
    try {
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      data = await fs.readFile(file);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    const html = file.endsWith('.html');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.length,
      // Built assets carry a content hash in their name; the page itself must stay fresh
      'Cache-Control': html ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const work = pathname.startsWith('/api/')
      ? api(req, pathname.slice(5)).then(result => {
          const data = Buffer.from(JSON.stringify(result));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(data);
        })
      : serveStatic(req, res, pathname);
    work.catch((e: Error) => {
      const status = e instanceof HttpError ? e.status : 400;
      if (res.headersSent) return res.destroy();
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: e.message }));
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    const refuse = (status: string) => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/api/connect') return refuse('404 Not Found');
    if (!originOk(req)) return refuse('403 Forbidden');
    const addr = addressOf(req);
    if (wss.clients.size >= config.maxConnections || (perAddress.get(addr) ?? 0) >= config.maxPerAddress) return refuse('503 Service Unavailable');
    wss.handleUpgrade(req, socket, head, ws => bridge(ws, addr));
  });

  // One WebSocket is one Mumble connection. The first message names the server and carries the
  // client certificate; after that binary messages are the raw Mumble TCP stream in both directions.
  function bridge(ws: WebSocket, addr: string): void {
    perAddress.set(addr, (perAddress.get(addr) ?? 0) + 1);
    const clientAddress = addr.replace(/^::ffff:/, '');
    let conn: ReturnType<typeof openTls> | null = null;
    let done = false;
    const finish = (reason: string) => {
      if (done) return;
      done = true;
      clearTimeout(hello);
      conn?.close();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'close', reason }));
        ws.close(1000);
      }
    };
    const hello = setTimeout(() => finish('No connection request received'), 10000);

    ws.on('message', (data, isBinary) => {
      if (conn) {
        if (isBinary) conn.send(data as Buffer);
        return;
      }
      if (isBinary) return finish('Expected a connection request');
      let req: any;
      try { req = JSON.parse(data.toString()); } catch { return finish('Invalid connection request'); }
      const host = String(req.host ?? '').trim();
      const port = Number(req.port) || 64738;
      if (!host || host.length > 255 || port < 1 || port > 65535 || !allowed(host, port)) {
        return finish(`This proxy does not allow connecting to ${host}:${port}`);
      }
      // Servers the operator listed are trusted as they are, also on localhost or a private network
      const guard = config.allowAny && !config.allowPrivate && !listed(host, port);
      if (guard && net.isIP(host) && isPrivateAddress(host)) return finish('This proxy does not connect to private addresses');
      clearTimeout(hello);
      conn = openTls(host, port, String(req.certPem ?? ''), String(req.keyPem ?? ''), {
        onSecure: info => {
          if (ws.readyState !== ws.OPEN) return;
          // The server's address stays here; the browser has no use for it without UDP
          ws.send(JSON.stringify({ type: 'secure', info: {
            fingerprint: info.fingerprint, authorized: info.authorized, authError: info.authError, chain: info.chain,
            // Mumble only ever sees this proxy's address; tell the browser its own so the app can show it
            clientAddress
          } }));
        },
        onData: chunk => {
          if (ws.readyState !== ws.OPEN) return;
          // A browser that stopped reading must not grow our memory without bound
          if (ws.bufferedAmount > MAX_BUFFERED) return finish('Connection too slow');
          ws.send(chunk, { binary: true });
        },
        onClose: reason => finish(reason)
      }, { lookup: guard ? publicLookup : undefined, proxyClient: config.sendProxy ? clientAddress : undefined });
    });
    ws.on('close', () => {
      done = true;
      clearTimeout(hello);
      conn?.close();
      const left = (perAddress.get(addr) ?? 1) - 1;
      if (left > 0) perAddress.set(addr, left); else perAddress.delete(addr);
    });
    ws.on('error', () => ws.terminate());
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.bind, resolve);
  });

  // STUN on UDP. Failing to open it (port taken, no permission) only costs screen sharing its helper.
  let stun: dgram.Socket | null = null;
  if (config.stunPort != null) {
    const socket = dgram.createSocket(net.isIPv4(config.stunBind) ? 'udp4' : 'udp6');
    socket.on('message', (msg, from) => {
      const answer = stunResponse(msg, from.address, from.port);
      if (answer) socket.send(answer, from.port, from.address);
    });
    await new Promise<void>(resolve => {
      socket.once('error', () => { socket.close(); resolve(); });
      socket.bind(config.stunPort!, config.stunBind, () => { socket.removeAllListeners('error'); socket.on('error', () => {}); stun = socket; stunPort = socket.address().port; resolve(); });
    });
  }

  return {
    port: (server.address() as net.AddressInfo).port,
    stunPort,
    close: () => new Promise<void>(resolve => {
      clearInterval(sweep);
      (stun as dgram.Socket | null)?.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}
