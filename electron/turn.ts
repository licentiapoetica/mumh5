// STUN and TURN (RFC 5389, RFC 5766). The desktop app uses it for its mumpeer lanes on loopback
// (mumpeer.ts). It was also the relay of the Node web proxy; the browser gateway has its own in
// crates/platform/src/turn.rs, so the public relay and lane credentials (LaneRegistry) here are
// only exercised by test/turn.test.ts.
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 0x2112a442;
const REALM = 'mumh5';

// Message types: request, with success (| 0x100) and error (| 0x110) answers
const BINDING = 0x0001, ALLOCATE = 0x0003, REFRESH = 0x0004, SEND = 0x0016, DATA = 0x0017, CREATE_PERMISSION = 0x0008, CHANNEL_BIND = 0x0009;
const A = {
  USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, CHANNEL_NUMBER: 0x000c, LIFETIME: 0x000d, XOR_PEER_ADDRESS: 0x0012,
  DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016, REQUESTED_ADDRESS_FAMILY: 0x0017, REQUESTED_TRANSPORT: 0x0019,
  XOR_MAPPED_ADDRESS: 0x0020
};

const LIFETIME = 600;          // an allocation, unless refreshed
const PERMISSION = 300;        // a peer address may send for this long after CreatePermission
const CHANNEL = 600;
const NONCE_AGE = 3600;
export const CREDENTIAL_TTL = 12 * 3600;

