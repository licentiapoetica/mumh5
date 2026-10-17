import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

// Link preview fetched from this computer (reveals the user's IP to the linked site). Public
// addresses only, redirects re-checked, size and time limits.

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  site: string;
  image: string;
  large: boolean;
  color: string;
}

const TIMEOUT_MS = 6000;
const MAX_HTML = 768 * 1024;
const MAX_REDIRECTS = 4;
const cache = new Map<string, { value: LinkPreview | null; expires: number }>();

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateV4(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const ok = addresses.filter(a => !isPrivateAddress(a.address));
    if (!ok.length) return (callback as any)(new Error('Refusing private address'));
    if ((options as dns.LookupOptions)?.all) return (callback as any)(null, ok);
    (callback as any)(null, ok[0].address, ok[0].family);
  });
};

function safeGet(rawUrl: string, hops = 0): Promise<http.IncomingMessage & { finalUrl: string }> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try { url = new URL(rawUrl); } catch { return reject(new Error('Invalid URL')); }
    if (!/^https?:$/.test(url.protocol)) return reject(new Error('Unsupported protocol'));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateAddress(host)) return reject(new Error('Refusing private address'));
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; mumh5-linkpreview/1.0)', 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' }
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) return reject(new Error('Too many redirects'));
        return resolve(safeGet(new URL(res.headers.location, url).href, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      resolve(Object.assign(res, { finalUrl: url.href }));
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

function readHead(res: http.IncomingMessage): Promise<Buffer> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => res.destroy(), TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(Buffer.concat(chunks).subarray(0, MAX_HTML)); };
    res.on('data', (c: Buffer) => {
      chunks.push(c);
      size += c.length;
      if (size > MAX_HTML || c.toString('latin1').toLowerCase().includes('</head>')) res.destroy();
    });
    res.on('end', done);
    res.on('close', done);
    res.on('error', done);
  });
}

const decodeEntities = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const clean = (s: string | undefined, max: number) => {
  if (!s) return '';
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

export function parsePreview(html: string, pageUrl: string): Omit<LinkPreview, 'url'> {
  const head = html.split(/<\/head>/i)[0];
  const meta: Record<string, string> = {};
  for (const [, attrs] of head.matchAll(/<meta\s+([^>]+?)\/?>/gi)) {
    const a: Record<string, string> = {};
    for (const m of attrs.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const abs = (u: string) => { try { const x = new URL(decodeEntities(u), pageUrl); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
  return {
    title: clean(meta['og:title'] || meta['twitter:title'] || titleTag, 200),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta['description'], 400),
    site: clean(meta['og:site_name'] || new URL(pageUrl).hostname.replace(/^www\./, ''), 80),
    image: abs(meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || ''),
    large: meta['twitter:card'] === 'summary_large_image' || Number(meta['og:image:width']) >= 600,
    color: /^#[0-9a-f]{3,8}$/i.test(meta['theme-color'] ?? '') ? meta['theme-color'] : ''
  };
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value: LinkPreview | null = null;
  try {
    const res = await safeGet(url);
    const type = String(res.headers['content-type'] ?? '');
    if (/text\/html|application\/xhtml/i.test(type)) {
      const charset = /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase() || 'utf-8';
      const body = await readHead(res);
      let html: string;
      try { html = new TextDecoder(charset).decode(body); } catch { html = body.toString('utf8'); }
      const p = parsePreview(html, res.finalUrl);
      if (p.title || p.description) value = { ...p, url: res.finalUrl };
    } else {
      res.resume();
    }
  } catch { /* no preview */ }
  cache.set(url, { value, expires: Date.now() + (value ? 6 * 3600e3 : 30 * 60e3) });
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return value;
}
