// Integration test against a real Mumble server. Skipped unless MUMBLE_TEST_HOST is set, e.g.
// docker run -d -p 64739:64738 mumblevoip/mumble-server && MUMBLE_TEST_HOST=localhost:64739 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodec } from '../src/core/proto.ts';
import { MumbleClient, PERM, type ChannelAcl } from '../src/core/client.ts';
import { channelPassword, withPassword } from '../src/core/channel-password.ts';
import { parseAdmins, withAdmins } from '../src/core/admins.ts';
import { withDisplayName } from '../src/core/display-name.ts';
import { ROOT_ONLY, effectivePermissions, explain, setCell, type AccessLevel, type Person } from '../src/core/access.ts';
import { addKey, createRole, docFromRoles, parseRoles, prepareRoles, roleMembers, rolesFromAcl, roleTarget, setMember, withRoles } from '../src/core/roles.ts';
import type { Transport } from '../src/core/transport.ts';
import { openTls } from '../electron/tls-transport.ts';
import { generateIdentity } from '../electron/identity.ts';
import { encodeVoice, decodeVoice } from '../src/core/voice-packet.ts';
import { udpChannel } from '../electron/udp-voice.ts';
import { encodePoke, decodePoke } from '../src/core/poke.ts';
import { FILE, FILE_DATA_ID, FileAssembler, Sender, announce, takeFiles, encodeFileSignal, encode15, decode15, fromRanges, toRanges, parsePiece, pieceBytes, pieceCount, pieceForm, pieceMessage, pieceSize, pump, isPiece } from '../src/core/file-transfer.ts';

const target = process.env.MUMBLE_TEST_HOST;
const codec = createCodec();

function connectUdp(name: string): Promise<MumbleClient> {
  const [host, port] = target!.split(':');
  const id = generateIdentity(name);
  const client = new MumbleClient(codec);
  let udp: ReturnType<typeof udpChannel> | undefined;
  let conn: ReturnType<typeof openTls> | undefined;
  const transport: Transport = { onData: null, onClose: null, send: b => conn?.send(b), close: () => { udp?.close(); conn?.close(); } };
  return new Promise((resolve, reject) => {
    conn = openTls(host, Number(port || 64738), id.certPem, id.keyPem, {
      // UDP goes to the address the TLS connection actually reached
      onSecure: info => {
        udp = udpChannel(info.address, info.port);
        transport.udp = udp;
        client.connect(transport, { username: name, os: 'test' });
      },
      onData: c => transport.onData?.(c),
      onClose: r => { udp?.close(); transport.onClose?.(r); }
    });
    client.on('synced', () => resolve(client));
    client.on('close', reject);
  });
}

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

test('channel passwords: enforced by the server, tokens open them, operators are dangerous', { skip: !target || !process.env.MUMBLE_SUPERUSER_PASSWORD }, async () => {
  const su = await connect('SuperUser', process.env.MUMBLE_SUPERUSER_PASSWORD);
  const guest = await connect('pwguest' + Date.now() % 100000);
  const name = `pw-${Date.now()}`;
  const aclOf = (id: number) => {
    const got = until<ChannelAcl>(res => { const off = su.on('acl', a => { if (a.channelId === id) { off(); res(a); } }); });
    su.queryAcl(id);
    return got;
  };
  const canEnter = (id: number, want: boolean) => until<void>(res => {
    if (guest.channels.get(id)?.canEnter === want) return res();
    const off = guest.on('channel', c => { if (c.id === id && c.canEnter === want) { off(); res(); } });
  });
  let id: number | undefined;
  try {
    const made = until<number>(res => guest.on('channel', c => { if (c.name === name) res(c.id); }));
    su.createChannel(0, name);
    id = await made;
    su.saveAcl(withPassword(await aclOf(id), 'Open Sesame'));
    await canEnter(id, false);
    assert.equal(channelPassword(await aclOf(id)), 'Open Sesame');

    const denied = until<number>(res => guest.on('permissionDenied', d => res(d.permission)));
    guest.joinChannel(id);
    assert.equal(await denied, PERM.Enter);

    guest.setTokens(['wrong']);
    await guest.flushed();
    assert.equal(guest.channels.get(id)!.canEnter, false);

    // Tokens are compared without case, and work on a live connection
    guest.setTokens(['wrong', 'open sesame']);
    await canEnter(id, true);
    const moved = until<void>(res => guest.on('user', u => { if (u.session === guest.session && u.channelId === id) res(); }));
    guest.joinChannel(id);
    await moved;
    guest.joinChannel(0);
    guest.setTokens([]);
    await canEnter(id, false);

    // Why passwordProblem refuses these: "#!x" admits everyone who does not hold "x"
    su.saveAcl(withPassword(await aclOf(id), '!nothing'));
    await canEnter(id, true);

    su.saveAcl(withPassword(await aclOf(id), ''));
    await su.flushed();
    assert.equal(channelPassword(await aclOf(id)), '');
    assert.equal(guest.channels.get(id)!.canEnter, true);
  } finally {
    if (id != null) su.removeChannel(id);
    await su.flushed();
    su.disconnect();
    guest.disconnect();
  }
});