export interface TurnOptions {
  port: number;
  bind: string;
  // false: answer STUN binding requests only
  relay: boolean;
  // Address announced for relayed traffic; found from the connection or the network interfaces when unset
  publicIp: string | null;
  // UDP ports used for relaying, so a firewall can open exactly these
  minPort: number;
  maxPort: number;
  maxAllocations: number;
  maxPerAddress: number;
  // Peers the relay may talk to; keeps it from being used to reach private networks
  peerAllowed: (ip: string) => boolean;
  // Virtual lanes (mumpeer links the proxy keeps for browsers); without it lane credentials get nothing
  lanes?: LaneRegistry;
  // One line per relay event, for finding out why someone cannot connect
  log?: (line: string) => void;
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

const v4 = (address: string) => address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

function ipBytes(address: string): number[] | null {
  const a = v4(address);
  if (net.isIPv4(a)) return a.split('.').map(Number);
  if (!net.isIPv6(a)) return null;
  const [head, tail = ''] = a.split('%')[0].split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...new Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.flatMap(g => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
}

// Address attribute value, masked with the cookie and (for IPv6) the transaction id
export function xorAddress(address: string, port: number, header: Uint8Array): Uint8Array | null {
  const bytes = ipBytes(address);
  if (!bytes) return null;
  const out = new Uint8Array(4 + bytes.length);
  out[1] = bytes.length === 4 ? 1 : 2;
  out[2] = (port >> 8) ^ 0x21;
  out[3] = (port & 255) ^ 0x12;
  for (let i = 0; i < bytes.length; i++) out[4 + i] = bytes[i] ^ header[4 + i];
  return out;
}

export function unxorAddress(value: Uint8Array, header: Uint8Array): { ip: string; port: number } | null {
  if (value.length !== 8 && value.length !== 20) return null;
  const port = ((value[2] ^ 0x21) << 8) | (value[3] ^ 0x12);
  const raw = [...value.subarray(4)].map((b, i) => b ^ header[4 + i]);
  if (raw.length === 4) return { ip: raw.join('.'), port };
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((raw[i] << 8) | raw[i + 1]).toString(16));
  return { ip: groups.join(':'), port };
}

interface Stun { type: number; header: Uint8Array; attrs: { type: number; value: Uint8Array; offset: number }[]; raw: Uint8Array }

export function parse(msg: Uint8Array): Stun | null {
  if (msg.length < 20) return null;
  const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  if (view.getUint32(4) !== COOKIE || view.getUint16(2) !== msg.length - 20) return null;
  const attrs: Stun['attrs'] = [];
  for (let at = 20; at + 4 <= msg.length;) {
    const type = view.getUint16(at), length = view.getUint16(at + 2);
    if (at + 4 + length > msg.length) return null;
    attrs.push({ type, value: msg.subarray(at + 4, at + 4 + length), offset: at });
    at += 4 + ((length + 3) & ~3);
  }
  return { type: view.getUint16(0), header: msg.subarray(0, 20), attrs, raw: msg };
}

// Builds a message; with a key it is signed (MESSAGE-INTEGRITY), which browsers check on answers
export function build(type: number, header: Uint8Array, attrs: [number, Uint8Array][], key?: Buffer): Uint8Array {
  const body = attrs.reduce((n, [, v]) => n + 4 + ((v.length + 3) & ~3), 0);
  const out = new Uint8Array(20 + body + (key ? 24 : 0));
  const view = new DataView(out.buffer);
  view.setUint16(0, type);
  out.set(header.subarray(4, 20), 4);
  let at = 20;
  for (const [t, v] of attrs) {
    view.setUint16(at, t);
    view.setUint16(at + 2, v.length);
    out.set(v, at + 4);
    at += 4 + ((v.length + 3) & ~3);
  }
  // The length field counts the integrity attribute while it is being computed
  view.setUint16(2, out.length - 20);
  if (key) {
    view.setUint16(at, A.MESSAGE_INTEGRITY);
    view.setUint16(at + 2, 20);
    out.set(createHmac('sha1', key).update(out.subarray(0, at)).digest(), at + 4);
  }
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const errorCode = (code: number, reason: string) => Uint8Array.from([0, 0, Math.floor(code / 100), code % 100, ...text(reason)]);

// Binding answer on its own, for the STUN-only case and the tests
export function stunResponse(msg: Uint8Array, address: string, port: number): Uint8Array | null {
  const m = parse(msg);
  if (!m || m.type !== BINDING) return null;
  const mapped = xorAddress(address, port, m.header);
  return mapped && build(BINDING | 0x100, m.header, [[A.XOR_MAPPED_ADDRESS, mapped]]);
}

// The password that goes with a username, as handed out by the API and checked here
export function turnCredential(secret: string, username: string): string {
  return createHmac('sha1', secret).update(username).digest('base64');
}

export interface TurnAddress { ip: string; port: number }

// A loopback-only TURN listener can relay to one virtual address over a paired transport.
export interface VirtualTurnPeer {
  local: TurnAddress;
  remote: TurnAddress;
  send(data: Uint8Array): void;
  receive(fn: (data: Uint8Array) => void): () => void;
}

// A mumpeer lane is reached with its own credential, `<expiry>:lane-<32 hex>`. Such a username only
// ever gets its virtual address, never a normal relay, and one allocation at a time.
export const isLaneUser = (user: string): boolean => /^\d+:lane-[0-9a-f]{32}$/.test(user);

export class LaneRegistry {
  private lanes = new Map<string, { peer: VirtualTurnPeer; free: (() => void) | null }>();

  // Makes the lane available to whoever holds its credential; the returned function closes it
  register(username: string, peer: VirtualTurnPeer): () => void {
    const entry = { peer, free: null as (() => void) | null };
    this.lanes.set(username, entry);
    return () => {
      if (this.lanes.get(username) !== entry) return;
      this.lanes.delete(username);
      entry.free?.();
    };
  }

  has(username: string): boolean { return this.lanes.has(username); }
  busy(username: string): boolean { return !!this.lanes.get(username)?.free; }

  // Takes the lane for one allocation; `free` closes that allocation when the lane goes away
  claim(username: string, free: () => void): VirtualTurnPeer | null {
    const entry = this.lanes.get(username);
    if (!entry || entry.free) return null;
    entry.free = free;
    return entry.peer;
  }

  release(username: string, free: () => void): void {
    const entry = this.lanes.get(username);
    if (entry?.free === free) entry.free = null;
  }
}

interface Client { key: string; ip: string; port: number; send(bytes: Uint8Array): void; local: string | null; closed?(): boolean }
interface Allocation {
  client: Client;
  socket: dgram.Socket | null;
  closeRelay(): void;
  relayIp: string;
  permissions: Map<string, number>;
  channels: Map<number, { ip: string; port: number; expires: number }>;
  byPeer: Map<string, number>;
  expires: number;
  // Set when this allocation reaches a paired transport instead of the network
  virtual?: VirtualTurnPeer;
}

export async function startTurn(opts: TurnOptions, secret: string, virtual?: VirtualTurnPeer): Promise<{ port: number; close(): void }> {
  if (virtual && (opts.bind !== '127.0.0.1' || !opts.relay)) throw new Error('Virtual TURN requires a loopback listener');
  const allocations = new Map<string, Allocation>();
  let closed = false;
  const now = () => Math.floor(Date.now() / 1000);

  const nonce = () => { const t = String(now()); return `${t}-${createHmac('sha1', secret).update(`nonce:${t}`).digest('hex').slice(0, 24)}`; };
  const nonceValid = (n: string) => {
    const [t, mac] = n.split('-');
    return !!mac && now() - Number(t) < NONCE_AGE && mac === createHmac('sha1', secret).update(`nonce:${t}`).digest('hex').slice(0, 24);
  };

  function free(a: Allocation): void {
    if (allocations.get(a.client.key) === a) allocations.delete(a.client.key);
    try { a.closeRelay(); } catch { /* already closed */ }
  }
  const sweep = setInterval(() => { for (const a of allocations.values()) if (a.expires < now()) free(a); }, 15000);
  sweep.unref();

  // The address peers must send to. Behind a 1:1 NAT (many cloud hosts) it has to be configured.
  function relayAddress(family: 4 | 6, local: string | null): string | null {
    if (opts.publicIp && (net.isIPv4(opts.publicIp) ? 4 : 6) === family) return opts.publicIp;
    if (local && (net.isIPv4(local) ? 4 : 6) === family && !/^(0\.0\.0\.0|::)$/.test(local)) return local;
    const want = family === 4 ? 'IPv4' : 'IPv6';
    const found = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === want && !i.address.startsWith('fe80'));
    // A public address first; Docker bridges and the like come before loopback only
    return (found.find(i => !isPrivateAddress(i!.address)) ?? found.find(i => !i!.internal) ?? found[0])?.address ?? null;
  }

  async function bindRelay(family: 4 | 6): Promise<dgram.Socket | null> {
    const span = opts.maxPort - opts.minPort + 1;
    const start = Math.floor(Math.random() * span);
    for (let i = 0; i < Math.min(span, 64); i++) {
      const socket = dgram.createSocket({ type: family === 4 ? 'udp4' : 'udp6', ipv6Only: family === 6 });
      const ok = await new Promise<boolean>(resolve => {
        socket.once('error', () => resolve(false));
        socket.bind(opts.minPort + ((start + i) % span), () => resolve(true));
      });
      if (ok) { socket.removeAllListeners('error'); socket.on('error', () => {}); return socket; }
      try { socket.close(); } catch { /* never opened */ }
    }
    return null;
  }

  // Checks the credentials of a request; answers with the right error and returns null otherwise
  function authenticate(m: Stun, client: Client): { key: Buffer; user: string } | null {
    const get = (t: number) => m.attrs.find(a => a.type === t);
    const fail = (code: number, reason: string) => {
      client.send(build(m.type | 0x110, m.header, [[A.ERROR_CODE, errorCode(code, reason)], [A.REALM, text(REALM)], [A.NONCE, text(nonce())]]));
      return null;
    };
    const integrity = get(A.MESSAGE_INTEGRITY);
    // The first request always comes without credentials; that is how a client learns the realm
    if (!integrity) return fail(401, 'Unauthorized');
    opts.log?.(`relay: ${client.key} sent credentials`);
    const username = get(A.USERNAME), n = get(A.NONCE);
    if (!username || !n || integrity.value.length !== 20) return fail(400, 'Bad Request');
    if (!nonceValid(new TextDecoder().decode(n.value))) return fail(438, 'Stale Nonce');
    const user = new TextDecoder().decode(username.value);
    // The username is the time the credential runs out
    if (!(Number(user.split(':')[0]) > now())) return fail(401, 'Unauthorized');
    const key = createHash('md5').update(`${user}:${REALM}:${turnCredential(secret, user)}`).digest();
    const signed = Uint8Array.from(m.raw.subarray(0, integrity.offset));
    new DataView(signed.buffer).setUint16(2, integrity.offset + 24 - 20);
    const expected = createHmac('sha1', key).update(signed).digest();
    if (!timingSafeEqual(expected, integrity.value)) return fail(401, 'Unauthorized');
    return { key, user };
  }

  // Two clients of this relay reach each other at its announced address. Behind a 1:1 NAT that
  // address is not on this machine and the router will not turn the packet around, so such
  // traffic stays on loopback and is presented as coming from the announced address.
  const loopback = (ip: string) => ip === '127.0.0.1' || ip === '::1';
  function toPeer(a: Allocation, data: Uint8Array, ip: string, port: number): void {
    const v = a.virtual;
    if (v) {
      if (ip === v.remote.ip && port === v.remote.port) v.send(data);
    } else {
      a.socket!.send(data, port, ip === a.relayIp ? (net.isIPv4(ip) ? '127.0.0.1' : '::1') : ip);
    }
  }

  function fromPeer(a: Allocation, data: Uint8Array, peerIp: string, peerPort: number): void {
    const seen = v4(peerIp);
    const ip = loopback(seen) && !loopback(a.relayIp) ? a.relayIp : seen;
    if ((a.permissions.get(ip) ?? 0) < now()) return;
    const channel = a.byPeer.get(`${ip}:${peerPort}`);
    if (channel != null && (a.channels.get(channel)?.expires ?? 0) >= now()) {
      const out = new Uint8Array(4 + data.length);
      new DataView(out.buffer).setUint16(0, channel);
      new DataView(out.buffer).setUint16(2, data.length);
      out.set(data, 4);
      return a.client.send(out);
    }
    const header = new Uint8Array(20);
    new DataView(header.buffer).setUint32(4, COOKIE);
    header.set(randomBytes(12), 8);
    const peer = xorAddress(ip, peerPort, header);
    if (peer) a.client.send(build(DATA, header, [[A.XOR_PEER_ADDRESS, peer], [A.DATA, data]]));
  }

  async function handle(msg: Uint8Array, client: Client): Promise<void> {
    // ChannelData: channel number, length, payload
    if (msg.length >= 4 && (msg[0] & 0xc0) === 0x40) {
      const a = allocations.get(client.key);
      const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      const bound = a?.channels.get(view.getUint16(0));
      const length = view.getUint16(2);
      if (a && bound && bound.expires >= now() && 4 + length <= msg.length) toPeer(a, msg.subarray(4, 4 + length), bound.ip, bound.port);
      return;
    }
    const m = parse(msg);
    if (!m) return;
    if (m.type === BINDING) {
      const mapped = xorAddress(client.ip, client.port, m.header);
      if (mapped) client.send(build(BINDING | 0x100, m.header, [[A.XOR_MAPPED_ADDRESS, mapped]]));
      return;
    }
    if (!opts.relay) return;
    const get = (t: number) => m.attrs.find(a => a.type === t);
    const existing = allocations.get(client.key);

    if (m.type === SEND) {
      const peer = get(A.XOR_PEER_ADDRESS), data = get(A.DATA);
      const to = peer && unxorAddress(peer.value, m.header);
      if (existing && to && data && (existing.permissions.get(to.ip) ?? 0) >= now()) toPeer(existing, data.value, to.ip, to.port);
      return;
    }
    if (![ALLOCATE, REFRESH, CREATE_PERMISSION, CHANNEL_BIND].includes(m.type)) return;
    const auth = authenticate(m, client);
    if (!auth) return;
    const { key, user } = auth;
    const ok = (attrs: [number, Uint8Array][] = []) => client.send(build(m.type | 0x100, m.header, attrs, key));
    const error = (code: number, reason: string) => {
      opts.log?.(`relay: ${client.key} refused, ${code} ${reason}`);
      client.send(build(m.type | 0x110, m.header, [[A.ERROR_CODE, errorCode(code, reason)]], key));
    };

    if (m.type === ALLOCATE) {
      if (existing) return error(437, 'Allocation Mismatch');
      if (get(A.REQUESTED_TRANSPORT)?.value[0] !== 17) return error(442, 'Unsupported Transport Protocol');
      const family: 4 | 6 = get(A.REQUESTED_ADDRESS_FAMILY)?.value[0] === 2 ? 6 : 4;
      const mine = [...allocations.values()].filter(a => a.client.ip === client.ip).length;
      if (allocations.size >= opts.maxAllocations || mine >= opts.maxPerAddress) return error(486, 'Allocation Quota Reached');
      // A lane credential reaches its lane or nothing: it never falls back to a normal relay
      const lane = !virtual && isLaneUser(user);
      if (lane && !opts.lanes?.has(user)) return error(401, 'Unauthorized');
      if (lane && opts.lanes!.busy(user)) return error(437, 'Allocation Mismatch');
      const fixed = virtual;
      // Virtual addresses are IPv4; the real one (either side of the pair) is known once the lane is claimed
      const relayIp = (fixed || lane) ? (family === 4 ? '192.0.2.1' : null) : relayAddress(family, client.local);
      if (!relayIp) return error(508, 'Insufficient Capacity');
      const socket = (fixed || lane) ? null : await bindRelay(family);
      if (!fixed && !lane && !socket) return error(508, 'Insufficient Capacity');
      if (closed || client.closed?.() || allocations.has(client.key)) {
        socket?.close();
        return error(437, 'Allocation Mismatch');
      }
      let a!: Allocation;
      let v = fixed;
      let release = () => {};
      if (lane) {
        // Removing the lane frees this allocation too
        const freeThis = () => free(a);
        const claimed = opts.lanes!.claim(user, freeThis);
        if (!claimed) return error(437, 'Allocation Mismatch');
        v = claimed;
        release = () => opts.lanes!.release(user, freeThis);
      }
      const relayPort = v?.local.port ?? socket!.address().port;
      a = {
        client, socket, relayIp: v ? v.local.ip : relayIp, permissions: new Map(), channels: new Map(), byPeer: new Map(), expires: now() + LIFETIME,
        closeRelay: () => socket?.close(), virtual: v
      };
      if (v) {
        const off = v.receive(data => fromPeer(a, data, v.remote.ip, v.remote.port));
        a.closeRelay = () => { off(); release(); };
      }
      socket?.on('message', (data, from) => fromPeer(a, data, from.address, from.port));
      allocations.set(client.key, a);
      opts.log?.(`relay: ${client.key} got ${a.relayIp}:${relayPort} (${allocations.size} in use)`);
      return ok([
        [A.XOR_RELAYED_ADDRESS, xorAddress(a.relayIp, relayPort, m.header)!],
        [A.LIFETIME, u32(LIFETIME)],
        [A.XOR_MAPPED_ADDRESS, xorAddress(client.ip, client.port, m.header)!]
      ]);
    }
    if (!existing) return error(437, 'Allocation Mismatch');

    if (m.type === REFRESH) {
      const wanted = get(A.LIFETIME);
      const seconds = wanted ? Math.min(new DataView(wanted.value.buffer, wanted.value.byteOffset).getUint32(0), LIFETIME) : LIFETIME;
      if (seconds === 0) free(existing);
      else existing.expires = now() + seconds;
      return ok([[A.LIFETIME, u32(seconds)]]);
    }
    const peers = m.attrs.filter(a => a.type === A.XOR_PEER_ADDRESS).map(a => unxorAddress(a.value, m.header));
    if (!peers.length || peers.some(p => !p)) return error(400, 'Bad Request');
    // Other clients of this relay are reached at its own address
    const vp = existing.virtual;
    if (peers.some(p => vp ? p!.ip !== vp.remote.ip : p!.ip !== existing.relayIp && !opts.peerAllowed(p!.ip))) return error(403, 'Forbidden');

    if (m.type === CREATE_PERMISSION) {
      for (const p of peers) existing.permissions.set(p!.ip, now() + PERMISSION);
      return ok();
    }
    // ChannelBind
    const number = get(A.CHANNEL_NUMBER);
    const channel = number ? new DataView(number.value.buffer, number.value.byteOffset).getUint16(0) : 0;
    const peer = peers[0]!;
    if (vp && peer.port !== vp.remote.port) return error(403, 'Forbidden');
    const peerKey = `${peer.ip}:${peer.port}`;
    if (channel < 0x4000 || channel > 0x7ffe) return error(400, 'Bad Request');
    const boundTo = existing.channels.get(channel), boundAs = existing.byPeer.get(peerKey);
    if ((boundTo && `${boundTo.ip}:${boundTo.port}` !== peerKey) || (boundAs != null && boundAs !== channel)) return error(400, 'Bad Request');
    existing.channels.set(channel, { ...peer, expires: now() + CHANNEL });
    existing.byPeer.set(peerKey, channel);
    existing.permissions.set(peer.ip, now() + PERMISSION);
    return ok();
  }

  // The public proxy supports both transports. The local listener only needs TCP.
  const udp = virtual ? null : dgram.createSocket(net.isIPv4(opts.bind) ? 'udp4' : 'udp6');
  let port = opts.port;
  if (udp) {
    udp.on('message', (msg, from) => {
      const ip = v4(from.address);
      handle(msg, { key: `udp:${ip}:${from.port}`, ip, port: from.port, local: null, send: bytes => udp.send(bytes, from.port, from.address) }).catch(() => {});
    });
    port = await new Promise<number>((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(opts.port, opts.bind, () => { udp.removeAllListeners('error'); udp.on('error', () => {}); resolve(udp.address().port); });
    }).catch(err => { clearInterval(sweep); throw err; });
  }

  // TCP, for browsers and networks that allow no UDP: the same messages, one after another, padded to 4 bytes
  const clients = new Set<net.Socket>();
  const tcp = net.createServer(socket => {
    clients.add(socket);
    const ip = v4(socket.remoteAddress ?? ''), remotePort = socket.remotePort ?? 0;
    const client: Client = {
      key: `tcp:${ip}:${remotePort}`, ip, port: remotePort, local: socket.localAddress ? v4(socket.localAddress) : null,
      closed: () => socket.destroyed,
      send: bytes => {
        if (socket.destroyed) return;
        // A slow reader must not grow our memory; it loses packets instead, like on UDP
        if (socket.writableLength > 4 * 1024 * 1024) return;
        const padded = (bytes.length + 3) & ~3;
        socket.write(padded === bytes.length ? bytes : Buffer.concat([bytes, Buffer.alloc(padded - bytes.length)]));
      }
    };
    let pending: Buffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    socket.setTimeout(LIFETIME * 1000, () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 4) {
        const kind = pending[0] & 0xc0;
        if (kind !== 0x00 && kind !== 0x40) return socket.destroy();
        const length = (kind === 0x00 ? 20 : 4) + pending.readUInt16BE(2);
        const framed = (length + 3) & ~3;
        if (length > 65536) return socket.destroy();
        if (pending.length < framed) break;
        handle(Uint8Array.from(pending.subarray(0, length)), client).catch(() => {});
        pending = pending.subarray(framed);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clients.delete(socket);
      const a = allocations.get(client.key);
      if (a?.client === client) free(a);
    });
  });
  if (opts.relay) {
    await new Promise<void>((resolve, reject) => {
      // The public relay can run with UDP alone. The loopback relay needs TCP.
      tcp.once('error', virtual ? reject : () => resolve());
      tcp.listen({ port, host: opts.bind }, () => {
        tcp.removeAllListeners('error');
        tcp.on('error', () => {});
        port = (tcp.address() as net.AddressInfo).port;
        resolve();
      });
    }).catch(err => { clearInterval(sweep); throw err; });
  }

  return {
    port,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      for (const a of [...allocations.values()]) free(a);
      try { udp?.close(); } catch { /* already closed */ }
      for (const socket of clients) socket.destroy();
      tcp.close();
    }
  };
}
