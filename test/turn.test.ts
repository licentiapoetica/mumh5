// The relay (TURN) in the web proxy, driven by a small client written here: the same steps a
// browser takes, over UDP and over TCP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { startTurn, turnCredential, build, parse, xorAddress, unxorAddress, type TurnOptions } from '../server/turn.ts';

const SECRET = 'test-secret';
const options = (over: Partial<TurnOptions> = {}): TurnOptions => ({
  port: 0, bind: '127.0.0.1', relay: true, publicIp: '127.0.0.1', minPort: 41000, maxPort: 41999, maxAllocations: 10, maxPerAddress: 4, peerAllowed: () => true, ...over
});

let counter = 0;
const header = () => { const h = new Uint8Array(20); new DataView(h.buffer).setUint32(4, 0x2112a442); h[19] = ++counter; h[18] = counter >> 8; return h; };
const text = (s: string) => new TextEncoder().encode(s);
const attr = (m: NonNullable<ReturnType<typeof parse>>, type: number) => m.attrs.find(a => a.type === type)?.value;
const code = (m: NonNullable<ReturnType<typeof parse>>) => { const e = attr(m, 0x0009); return e ? e[2] * 100 + e[3] : 0; };

// One client connection to the relay, UDP or TCP
async function connect(port: number, transport: 'udp' | 'tcp') {
  const inbox: Uint8Array[] = [];
  const waiting: ((m: Uint8Array) => void)[] = [];
  const deliver = (m: Uint8Array) => { const w = waiting.shift(); if (w) w(m); else inbox.push(m); };
  const next = () => new Promise<Uint8Array>((resolve, reject) => {
    const m = inbox.shift();
    if (m) return resolve(m);
    const timer = setTimeout(() => reject(new Error('no answer from the relay')), 3000);
    waiting.push(v => { clearTimeout(timer); resolve(v); });
  });
  if (transport === 'udp') {
    const socket = dgram.createSocket('udp4');
    socket.on('message', deliver);
    await new Promise<void>(r => socket.bind(0, '127.0.0.1', r));
    return { next, send: (b: Uint8Array) => socket.send(b, port, '127.0.0.1'), close: () => socket.close() };
  }
  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>((r, j) => { socket.once('connect', () => r()); socket.once('error', j); });
  let pending: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = ((pending[0] & 0xc0) === 0 ? 20 : 4) + pending.readUInt16BE(2);
      const framed = (length + 3) & ~3;
      if (pending.length < framed) break;
      deliver(Uint8Array.from(pending.subarray(0, length)));
      pending = pending.subarray(framed);
    }
  });
  return {
    next,
    send: (b: Uint8Array) => { const padded = (b.length + 3) & ~3; socket.write(Buffer.concat([b, Buffer.alloc(padded - b.length)])); },
    close: () => socket.destroy()
  };
}

// Allocate: asked for credentials first, then granted
async function allocate(c: Awaited<ReturnType<typeof connect>>, secret = SECRET) {
  const transport: [number, Uint8Array] = [0x0019, Uint8Array.from([17, 0, 0, 0])];
  c.send(build(0x0003, header(), [transport]));
  const challenge = parse(await c.next())!;
  assert.equal(challenge.type, 0x0113);
  assert.equal(code(challenge), 401);
  const realm = attr(challenge, 0x0014)!, nonce = attr(challenge, 0x0015)!;
  const username = String(Math.floor(Date.now() / 1000) + 600);
  const key = createHash('md5').update(`${username}:mumh5:${turnCredential(secret, username)}`).digest();
  const auth: [number, Uint8Array][] = [[0x0006, text(username)], [0x0014, realm], [0x0015, nonce]];
  const h = header();
  c.send(build(0x0003, h, [transport, ...auth], key));
  const answer = parse(await c.next())!;
  return { answer, key, auth, relay: answer.type === 0x0103 ? unxorAddress(attr(answer, 0x0016)!, h) : null };
}

