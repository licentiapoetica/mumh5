// Bot signaling travels over Mumble plugin data. Only the TLS link carries media.
export const MUMCORD_HELLO = 'mumcord.hello';
export const MUMCORD_PEER = 'mumcord.peer';
export const PAIR_SIGNAL = 'mumh5.mumpeer';
export const PEER_HELLO = new TextEncoder().encode(JSON.stringify({ app: 'mumcord', v: 1, features: ['p2p'], ask: false }));

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

function isSession(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

export interface RelayEndpoint { host: string; tcp: number; fp: string }

const DNS_NAME = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.?$/i;

function ipv6Host(host: string): string | null {
  if (!/^[a-f\d:.]+$/i.test(host)) return null;
  try { return new URL(`https://[${host}]/`).hostname; }
  catch { return null; }
}

function validHost(host: string): boolean {
  if (host.length > 253) return false;
  return host.includes(':') ? ipv6Host(host) != null : DNS_NAME.test(host);
}

// Automatic discovery compares the configured host without resolving DNS aliases.
function hostKey(value: string): string | null {
  const host = value.toLowerCase().replace(/\.$/, '');
  if (host.includes(':')) return ipv6Host(host.replace(/^\[(.*)\]$/, '$1'));
  return validHost(host) ? host : null;
}

export function sameRelayHost(server: string, relay: string): boolean {
  const host = hostKey(server);
  return host != null && host === hostKey(relay);
}

export function relayEndpoint(value: unknown): RelayEndpoint | null {
  if (!value || typeof value !== 'object') return null;
  const { host, tcp, fp } = value as Record<string, unknown>;
  if (typeof host !== 'string' || !validHost(host)) return null;
  if (typeof tcp !== 'number' || !Number.isInteger(tcp) || tcp < 1 || tcp > 65535) return null;
  if (typeof fp !== 'string' || !/^[0-9a-f]{64}$/i.test(fp)) return null;
  return { host, tcp, fp: fp.toLowerCase() };
}

export function isRelayToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export interface RelayAnnouncement extends RelayEndpoint {
  t: 'relay';
  state: 'up' | 'down';
  seq: number;
  screen: boolean;
  registeredOnly: boolean;
}

export type BotMessage = RelayAnnouncement
  | { t: 'token'; rid: string; a: number; b: number; tok: string; ttl: number }
  | { t: 'token-err'; rid: string; reason: string };

function packet(data: Uint8Array): Record<string, unknown> | null {
  if (data.length > 1000) return null;
  try {
    const msg = JSON.parse(decoder.decode(data));
    return msg && Number.isSafeInteger(msg.v) && msg.v >= 1 ? msg : null;
  } catch { return null; }
}

export function decodeBot(data: Uint8Array): BotMessage | null {
  const msg = packet(data);
  if (!msg) return null;
  if (msg.t === 'relay') {
    const endpoint = relayEndpoint(msg);
    if (!endpoint || (msg.state !== 'up' && msg.state !== 'down')) return null;
    if (typeof msg.seq !== 'number' || !Number.isSafeInteger(msg.seq) || msg.seq < 0) return null;
    if (msg.u != null && (!Array.isArray(msg.u) || msg.u.some(use => typeof use !== 'string'))) return null;
    return { ...endpoint, t: 'relay', state: msg.state, seq: msg.seq,
      screen: msg.u == null || msg.u.includes('scr'), registeredOnly: msg.reg === true };
  }
  if (!isRequestId(msg.rid)) return null;
  if (msg.t === 'token-err') {
    if (typeof msg.r !== 'string' || !/^[a-z-]{1,40}$/.test(msg.r)) return null;
    return { t: 'token-err', rid: msg.rid, reason: msg.r };
  }
  if (msg.t !== 'token' || !isSession(msg.a) || !isSession(msg.b) || msg.a === msg.b || !isRelayToken(msg.tok)) return null;
  if (typeof msg.ttl !== 'number' || !Number.isSafeInteger(msg.ttl) || msg.ttl < 1) return null;
  return { t: 'token', rid: msg.rid, a: msg.a, b: msg.b, tok: msg.tok, ttl: msg.ttl };
}

export function requestPair(peer: number, rid: string): Uint8Array {
  return encoder.encode(JSON.stringify({ v: 1, t: 'token-req', rid, peer, use: 'scr' }));
}

export type PairMessage = { t: 'need'; share: string }
  | { t: 'prepare' | 'ack'; share: string; rid: string };

export function encodePair(msg: PairMessage): Uint8Array {
  return encoder.encode(JSON.stringify({ v: 1, ...msg }));
}

export function decodePair(data: Uint8Array): PairMessage | null {
  const msg = packet(data);
  if (msg?.v !== 1 || !isRequestId(msg.share)) return null;
  if (msg.t === 'need') return { t: msg.t, share: msg.share };
  if ((msg.t === 'prepare' || msg.t === 'ack') && isRequestId(msg.rid)) return { t: msg.t, share: msg.share, rid: msg.rid };
  return null;
}

export function requestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join('');
}