test('a temporary channel takes a password from the person who made it', { skip: !target || !process.env.MUMBLE_SUPERUSER_PASSWORD }, async () => {
  const su = await connect('SuperUser', process.env.MUMBLE_SUPERUSER_PASSWORD);
  const guest = await connect('tmpguest' + Date.now() % 100000);
  const name = `tmp-${Date.now()}`;
  try {
    const made = until<number>(res => su.on('channel', c => { if (c.name === name) res(c.id); }));
    su.createChannel(0, name, { temporary: true });
    const id = await made;
    const acl = until<ChannelAcl>(res => su.on('acl', a => { if (a.channelId === id) res(a); }));
    su.queryAcl(id);
    su.saveAcl(withPassword(await acl, 'temp pass'));
    await until<void>(res => {
      if (guest.channels.get(id)?.canEnter === false) return res();
      guest.on('channel', c => { if (c.id === id && !c.canEnter) res(); });
    });
  } finally {
    su.disconnect();
    guest.disconnect();
  }
});

test('the admin list: kept by the server, and only people with Write can change it', { skip: !target || !process.env.MUMBLE_SUPERUSER_PASSWORD }, async () => {
  const su = await connect('SuperUser', process.env.MUMBLE_SUPERUSER_PASSWORD);
  const guest = await connect('adminguest' + Date.now() % 100000);
  const rootText = async (c: MumbleClient) => {
    const root = c.channels.get(0)!;
    if (root.description || !root.descriptionHash) return root.description;
    const got = until<string>(res => { const off = c.on('channel', ch => { if (ch.id === 0 && ch.description) { off(); res(ch.description); } }); });
    c.requestBlob({ descriptions: [0] });
    return got;
  };
  const before = await rootText(su);
  try {
    // Long enough that the server only announces it by hash
    const text = withAdmins(`<p>${'Welcome. '.repeat(30)}</p>`, [41, 42]);
    const seen = until<void>(res => guest.on('channel', c => { if (c.id === 0) res(); }));
    su.updateChannel(0, { description: text });
    await seen;
    assert.deepEqual(parseAdmins(await rootText(guest)), [41, 42]);

    const denied = until<number>(res => guest.on('permissionDenied', d => res(d.permission)));
    guest.updateChannel(0, { description: withAdmins('', [guest.self!.session]) });
    assert.equal(await denied, PERM.Write);
    await su.flushed();
    assert.deepEqual(parseAdmins(await rootText(su)), [41, 42]);

    // Emptied: nothing is left to fetch, so the list can be published again
    const cleared = until<void>(res => guest.on('channel', c => { if (c.id === 0 && !c.descriptionHash) res(); }));
    su.updateChannel(0, { description: '' });
    await cleared;
  } finally {
    su.updateChannel(0, { description: before });
    await su.flushed();
    su.disconnect();
    guest.disconnect();
  }
});

