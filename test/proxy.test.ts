// The web proxy: allowlist, identity endpoints and the WebSocket bridge. The bridge tests need a
// real Mumble server and are skipped unless MUMBLE_TEST_HOST is set (see server.test.ts).
import { test } from 'node:test';
import net from 'node:net';
import dgram from 'node:dgram';
import assert from 'node:assert/strict';
import { proxyLine } from '../electron/tls-transport.ts';
import { stunResponse } from '../server/proxy.ts';
import { startProxy, defaults, parseServers, isPrivateAddress, type ProxyConfig } from '../server/proxy.ts';
import { WebSocket as WsClient } from 'ws';
import { WebSocketTransport } from '../src/core/ws-transport.ts';
import { createCodec } from '../src/core/proto.ts';
import { MumbleClient } from '../src/core/client.ts';

const target = process.env.MUMBLE_TEST_HOST;

async function withProxy(config: Partial<ProxyConfig>, fn: (base: string) => Promise<void>): Promise<void> {
  const proxy = await startProxy({ ...defaults, port: 0, origins: ['*'], ...config });
  try { await fn(`http://127.0.0.1:${proxy.port}`); } finally { await proxy.close(); }
}

const post = (base: string, route: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('server list parsing', () => {
  assert.deepEqual(parseServers('Mumble.Example.com, voice.example.org:1234=Friends ,[::1]:5=Local'), [
    { host: 'mumble.example.com', port: 64738, label: 'mumble.example.com' },
    { host: 'voice.example.org', port: 1234, label: 'Friends' },
    { host: '::1', port: 5, label: 'Local' }
  ]);
  assert.deepEqual(parseServers(''), []);
});

test('private address detection', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(isPrivateAddress(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.ok(!isPrivateAddress(a), a);
});

test('refuses to start without allowed servers', async () => {
  await assert.rejects(startProxy({ ...defaults, port: 0 }), /No servers allowed/);
});

test('config lists the allowed servers', async () => {
  await withProxy({ servers: parseServers('voice.example.org=Friends') }, async base => {
    assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { servers: [{ host: 'voice.example.org', port: 64738, label: 'Friends' }], any: false, stun: null });
  });
});

test('identity create, describe, export and import round trip', async () => {
  await withProxy({ servers: parseServers('voice.example.org') }, async base => {
    const created = await (await post(base, 'identity/create', { name: 'web user', email: '' })).json();
    assert.match(created.certPem, /BEGIN CERTIFICATE/);
    assert.match(created.keyPem, /PRIVATE KEY/);
    assert.match(created.cert.subject, /CN=web user/);
    assert.equal(created.commonName, 'web user');

    const { p12 } = await (await post(base, 'identity/export', { certPem: created.certPem, keyPem: created.keyPem, password: 'secret-pass', name: 'web user' })).json();
    const wrong = await post(base, 'identity/import', { p12, password: 'nope' });
    assert.equal(wrong.status, 400);
    const imported = await (await post(base, 'identity/import', { p12, password: 'secret-pass' })).json();
    assert.equal(imported.fingerprint, created.fingerprint);

    const der = created.certPem.replace(/-----[^-]+-----|\s/g, '');
    const [described] = await (await post(base, 'certs/describe', { ders: [der] })).json();
    assert.equal(described.fingerprint256, created.cert.fingerprint256);
  });
});

// A binding request: type, length 0, magic cookie, 12 byte transaction id
const stunRequest = () => Uint8Array.from([0, 1, 0, 0, 0x21, 0x12, 0xa4, 0x42, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

test('STUN answers carry the sender address, masked as the protocol asks', () => {
  const v4 = stunResponse(stunRequest(), '203.0.113.7', 54321)!;
  assert.deepEqual([...v4.subarray(0, 4)], [1, 1, 0, 12]);
  assert.deepEqual([...v4.subarray(4, 20)], [...stunRequest().subarray(4, 20)]);
  assert.deepEqual([...v4.subarray(20, 26)], [0, 0x20, 0, 8, 0, 1]);
  assert.equal(((v4[26] << 8) | v4[27]) ^ 0x2112, 54321);
  assert.deepEqual([...v4.subarray(28)].map((b, i) => b ^ [0x21, 0x12, 0xa4, 0x42][i]), [203, 0, 113, 7]);
  // An IPv4 sender seen through an IPv6 socket is still IPv4
  assert.deepEqual([...stunResponse(stunRequest(), '::ffff:203.0.113.7', 54321)!], [...v4]);
  const v6 = stunResponse(stunRequest(), '2001:db8::7', 1)!;
  assert.equal(v6[25], 2);
  const mask = stunRequest().subarray(4, 20);
  assert.deepEqual([...v6.subarray(28)].map((b, i) => b ^ mask[i]), [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
  // Not a binding request
  assert.equal(stunResponse(new Uint8Array(20), '203.0.113.7', 1), null);
  assert.equal(stunResponse(stunRequest().subarray(0, 12), '203.0.113.7', 1), null);
});

test('the proxy answers STUN over UDP and announces the port', async () => {
  const proxy = await startProxy({ ...defaults, port: 0, origins: ['*'], servers: parseServers('voice.example.org'), stunPort: 0, stunBind: '127.0.0.1' });
  try {
    assert.ok(proxy.stunPort);
    assert.equal((await (await fetch(`http://127.0.0.1:${proxy.port}/api/config`)).json()).stun, proxy.stunPort);
    const client = dgram.createSocket('udp4');
    const answer = await new Promise<Buffer>((resolve, reject) => {
      client.once('message', resolve);
      client.once('error', reject);
      client.send(stunRequest(), proxy.stunPort!, '127.0.0.1');
      setTimeout(() => reject(new Error('no STUN answer')), 3000);
    });
    assert.equal(((answer[26] << 8) | answer[27]) ^ 0x2112, client.address().port);
    assert.deepEqual([...answer.subarray(28)].map((b, i) => b ^ [0x21, 0x12, 0xa4, 0x42][i]), [127, 0, 0, 1]);
    client.close();
  } finally {
    await proxy.close();
  }
});

test('requests from other origins are refused', async () => {
  await withProxy({ servers: parseServers('voice.example.org'), origins: [] }, async base => {
    const cross = await post(base, 'identity/create', { name: 'x' }, { Origin: 'https://evil.example' });
    assert.equal(cross.status, 403);
    const same = await post(base, 'certs/describe', { ders: [] }, { Origin: base });
    assert.equal(same.status, 200);
  });
});

test('static files are served without leaving the folder', async () => {
  await withProxy({ servers: parseServers('voice.example.org'), staticDir: 'test' }, async base => {
    const ok = await fetch(`${base}/proxy.test.ts`);
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
  });
});

test('behind a reverse proxy, limits count the forwarded client address', async () => {
  await withProxy({ servers: parseServers('voice.example.org'), trustProxy: true, maxPerAddress: 1 }, async base => {
    const open = (forwarded: string) => new Promise<string>(resolve => {
      const ws = new WsClient(`${base.replace(/^http/, 'ws')}/api/connect`, { headers: { 'X-Forwarded-For': forwarded } });
      ws.on('open', () => resolve('open'));
      ws.on('unexpected-response', (_req, res) => resolve(String(res.statusCode)));
      ws.on('error', () => resolve('error'));
    });
    assert.equal(await open('203.0.113.1'), 'open');
    assert.equal(await open('203.0.113.2'), 'open');
    // A made-up first entry does not hide the address the reverse proxy saw
    assert.equal(await open('198.51.100.9, 203.0.113.1'), '503');
  });
});

test('PROXY protocol lines', () => {
  assert.equal(proxyLine('203.0.113.7', 40000, '127.0.0.1', 64738), 'PROXY TCP4 203.0.113.7 127.0.0.1 40000 64738\r\n');
  assert.equal(proxyLine('::ffff:203.0.113.7', 40000, '::ffff:10.0.0.2', 64738), 'PROXY TCP4 203.0.113.7 10.0.0.2 40000 64738\r\n');
  assert.equal(proxyLine('2001:db8::7', 40000, '::1', 64738), 'PROXY TCP6 2001:db8::7 ::1 40000 64738\r\n');
  assert.equal(proxyLine('203.0.113.7', 40000, '::1', 64738), 'PROXY TCP6 ::ffff:203.0.113.7 ::1 40000 64738\r\n');
  assert.equal(proxyLine('2001:db8::7', 40000, '127.0.0.1', 64738), 'PROXY UNKNOWN\r\n');
});

test('the client address is announced to the server before TLS when asked to', async () => {
  // Stands in for go-mmproxy: reads the first bytes of the connection
  let gotFirst!: (s: string) => void;
  const first = new Promise<string>(resolve => { gotFirst = resolve; });
  const upstream = net.createServer(s => s.once('data', d => { gotFirst(d.toString('latin1')); s.destroy(); }));
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const port = (upstream.address() as net.AddressInfo).port;
  try {
    await withProxy({ servers: parseServers(`127.0.0.1:${port}`), sendProxy: true, trustProxy: true }, async base => {
      const id = await identity(base, 'a');
      const ws = new WsClient(wsUrl(base), { headers: { 'X-Forwarded-For': '203.0.113.7' } });
      ws.on('open', () => ws.send(JSON.stringify({ host: '127.0.0.1', port, ...id })));
      ws.on('error', () => {});
      assert.match(await first, new RegExp(`^PROXY TCP4 203\\.0\\.113\\.7 127\\.0\\.0\\.1 \\d+ ${port}\\r\\n`));
      ws.terminate();
    });
  } finally {
    upstream.close();
  }
});

const identity = async (base: string, name: string) => (await post(base, 'identity/create', { name })).json() as Promise<{ certPem: string; keyPem: string }>;
const wsUrl = (base: string) => `${base.replace(/^http/, 'ws')}/api/connect`;

test('servers off the allowlist are refused', async () => {
  await withProxy({ servers: parseServers('voice.example.org') }, async base => {
    const t = new WebSocketTransport(wsUrl(base), { host: '127.0.0.1', port: 64738 }, await identity(base, 'a'));
    await assert.rejects(t.secure, /does not allow connecting to 127\.0\.0\.1:64738/);
  });
});

test('private addresses are refused when any server is allowed', async () => {
  await withProxy({ allowAny: true }, async base => {
    const id = await identity(base, 'a');
    await assert.rejects(new WebSocketTransport(wsUrl(base), { host: '127.0.0.1', port: 64738 }, id).secure, /private addresses/);
    await assert.rejects(new WebSocketTransport(wsUrl(base), { host: 'localhost', port: 64738 }, id).secure, /private addresses/);
  });
});

test('a listed server on a private address is reachable when any server is allowed', async () => {
  // Refuses the TLS handshake, which is enough to see the connection was attempted
  const local = net.createServer(s => s.destroy());
  await new Promise<void>(resolve => local.listen(0, '127.0.0.1', resolve));
  const port = (local.address() as net.AddressInfo).port;
  try {
    await withProxy({ allowAny: true, servers: parseServers(`127.0.0.1:${port},localhost:${port}`) }, async base => {
      const id = await identity(base, 'a');
      for (const host of ['127.0.0.1', 'localhost']) {
        const err = await new WebSocketTransport(wsUrl(base), { host, port }, id).secure.then(() => null, e => e as Error);
        assert.ok(err && !/private addresses|does not allow/.test(err.message), `${host}: ${err?.message}`);
      }
      // Other private addresses stay blocked
      await assert.rejects(new WebSocketTransport(wsUrl(base), { host: '127.0.0.1', port: port + 1 }, id).secure, /private addresses/);
    });
  } finally {
    local.close();
  }
});

test('two clients talk through the proxy', { skip: !target }, async () => {
  const [host, port = '64738'] = target!.split(':');
  await withProxy({ servers: parseServers(target!) }, async base => {
    const connect = async (name: string) => {
      const transport = new WebSocketTransport(wsUrl(base), { host, port: Number(port) }, await identity(base, name));
      const info = await transport.secure;
      assert.match(info.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      assert.ok(info.chain.length >= 1);
      assert.equal(info.clientAddress, '127.0.0.1');
      const client = new MumbleClient(createCodec());
      client.connect(transport, { username: name, os: 'test' });
      await new Promise<void>((resolve, reject) => { client.on('synced', () => resolve()); client.on('close', reject); });
      return client;
    };
    const a = await connect(`proxy-a-${Date.now() % 100000}`);
    const b = await connect(`proxy-b-${Date.now() % 100000}`);
    const got = new Promise<string>(resolve => b.on('text', m => resolve(m.html)));
    // A direct message, so other test files listening in the root channel are not disturbed
    a.sendText({ users: [b.session!] }, 'hello through the proxy');
    assert.equal(await got, 'hello through the proxy');
    // No UDP in a browser: voice stays on the TCP tunnel
    assert.equal(a.udpOk, false);
    a.disconnect();
    b.disconnect();
  });
});
