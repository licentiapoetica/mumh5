// Mumpeer through the web proxy: the proxy keeps the link to the relay for the browser and offers
// each lane as a TURN credential on its public relay. A fake Mumble server and a fake relay stand in
// for the real ones (no mumbot or mumpeer here), so this covers the proxy's side only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { X509Certificate, createHash } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket as WsClient } from 'ws';
import { generateIdentity } from '../electron/identity.ts';
import { startProxy, defaults, parseServers, type ProxyConfig } from '../server/proxy.ts';
import { build, parse, unxorAddress, xorAddress } from '../server/turn.ts';
import { WebSocketTransport } from '../src/core/ws-transport.ts';

const TOKEN = 'A'.repeat(43);
const text = (s: string) => new TextEncoder().encode(s);
const attr = (m: NonNullable<ReturnType<typeof parse>>, type: number) => m.attrs.find(a => a.type === type)?.value;

// A server that completes the TLS handshake and then stays quiet; enough for "secure"
async function fakeMumble() {
  const id = generateIdentity('Server');
  const server = tls.createServer({ cert: id.certPem, key: id.keyPem }, s => { s.on('error', () => {}); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: (server.address() as net.AddressInfo).port, close: () => server.close() };
}

// A relay that answers the bind and keeps what the lanes send
async function fakeRelay() {
  const id = generateIdentity('Relay');
  const fp = new X509Certificate(id.certPem).fingerprint256.replaceAll(':', '').toLowerCase();
  const frames: { type: number; data: Buffer }[] = [];
  const sockets = new Set<tls.TLSSocket>();
  const server = tls.createServer({
    cert: id.certPem, key: id.keyPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3', ALPNProtocols: ['mumpeer/1']
  }, socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 3 && buffer.length >= 3 + buffer.readUInt16BE(1)) {
        const length = buffer.readUInt16BE(1);
        const frame = { type: buffer[0], data: Buffer.from(buffer.subarray(3, 3 + length)) };
        buffer = buffer.subarray(3 + length);
        frames.push(frame);
        if (frame.type === 0 && JSON.parse(frame.data.toString()).t === 'bind') send(socket, 0, Buffer.from('{"v":1,"t":"ready"}'));
      }
    });
  });
  const send = (socket: tls.TLSSocket, type: number, data: Buffer) =>
    socket.write(Buffer.concat([Buffer.from([type, data.length >> 8, data.length & 255]), data]));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: (server.address() as net.AddressInfo).port, fp, frames,
    push: (data: Buffer) => { for (const s of sockets) send(s, 1, data); },
    close: () => { for (const s of sockets) s.destroy(); server.close(); }
  };
}

// The browser's side of the WebSocket, with the relay messages as calls
async function browser(base: string, mumblePort: number, waitSecure = true) {
  const id = generateIdentity('Browser');
  const ws = new WsClient(`${base.replace(/^http/, 'ws')}/api/connect`);
  const inbox: any[] = [];
  const waiting: ((m: any) => void)[] = [];
  ws.on('message', (data, binary) => {
    if (binary) return;
    const m = JSON.parse(data.toString());
    const w = waiting.findIndex(f => (f as any).match(m));
    if (w >= 0) waiting.splice(w, 1)[0](m); else inbox.push(m);
  });
  const wait = (match: (m: any) => boolean) => new Promise<any>((resolve, reject) => {
    const i = inbox.findIndex(match);
    if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
    const f = Object.assign(resolve, { match });
    waiting.push(f);
    setTimeout(() => reject(new Error('no answer from the proxy')), 4000).unref();
  });
  await once(ws, 'open');
  ws.send(JSON.stringify({ host: '127.0.0.1', port: mumblePort, certPem: id.certPem, keyPem: id.keyPem }));
  if (waitSecure) await wait(m => m.type === 'secure');
  let n = 0;
  const call = async (msg: object) => {
    const mine = ++n;
    ws.send(JSON.stringify({ ...msg, n: mine }));
    const answer = await wait(m => m.n === mine);
    if (answer.type === 'relay-fail') throw new Error(answer.reason);
    return answer.result;
  };
  return { ws, call, wait, close: () => ws.close() };
}

async function setup(over: Partial<ProxyConfig> = {}) {
  const mumble = await fakeMumble();
  const relay = await fakeRelay();
  const proxy = await startProxy({
    ...defaults, port: 0, origins: ['*'], stunPort: 0, stunBind: '127.0.0.1', turnIp: '127.0.0.1',
    servers: parseServers(`127.0.0.1:${mumble.port}`), ...over
  });
  const base = `http://127.0.0.1:${proxy.port}`;
  return { mumble, relay, proxy, base, endpoint: { host: '127.0.0.1', tcp: relay.port, fp: relay.fp }, done: async () => { await proxy.close(); mumble.close(); relay.close(); } };
}