for (const transport of ['udp', 'tcp'] as const) {
  test(`relays between a client and a peer over ${transport}`, async () => {
    const turn = await startTurn(options(), SECRET);
    const client = await connect(turn.port, transport);
    const peer = dgram.createSocket('udp4');
    await new Promise<void>(r => peer.bind(0, '127.0.0.1', r));
    const peerPort = peer.address().port;
    const atPeer: { data: string; port: number }[] = [];
    let peerGot: (() => void) | null = null;
    peer.on('message', (m, from) => { atPeer.push({ data: m.toString(), port: from.port }); peerGot?.(); });
    const peerNext = () => atPeer.length ? Promise.resolve() : new Promise<void>((r, j) => { peerGot = r; setTimeout(() => j(new Error('peer got nothing')), 3000); });
    try {
      const { answer, key, auth, relay } = await allocate(client);
      assert.equal(answer.type, 0x0103);
      assert.equal(relay!.ip, '127.0.0.1');
      assert.ok(relay!.port >= 41000 && relay!.port <= 41999, 'relay port within the configured range');
      // The answer is signed, which browsers insist on
      assert.ok(attr(answer, 0x0008), 'message integrity on the answer');

      // Without permission, nothing gets through in either direction
      let h = header();
      const peerAddr = (hd: Uint8Array): [number, Uint8Array] => [0x0012, xorAddress('127.0.0.1', peerPort, hd)!];
      client.send(build(0x0016, h, [peerAddr(h), [0x0013, text('too early')]]));
      peer.send('unwanted', relay!.port, '127.0.0.1');
      // Let both arrive (and be dropped) before permission is given
      await new Promise(r => setTimeout(r, 150));
      assert.equal(atPeer.length, 0, 'nothing reaches the peer without permission');

      h = header();
      client.send(build(0x0008, h, [peerAddr(h), ...auth], key));
      assert.equal(parse(await client.next())!.type, 0x0108);

      // Send indication out, data indication back
      h = header();
      client.send(build(0x0016, h, [peerAddr(h), [0x0013, text('hello peer')]]));
      await peerNext();
      assert.deepEqual(atPeer.map(p => p.data), ['hello peer']);
      assert.equal(atPeer[0].port, relay!.port, 'the peer sees the relay as the sender');
      peer.send('hello client', relay!.port, '127.0.0.1');
      const indication = parse(await client.next())!;
      assert.equal(indication.type, 0x0017);
      assert.equal(new TextDecoder().decode(attr(indication, 0x0013)!), 'hello client');
      assert.deepEqual(unxorAddress(attr(indication, 0x0012)!, indication.header), { ip: '127.0.0.1', port: peerPort });

      // Channel: the compact framing browsers switch to for media
      h = header();
      client.send(build(0x0009, h, [[0x000c, Uint8Array.from([0x40, 0x01, 0, 0])], peerAddr(h), ...auth], key));
      assert.equal(parse(await client.next())!.type, 0x0109);
      atPeer.length = 0;
      client.send(Uint8Array.from([0x40, 0x01, 0, 5, ...text('media')]));
      await peerNext();
      assert.equal(atPeer[0].data, 'media');
      peer.send('frames', relay!.port, '127.0.0.1');
      const data = await client.next();
      assert.deepEqual([...data.subarray(0, 4)], [0x40, 0x01, 0, 6]);
      assert.equal(new TextDecoder().decode(data.subarray(4)), 'frames');

      // Refresh with lifetime 0 ends the allocation
      h = header();
      client.send(build(0x0004, h, [[0x000d, Uint8Array.from([0, 0, 0, 0])], ...auth], key));
      assert.equal(parse(await client.next())!.type, 0x0104);
      h = header();
      client.send(build(0x0008, h, [peerAddr(h), ...auth], key));
      assert.equal(code(parse(await client.next())!), 437);
    } finally {
      client.close();
      peer.close();
      turn.close();
    }
  });
}

test('wrong credentials and forbidden peers are refused', async () => {
  const turn = await startTurn(options({ peerAllowed: ip => ip !== '10.1.2.3' }), SECRET);
  const client = await connect(turn.port, 'udp');
  try {
    const bad = await allocate(client, 'another-secret');
    assert.equal(code(bad.answer), 401);
    const { answer, key, auth } = await allocate(client);
    assert.equal(answer.type, 0x0103);
    const h = header();
    client.send(build(0x0008, h, [[0x0012, xorAddress('10.1.2.3', 9, h)!], ...auth], key));
    assert.equal(code(parse(await client.next())!), 403);
    // A second allocation for the same client
    const again = await allocate(client);
    assert.equal(code(again.answer), 437);
  } finally {
    client.close();
    turn.close();
  }
});

test('quota per address', async () => {
  const turn = await startTurn(options({ maxPerAddress: 1 }), SECRET);
  const a = await connect(turn.port, 'udp'), b = await connect(turn.port, 'udp');
  try {
    assert.equal((await allocate(a)).answer.type, 0x0103);
    assert.equal(code((await allocate(b)).answer), 486);
  } finally {
    a.close();
    b.close();
    turn.close();
  }
});

test('STUN only: binding is answered, allocation is ignored', async () => {
  const turn = await startTurn(options({ relay: false }), SECRET);
  const client = await connect(turn.port, 'udp');
  try {
    client.send(build(0x0001, header(), []));
    assert.equal(parse(await client.next())!.type, 0x0101);
    client.send(build(0x0003, header(), [[0x0019, Uint8Array.from([17, 0, 0, 0])]]));
    await assert.rejects(client.next(), /no answer/);
  } finally {
    client.close();
    turn.close();
  }
});
