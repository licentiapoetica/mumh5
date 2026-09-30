import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { randomBytes } from 'node:crypto';

// Mumble's public server list and the classic UDP ping, as used by the desktop client.

export interface PublicServer {
  name: string;
  host: string;
  port: number;
  url: string;
  country: string;
  countryCode: string;
  continent: string;
  ca: boolean;
}

export interface PingResult {
  ping: number;      // round trip in ms
  users: number;
  maxUsers: number;
  bandwidth: number;
  version: string;
}

const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Website field: often a bare host like "www.example.com"; only http(s) links are kept
function webUrl(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\/[^\s]+$/i.test(v)) return v;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(v)) return `http://${v}`;
  return '';
}

export function parsePublicList(xml: string): PublicServer[] {
  const out: PublicServer[] = [];
  // Quoted values may contain '>' (e.g. name="<C>"), so step over quoted strings
  for (const [, attrs] of xml.matchAll(/<server\s+((?:[^>"]|"[^"]*")*?)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const m of attrs.matchAll(/([a-z_]+)="([^"]*)"/g)) a[m[1]] = decode(m[2]);
    const port = Number(a.port) || 64738;
    if (!a.ip || !a.name) continue;
    out.push({
      name: a.name, host: a.ip, port, url: webUrl(a.url ?? ''),
      country: a.country || 'Unknown', countryCode: (a.country_code ?? '').toLowerCase(),
      continent: (a.continent_code ?? '').toLowerCase(), ca: a.ca === '1'
    });
  }
  return out;
}

// Mumble's list sits behind a CDN that refuses non-browser TLS clients (Node, curl: HTTP 501),
// so the app passes Electron's net.fetch, which uses Chromium's network stack
export async function fetchPublicListWith(fetcher: (url: string) => Promise<Response>, url: string): Promise<PublicServer[]> {
  let res: Response;
  try { res = await fetcher(url); } catch (e) { throw new Error(`Could not reach the list server (${(e as Error).message})`); }
  if (!res.ok) throw new Error(`The list server answered with HTTP ${res.status}`);
  return parsePublicList(await res.text());
}

// Legacy extended ping: 4 zero bytes + 8-byte cookie; answer is 24 bytes:
// version (legacy format), cookie, users, max users, bandwidth (big endian)
export async function pingServer(host: string, port: number, timeoutMs = 2000): Promise<PingResult | null> {
  let address: string, family: number;
  try { ({ address, family } = await dns.lookup(host)); } catch { return null; }
  return new Promise(resolve => {
    const sock = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
    const cookie = randomBytes(8);
    const packet = Buffer.concat([Buffer.alloc(4), cookie]);
    let done = false;
    const finish = (r: PingResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* closed */ }
      resolve(r);
    };
    const start = process.hrtime.bigint();
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('message', msg => {
      if (msg.length !== 24 || !msg.subarray(4, 12).equals(cookie)) return;
      const v = msg.readUInt32BE(0);
      finish({
        ping: Number(process.hrtime.bigint() - start) / 1e6,
        users: msg.readUInt32BE(12),
        maxUsers: msg.readUInt32BE(16),
        bandwidth: msg.readUInt32BE(20),
        version: `${v >> 16}.${(v >> 8) & 255}.${v & 255}`
      });
    });
    sock.on('error', () => finish(null));
    sock.send(packet, port, address, err => { if (err) finish(null); });
  });
}