// A TURN client over TCP: allocates, gets permission for the pair and exchanges data
async function turnClient(port: number, ice: { username: string; credential: string }) {
  const socket = net.connect(port, '127.0.0.1');
  await once(socket, 'connect');
  const inbox: Uint8Array[] = [];
  let pending: Buffer = Buffer.alloc(0);
  let waiter: ((m: Uint8Array) => void) | null = null;
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = ((pending[0] & 0xc0) === 0 ? 20 : 4) + pending.readUInt16BE(2);
      const framed = (length + 3) & ~3;
      if (pending.length < framed) break;
      const m = Uint8Array.from(pending.subarray(0, length));
      pending = pending.subarray(framed);
      if (waiter) { const w = waiter; waiter = null; w(m); } else inbox.push(m);
    }
  });
  const next = () => new Promise<Uint8Array>((resolve, reject) => {
    const m = inbox.shift();
    if (m) return resolve(m);
    waiter = resolve;
    setTimeout(() => reject(new Error('no answer from the relay')), 4000).unref();
  });
  const send = (b: Uint8Array) => socket.write(Buffer.concat([b, Buffer.alloc(((b.length + 3) & ~3) - b.length)]));
  let counter = 0;
  const header = () => { const h = new Uint8Array(20); new DataView(h.buffer).setUint32(4, 0x2112a442); h[19] = ++counter; return h; };
  const transport: [number, Uint8Array] = [0x0019, Uint8Array.from([17, 0, 0, 0])];
  send(build(0x0003, header(), [transport]));
  const challenge = parse(await next())!;
  const realm = attr(challenge, 0x0014)!, nonce = attr(challenge, 0x0015)!;
  const key = createHash('md5').update(`${ice.username}:mumh5:${ice.credential}`).digest();
  const auth: [number, Uint8Array][] = [[0x0006, text(ice.username)], [0x0014, realm], [0x0015, nonce]];
  const h = header();
  send(build(0x0003, h, [transport, ...auth], key));
  const answer = parse(await next())!;
  return {
    answer, relay: answer.type === 0x0103 ? unxorAddress(attr(answer, 0x0016)!, h) : null, next,
    permit: async (ip: string) => {
      const ph = header();
      send(build(0x0008, ph, [[0x0012, xorAddress(ip, 0, ph)!], ...auth], key));
      return parse(await next())!;
    },
    sendTo: (ip: string, port: number, data: string) => {
      const sh = header();
      send(build(0x0016, sh, [[0x0012, xorAddress(ip, port, sh)!], [0x0013, text(data)]]));
    },
    close: () => socket.destroy()
  };
}

test('a browser reaches the relay through the proxy and uses a lane as a TURN server', async () => {
  const t = await setup();
  const b = await browser(t.base, t.mumble.port);
  try {
    assert.equal((await (await fetch(`${t.base}/api/config`)).json()).mumpeer, true);
    await b.call({ type: 'relay-open', rid: '0123456789abcdef', address: t.endpoint, token: TOKEN, lowSide: true });
    // The relay saw the bind with the token and nothing else yet
    const bind = t.relay.frames.find(f => f.type === 0);
    assert.deepEqual(JSON.parse(bind!.data.toString()), { v: 1, t: 'bind', tok: TOKEN });

    const ice = await b.call({ type: 'relay-turn', rid: '0123456789abcdef', lane: 0 });
    assert.equal(ice.urls, '');
    assert.equal(ice.port, t.proxy.stunPort);
    assert.ok(typeof ice.credential === 'string' && ice.credential.length > 10);
    assert.match(ice.username, /^\d+:lane-[0-9a-f]{32}$/);

    const client = await turnClient(t.proxy.stunPort!, ice);
    try {
      // The low side's virtual address is .1 and its peer's is .2, as on the desktop
      assert.deepEqual(client.relay, { ip: '192.0.2.1', port: 40000 });
      assert.equal((await client.permit('192.0.2.2')).type, 0x0108);
      client.sendTo('192.0.2.2', 40000, 'to the other side');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the relay got nothing')), 3000);
        const tick = setInterval(() => {
          if (t.relay.frames.some(f => f.type === 1)) { clearTimeout(timer); clearInterval(tick); resolve(); }
        }, 20);
      });
      const packet = t.relay.frames.find(f => f.type === 1)!;
      assert.equal(packet.data[0], 0, 'the lane number leads the packet');
      assert.equal(packet.data.subarray(1).toString(), 'to the other side');

      t.relay.push(Buffer.concat([Buffer.from([0]), Buffer.from('from the other side')]));
      const indication = parse(await client.next())!;
      assert.equal(indication.type, 0x0017);
      assert.equal(new TextDecoder().decode(attr(indication, 0x0013)), 'from the other side');
    } finally {
      client.close();
    }
    // Closing the link tells the browser and ends the lane
    await b.call({ type: 'relay-close', rid: '0123456789abcdef' });
    const closed = await b.wait(m => m.type === 'relay-closed');
    assert.equal(closed.rid, '0123456789abcdef');
    const late = await turnClient(t.proxy.stunPort!, ice);
    assert.equal(late.answer.type, 0x0113, 'the lane credential no longer allocates');
    late.close();
  } finally {
    b.close();
    await t.done();
  }
});

