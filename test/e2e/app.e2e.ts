// Drives the built Electron app against a real Mumble server, with a headless second client.
//   npm run build && MUMBLE_TEST_HOST=localhost:64739 npm run test:e2e
// Optional: UPLOAD_HOST + UPLOAD_KEY to also test file sharing, SHOTS_DIR to save screenshots.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createCodec } from '../../src/core/proto.ts';
import { encodeVoice, decodeVoice, type VoicePacket } from '../../src/core/voice-packet.ts';
import { MumbleClient } from '../../src/core/client.ts';
import type { Transport } from '../../src/core/transport.ts';
import { openTls } from '../../electron/tls-transport.ts';
import { generateIdentity } from '../../electron/identity.ts';

const target = process.env.MUMBLE_TEST_HOST;
if (!target) {
  console.log('MUMBLE_TEST_HOST not set, skipping');
  process.exit(0);
}
const [host, port] = target.split(':');
const shots = process.env.SHOTS_DIR;
const root = path.resolve(import.meta.dirname, '../..');

function headless(username: string, password = ''): Promise<MumbleClient> {
  const codec = createCodec();
  const id = generateIdentity(username);
  const client = new MumbleClient(codec);
  const t: Transport = { onData: null, onClose: null, send: b => conn.send(b), close: () => conn.close() };
  const conn = openTls(host, Number(port), id.certPem, id.keyPem, {
    onSecure: () => {}, onData: c => t.onData?.(c), onClose: r => t.onClose?.(r)
  });
  client.connect(t, { username, password, os: 'test' });
  return new Promise((res, rej) => { client.on('synced', () => res(client)); client.on('close', rej); });
}

