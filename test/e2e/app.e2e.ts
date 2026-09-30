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

  // Welcome page: no message box while offline, identities one click away
  assert.equal(await page.locator('.chat .composer').count(), 0);
  await page.getByRole('button', { name: 'Manage identities' }).click();
  await page.getByRole('tab', { name: 'Identities', selected: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: welcome page without composer, manage identities');

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
  // Generous: on a freshly started server and fake microphone the first packets can take a while
  const packets = await within(stream, 'voice packets from the app', 20000);
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
  // Voice runs over encrypted UDP once the server answers UDP pings
  await page.locator('.stats', { hasText: /Transport: UDP, \d+ ms ping/ }).waitFor({ timeout: 10000 });
  await page.getByLabel(/Send voice over TCP only/).check();
  await page.locator('.stats', { hasText: 'Transport: TCP tunnel' }).waitFor();
  await page.getByLabel(/Send voice over TCP only/).uncheck();
  await page.locator('.stats', { hasText: /Transport: UDP/ }).waitFor();
  console.log('ok: voice transport UDP, with a TCP-only switch');
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

  // Right-click menus for text: composer editing, links, messages, authors
  const composer = page.locator('.chat .composer [contenteditable]');
  const composerText = async () => (await composer.innerText()).trim();
  const menuItem = (name: string) => page.getByRole('menuitem', { name, exact: true });
  await composer.fill('abc 123');
  await composer.click({ button: 'right' });
  await menuItem('Select all').click();
  await composer.click({ button: 'right' });
  await menuItem('Cut').click();
  assert.equal(await composerText(), '');
  await composer.click({ button: 'right' });
  await menuItem('Paste').click();
  assert.equal(await composerText(), 'abc 123');
  await composer.fill('');
  await page.locator('.msg a[href="https://example.com/x"]').click({ button: 'right' });
  await menuItem('Copy link address').click();
  await composer.click({ button: 'right' });
  await menuItem('Paste').click();
  assert.equal(await composerText(), 'https://example.com/x');
  await composer.fill('');
  await page.locator('.msg .html', { hasText: 'hi alice' }).click({ button: 'right' });
  await menuItem('Copy message text').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.msg header strong', { hasText: 'bob' }).first().click({ button: 'right' });
  await menuItem('Send message').waitFor();
  await page.keyboard.press('Escape');
  console.log('ok: right-click menus for text fields, links, messages and authors');

  // Formatting in the message box: toolbar behind the Aa button, sent as Mumble-compatible HTML
  await page.locator('.chat .composer').getByRole('button', { name: 'Text formatting' }).click();
  await composer.fill('bold words https://example.com/b');
  await composer.press('Control+a');
  const gotBold = new Promise<string>(res => bob.on('text', m => { if (m.html.includes('bold words')) res(m.html); }));
  await page.locator('.chat .composer').getByRole('button', { name: 'Bold (Ctrl+B)' }).click();
  await composer.press('Enter');
  const bold = await within(gotBold, 'formatted message');
  assert.match(bold, /(<b>|font-weight:bold)/, `bold arrives: ${bold}`);
  assert.match(bold, /<a href="https:\/\/example\.com\/b">/, 'links still work in formatted messages');
  await page.locator('.chat .composer').getByRole('button', { name: 'Text formatting' }).click();
  console.log('ok: formatted message from the toolbar');

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
  const soundLog = () => page.evaluate(() => [...((window as any).__mumh5Sounds ?? [])] as string[]);
  const played = await soundLog();
  for (const ev of ['connected', 'message', 'privateMessage']) assert.ok(played.includes(ev), `sound for ${ev}: ${played}`);
  console.log('ok: sounds for connect, channel and direct messages');
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

  // Color schemes apply right away and are remembered
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Windows 95' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'win95');
  assert.equal(await page.locator('.rail').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 128, 128)');
  await page.getByRole('radio', { name: 'Dark' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: color schemes');

  // Layouts like the desktop client: classic (channels right of chat), stacked (channels above)
  const box = (sel: string) => page.locator(sel).first().boundingBox().then(b => b!);
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Classic' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.app.classic').waitFor();
  assert.ok((await box('.sidebar')).x > (await box('.chat')).x, 'classic: channel list right of chat');
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Stacked' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.app.stacked').waitFor();
  const chatBox = await box('.chat'), treeBox = await box('.sidebar');
  assert.ok(chatBox.y >= treeBox.y + treeBox.height - 1, 'stacked: chat below channel list');
  // The split between chat and channel list drags
  const handle = page.getByRole('separator', { name: 'Resize channel list' });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 60, { steps: 4 });
  await page.mouse.up();
  assert.ok((await box('.sidebar')).height > treeBox.height + 40, 'stacked: split resizes');
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Modern' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.app.side').waitFor();
  console.log('ok: classic and stacked layouts');

  // Public server list, from a local list in the official XML format
  const http = await import('node:http');
  const listServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(`<?xml version="1.0"?><servers><server name="E2E Murmur" ip="${host}" port="${port}" country="Testland" country_code="TL" continent_code="EU" url="https://example.org" ca="0"/><server name="Offline one" ip="127.0.0.1" port="9" country="Nowhere" continent_code="NA"/></servers>`);
  }).listen(0);
  const listPort = (listServer.address() as { port: number }).port;
  await page.getByTitle('Browse public servers').click();
  const pub = page.getByRole('dialog', { name: 'Public servers' });
  await pub.locator('.link', { hasText: 'List source' }).click();
  await page.getByLabel('URL').fill(`http://127.0.0.1:${listPort}/v1/list`);
  await page.getByRole('button', { name: 'Use this list' }).click();
  const row = pub.locator('tr', { hasText: 'E2E Murmur' });
  await row.getByText(/^\d+ \/ \d+$/).waitFor({ timeout: 8000 });
  await row.getByText(/ms$/).waitFor();
  await row.getByRole('button', { name: 'Add' }).click();
  assert.equal(await page.getByLabel('Address').inputValue(), host);
  assert.equal(await page.getByLabel('Port').inputValue(), port);
  assert.equal(await page.getByLabel('Label').inputValue(), 'E2E Murmur');
  await page.getByRole('button', { name: 'Cancel' }).click();
  listServer.close();
  console.log('ok: public server list with live ping and prefilled add');

  // Server menus are titled with the server's name
  await page.locator('.rail .tile').first().click({ button: 'right' });
  await page.locator('.menu .head', { hasText: 'Test Server' }).waitFor();
  await page.keyboard.press('Escape');

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
  assert.ok((await soundLog()).includes('mute'), 'mute sound');

  // Sound pack in TeamSpeak 3 format: settings.ini maps events to files exactly
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Sounds' }).click();
  // Real 16-bit PCM WAVs (a short tone), like the files in a TeamSpeak pack
  const wav = (name: string) => {
    const rate = 22050, n = rate / 10, b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2);
    return { name, mimeType: 'audio/wav', buffer: b };
  };
  const ini = { name: 'settings.ini', mimeType: 'text/plain', buffer: Buffer.from([
    '[soundfiles]',
    'SOUND_CAPTURE_MUTED    = play("mic_muted.wav")',
    'CHAT_RECEIVED_MESSAGE_CHANNEL = play("chat_message_inbound.wav")',
    'CHAT_RECEIVED_MESSAGE_CLIENT  = play("chat_message_inbound.wav")',
    'CLIENT_SWITCHED_TO_CURRENT_CHANNEL_APPEARS = play("${clientType}_switched_tocurrentchannel.wav")',
    'CHANNEL_CREATED_BY_OTHER = '
  ].join('\n')) };
  const packChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load sound pack...' }).click();
  await (await packChooser).setFiles([ini, wav('mic_muted.wav'), wav('chat_message_inbound.wav'),
    wav('blue_switched_tocurrentchannel.wav'), wav('neutral_switched_tocurrentchannel.wav'), wav('extra.wav')]);
  const rep = page.locator('.report');
  for (const line of ['mic_muted.wav: You muted', 'chat_message_inbound.wav: Channel message', 'chat_message_inbound.wav: Direct message',
    'neutral_switched_tocurrentchannel.wav: Someone joined your channel']) await rep.getByText(line).waitFor();
  await rep.getByText(/Not matched.*extra\.wav/).waitFor();
  assert.ok(!(await rep.textContent())!.includes('blue_switched_tocurrentchannel.wav: '), 'neutral variant preferred');
  // A custom sound really plays (blob URL, allowed by the security policy) and survives a reload
  const before = (await soundLog()).filter(x => x === 'mute').length;
  await page.locator('.events li', { hasText: 'You muted' }).getByRole('button', { name: /^Play/ }).click();
  await page.waitForFunction(n => ((window as any).__mumh5Sounds ?? []).filter((x: string) => x === 'mute').length > n, before);
  assert.equal(await page.getByText(/^Could not play/).count(), 0, 'no playback errors');
  await page.getByRole('button', { name: 'Reset all to built-in' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: TeamSpeak sound pack mapped from settings.ini');

  if (process.env.UPLOAD_HOST) {
    const png = path.join(userData, 'gradient.png');
    writeFileSync(png, testPng());
    const gotUpload = new Promise<string>(res => bob.on('text', m => res(m.html)));
    await page.locator('.chat .composer input[type=file]').first().setInputFiles(png);
    const up = await within(gotUpload, 'upload message');
    assert.match(up, /<a href="http[^"]+\/cu\/[A-Za-z0-9_-]{12}\/gradient\.png">gradient\.png<\/a>/);
    assert.match(up, /<br\/><img src="data:image\/jpeg;base64,[^"]+"\/>$/);
    assert.ok(up.length > 5000, `preview should exceed the text limit (${up.length})`);
    await page.locator('.embed img').waitFor();
    await page.waitForFunction(() => (document.querySelector('.embed img') as HTMLImageElement)?.naturalWidth === 400);
    console.log('ok: upload posted with vanilla thumbnail, embed loads for mumh5');

    // Link previews through the upload host: fetched and image-proxied by f0ckm (needs internet)
    bob.sendText({ channels: [0] }, '<a href="https://github.com/mumble-voip/mumble">https://github.com/mumble-voip/mumble</a>');
    const gh = page.locator('.msg', { hasText: 'github.com/mumble-voip' }).locator('.card');
    await gh.locator('.title', { hasText: /mumble/i }).waitFor({ timeout: 15000 });
    await gh.locator('.site', { hasText: 'GitHub' }).waitFor();
    const ghImg = gh.locator('img');
    assert.ok((await ghImg.getAttribute('src'))!.startsWith(`${process.env.UPLOAD_HOST}/api/chat/preview/image?`), 'image proxied by the upload host');
    await page.waitForFunction(() => ((document.querySelector('.card img') as HTMLImageElement)?.naturalWidth ?? 0) > 0, null, { timeout: 15000 });
    console.log('ok: link preview through the upload host');

    // Direct mode: this computer fetches the preview itself
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Chat and files' }).click();
    await page.getByLabel('Link previews').selectOption('direct');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    bob.sendText({ channels: [0] }, '<a href="https://www.mumble.info/">https://www.mumble.info/</a>');
    const direct = page.locator('.msg', { hasText: 'www.mumble.info' }).locator('.card');
    await direct.locator('.title').waitFor({ timeout: 15000 });
    assert.ok(!(await direct.locator('img').getAttribute('src').catch(() => ''))?.includes('/api/chat/preview/image'), 'direct mode does not use the proxy');
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Chat and files' }).click();
    await page.getByLabel('Link previews').selectOption('host');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    console.log('ok: link preview fetched directly');

    // Types the upload host does not allow are refused before uploading
    const txt = path.join(userData, 'notes.txt');
    writeFileSync(txt, 'plain text');
    let leaked = false;
    const off = bob.on('text', () => { leaked = true; });
    await page.locator('.chat .composer input[type=file]').first().setInputFiles(txt);
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
  // Per-person volume lives in the menu
  await page.getByRole('slider', { name: 'Volume' }).fill('1.5');
  await page.locator('.menu .slider-label', { hasText: '150%' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.sidebar .user', { hasText: 'bob' }).click({ button: 'right' });
  assert.equal(await page.getByRole('slider', { name: 'Volume' }).inputValue(), '1.5', 'volume remembered');
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
  // Live: the online time advances while the dialog is open
  const onlineText = () => info.locator('dt', { hasText: 'Online for' }).locator('xpath=following-sibling::dd[1]').textContent();
  const t1 = await onlineText();
  await page.waitForTimeout(2200);
  assert.notEqual(await onlineText(), t1, 'online time ticks live');
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
    await page.locator('.panel .composer [contenteditable]').fill('side hello');
    await page.locator('.panel .composer [contenteditable]').press('Enter');
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

    // The channel list is resizable too (from its right edge)
    const sideBox = (await page.locator('aside.sidebar').boundingBox())!;
    const sideHandle = (await page.locator('aside.sidebar .resize').boundingBox())!;
    await page.mouse.move(sideHandle.x + 4, sideHandle.y + 300);
    await page.mouse.down();
    await page.mouse.move(sideHandle.x + 104, sideHandle.y + 300, { steps: 5 });
    await page.mouse.up();
    const sideAfter = (await page.locator('aside.sidebar').boundingBox())!;
    assert.ok(Math.abs(sideAfter.width - (sideBox.width + 100)) < 6, `sidebar resized ${sideBox.width} -> ${sideAfter.width}`);
    await page.locator('aside.sidebar .resize').dblclick();
    console.log('ok: channel list resizable');

    // ─── Channel management and permissions, done by alice through the UI ───
    // Give alice (by certificate hash) full rights first, as SuperUser. Not @all: Write
    // overrides denies, and bob must stay an ordinary user for the permission checks.
    const aliceHash = [...admin.users.values()].find(u => u.name === 'alice')!.hash;
    const rootAcl = new Promise<any>(res => admin.on('acl', a => { if (a.channelId === 0) res(a); }));
    admin.queryAcl(0);
    const ra = await within(rootAcl, 'root ACL');
    ra.acls.push({ applyHere: true, applySubs: true, inherited: false, userId: null, group: `$${aliceHash}`, grant: 0x1f0fff, deny: 0 });
    admin.saveAcl(ra);
    await page.waitForTimeout(1500);
    const chByName = (n: string) => [...bob.channels.values()].find(c => c.name === n);
    const bobSees = (label: string, cond: () => boolean) => within(new Promise<void>(res => {
      if (cond()) return res();
      const off = bob.on('channel', () => { if (cond()) { off(); res(); } });
      const off2 = bob.on('channelRemove', () => { if (cond()) { off2(); res(); } });
    }), label);

    // Create from the context menu on free space in the channel list
    const listBox = (await page.locator('.sidebar .scroll').boundingBox())!;
    await page.mouse.click(listBox.x + listBox.width / 2, listBox.y + listBox.height - 20, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Create channel...' }).click();
    await page.getByLabel('Name').fill('Team');
    await page.getByRole('button', { name: 'Create channel' }).click();
    await page.locator('.channel .name', { hasText: 'Team' }).waitFor();
    console.log('ok: channel created');

    // Edit name and position
    await page.locator('.channel .name', { hasText: 'Team' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit channel...' }).click();
    await page.getByLabel('Name').fill('Team Room');
    await page.getByLabel('Position').fill('7');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await bobSees('rename', () => chByName('Team Room')?.position === 7);
    const teamId = chByName('Team Room')!.id;
    console.log('ok: channel edited');

    // Permissions: deny Enter for everyone
    await page.locator('.channel .name', { hasText: 'Team Room' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Permissions...' }).click();
    const dlg = page.getByRole('dialog', { name: 'Channel: Team Room' });
    await dlg.getByRole('listbox', { name: 'Rules' }).waitFor();
    await dlg.getByRole('button', { name: 'Add', exact: true }).click();
    await dlg.getByLabel('Deny Enter').check();
    if (shots) await page.screenshot({ path: path.join(shots, 'acl.png') });
    // Group with a registered member
    await dlg.getByRole('tab', { name: 'Groups' }).click();
    await dlg.getByLabel('New group name').fill('mods');
    await dlg.getByRole('button', { name: 'Add', exact: true }).click();
    await dlg.getByLabel('Member name').fill('SuperUser');
    await dlg.getByRole('button', { name: 'Add member' }).click();
    await dlg.locator('.members', { hasText: 'SuperUser' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'groups.png') });
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(1500);
    const deniedEnter = new Promise<number>(res => bob.on('permissionDenied', d => res(d.permission)));
    bob.joinChannel(teamId);
    assert.equal(await within(deniedEnter, 'enter denied'), 0x4);
    const teamAcl = new Promise<any>(res => admin.on('acl', a => { if (a.channelId === teamId) res(a); }));
    admin.queryAcl(teamId);
    const ta = await within(teamAcl, 'team ACL');
    assert.deepEqual(ta.groups.find((g: any) => g.name === 'mods')?.add, [0]);
    console.log('ok: permissions and groups saved and enforced');

    // Drag the channel into Games, and bob into Lobby
    await page.locator('.channel .name', { hasText: 'Team Room' }).dragTo(page.locator('.channel .name', { hasText: 'Games' }));
    const gamesId = chByName('Games')!.id;
    await bobSees('channel moved', () => chByName('Team Room')?.parent === gamesId);
    await page.locator('.sidebar .user', { hasText: 'bob' }).dragTo(page.locator('.channel', { hasText: 'Lobby' }).first());
    await within(new Promise<void>(res => {
      if (bob.self?.channelId === lobby.id) return res();
      bob.on('user', u => { if (u.session === bob.session && u.channelId === lobby.id) res(); });
    }), 'bob moved');
    bob.joinChannel(0);
    console.log('ok: drag and drop moves channels and people');

    // Delete (Team Room is now inside Games, which stays collapsed while empty)
    await page.locator('.channel', { hasText: 'Games' }).first().getByRole('button', { name: 'Expand' }).click();
    await page.locator('.channel .name', { hasText: 'Team Room' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete channel...' }).click();
    await page.getByRole('button', { name: 'Delete channel' }).click();
    await bobSees('deleted', () => !chByName('Team Room'));
    console.log('ok: channel deleted');
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
  await page.locator('.chat .composer input[type=file]').first().setInputFiles(big);
  const inline = await within(gotInline, 'inline image', 15000);
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
  assert.ok((await soundLog()).includes('userConnected'), 'sound when someone connects into your channel');

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

  // Narrow window: voice channel as tiles, speaking lights up the tile
  await page.setViewportSize({ width: 420, height: 800 });
  const stage = page.getByRole('region', { name: 'Voice channel' });
  const bobTile = stage.locator('.tile', { hasText: 'bob' });
  await bobTile.waitFor();
  const echo2 = packets.map((p, i) => encodeVoice({ target: 0, frame: 5000 + i * 2, opus: p.opus, last: i === packets.length - 1 }, bob.protobufVoice));
  const pump2 = setInterval(() => { const pk = echo2.shift(); if (pk) bob.sendVoiceTunnel(pk); }, 20);
  await page.locator('.stage .tile.talking', { hasText: 'bob' }).waitFor({ timeout: 3000 });
  clearInterval(pump2);
  await page.setViewportSize({ width: 1280, height: 800 });
  await stage.waitFor({ state: 'detached' }); // wide layouts use the member list instead
  console.log('ok: voice tiles on small windows show who is talking');

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

  // Self-registration from the right-click menu on yourself; the profile shows no badge either way
  const meRow = page.locator('.sidebar .user.self');
  await meRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Register on this server' }).click();
  await meRow.locator('.reg').waitFor();
  await meRow.click({ button: 'right' });
  assert.equal(await page.getByRole('menuitem', { name: 'Register on this server' }).count(), 0, 'no register item once registered');
  await page.keyboard.press('Escape');
  console.log('ok: registered on the server');

  // Kicked: the reason is shown with a Reconnect button
  if (admin) {
    const me = [...admin.users.values()].find(u => u.name === newName)!;
    admin.kick(me.session, 'testing kicks');
    const card = page.locator('.ended');
    await card.getByText('You were kicked by SuperUser').waitFor();
    await card.getByText('testing kicks').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'kicked.png') });
    await card.getByRole('button', { name: 'Reconnect' }).click();
    await page.locator('.sidebar .status', { hasText: 'Connected' }).waitFor();
    assert.equal(await card.count(), 0);
    console.log('ok: kick shows the reason and reconnects');
  }

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
    // Small windows show the voice channel as tiles above the chat
    const stage = page.getByRole('region', { name: 'Voice channel' });
    await stage.locator('.tile', { hasText: 'bob' }).waitFor();
    await stage.getByRole('button', { name: /^(Mute|Unmute)$/ }).waitFor();
    await page.screenshot({ path: path.join(shots, 'narrow-stage.png') });
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