test('mumpeer requests are refused before the Mumble connection is secure, for other hosts and past the limit', async () => {
  const t = await setup();
  try {
    // Straight after the hello, before the proxy has reported "secure"
    const early = await browser(t.base, t.mumble.port, false);
    await assert.rejects(early.call({ type: 'relay-open', rid: '0123456789abcdef', address: t.endpoint, token: TOKEN, lowSide: true }), /unavailable/);
    early.close();

    const b = await browser(t.base, t.mumble.port);
    try {
      // A relay somewhere else is only for proxies that allow any server
      await assert.rejects(b.call({ type: 'relay-open', rid: '0123456789abcdef', address: { ...t.endpoint, host: 'relay.example.org' }, token: TOKEN, lowSide: true }), /only allows a relay on the Mumble server host/);
      await assert.rejects(b.call({ type: 'relay-open', rid: 'nothex', address: t.endpoint, token: TOKEN, lowSide: true }), /Invalid mumpeer connection/);
      await assert.rejects(b.call({ type: 'relay-open', rid: '0123456789abcdef', address: t.endpoint, token: 'short', lowSide: true }), /Invalid mumpeer connection/);
      // Nine links, then the tenth is refused; the same id twice is refused without closing the first
      for (let i = 0; i < 9; i++) await b.call({ type: 'relay-open', rid: i.toString(16).padStart(16, '0'), address: t.endpoint, token: TOKEN, lowSide: false });
      await assert.rejects(b.call({ type: 'relay-open', rid: 'a'.repeat(16), address: t.endpoint, token: TOKEN, lowSide: false }), /Too many/);
      await assert.rejects(b.call({ type: 'relay-open', rid: '0'.repeat(16), address: t.endpoint, token: TOKEN, lowSide: false }), /Too many/);
      assert.ok((await b.call({ type: 'relay-turn', rid: '0'.repeat(16), lane: 1 })).username, 'the first link still works');
      await assert.rejects(b.call({ type: 'relay-turn', rid: '0'.repeat(16), lane: 2 }), /unavailable/);
    } finally {
      b.close();
    }
  } finally {
    await t.done();
  }
});

test('a proxy that is not allowed to relay says so and does not dial', async () => {
  const t = await setup({ turn: false });
  const b = await browser(t.base, t.mumble.port);
  try {
    assert.equal((await (await fetch(`${t.base}/api/config`)).json()).mumpeer, false);
    await assert.rejects(b.call({ type: 'relay-open', rid: '0123456789abcdef', address: t.endpoint, token: TOKEN, lowSide: true }), /unavailable/);
    assert.equal(t.relay.frames.length, 0);
  } finally {
    b.close();
    await t.done();
  }
});

test('a relay on another host is refused when it resolves to a private address', async () => {
  const mumble = await fakeMumble();
  const relay = await fakeRelay();
  const proxy = await startProxy({
    ...defaults, port: 0, origins: ['*'], stunPort: 0, stunBind: '127.0.0.1', turnIp: '127.0.0.1',
    allowAny: true, servers: parseServers(`127.0.0.1:${mumble.port}`)
  });
  const b = await browser(`http://127.0.0.1:${proxy.port}`, mumble.port);
  try {
    // "localhost" is another host than 127.0.0.1, so the guard applies to it, as for any server
    await assert.rejects(
      b.call({ type: 'relay-open', rid: '0123456789abcdef', address: { host: 'localhost', tcp: relay.port, fp: relay.fp }, token: TOKEN, lowSide: true }),
      /Could not connect to mumpeer/);
    assert.equal(relay.frames.length, 0);
  } finally {
    b.close();
    await proxy.close();
    mumble.close();
    relay.close();
  }
});

test('the browser transport opens a link, gets TURN servers for the proxy and hears when the link ends', async () => {
  const t = await setup({ turnUrls: ['turns:turn.example.org:443?transport=tcp'] });
  const id = generateIdentity('Browser');
  const transport = new WebSocketTransport(`${t.base.replace(/^http/, 'ws')}/api/connect`, { host: '127.0.0.1', port: t.mumble.port }, id);
  try {
    await transport.secure;
    const ended: string[] = [];
    transport.onRelayClose((rid, reason) => ended.push(`${rid}: ${reason}`));
    await transport.relayOpen('0123456789abcdef', t.endpoint, TOKEN, true);
    const ice = await transport.relayTurn('0123456789abcdef', 1);
    assert.deepEqual(ice.urls, [
      `turn:127.0.0.1:${t.proxy.stunPort}?transport=udp`, `turn:127.0.0.1:${t.proxy.stunPort}?transport=tcp`, 'turns:turn.example.org:443?transport=tcp'
    ]);
    assert.match(ice.username, /^\d+:lane-[0-9a-f]{32}$/);
    await assert.rejects(transport.relayTurn('ffffffffffffffff', 0), /unavailable/);
    // The relay going away is reported with its id
    t.relay.close();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the browser was not told')), 3000);
      const tick = setInterval(() => { if (ended.length) { clearTimeout(timer); clearInterval(tick); resolve(); } }, 20);
    });
    assert.match(ended[0], /^0123456789abcdef: /);
    await assert.rejects(transport.relayTurn('0123456789abcdef', 0), /unavailable/);
  } finally {
    transport.close();
    await t.done();
  }
});
