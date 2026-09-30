// Integration test against a real Mumble server. Skipped unless MUMBLE_TEST_HOST is set, e.g.
// docker run -d -p 64739:64738 mumblevoip/mumble-server && MUMBLE_TEST_HOST=localhost:64739 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodec } from '../src/core/proto.ts';
import { MumbleClient } from '../src/core/client.ts';
import type { Transport } from '../src/core/transport.ts';
import { openTls } from '../electron/tls-transport.ts';
import { generateIdentity } from '../electron/identity.ts';
import { encodeVoice, decodeVoice } from '../src/core/voice-packet.ts';

const target = process.env.MUMBLE_TEST_HOST;
const codec = createCodec();

function connect(name: string, password = ''): Promise<MumbleClient> {
  const [host, port] = target!.split(':');
  const id = generateIdentity(name);
  const client = new MumbleClient(codec);
  const transport: Transport = { onData: null, onClose: null, send: b => conn.send(b), close: () => conn.close() };
  const conn = openTls(host, Number(port || 64738), id.certPem, id.keyPem, {
    onSecure: () => {},
    onData: c => transport.onData?.(c),
    onClose: r => transport.onClose?.(r)
  });
  client.connect(transport, { username: name, password, os: 'test' });
  return new Promise((resolve, reject) => {
    client.on('synced', () => resolve(client));
    client.on('close', reject);
  });
}

const until = <T>(fn: (resolve: (v: T) => void) => void, ms = 5000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fn(v => { clearTimeout(t); resolve(v); });
  });