test('profile pictures: sent as a texture, fetched by hash, an empty one removes it', { skip: !target }, async () => {
  const alice = await connect('pica' + Date.now() % 1000);
  const bob = await connect('picb' + Date.now() % 1000);
  let carol: MumbleClient | undefined;
  try {
    const picture = new Uint8Array(4000);
    picture.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 8; i < picture.length; i++) picture[i] = (i * 13) & 255;
    const aliceId = alice.session!;
    // Unregistered users may set one; others are told the hash only and ask for the bytes
    const announced = until<void>(res => bob.on('user', (u, changed) => { if (u.session === aliceId && changed.includes('textureHash')) res(); }));
    alice.setTexture(picture);
    await announced;
    assert.equal(bob.users.get(aliceId)!.texture, null, 'a new hash clears the old picture');
    const fetched = until<Uint8Array>(res => bob.on('user', (u, changed) => { if (u.session === aliceId && changed.includes('texture') && u.texture) res(u.texture); }));
    bob.requestBlob({ textures: [aliceId] });
    assert.deepEqual([...await fetched], [...picture]);

    // Someone joining later gets the hash too
    carol = await connect('picc' + Date.now() % 1000);
    assert.ok(carol.users.get(aliceId)!.textureHash, 'late joiner sees the hash');

    // Over the image limit: dropped by the server without an answer, the old picture stays
    alice.setTexture(new Uint8Array(alice.config.imageMessageLength + 1000));
    await new Promise(r => setTimeout(r, 1200));
    assert.deepEqual([...bob.users.get(aliceId)!.texture!], [...picture]);

    // Removing sends an empty picture
    const removed = until<number>(res => bob.on('user', (u, changed) => { if (u.session === aliceId && changed.includes('texture')) res(u.texture!.length); }));
    alice.setTexture(new Uint8Array(0));
    assert.equal(await removed, 0);
  } finally {
    alice.disconnect();
    bob.disconnect();
    carol?.disconnect();
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

test('voice over encrypted UDP (OCB2) between two clients', { skip: !target }, async () => {
  const alice = await connectUdp('udpA' + Date.now() % 1000);
  const bob = await connectUdp('udpB' + Date.now() % 1000);
  try {
    // Both sides confirm UDP with encrypted pings
    await until<void>(res => { if (alice.udpOk) res(); else alice.on('udp', ok => { if (ok) res(); }); }, 8000);
    await until<void>(res => { if (bob.udpOk) res(); else bob.on('udp', ok => { if (ok) res(); }); }, 8000);
    assert.ok(alice.udpRtt >= 0);

    // Alice's voice goes out over UDP and reaches bob over UDP, not the TCP tunnel
    let tunneled = 0;
    const origSend = (alice as any).sendVoiceTunnel.bind(alice);
    (alice as any).sendVoiceTunnel = (p: Uint8Array) => { tunneled++; origSend(p); };
    const got = until<number>(res => {
      let n = 0;
      bob.on('voice', raw => { const p = decodeVoice(raw); if (p?.session === alice.session && ++n === 10) res(n); });
    });
    const opus = new Uint8Array([0x78, ...new Array(40).fill(9)]);
    for (let i = 0; i < 10; i++) alice.sendVoice(encodeVoice({ target: 0, frame: i * 2, opus, last: i === 9 }, alice.protobufVoice));
    assert.equal(await got, 10);
    assert.equal(tunneled, 0, 'nothing went through the TCP tunnel');
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});


test('file announcements with a preview pass the server as they are', { skip: !target }, async () => {
  const alice = await connect('annA' + Date.now() % 1000);
  const bob = await connect('annB' + Date.now() % 1000);
  try {
    const meta = { i: 'abc', n: 'clip--1.mp4', s: 5, m: 'video/mp4', c: 1500, h: 'ab'.repeat(32) };
    const html = announce(meta, `<b>clip--1.mp4</b> (5 B)<br/><img src="data:image/jpeg;base64,${'A'.repeat(20000)}"/>`);
    const got = until<string>(res => bob.on('text', m => res(m.html)));
    alice.sendText({ channels: [0] }, html);
    const arrived = await got;
    assert.equal(arrived, html);
    assert.equal(takeFiles(arrived).files[0].meta.n, 'clip--1.mp4');
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

test('a poke reaches one person as a private message with its marker intact', { skip: !target }, async () => {
  const alice = await connect('pokeA' + Date.now() % 1000);
  const bob = await connect('pokeB' + Date.now() % 1000);
  try {
    const got = until<{ html: string; users: number[]; channels: number[] }>(res => bob.on('text', m => res({ html: m.html, users: m.sessions, channels: m.channels })));
    alice.sendText({ users: [bob.session!] }, encodePoke('Hey wake up! <3'));
    const arrived = await got;
    assert.equal(arrived.channels.length, 0);
    assert.equal(decodePoke(arrived.html), 'Hey wake up! <3');
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

test('a file reaches two people through the server, chat stays quick meanwhile', { skip: !target }, async () => {
  const alice = await connect('fileA' + Date.now() % 1000);
  const bob = await connect('fileB' + Date.now() % 1000);
  const carol = await connect('fileC' + Date.now() % 1000);
  try {
    const form = pieceForm(alice.config);
    const c = pieceBytes(alice.config);
    const data = new Uint8Array(c * 7 + 1234);
    for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536));
    const meta = { s: data.length, c };
    const count = pieceCount(meta);
    const sender = new Sender();
    const assembler = new FileAssembler();
    const done: number[] = [];
    let pumping: Promise<void> | null = null;
    alice.on('pluginData', async (from, id, packet) => {
      if (id !== FILE_DATA_ID) return;
      const sig = await assembler.push(from, packet);
      if (sig?.type !== FILE.want) return;
      sender.want('f1', from, fromRanges(JSON.parse(sig.text!).r, count)!);
      pumping ??= pump({
        client: alice, sender, alive: () => true,
        read: async (_f, k) => pieceMessage(form, 'f1', k, encode15(data.subarray(k * c, k * c + pieceSize(meta, k)))),
        done: r => done.push(r), gone: () => {}
      });
    });
    const receive = (who: MumbleClient) => {
      const parts: Uint8Array[] = [];
      let n = 0;
      return until<Uint8Array>(res => who.on('text', m => {
        if (!isPiece(m.html)) return;
        const p = parsePiece(m.html)!;
        assert.equal(m.actor, alice.session);
        if (!parts[p.index]) n++;
        parts[p.index] = decode15(p.payload, pieceSize(meta, p.index))!;
        if (n === count) {
          const all = new Uint8Array(data.length);
          parts.forEach((x, k) => all.set(x, k * c));
          res(all);
        }
      }), 60000);
    };
    const bobGot = receive(bob), carolGot = receive(carol);
    const t0 = Date.now();
    for (const who of [bob, carol]) {
      for (const packet of await encodeFileSignal(FILE.want, { i: 'f1', r: toRanges(Array.from({ length: count }, (_, k) => k)) })) {
        who.sendPluginData([alice.session!], FILE_DATA_ID, packet);
      }
    }
    // A chat message in the middle of the transfer still goes out at once
    await new Promise(r => setTimeout(r, 2500));
    const chatAt = Date.now();
    const chat = until<number>(res => bob.on('text', m => { if (m.html === 'during') res(Date.now() - chatAt); }));
    alice.sendText({ channels: [0] }, 'during');
    const latency = await chat;
    assert.deepEqual(await bobGot, data);
    assert.deepEqual(await carolGot, data);
    const secs = (Date.now() - t0) / 1000;
    await pumping;
    assert.deepEqual(done.sort(), [bob.session, carol.session].sort());
    console.log(`  ${(data.length / 1024).toFixed(0)} KB in ${count} pieces to 2 people: ${secs.toFixed(1)} s, ${(data.length / 1024 / secs).toFixed(0)} KB/s; chat during it took ${latency} ms`);
    assert.ok(latency < 1500, `chat message waited ${latency} ms`);
  } finally {
    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
  }
});

test('the access checker agrees with the server on random rules', { skip: !target || !superPw, timeout: 240000 }, async () => {
  const su = await connect('SuperUser', superPw);
  const tag = Date.now() % 100000;
  const [a, b, guest] = await Promise.all([connect(`acca${tag}`), connect(`accb${tag}`), connect(`accg${tag}`)]);
  const token = 'AccessKey';
  guest.setTokens([token.toLowerCase()]);
  const people = [a, b, guest];
  const aclOf = (id: number) => until<ChannelAcl>(res => {
    const off = su.on('acl', x => { if (x.channelId === id) { off(); res(x); } });
    su.queryAcl(id);
  }, 20000);
  const poll = (ok: () => boolean) => until<void>(res => {
    const t = setInterval(() => { if (ok()) { clearInterval(t); res(); } }, 25);
  }, 8000);
  const makeChannel = async (parent: number, name: string) => {
    su.createChannel(parent, name);
    await poll(() => [...su.channels.values()].some(c => c.name === name));
    return [...su.channels.values()].find(c => c.name === name)!.id;
  };
  const baseRoot = await aclOf(0);
  let parentId = -1;
  try {
    for (const c of [a, b]) {
      su.register(c.self!.session);
      await poll(() => c.self?.userId != null);
    }
    parentId = await makeChannel(0, `access${tag}`);
    const childId = await makeChannel(parentId, `inner${tag}`);
    su.setUserState(a.self!.session, { channel_id: parentId });
    su.setUserState(b.self!.session, { channel_id: childId });
    await poll(() => a.self?.channelId === parentId && b.self?.channelId === childId);
    const ids = [a.self!.userId!, b.self!.userId!];

    // Fixed seed: a failure can be repeated
    let seed = 20261121;
    const rnd = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };
    const pick = <T>(list: T[]) => list[rnd(list.length)];
    const some = () => ids.filter(() => rnd(3) === 0);
    const bits = Object.values(PERM) as number[];
    const mask = bits.reduce((x, y) => x | y, 0);
    const someBits = () => { let v = 0; for (let i = rnd(3) + 1; i > 0; i--) v |= pick(bits); return v; };
    const specs = ['all', 'auth', 'in', 'out', 'sub', 'sub,0,1', 'sub,-1,1,2', '~in', '~out', '~sub', '!auth', '!in', 'none', 'strong',
      'team', '!team', '~team', '!~team', `$${a.self!.hash}`, `!$${b.self!.hash}`, `#${token}`, `!#${token}`];
    const randomRules = () => Array.from({ length: rnd(5) + 1 }, () => {
      const grant = someBits();
      const deny = rnd(2) ? someBits() & ~grant : 0;
      const byUser = rnd(6) === 0;
      return { applyHere: rnd(4) > 0, applySubs: rnd(4) > 0, inherited: false, userId: byUser ? pick(ids) : null, group: byUser ? null : pick(specs), grant, deny };
    });
    const randomGroup = () => ({ name: 'team', inherited: false, inherit: rnd(4) > 0, inheritable: rnd(4) > 0, add: some(), remove: some(), inheritedMembers: [] });

    const path = [0, parentId, childId];
    const parents = (id: number) => su.channels.get(id)?.parent;
    for (let round = 0; round < 8; round++) {
      su.saveAcl({ ...baseRoot, groups: [...baseRoot.groups, randomGroup()], acls: [...baseRoot.acls, ...randomRules()] });
      su.saveAcl({ channelId: parentId, inheritAcls: rnd(4) > 0, groups: rnd(2) ? [randomGroup()] : [], acls: randomRules() });
      su.saveAcl({ channelId: childId, inheritAcls: rnd(4) > 0, groups: rnd(2) ? [randomGroup()] : [], acls: randomRules() });
      const levels: AccessLevel[] = [];
      for (const id of path) {
        const acl = await aclOf(id);
        levels.push({ channelId: id, name: String(id), inheritAcls: acl.inheritAcls, rules: acl.acls, groups: acl.groups });
      }
      await su.flushed();
      for (const c of people) {
        const who: Person = { userId: c.self!.userId, hash: c.self!.hash, channelId: c.self!.channelId, tokens: c === guest ? [token.toLowerCase()] : [], strong: false };
        const server = new Map<number, number>();
        for (const id of path) {
          await c.flushed();
          const got = until<number>(res => { const off = c.on('permissions', (ch, p) => { if (ch === id) { off(); res(p); } }); });
          c.requestPermissions(id);
          server.set(id, (await got) & mask);
        }
        path.forEach((id, i) => {
          const upTo = levels.slice(0, i + 1);
          const where = `round ${round}, user ${c.self!.name}, channel ${i}`;
          assert.equal(effectivePermissions(upTo, who, parents) & mask, server.get(id), where);
          for (const bit of bits) {
            const rootOnly = (bit & ROOT_ONLY) !== 0;
            const wanted = bit === PERM.Kick ? PERM.Kick | PERM.Ban : bit;
            const allowed = (server.get(rootOnly ? 0 : id)! & wanted) !== 0;
            assert.equal(explain(upTo, who, bit, parents).verdict, allowed ? 'allowed' : 'denied', `${where}, bit ${bit}`);
          }
        });
      }
    }
  } finally {
    su.saveAcl(baseRoot);
    if (parentId >= 0) su.removeChannel(parentId);
    // Saves are paced: the answer to this query means the server has the old rules back
    await aclOf(0);
    for (const c of [a, b, guest, su]) c.disconnect();
  }
});

test('roles: enforced by the server, readable by everyone, keys grant them, members cannot forge them', { skip: !target || !superPw, timeout: 60000 }, async () => {
  const tag = Date.now() % 100000;
  const su = await connect('SuperUser', superPw);
  const [member, keyHolder, outsider] = await Promise.all([connect(`rolem${tag}`), connect(`rolek${tag}`), connect(`roleo${tag}`)]);
  const poll = (ok: () => boolean, ms = 8000) => until<void>(res => {
    const t = setInterval(() => { if (ok()) { clearInterval(t); res(); } }, 25);
  }, ms);
  const aclOf = (id: number) => until<ChannelAcl>(res => {
    const off = su.on('acl', x => { if (x.channelId === id) { off(); res(x); } });
    su.queryAcl(id);
  }, 15000);
  const holds = async (c: MumbleClient, bit: number) => {
    await c.flushed();
    const got = until<number>(res => { const off = c.on('permissions', (ch, p) => { if (ch === 0) { off(); res(p); } }); });
    c.requestPermissions(0);
    return ((await got) & bit) !== 0;
  };
  const rootText = async (c: MumbleClient) => {
    const root = c.channels.get(0)!;
    if (root.description || !root.descriptionHash) return root.description;
    const got = until<string>(res => { const off = c.on('channel', ch => { if (ch.id === 0 && ch.description) { off(); res(ch.description); } }); });
    c.requestBlob({ descriptions: [0] });
    return got;
  };
  const baseAcl = await aclOf(0);
  const baseText = await rootText(su);
  try {
    su.register(member.self!.session);
    await poll(() => member.self?.userId != null);
    const id = member.self!.userId!;

    const made = createRole(baseAcl, 'Moderator', 'tst');
    let acl = setCell(made.acl, roleTarget(made.group), PERM.Move, 'allow');
    acl = setMember(acl, made.group, id, true);
    acl = addKey(acl, made.group, 'ABCD-EFGH-JKLM');
    const roles = rolesFromAcl(acl, null).map(r => (r.g === made.group ? { ...r, n: 'Moderator', c: '#6fb3ff', i: 'star' } : r));
    const ready = prepareRoles(acl, roles);
    const text = withRoles(`<p>${'Welcome. '.repeat(30)}</p>`, docFromRoles(roles));
    const seen = until<void>(res => { const off = outsider.on('channel', c => { if (c.id === 0) { off(); res(); } }); });
    su.saveAcl(ready);
    su.updateChannel(0, { description: text });
    await seen;

    const back = await aclOf(0);
    assert.deepEqual(roleMembers(back, made.group), [id]);
    assert.ok(await holds(member, PERM.Move), 'the role gives its member the permission');
    assert.ok(!(await holds(outsider, PERM.Move)), 'nobody else has it');
    keyHolder.setTokens(['mk.abcd-efgh-jklm.' + made.group]);
    assert.ok(await holds(keyHolder, PERM.Move), 'the key gives it, in any case');

    // A member without Write reads the published data but cannot change it
    const doc = parseRoles(await rootText(outsider))!;
    assert.deepEqual(doc.roles.find(r => r.g === made.group)!.m, [id]);
    assert.equal(doc.roles.find(r => r.g === made.group)!.i, 'star');
    assert.ok(!(await rootText(outsider)).includes('ABCD-EFGH-JKLM'), 'keys are not published');
    const denied = until<number>(res => { const off = member.on('permissionDenied', d => { off(); res(d.permission); }); });
    member.updateChannel(0, { description: withRoles('', docFromRoles([{ ...roles[0], m: [id] }])) });
    assert.equal(await denied, PERM.Write);
    const deniedAcl = until<number>(res => { const off = member.on('permissionDenied', d => { off(); res(d.permission); }); });
    member.saveAcl(setMember(back, made.group, id, false));
    assert.equal(await deniedAcl, PERM.Write);
  } finally {
    su.saveAcl(baseAcl);
    su.updateChannel(0, { description: baseText });
    await aclOf(0);
    for (const c of [member, keyHolder, outsider, su]) c.disconnect();
  }
});

test('a display name reaches everyone in the comment, the account name stays', { skip: !target, timeout: 30000 }, async () => {
  const tag = Date.now() % 100000;
  const poll = async (what: string, ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(ok(), what);
  };
  const account = `dn-a${tag}`;
  const a = await connect(account);
  const b = await connect(`dn-b${tag}`);
  let c: MumbleClient | undefined;
  try {
    const seen = () => b.users.get(a.session!)!;
    a.setComment(withDisplayName('', 'Free Name'));
    await poll('others get the name', () => seen().chosenName === 'Free Name');
    await poll('the server echoes it to the sender', () => a.self!.chosenName === 'Free Name');
    assert.equal(seen().name, account);
    assert.equal(seen().displayName, 'Free Name');

    c = await connect(`dn-c${tag}`);
    assert.equal(c.users.get(a.session!)!.chosenName, 'Free Name', 'someone joining later gets it');

    // Taken: the account name of someone here
    a.setComment(withDisplayName('', `DN-B${tag}`));
    await poll('a taken name keeps the account beside it', () => seen().displayName === `DN-B${tag} (${account})`);

    // Long comments arrive as a hash; the name inside needs the text
    a.setComment(withDisplayName(`<p>${'long text '.repeat(40)}</p>`, 'Long Name'));
    await poll('announced by hash', () => !!seen().commentHash && !seen().comment);
    b.requestBlob({ comments: [a.session!] });
    await poll('name read from the fetched text', () => seen().chosenName === 'Long Name');

    a.setComment('');
    await poll('removed', () => seen().chosenName === '' && seen().displayName === '');
    assert.equal(seen().commentHash, null, 'an emptied comment leaves nothing to fetch');
  } finally {
    for (const x of [a, b, c]) x?.disconnect();
  }
});
