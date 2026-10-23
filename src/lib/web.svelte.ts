// The browser build: what the desktop app does in its main process goes through the mumh5 web
// proxy instead (server/proxy.ts). Identities are kept in this browser and sent to the proxy
// when connecting, because the proxy presents the certificate to the Mumble server.
import type { CertDetails } from '../core/transport.ts';
import { WebSocketTransport } from '../core/ws-transport.ts';
import type { IdentitySummary, PingResult, PlatformApi } from './native.ts';

interface StoredIdentity {
  id: string;
  name: string;
  certPem: string;
  keyPem: string;
  fingerprint: string;
  cert: CertDetails;
  createdAt: string;
}
interface StoreData { identities: StoredIdentity[]; defaultId: string | null; setupDone: boolean }

const KEY = 'mumh5.identities';

// The proxy normally serves the page; VITE_PROXY_URL points a separately hosted page at it
const base = (() => {
  const fixed = import.meta.env?.VITE_PROXY_URL as string | undefined;
  if (fixed) return fixed.replace(/\/*$/, '/');
  return typeof location !== 'undefined' ? new URL('.', location.href).href : '';
})();

async function call<T>(route: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}api/${route}`, body === undefined ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the proxy.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The proxy answered ${res.status}.`);
  return data as T;
}

const toBase64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

function read(): StoreData {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (d && Array.isArray(d.identities)) return d;
  } catch { /* storage unavailable or damaged */ }
  return { identities: [], defaultId: null, setupDone: false };
}

function write(d: StoreData): void {
  // Unlike settings, losing this silently would lose the user's registrations
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { throw new Error('This browser does not allow storing the identity (private window or storage disabled).'); }
}

const summary = (d: StoreData, i: StoredIdentity): IdentitySummary =>
  ({ id: i.id, name: i.name, fingerprint: i.fingerprint, isDefault: i.id === d.defaultId, cert: i.cert });

type Fresh = { certPem: string; keyPem: string; fingerprint: string; cert: CertDetails; commonName: string };

function add(fresh: Fresh, name: string): IdentitySummary {
  const d = read();
  const existing = d.identities.find(i => i.fingerprint === fresh.fingerprint);
  if (existing) throw new Error(`This certificate is already stored as "${existing.name}".`);
  const stored: StoredIdentity = {
    id: crypto.randomUUID(), name: name.trim() || fresh.commonName || 'Identity', certPem: fresh.certPem, keyPem: fresh.keyPem,
    fingerprint: fresh.fingerprint, cert: fresh.cert, createdAt: new Date().toISOString()
  };
  d.identities.push(stored);
  d.defaultId ??= stored.id;
  write(d);
  return summary(d, stored);
}

// The identity to connect with: the requested one, else the default, else a new one
async function identityFor(id?: string): Promise<StoredIdentity> {
  let d = read();
  if (!d.identities.length) {
    add(await call<Fresh>('identity/create', { name: 'mumh5 user', email: '' }), 'My identity');
    d = read();
  }
  return d.identities.find(i => i.id === id) ?? d.identities.find(i => i.id === d.defaultId) ?? d.identities[0];
}

function browserVersion(): string {
  const m = /(Firefox|Edg|Chrome|Version)\/(\d+)/.exec(navigator.userAgent);
  if (!m) return '';
  return `${m[1] === 'Edg' ? 'Edge' : m[1] === 'Version' ? 'Safari' : m[1]} ${m[2]}`;
}

export const webApi: PlatformApi = {
  platformInfo: async () => ({ os: 'Web', osVersion: browserVersion() }),
  describeCerts: ders => call<CertDetails[]>('certs/describe', { ders: ders.map(toBase64) }),
  pingServer: (host, port) => call<PingResult | null>('ping', { host, port }).catch(() => null),
  identities: {
    list: async () => { const d = read(); return { identities: d.identities.map(i => summary(d, i)), setupDone: d.setupDone }; },
    create: async (name, email) => add(await call<Fresh>('identity/create', { name, email }), name),
    importP12: async (bytes, password, name) => add(await call<Fresh>('identity/import', { p12: toBase64(bytes), password }), name),
    // The desktop client's settings are out of a browser's reach
    findMumble: async () => null,
    importMumble: async () => { throw new Error('Not available in the browser. Export the certificate from Mumble and import the file.'); },
    // Returns the file name; the browser decides where downloads go
    exportP12: async (id, password) => {
      const i = read().identities.find(x => x.id === id);
      if (!i) throw new Error('Identity not found.');
      const { p12 } = await call<{ p12: string }>('identity/export', { certPem: i.certPem, keyPem: i.keyPem, password, name: i.name });
      const file = `${i.name.replace(/[^\w.-]+/g, '_') || 'identity'}.p12`;
      const url = URL.createObjectURL(new Blob([fromBase64(p12)], { type: 'application/x-pkcs12' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return `your downloads as ${file}`;
    },
    setDefault: async id => { const d = read(); if (d.identities.some(i => i.id === id)) d.defaultId = id; write(d); },
    rename: async (id, name) => { const d = read(); const i = d.identities.find(x => x.id === id); if (i && name.trim()) i.name = name.trim(); write(d); },
    remove: async id => {
      const d = read();
      d.identities = d.identities.filter(i => i.id !== id);
      if (d.defaultId === id) d.defaultId = d.identities[0]?.id ?? null;
      write(d);
    },
    finishSetup: async () => { const d = read(); d.setupDone = true; write(d); }
  }
};

export async function openWebTransport(host: string, port: number, identityId?: string): Promise<WebSocketTransport> {
  const identity = await identityFor(identityId);
  return new WebSocketTransport(`${base.replace(/^http/, 'ws')}api/connect`, { host, port }, identity);
}

// Which servers the proxy connects to; the connect dialog offers these
export interface ProxyServer { host: string; port: number; label: string }
class ProxyInfo {
  servers = $state<ProxyServer[]>([]);
  any = $state(false);
  // UDP port of the proxy's STUN responder, if it runs one
  stun = $state<number | null>(null);
  loaded = $state(false);
  error = $state('');

  async load(): Promise<void> {
    try {
      const c = await call<{ servers: ProxyServer[]; any: boolean; stun?: number | null; turn?: boolean }>('config');
      this.servers = c.servers;
      this.any = c.any;
      this.stun = c.stun ?? null;
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.loaded = true;
  }
}
export const proxyInfo = new ProxyInfo();

// STUN and the relay of a mumh5 proxy, for screen sharing. The browser build uses the proxy it
// is served from, a host the user already uses; the desktop app one the user entered. The relay
// needs credentials, which the proxy hands out for a few hours at a time.
const relays = new Map<string, { servers: RTCIceServer[]; until: number }>();
export async function relayIce(address: string): Promise<RTCIceServer[]> {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`); } catch { return []; }
  const root = url.href.replace(/\/*$/, '/');
  const known = relays.get(root);
  if (known && known.until > Date.now()) return known.servers;
  try {
    const res = await fetch(`${root}api/relay`);
    if (!res.ok) return [];
    const c = await res.json() as { port: number; username?: string; credential?: string; ttl?: number; urls?: string[] };
    const servers: RTCIceServer[] = [{ urls: `stun:${url.hostname}:${c.port}` }];
    // UDP where it is allowed, TCP for networks and browsers that forbid it
    // The operator may name other ways in, such as a TLS front on port 443 for networks that allow nothing else
    const direct = [`turn:${url.hostname}:${c.port}?transport=udp`, `turn:${url.hostname}:${c.port}?transport=tcp`];
    if (c.username) servers.push({ urls: [...direct, ...(c.urls ?? [])], username: c.username, credential: c.credential });
    relays.set(root, { servers, until: Date.now() + Math.max(60, (c.ttl ?? 3600) - 3000) * 1000 });
    return servers;
  } catch {
    return [];
  }
}
export const proxyIce = (): Promise<RTCIceServer[]> => base ? relayIce(base) : Promise.resolve([]);