test('two clients sync, see each other, exchange text, and update state', { skip: !target }, async () => {
  const alice = await connect('alice' + Date.now() % 1000);
  const bob = await connect('bob' + Date.now() % 1000);
  try {
    assert.ok(alice.channels.has(0), 'root channel present');
    assert.ok(alice.session != null && bob.session != null);

    // Alice learns about Bob via UserState
    await until<void>(res => {
      if (alice.users.has(bob.session!)) return res();
      alice.on('user', u => { if (u.session === bob.session) res(); });
    });

    // Channel text message
    const got = until<string>(res => bob.on('text', m => res(m.html)));
    alice.sendText({ channels: [0] }, 'hi from <b>alice</b>');
    assert.equal(await got, 'hi from <b>alice</b>');

    // Self-mute propagates to other clients
    const muted = until<boolean>(res => bob.on('user', (u, changed) => {
      if (u.session === alice.session && changed.includes('selfMute')) res(u.selfMute);
    }));
    alice.setSelfMute(true);
    assert.equal(await muted, true);

    // Plugin data between clients (used for rich chat)
    const pd = until<string>(res => bob.on('pluginData', (s, id, data) => res(`${s}:${id}:${new TextDecoder().decode(data)}`)));
    alice.sendPluginData([bob.session!], 'mumh5', new TextEncoder().encode('{"t":"typing"}'));
    assert.equal(await pd, `${alice.session}:mumh5:{"t":"typing"}`);

    // Disconnect is seen as UserRemove
    const gone = until<number>(res => bob.on('userRemove', u => res(u.session)));
    const aliceSession = alice.session;
    alice.disconnect();
    assert.equal(await gone, aliceSession);
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

test('image messages over the text limit must be well-formed XML', { skip: !target }, async () => {
  const alice = await connect('imgA' + Date.now() % 1000);
  const bob = await connect('imgB' + Date.now() % 1000);
  try {
    // Longer than the default 5000-char text limit, under the 128 KB image limit
    const img = `<img src="data:image/jpeg;base64,${'A'.repeat(8000)}"/>`;

    const denied = until<number>(res => alice.on('permissionDenied', d => res(d.type)));
    alice.sendText({ channels: [0] }, `<a href="https://x.example/f.png">f.png</a><br>${img}`);
    assert.equal(await denied, 4, 'unclosed <br> is invalid XML, server denies as TextTooLong');

    const got = until<string>(res => bob.on('text', m => res(m.html)));
    const ok = `<a href="https://x.example/f.png">f.png</a><br/>${img}`;
    alice.sendText({ channels: [0] }, ok);
    assert.equal(await got, ok);
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

test('bursts of messages are paced instead of dropped by the server', { skip: !target }, async () => {
  const alice = await connect('burstA' + Date.now() % 1000);
  const bob = await connect('burstB' + Date.now() % 1000);
  try {
    const got: string[] = [];
    const all = until<void>(res => bob.on('text', m => { got.push(m.html); if (got.length === 9) res(); }), 15000);
    for (let i = 0; i < 9; i++) alice.sendText({ channels: [0] }, `msg ${i}`);
    assert.ok(alice.queued > 0, 'some messages wait for the rate limit');
    await all;
    assert.deepEqual(got, Array.from({ length: 9 }, (_, i) => `msg ${i}`));
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

test('voice packets are relayed through the TCP tunnel in the negotiated format', { skip: !target }, async () => {
  const alice = await connect('voiceA' + Date.now() % 1000);
  const bob = await connect('voiceB' + Date.now() % 1000);
  try {
    assert.equal(alice.protobufVoice, true, '1.5 server uses the protobuf voice format');
    const frames: { session: number; frame: number; last: boolean; bytes: number }[] = [];
    const done = until<void>(res => bob.on('voice', raw => {
      const p = decodeVoice(raw);
      if (!p) return;
      frames.push({ session: p.session, frame: p.frame, last: p.last, bytes: p.opus.length });
      if (p.last) res();
    }));
    // Opus TOC byte 0x78: SILK wideband 20 ms frame, followed by filler
    const opus = new Uint8Array([0x78, ...new Array(40).fill(7)]);
    for (let i = 0; i < 5; i++) alice.sendVoiceTunnel(encodeVoice({ target: 0, frame: i * 2, opus, last: i === 4 }, alice.protobufVoice));
    await done;
    assert.equal(frames.length, 5);
    assert.ok(frames.every(f => f.session === alice.session && f.bytes === opus.length));
    assert.deepEqual(frames.map(f => f.frame), [0, 2, 4, 6, 8]);
    assert.equal(frames[4].last, true);
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

test('irregular bursts match the server bucket (whole-second leaks)', { skip: !target }, async () => {
  const alice = await connect('pace' + Date.now() % 1000);
  const bob = await connect('paceB' + Date.now() % 1000);
  try {
    const got: string[] = [];
    const total = 11;
    const all = until<void>(res => bob.on('text', m => { got.push(m.html); if (got.length === total) res(); }), 25000);
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    // Gaps that do not line up with whole seconds used to make the client overestimate
    const gaps = [0, 0, 0, 0, 0, 1900, 300, 300, 1400, 0, 0];
    for (let i = 0; i < total; i++) {
      await sleep(gaps[i]);
      alice.sendText({ channels: [0] }, `p${i}`);
    }
    await all;
    assert.deepEqual(got, gaps.map((_, i) => `p${i}`));
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

const superPw = process.env.MUMBLE_SUPERUSER_PASSWORD;

test('channel management and ACLs as SuperUser', { skip: !target || !superPw }, async () => {
  const admin = await connect('SuperUser', superPw);
  const guest = await connect('guest' + Date.now() % 1000);
  try {
    const name = 'acltest' + Date.now() % 100000;
    const byName = (n: string) => [...admin.channels.values()].find(c => c.name === n);
    const channelEvent = (pred: () => boolean) => until<void>(res => {
      if (pred()) return res();
      const off = admin.on('channel', () => { if (pred()) { off(); res(); } });
    });

    // Create, rename, describe, move
    admin.createChannel(0, name);
    await channelEvent(() => !!byName(name));
    const id = byName(name)!.id;
    admin.updateChannel(id, { name: name + 'x', description: 'about <b>this</b>', position: 3 });
    await channelEvent(() => admin.channels.get(id)?.name === name + 'x');
    assert.equal(admin.channels.get(id)!.description, 'about <b>this</b>');
    admin.createChannel(0, name + 'sub');
    await channelEvent(() => !!byName(name + 'sub'));
    const sub = byName(name + 'sub')!.id;
    admin.updateChannel(sub, { parent: id });
    await channelEvent(() => admin.channels.get(sub)?.parent === id);

    // Link and unlink
    admin.setLinks(id, [0], []);
    await channelEvent(() => !!admin.channels.get(id)?.links.has(0));
    admin.setLinks(id, [], [0]);
    await channelEvent(() => !admin.channels.get(id)?.links.has(0));

    // ACL: deny Enter for everyone in the channel, and a group with a registered member
    const acl = until<any>(res => admin.on('acl', a => { if (a.channelId === id) res(a); }));
    admin.queryAcl(id);
    const current = await acl;
    assert.ok(current.acls.some((a: any) => a.inherited), 'inherited rules from root are listed');
    current.acls.push({ applyHere: true, applySubs: true, inherited: false, userId: null, group: 'all', grant: 0, deny: 0x4 });
    current.groups.push({ name: 'mods', inherited: false, inherit: true, inheritable: true, add: [0], remove: [], inheritedMembers: [] });
    admin.saveAcl(current);
    const saved = until<any>(res => admin.on('acl', a => { if (a.channelId === id) res(a); }));
    setTimeout(() => admin.queryAcl(id), 300);
    const after = await saved;
    assert.ok(after.acls.some((a: any) => !a.inherited && a.group === 'all' && a.deny === 0x4), 'rule saved');
    assert.deepEqual(after.groups.find((g: any) => g.name === 'mods')?.add, [0], 'group member saved');

    // The rule is enforced: a guest may not enter
    const denied = until<number>(res => guest.on('permissionDenied', d => res(d.permission)));
    guest.joinChannel(id);
    assert.equal(await denied, 0x4);

    // Permissions: a guest may traverse the channel but not enter it; SuperUser gets no
    // permission messages at all and is treated as allowed everything
    const perms = until<number>(res => guest.on('permissions', (c, bits) => { if (c === id) res(bits); }));
    guest.requestPermissions(id);
    const bits = await perms;
    assert.equal(bits & 0x4, 0, 'guest cannot enter');
    assert.ok(bits & 0x2, 'guest can traverse');
    assert.equal(guest.can(id, 0x4), false);
    assert.equal(admin.can(id, 0x1), true);

    // Remove (subchannel goes with it)
    admin.removeChannel(id);
    await until<void>(res => admin.on('channelRemove', c => { if (c === id) res(); }));
    assert.ok(!admin.channels.has(sub));
  } finally {
    admin.disconnect();
    guest.disconnect();
  }
});