// Noisy PNG, no image library needed. Noise keeps the JPEG preview big enough (over the
// server's 5000-char text limit) to exercise Murmur's XML check on image messages.
function testPng(w = 400, h = 300): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    raw.set([(x * 7 + Math.random() * 90) & 255, (y * 5 + Math.random() * 90) & 255, Math.random() * 255], y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Fails with a label instead of hanging when an expected event never comes
function within<T>(p: Promise<T>, label: string, ms = 10000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Timed out waiting for: ${label}`)), ms))]);
}

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const userData = mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-'));
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  // Stay on $DISPLAY (e.g. Xvfb); Electron would otherwise pick the Wayland session automatically
  // Fake microphone (a beeping tone) and auto-granted permission for the voice tests
  args: [root, `--user-data-dir=${userData}`, '--ozone-platform=x11', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  env: env as Record<string, string>
});
const bob = await headless('bob');
// SuperUser can create channels; needs MUMBLE_SUPERUSER_PASSWORD on the test server
const admin = process.env.MUMBLE_SUPERUSER_PASSWORD ? await headless('SuperUser', process.env.MUMBLE_SUPERUSER_PASSWORD) : null;
try {
  const page = await app.firstWindow();
  page.on('console', m => { if (m.type() === 'error') console.log('[renderer]', m.text()); });
  await page.setViewportSize({ width: 1280, height: 800 });

  // First start: identity setup wizard
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor();
  await page.getByRole('button', { name: /Create a new identity/ }).click();
  await page.getByLabel('Name').fill('alice');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor({ state: 'detached' });
  console.log('ok: identity wizard creates an identity');

  // Settings: upload host + key
  if (process.env.UPLOAD_HOST && process.env.UPLOAD_KEY) {
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Chat and files' }).click();
    await page.getByLabel('Upload host').fill(process.env.UPLOAD_HOST);
    await page.getByLabel('Upload key').fill(process.env.UPLOAD_KEY);
    await page.getByRole('button', { name: 'Test key' }).click();
    await page.getByText(/^Key works\./).waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }

  // Add and connect to the server
  await page.getByTitle('Add a server').click();
  await page.getByLabel('Address').fill(host);
  await page.getByLabel('Port').fill(port);
  await page.getByLabel('Username').fill('alice');
  await page.getByLabel('Label').fill('Test Server');
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.getByText(/Connected/).first().waitFor();
  console.log('ok: connected');

  // Bob is listed in the channel tree
  await page.locator('.sidebar').getByText('bob').waitFor();
  console.log('ok: sees bob');

  // ─── Voice ───────────────────────────────────────────────────────────────
  const aliceSession = () => [...bob.users.values()].find(u => u.name === 'alice')!.session;
  const collect = (n: number, stopOnLast = false) => new Promise<VoicePacket[]>(res => {
    const got: VoicePacket[] = [];
    const off = bob.on('voice', raw => {
      const p = decodeVoice(raw);
      if (!p || p.session !== aliceSession()) return;
      got.push(p);
      if (got.length >= n || (stopOnLast && p.last)) { off(); res(got); }
    });
  });
  const setMode = async (label: string) => {
    await page.getByTitle('Settings').click();
    await page.getByRole('radio', { name: new RegExp(label) }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  };

  // Always on: a steady stream of 20 ms Opus packets
  const stream = collect(25);
  await setMode('Always on');
  const packets = await within(stream, 'voice packets from the app');
  assert.ok(packets.every(p => p.opus.length > 0 && !p.last));
  const steps = packets.slice(1).map((p, i) => p.frame - packets[i].frame);
  assert.ok(steps.every(d => d === 2), `sequence advances 2 frames per 20 ms packet: ${steps.join(',')}`);
  console.log(`ok: app sends Opus voice (${packets[0].opus.length} bytes per packet)`);

  // Echo alice's own audio back as bob: the app decodes it and shows bob speaking
  const echo = packets.map((p, i) => encodeVoice({ target: 0, frame: i * 2, opus: p.opus, last: i === packets.length - 1 }, bob.protobufVoice));
  const bobRow = page.locator('.sidebar .user', { hasText: 'bob' });
  const pump = setInterval(() => { const pk = echo.shift(); if (pk) bob.sendVoiceTunnel(pk); }, 20);
  await bobRow.locator('.avatar.speaking').waitFor({ timeout: 3000 });
  console.log('ok: incoming voice decoded, speaker highlighted');
  await bobRow.locator('.avatar.speaking').waitFor({ state: 'detached', timeout: 3000 });
  clearInterval(pump);
  console.log('ok: speaking indicator clears after the terminator');

  // Push to talk: silent until the key is held, terminator on release
  const ended = collect(1000, true);
  await setMode('Push to talk');
  const tail = await within(ended, 'terminator after leaving always-on');
  assert.equal(tail.at(-1)!.last, true);
  let leaked = 0;
  const offLeak = bob.on('voice', raw => { if (decodeVoice(raw)?.session === aliceSession()) leaked++; });
  await page.waitForTimeout(400);
  offLeak();
  assert.equal(leaked, 0, 'no voice while the push-to-talk key is up');
  await page.locator('.chat h1').click();
  const ptt = collect(1000, true);
  await page.keyboard.down('Backquote');
  await page.waitForTimeout(300);
  await page.keyboard.up('Backquote');
  const burst = await within(ptt, 'push-to-talk burst');
  assert.ok(burst.length >= 8 && burst.length <= 30, `about 300 ms of audio (${burst.length} packets)`);
  assert.equal(burst.at(-1)!.last, true);
  console.log(`ok: push to talk (${burst.length} packets, ends with terminator)`);

  // Voice activity with the fake beeping microphone: transmits in bursts
  await setMode('Voice activity');
  const vad = await within(collect(10), 'voice activity packets', 8000);
  assert.ok(vad.length === 10);
  const biggest = Math.max(...vad.map(p => p.opus.length));
  assert.ok(biggest > 40, `packets during the tone carry real audio (largest ${biggest} bytes)`);
  console.log(`ok: voice activity detection transmits on the tone (up to ${biggest} bytes per packet)`);

  // The app's own statistics confirm it decoded the echoed audio
  await page.getByTitle('Settings').click();
  const statsText = await page.locator('.stats').textContent();
  const decoded = Number(/decoded (\d+)/.exec(statsText ?? '')?.[1]);
  assert.ok(decoded >= 20, `decoded frames reported: ${statsText}`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log(`ok: ${decoded} frames decoded`);
  await setMode('Push to talk');
  await page.waitForTimeout(300);

  // Alice -> channel
  const gotText = new Promise<string>(res => bob.on('text', m => res(m.html)));
  await page.getByLabel('Message').fill('hello <from> alice\nsecond line https://example.com/x');
  await page.getByLabel('Message').press('Enter');
  const html = await within(gotText, 'channel text');
  assert.equal(html, 'hello &lt;from&gt; alice<br/>second line <a href="https://example.com/x">https://example.com/x</a>');
  console.log('ok: bob received channel text');

  // Bob -> channel, rendered sanitized
  bob.sendText({ channels: [0] }, 'hi alice <b>bold</b><script>window.pwned=1</script><img src="https://evil.example/t.png">');
  await page.locator('.msg', { hasText: 'hi alice' }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
  assert.equal(await page.locator('.msg b', { hasText: 'bold' }).count(), 1);
  assert.equal(await page.locator('img[src^="https://evil"]').count(), 0);
  console.log('ok: incoming text rendered and sanitized');

  // YouTube links become a click-to-play card; nothing loads from YouTube before the click
  bob.sendText({ channels: [0] }, 'watch <a href="https://youtu.be/dQw4w9WgXcQ?t=1m30s">https://youtu.be/dQw4w9WgXcQ?t=1m30s</a>');
  const card = page.locator('.msg', { hasText: 'watch' }).locator('.yt');
  await card.getByText('from 1:30, click to play').waitFor();
  assert.equal(await card.locator('iframe').count(), 0);
  assert.equal(await card.locator('.facade').evaluate(el => getComputedStyle(el).backgroundImage), 'none', 'no thumbnail request by default');
  await card.locator('.facade').click();
  assert.equal(await card.locator('iframe').getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=90');
  console.log('ok: YouTube link embedded as click-to-play');

  // Bob -> DM
  const alice = [...bob.users.values()].find(u => u.name === 'alice')!;
  bob.sendText({ users: [alice.session] }, 'psst');
  await page.locator('.sidebar').getByText('Direct messages').waitFor();
  await page.locator('.dm', { hasText: 'bob' }).click();
  await page.locator('.msg', { hasText: 'psst' }).waitFor();
  console.log('ok: direct message shown in its own view');
  await page.locator('.channel .name').first().dblclick();

  // Mute toggles propagate
  const muted = new Promise<boolean>(res => bob.on('user', (u, changed) => { if (u.name === 'alice' && changed.includes('selfMute')) res(u.selfMute); }));
  await page.locator('.me').getByRole('button', { name: 'Mute', exact: true }).click();
  assert.equal(await within(muted, 'mute state'), true);
  await page.locator('.me').getByRole('button', { name: 'Unmute', exact: true }).waitFor();

  // Right-click on mute / deafen opens quick audio options
  await page.locator('.me').getByRole('button', { name: 'Unmute', exact: true }).click({ button: 'right' });
  const micPop = page.getByRole('dialog', { name: 'Microphone' });
  await micPop.getByLabel('Microphone').waitFor();
  await micPop.getByRole('radio', { name: 'Always on' }).waitFor();
  await micPop.getByLabel(/Input volume/).fill('1.5');
  await micPop.getByText('Input volume: 150%').waitFor();
  await page.keyboard.press('Escape');
  await micPop.waitFor({ state: 'detached' });
  await page.locator('.me').getByRole('button', { name: 'Deafen', exact: true }).click({ button: 'right' });
  const outPop = page.getByRole('dialog', { name: 'Output' });
  await outPop.getByLabel('Output device').waitFor();
  await outPop.getByRole('button', { name: 'Voice settings...' }).click();
  await page.getByRole('tab', { name: 'Voice', selected: true }).waitFor();
  await page.getByText('Microphone volume: 150%').waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: quick audio options on right-click');

  // Tray icon mirrors the voice state; its menu acts on it
  const trayState = () => app.evaluate(() => (globalThis as any).__mumh5Tray && {
    tooltip: (globalThis as any).__mumh5Tray.tooltip, items: (globalThis as any).__mumh5Tray.items, icon: (globalThis as any).__mumh5Tray.state.icon
  });
  const trayUntil = async (label: string, pred: (t: any) => boolean) => {
    for (let i = 0; i < 50; i++) { const t = await trayState(); if (t && pred(t)) return t; await page.waitForTimeout(100); }
    throw new Error(`Tray never reached: ${label} (${JSON.stringify(await trayState())})`);
  };
  const tMuted = await trayUntil('muted', t => /muted on Test Server/.test(t.tooltip));
  assert.equal(tMuted.icon, 'data:image/png;base64,');
  assert.equal(tMuted.items.find((i: any) => i.label === 'Mute').checked, true);
  await app.evaluate(() => (globalThis as any).__mumh5Tray.click('Mute'));
  await within(new Promise<void>(res => bob.on('user', (u, ch) => { if (u.name === 'alice' && ch.includes('selfMute') && !u.selfMute) res(); })), 'unmuted from the tray');
  await trayUntil('connected', t => /connected on Test Server/.test(t.tooltip) && !t.items.find((i: any) => i.label === 'Mute').checked);
  await app.evaluate(() => (globalThis as any).__mumh5Tray.click('Mute'));
  await trayUntil('muted again', t => /muted/.test(t.tooltip));
  console.log('ok: tray icon follows voice state and its menu mutes');
  await page.locator('.channel + .users, .users').getByTitle('Muted', { exact: true }).first().waitFor();
  console.log('ok: self mute propagated and shown');

  if (process.env.UPLOAD_HOST) {
    const png = path.join(userData, 'gradient.png');
    writeFileSync(png, testPng());
    const gotUpload = new Promise<string>(res => bob.on('text', m => res(m.html)));
    await page.locator('.chat .composer input[type=file]').setInputFiles(png);
    const up = await within(gotUpload, 'upload message');
    assert.match(up, /<a href="http[^"]+\/cu\/[A-Za-z0-9_-]{12}\/gradient\.png">gradient\.png<\/a>/);
    assert.match(up, /<br\/><img src="data:image\/jpeg;base64,[^"]+"\/>$/);
    assert.ok(up.length > 5000, `preview should exceed the text limit (${up.length})`);
    await page.locator('.embed img').waitFor();
    await page.waitForFunction(() => (document.querySelector('.embed img') as HTMLImageElement)?.naturalWidth === 400);
    console.log('ok: upload posted with vanilla thumbnail, embed loads for mumh5');

    // Types the upload host does not allow are refused before uploading
    const txt = path.join(userData, 'notes.txt');
    writeFileSync(txt, 'plain text');
    let leaked = false;
    const off = bob.on('text', () => { leaked = true; });
    await page.locator('.chat .composer input[type=file]').setInputFiles(txt);
    await page.getByText('notes.txt: file type not allowed on this upload host').waitFor();
    await page.waitForTimeout(500);
    off();
    assert.equal(leaked, false);
    console.log('ok: disallowed file type refused');
  }

  // Server certificate viewer from the header (the Docker server is self-signed, so no green header)
  assert.equal(await page.locator('.sidebar header.trusted').count(), 0);
  await page.locator('.sidebar header .title').click();
  await page.getByRole('dialog', { name: /Certificate of/ }).getByText('self-signed').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  console.log('ok: server certificate viewer');

  // Own description: rich text with a picture, as Mumble-compatible XHTML
  await page.locator('.me .profile').click();
  await page.getByRole('button', { name: 'Edit description' }).click();
  const area = page.locator('.rich .area');
  await area.click();
  await page.keyboard.type('I test things ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second line');
  const pic = path.join(userData, 'avatar.png');
  writeFileSync(pic, testPng(300, 200));
  await page.locator('.rich input[type=file]').setInputFiles(pic);
  await area.locator('img').waitFor();
  const aliceId = [...bob.users.values()].find(u => u.name === 'alice')!.session;
  const commented = new Promise<string>(res => bob.on('user', (u, changed) => {
    if (u.session !== aliceId) return;
    if (changed.includes('comment') && u.comment) res(u.comment);
    // Long comments are announced by hash only; fetch the text
    else if (changed.includes('commentHash')) bob.requestBlob({ comments: [aliceId] });
  }));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const comment = await within(commented, 'comment update');
  assert.match(comment, /^<p>I test things <span style="font-weight:bold">bold<\/span><\/p><p>second line<img src="data:image\/jpeg;base64,[^"]+"\/><\/p>$/);
  assert.ok(comment.length > 5000, 'long enough that the server ran its XML check and accepted it');
  await page.locator('.panel .html img').waitFor();
  console.log('ok: own description edited');

  // Other user's profile and context menu
  await page.locator('.sidebar .user', { hasText: 'bob' }).click({ button: 'right' });
  for (const item of ['View profile', 'Send message', 'Server mute', 'Kick...', 'Ban...']) {
    await page.getByRole('menuitem', { name: item }).waitFor();
  }
  await page.getByRole('menuitem', { name: 'View profile' }).click();
  await page.locator('.panel h3', { hasText: 'bob' }).waitFor();
  console.log('ok: user context menu and profile');

  // Information: own connection shows client details and the full certificate
  await page.locator('.sidebar .user.self').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Information' }).click();
  const info = page.getByRole('dialog', { name: /^Information: alice/ });
  await info.getByText('mumh5 0.1.0').waitFor();
  await info.getByText('linux', { exact: false }).first().waitFor();
  await info.getByText('Online for').waitFor();
  await info.getByRole('button', { name: 'View certificate' }).click();
  await page.getByRole('dialog', { name: /^Certificate of alice/ }).getByText('alice', { exact: true }).first().waitFor();
  await page.getByRole('dialog', { name: /^Certificate of alice/ }).getByRole('button', { name: 'Close', exact: true }).last().click();
  await info.getByRole('button', { name: 'Close', exact: true }).last().click();
  console.log('ok: own connection information with certificate chain');

  // Someone else as a normal user: times and pings, details withheld by the server
  await page.locator('.sidebar .user', { hasText: 'bob' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Information' }).click();
  const bobInfo = page.getByRole('dialog', { name: 'Information: bob' });
  await bobInfo.getByText('Ping (TCP)').waitFor();
  await bobInfo.getByText('only shown to admins', { exact: false }).first().waitFor();
  assert.equal(await bobInfo.getByText('mumh5 0.1.0').count(), 0);
  await bobInfo.getByRole('button', { name: 'Close', exact: true }).last().click();
  console.log('ok: other user information respects server permissions');

  if (admin) {
    // Remove channels left over from an earlier run (the server refuses duplicate names)
    for (const c of [...admin.channels.values()]) {
      if (c.id !== 0 && c.parent === 0) admin.send('ChannelRemove', { channel_id: c.id });
    }
    await new Promise(r => setTimeout(r, 300));

    // Channels: a long description (only sent as a hash), and a nested pair
    const longDesc = 'Welcome to the lobby. ' + 'This description is long enough that the server only announces its hash. '.repeat(3);
    const created = new Promise<void>(res => {
      let n = 0;
      admin.on('channel', c => { if (['Lobby', 'Games', 'Minecraft'].includes(c.name) && ++n === 3) res(); });
    });
    admin.send('ChannelState', { parent: 0, name: 'Lobby', description: longDesc });
    admin.send('ChannelState', { parent: 0, name: 'Games' });
    await new Promise(r => setTimeout(r, 300));
    const games = [...admin.channels.values()].find(c => c.name === 'Games')!;
    admin.send('ChannelState', { parent: games.id, name: 'Minecraft' });
    await within(created, 'channels created');

    await page.locator('.channel', { hasText: 'Games' }).waitFor();
    assert.equal(await page.locator('.channel', { hasText: 'Minecraft' }).count(), 0, 'empty subchannels start collapsed');
    console.log('ok: channels collapsed by default');

    // Single click previews the description (fetched on demand), without joining
    await page.locator('.channel .name', { hasText: 'Lobby' }).click();
    await page.locator('.panel .html', { hasText: 'Welcome to the lobby' }).waitFor();
    assert.equal(await page.locator('.me .who span').textContent(), 'Root');
    console.log('ok: single click shows description without joining');

    // Side chat sends to that channel while staying in Root
    const lobby = [...bob.channels.values()].find(c => c.name === 'Lobby')!;
    await page.locator('.panel [role=tab]', { hasText: 'Chat' }).click();
    // Channel messages only reach people in that channel, so listen from inside Lobby
    admin.joinChannel(lobby.id);
    await new Promise(r => setTimeout(r, 300));
    const sideMsg = new Promise<number[]>(res => admin.on('text', m => { if (m.html === 'side hello') res(m.channels); }));
    await page.locator('.panel textarea').fill('side hello');
    await page.locator('.panel textarea').press('Enter');
    assert.deepEqual(await within(sideMsg, 'side chat message'), [lobby.id]);
    await page.locator('.panel .msg', { hasText: 'side hello' }).waitFor();
    assert.equal(await page.locator('.chat .msg', { hasText: 'side hello' }).count(), 0);
    console.log('ok: side chat sends to the previewed channel');

    // Double click joins; the joined channel opens up
    await page.locator('.channel .name', { hasText: 'Games' }).dblclick();
    await page.locator('.me .who span', { hasText: 'Games' }).waitFor();
    await page.locator('.channel', { hasText: 'Minecraft' }).waitFor();
    console.log('ok: double click joins and expands');

    // Channel context menu
    await page.locator('.channel .name', { hasText: 'Lobby' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Join channel' }).click();
    await page.locator('.me .who span', { hasText: 'Lobby' }).waitFor();
    console.log('ok: channel context menu joins');

    // Side panel can be resized by dragging its left edge
    const panelBox = (await page.locator('aside.panel').boundingBox())!;
    const handle = (await page.locator('aside.panel .resize').boundingBox())!;
    await page.mouse.move(handle.x + 4, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(handle.x - 150, handle.y + 200, { steps: 5 });
    await page.mouse.up();
    const grown = (await page.locator('aside.panel').boundingBox())!;
    assert.ok(Math.abs(grown.width - (panelBox.width + 154)) < 6, `panel resized ${panelBox.width} -> ${grown.width}`);
    console.log('ok: side panel resizable');
  }

  // Without an upload host, images are sent inline within Mumble's image limit
  await page.locator('.channel .name', { hasText: 'Root' }).dblclick();
  await page.locator('.me .who span', { hasText: 'Root' }).waitFor();
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Chat and files' }).click();
  await page.getByLabel('Upload host').fill('');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const big = path.join(userData, 'big.png');
  writeFileSync(big, testPng(1600, 1200));
  const gotInline = new Promise<string>(res => bob.on('text', m => { if (m.html.startsWith('<img')) res(m.html); }));
  await page.locator('.chat .composer input[type=file]').setInputFiles(big);
  const inline = await within(gotInline, 'inline image');
  assert.match(inline, /^<img src="data:image\/jpeg;base64,[^"]+"\/>$/);
  assert.ok(inline.length <= 131072, `inline image within the server limit (${inline.length})`);
  console.log(`ok: inline image without upload host (${inline.length} chars)`);

  // ─── Several servers at once ─────────────────────────────────────────────
  const userState = (name: string) => [...bob.users.values()].find(u => u.name === name);
  const until2 = (label: string, cond: () => boolean) => within(new Promise<void>(res => {
    if (cond()) return res();
    const off = bob.on('user', () => { if (cond()) { off(); res(); } });
  }), label);

  await page.getByTitle('Add a server').click();
  await page.getByLabel('Address').fill(host);
  await page.getByLabel('Port').fill(port);
  await page.getByLabel('Username').fill('alice-b');
  await page.getByLabel('Label').fill('Second');
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.locator('.rail .tile.live').nth(1).waitFor();
  assert.equal(await page.locator('.rail .tile.live').count(), 2, 'both servers connected');
  await until2('background server shows deafened', () => !!userState('alice-b')?.selfDeaf);
  assert.equal(await page.locator('.rail .tile.voice').getAttribute('title').then(t => t?.startsWith('Test Server')), true);
  await page.getByText('Voice is on Test Server').waitFor();
  console.log('ok: second server connected, deafened in the background');

  // Joining a channel on the second server moves voice there
  await page.locator('.channel .name', { hasText: 'Root' }).dblclick();
  await until2('voice moved to the second server', () => !userState('alice-b')?.selfDeaf && !!userState('alice')?.selfDeaf);
  assert.equal(await page.locator('.rail .tile.voice').getAttribute('title').then(t => t?.startsWith('Second')), true);
  console.log('ok: voice follows the channel you join');

  // Messages on the server not on screen show as unread on its tile
  bob.sendText({ channels: [0] }, 'ping both');
  await page.locator('.rail .tile[title^="Test Server"] .unread').waitFor();
  console.log('ok: unread badge on the background server');

  // Reorder by dragging Second above Test Server
  await page.locator('.rail .tile[title^="Second"]').dragTo(page.locator('.rail .tile[title^="Test Server"]'), { targetPosition: { x: 22, y: 4 } });
  assert.match(await page.locator('.rail .tile').first().getAttribute('title') ?? '', /^Second/);
  console.log('ok: servers reordered by drag and drop');

  // Custom icon from the tile's context menu: square-cropped and shown instead of initials
  const iconFile = path.join(userData, 'icon.png');
  writeFileSync(iconFile, testPng(300, 200));
  await page.locator('.rail .tile[title^="Second"]').click({ button: 'right' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Change icon...' }).click();
  await (await chooser).setFiles(iconFile);
  const icon = page.locator('.rail .tile[title^="Second"] img.icon');
  await icon.waitFor();
  assert.deepEqual(await icon.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight, i.src.slice(0, 15)]), [128, 128, 'data:image/webp']);
  console.log('ok: custom server icon');

  // Disconnecting the voice server hands voice back and restores the earlier state
  await page.locator('.rail .tile[title^="Second"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Disconnect' }).click();
  await until2('voice back on the first server', () => !userState('alice-b') && !userState('alice')?.selfDeaf);
  assert.equal(userState('alice')?.selfMute, true, 'earlier self-mute kept');
  await page.locator('.rail .tile[title^="Test Server"]').click();
  await page.locator('.rail .tile[title^="Test Server"] .unread').waitFor({ state: 'detached' });
  console.log('ok: voice returns when the other server disconnects');

  // Change name: Mumble needs a reconnect, the app does it and remembers the name.
  // Unique per run: a reused test server may still have an earlier run's name registered.
  const newName = `alice${Date.now() % 100000}`;
  await page.locator('.me .profile').click();
  await page.getByRole('button', { name: 'Change name' }).click();
  await page.getByLabel('New name').fill(newName);
  await page.getByRole('button', { name: 'Reconnect with this name' }).click();
  await page.locator('.me .who strong', { hasText: newName }).waitFor();
  await within(new Promise<void>(res => {
    if ([...bob.users.values()].some(u => u.name === newName)) return res();
    bob.on('user', u => { if (u.name === newName) res(); });
  }), 'bob sees the new name');
  console.log('ok: name changed by reconnecting');

  // Self-registration: guest badge becomes registered
  await page.locator('.me .profile').click();
  await page.locator('.panel .badge-reg', { hasText: 'Guest' }).waitFor();
  await page.locator('.panel .register').click();
  await page.locator('.panel .badge-reg.registered', { hasText: 'Registered' }).waitFor();
  await page.locator('.sidebar .user', { hasText: newName }).locator('.reg').waitFor();
  console.log('ok: registered on the server');

  if (shots) {
    await page.waitForTimeout(300);
    for (const [name, w, h] of [['wide', 1280, 800], ['medium', 900, 700], ['narrow', 400, 780]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(shots, `${name}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.me').getByRole('button', { name: /^(Mute|Unmute)$/ }).click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, 'quick-audio.png') });
    await page.keyboard.press('Escape');
    await page.locator('.me .profile').click();
    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, 'editor.png') });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByTitle('Settings').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(shots, 'settings-voice.png') });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('.sidebar .user', { hasText: 'bob' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, 'profile.png') });
    await page.setViewportSize({ width: 400, height: 780 });
    await page.waitForTimeout(200);
    await page.getByLabel('Open channels').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shots, 'narrow-drawer.png') });
  }
  console.log('E2E PASSED');
} catch (e) {
  if (shots) await (await app.firstWindow()).screenshot({ path: path.join(shots, 'failure.png') });
  throw e;
} finally {
  bob.disconnect();
  admin?.disconnect();
  await app.close();
}
