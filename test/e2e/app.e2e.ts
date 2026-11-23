// Drives the built Electron app against a real Mumble server, with a headless second client.
//   npm run build && MUMBLE_TEST_HOST=localhost:64739 npm run test:e2e
// Optional: E2E_INTERNET=1 to also test link previews (fetches github.com), SHOTS_DIR to save screenshots.
import { _electron as electron, type Locator } from 'playwright-core';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { zipSync } from 'fflate';
import { readAudioPack } from '../../src/core/audio-pack.ts';
import { createCodec } from '../../src/core/proto.ts';
import { encodeVoice, decodeVoice, type VoicePacket } from '../../src/core/voice-packet.ts';
import { MumbleClient, PERM, type ChannelAcl } from '../../src/core/client.ts';
import { channelPassword, withPassword } from '../../src/core/channel-password.ts';
import type { Transport } from '../../src/core/transport.ts';
import { openTls } from '../../electron/tls-transport.ts';
import { generateIdentity } from '../../electron/identity.ts';
import { byOrder } from '../../src/core/channel-order.ts';
import { encodePoke, decodePoke } from '../../src/core/poke.ts';
import { REACT_DATA_ID, decodeReact, encodeReact, messageRef, type ReactSignal } from '../../src/core/reactions.ts';
import { TEXT, TEXT_DATA_ID, TEXT_MARK, TextAssembler, encodeText, parseMsg, parseHistory } from '../../src/core/text-signal.ts';
import {
  FILE, FILE_DATA_ID, FileAssembler, Sender, pump as pumpPieces, announce, takeFiles, encodeFileSignal, isPiece, parsePiece, decode15, encode15,
  pieceBytes, pieceCount, pieceSize, pieceForm, pieceMessage, fromRanges, sha256, rootHash
} from '../../src/core/file-transfer.ts';

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
  // Fake microphone (a beeping tone) and auto-granted permission for the voice tests; nothing reaches the speakers
  args: [root, `--user-data-dir=${userData}`, '--ozone-platform=x11', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-audio-output'],
  env: env as Record<string, string>
});
// The update check asks GitHub; answer for it, as if the release had three newer commits
const updateAsks: string[] = [];
await app.context().route('https://api.github.com/**', route => {
  updateAsks.push(route.request().url());
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ status: 'ahead', ahead_by: 3, behind_by: 0 }) });
});
const bob = await headless('bob');
// SuperUser can create channels; needs MUMBLE_SUPERUSER_PASSWORD on the test server
const admin = process.env.MUMBLE_SUPERUSER_PASSWORD ? await headless('SuperUser', process.env.MUMBLE_SUPERUSER_PASSWORD) : null;
// The text channel made further down; checked again after the app reconnects
let notesId: number | null = null;
try {
  const page = await app.firstWindow();
  page.on('console', m => { if (m.type() === 'error') console.log('[renderer]', m.text()); });
  await page.setViewportSize({ width: 1280, height: 800 });

  // First start: identity setup wizard
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor();
  await page.getByRole('button', { name: /Create a new identity/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('alice');
  assert.ok(await page.getByLabel('Use this name as my username').isChecked());
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor({ state: 'detached' });
  console.log('ok: identity wizard creates an identity');

  // Stacked is the default layout; the steps below were written for Modern
  await page.locator('.app.stacked').waitFor();

  // The server list starts hidden; the button in the top left corner docks it beside the content
  const serverButton = page.getByRole('button', { name: 'Show servers' });
  assert.equal(await page.locator('.rail').count(), 0, 'server list hidden');
  const corner = (await serverButton.boundingBox())!;
  assert.ok(corner.x < 16 && corner.y < 16, 'button in the top left corner');
  await serverButton.click();
  await page.locator('.rail').waitFor();
  assert.deepEqual(await page.locator('.rail .tile').first().boundingBox(), corner, 'first tile exactly where the button was');
  const railBox = (await page.locator('.rail').boundingBox())!;
  const contentBox = (await page.locator('section.home').boundingBox())!;
  assert.ok(contentBox.x >= railBox.x + railBox.width, 'the list sits beside the content, not over it');
  assert.equal(await serverButton.count(), 0, 'no button while the list is open');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).railHidden), false);
  await page.getByRole('button', { name: 'Hide server list' }).click();
  await page.locator('.rail').waitFor({ state: 'detached' });
  await serverButton.click();
  await page.locator('.rail').waitFor();
  console.log('ok: server list hides behind the current server');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const backgroundDesign = page.getByRole('group', { name: 'Background design' });
  await backgroundDesign.getByRole('button', { name: 'Grid', exact: true }).click();
  await page.locator('.home > .background-art[data-design="grid"]').waitFor();
  // The own pipette is for Wayland only, where Chromium's picks from the wrong place; the test display is X11
  assert.equal(await page.getByRole('button', { name: 'Pick the design color from the screen' }).count(), 0);
  await backgroundDesign.getByRole('button', { name: 'None', exact: true }).click();
  assert.equal(await page.locator('.background-art').count(), 0);
  console.log('ok: background design applies and clears from Appearance');
  // A heading resets the settings below it, the button at the end the whole tab, both after asking
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
  const confirmReset = () => page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await backgroundDesign.getByRole('button', { name: 'Dots', exact: true }).click();
  await page.locator('.home > .background-art[data-design="dots"]').waitFor();
  await page.getByRole('button', { name: 'Reset background', exact: true }).click();
  await confirmReset();
  assert.equal(await page.locator('.background-art').count(), 0);
  assert.equal(await theme(), 'light', 'other headings keep their settings');
  assert.equal(await page.getByRole('button', { name: 'Reset background', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Reset appearance', exact: true }).click();
  await confirmReset();
  assert.equal(await theme(), 'dark');
  assert.equal(await page.evaluate(() => 'theme' in JSON.parse(localStorage.getItem('mumh5.settings')!)), false, 'defaults are not saved');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).railHidden), false, 'window state is not reset');
  console.log('ok: appearance resets per heading and as a whole');
  // Rounded corners are opt-in per group, and square again after a reset
  const closeSettingsIcon = page.locator('.modal header .icon-btn').first();
  const radius = (el: typeof closeSettingsIcon) => el.evaluate(b => getComputedStyle(b).borderTopLeftRadius);
  assert.equal(await radius(closeSettingsIcon), '0px', 'square by default');
  await page.getByRole('slider', { name: 'Icon buttons' }).fill('10');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.modal header .icon-btn')!).borderTopLeftRadius === '10px');
  assert.equal(await radius(page.locator('.modal').first()), '0px', 'other groups stay square');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).corners), { icons: 10 });
  const allCorners = page.getByRole('group', { name: 'All elements' });
  await allCorners.getByRole('button', { name: 'Round', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.modal')!).borderTopLeftRadius === '24px');
  await page.getByRole('button', { name: 'Reset rounded corners', exact: true }).click();
  await confirmReset();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.modal header .icon-btn')!).borderTopLeftRadius === '0px');
  assert.equal(await page.evaluate(() => 'corners' in JSON.parse(localStorage.getItem('mumh5.settings')!)), false, 'square is not saved');
  console.log('ok: rounded corners apply per group and reset');
  // Save applies a field still being typed in and leaves Settings open
  await page.getByRole('tab', { name: 'Chat and files' }).click();
  const embedField = page.getByLabel('Load media at once from these hosts');
  await embedField.fill('corners.example');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.foot-note', { hasText: 'Saved' }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).embedHosts), ['corners.example']);
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  await embedField.fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  console.log('ok: save applies changes and keeps settings open');
  // Settings in a window of its own changes the app beside it
  const [settingsPopup] = await Promise.all([app.waitForEvent('window'), page.getByRole('button', { name: 'Open in a new window' }).click()]);
  await settingsPopup.getByRole('dialog', { name: 'Settings' }).waitFor();
  await settingsPopup.getByRole('tab', { name: 'Appearance', selected: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Settings' }).count(), 0, 'moved out of the main window');
  assert.ok(await settingsPopup.evaluate(() => {
    const r = document.querySelector('.modal')!.getBoundingClientRect();
    return r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight;
  }), 'settings fills its window');
  const rootCorner = (px: string) => page.waitForFunction(v => getComputedStyle(document.documentElement).getPropertyValue('--r-icons').trim() === v, px);
  await settingsPopup.getByRole('slider', { name: 'Icon buttons' }).fill('6');
  await rootCorner('6px');
  await settingsPopup.waitForFunction(() => getComputedStyle(document.querySelector('.modal header .icon-btn')!).borderTopLeftRadius === '6px');
  // The question of a reset is asked in that window
  await settingsPopup.getByRole('button', { name: 'Reset rounded corners', exact: true }).click();
  await settingsPopup.getByRole('button', { name: 'Reset', exact: true }).click();
  await rootCorner('0px');
  // The Settings button does not open a second copy
  await page.getByTitle('Settings').click();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('dialog', { name: 'Settings' }).count(), 0, 'no second settings');
  await Promise.all([settingsPopup.waitForEvent('close'), settingsPopup.getByRole('button', { name: 'Done', exact: true }).click()]);
  await page.getByTitle('Settings').click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  console.log('ok: settings in a new window apply to the app');
  await page.getByRole('radio', { name: 'Modern' }).click();
  await page.getByRole('tab', { name: 'Sounds' }).click();
  // Audio packs: a fresh profile is quiet, and an imported pack joins the library
  const soundsIdle = () => page.waitForFunction(() => !!document.querySelector('fieldset:not([disabled])'));
  await soundsIdle();
  assert.equal(await page.locator('.events input:checked').count(), 3, 'quiet defaults');
  const packSelect = page.getByLabel('Audio pack', { exact: true });
  const standardClips = readAudioPack(readFileSync(new URL('../../src/assets/default-audio-pack.zip', import.meta.url)));
  const e2ePack = zipSync({ 'AudioNotification/SelfMute.wav': standardClips.get('AudioNotification/SelfUnmute.wav')! });
  await page.getByRole('checkbox', { name: 'You deafened', exact: true }).check();
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'e2e-pack.zip', mimeType: 'application/zip', buffer: Buffer.from(e2ePack) });
  await page.locator('.help strong').getByText('e2e-pack.zip', { exact: true }).waitFor();
  await soundsIdle();
  assert.equal(await packSelect.locator('option').count(), 2);
  assert.equal(await page.locator('.events input:checked').count(), 4, 'importing keeps event choices');
  await packSelect.selectOption('');
  await page.locator('.help strong').getByText('Chatterbox female (standard)', { exact: true }).waitFor();
  await soundsIdle();
  await packSelect.selectOption({ label: 'e2e-pack.zip' });
  await page.locator('.help strong').getByText('e2e-pack.zip', { exact: true }).waitFor();
  await soundsIdle();
  await page.getByRole('button', { name: 'Remove pack', exact: true }).click();
  await page.locator('.help strong').getByText('Chatterbox female (standard)', { exact: true }).waitFor();
  await soundsIdle();
  assert.equal(await packSelect.locator('option').count(), 1);
  await page.getByRole('button', { name: 'Use quiet defaults' }).click();
  assert.equal(await page.locator('.events input:checked').count(), 3);
  console.log('ok: audio pack import, library, switching, removal and quiet defaults');
  // The tests below exercise optional sounds.
  for (const name of ['You connected', 'Channel message', 'You muted', 'You unmuted', 'Someone connected into your channel']) {
    await page.getByRole('checkbox', { name, exact: true }).check();
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.app.side').waitFor();
  console.log('ok: stacked by default');

  // Start screen: the saved servers instead of channels and chat, identities one click away
  await page.getByRole('region', { name: 'Servers' }).getByRole('heading', { name: 'Servers' }).waitFor();
  assert.equal(await page.locator('.chat').count(), 0, 'no chat while not connected');
  assert.equal(await page.locator('.sidebar').count(), 0, 'no channel list while not connected');
  await page.getByRole('button', { name: 'Manage identities' }).click();
  await page.getByRole('tab', { name: 'Identities', selected: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: start screen, manage identities');

  // Mute and deafen are there without a connection
  const me = page.locator('.me');
  await me.getByText('Not connected').waitFor();
  assert.ok(await me.getByRole('button', { name: 'Server information' }).isDisabled());
  await me.getByRole('button', { name: 'Deafen', exact: true }).click();
  await me.getByRole('button', { name: 'Unmute', exact: true }).waitFor();
  await me.getByText('Deafened').waitFor();
  await me.getByRole('button', { name: 'Unmute', exact: true }).click();
  await me.getByRole('button', { name: 'Deafen', exact: true }).waitFor();
  await me.getByRole('button', { name: 'Mute', exact: true }).waitFor();
  console.log('ok: mute and deafen shown while disconnected');
  // Muted before connecting: applied when connected, without the mute sound
  await me.getByRole('button', { name: 'Mute', exact: true }).click();
  await me.getByRole('button', { name: 'Unmute', exact: true }).waitFor();

  // Add and connect to the server
  await page.getByTitle('Add a server').click();
  await page.getByLabel('Address').fill(host);
  // The right-click menu opens at the pointer, also with the page zoomed
  await page.evaluate(() => addEventListener('contextmenu', e => { (window as any).__menuAt = [e.clientX, e.clientY]; }, true));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
  await page.waitForTimeout(200);
  await page.getByLabel('Address').click({ button: 'right' });
  await page.locator('.menu[role=menu]').waitFor();
  const [menuAt, pointerAt] = await page.evaluate(() => {
    const r = document.querySelector('.menu[role=menu]')!.getBoundingClientRect();
    return [[r.left, r.top], (window as any).__menuAt as number[]];
  });
  assert.ok(Math.abs(menuAt[0] - pointerAt[0]) <= 1 && Math.abs(menuAt[1] - pointerAt[1]) <= 4, `menu ${menuAt} at pointer ${pointerAt}`);
  await page.locator('.catcher').click({ position: { x: 5, y: 5 } });
  await page.locator('.menu[role=menu]').waitFor({ state: 'detached' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await page.waitForTimeout(200);
  console.log('ok: text menu opens at the pointer when zoomed');
  await page.getByLabel('Port').fill(port);
  assert.equal(await page.getByLabel('Username').inputValue(), 'alice', 'username suggested from the identity');
  await page.getByLabel('Label').fill('Test Server');
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.getByText(/Connected/).first().waitFor();
  console.log('ok: connected');
  // The chat's title bar is solid, so a background starts under it, as under the voice tiles
  const [chatBg, headerBg] = await page.locator('section.chat > header').evaluate(el =>
    [getComputedStyle(el.parentElement!).backgroundColor, getComputedStyle(el).backgroundColor]);
  assert.equal(headerBg, chatBg);
  await within(new Promise<void>(res => { const check = () => { const u = [...bob.users.values()].find(x => x.name === 'alice'); if (u?.selfMute) res(); else setTimeout(check, 100); }; check(); }), 'mute applied on connect');
  await page.waitForTimeout(800);
  const connectSounds = await page.evaluate(() => [...((window as any).__mumh5Sounds ?? [])] as string[]);
  assert.ok(!connectSounds.some(x => ['mute', 'unmute', 'deafen', 'undeafen'].includes(x)), `no mute sounds on connect: ${connectSounds}`);
  await page.locator('.me').getByRole('button', { name: 'Unmute', exact: true }).click();
  await page.waitForFunction(() => ((window as any).__mumh5Sounds ?? []).includes('unmute'));
  console.log('ok: mute chosen before connecting applies without a sound; unmuting still sounds');

  // Bob is listed in the channel tree
  await page.locator('.sidebar').getByText('bob').waitFor();
  console.log('ok: sees bob');

  // The fake microphone is a pure tone, which DeepFilterNet rightly removes as noise. The default
  // is checked here; the voice steps below use the browser's filter so the tone gets through.
  await page.getByTitle('Settings').click();
  assert.equal(await page.locator('#v-noise').inputValue(), 'deepfilter');
  await page.locator('[data-denoise="on"]').waitFor({ timeout: 30000 });
  await page.locator('#v-noise').selectOption('browser');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: DeepFilterNet is the default and loads');

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
  // Collect only after the switch: the fake microphone's beep often has voice activity sending
  // already, and switching modes ends that transmission with a terminator packet
  await setMode('Always on');
  const stream = collect(25);
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
  const emptyScroll = await page.getByLabel('Message').evaluate(e => e.scrollHeight - e.clientHeight);
  assert.ok(emptyScroll <= 0, `empty composer scrolls by ${emptyScroll}px`);
  await page.getByLabel('Message').fill('hello <from> alice\nsecond line https://example.com/x');
  await page.getByLabel('Message').press('Enter');
  const html = await within(gotText, 'channel text');
  assert.equal(html, 'hello &lt;from&gt; alice<br/>second line <a href="https://example.com/x">https://example.com/x</a>');
  console.log('ok: bob received channel text');

  // Up brings back the last sent message, Down returns to an empty field
  await page.getByLabel('Message').press('ArrowUp');
  assert.match(await page.getByLabel('Message').innerText(), /^hello <from> alice\nsecond line/);
  await page.getByLabel('Message').press('ArrowDown');
  assert.equal((await page.getByLabel('Message').innerText()).trim(), '');
  console.log('ok: Up recalls the last sent message');

  // Bob -> channel, rendered sanitized
  bob.sendText({ channels: [0] }, 'hi alice <b>bold</b><script>window.pwned=1</script><img src="https://evil.example/t.png">');
  await page.locator('.msg', { hasText: 'hi alice' }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
  assert.equal(await page.locator('.msg b', { hasText: 'bold' }).count(), 1);
  assert.equal(await page.locator('img[src^="https://evil"]').count(), 0);
  // The full date appears at the right edge while the pointer is on a message
  const anyMsg = page.locator('.chat .msg').last();
  const stamp = anyMsg.locator('.stamp');
  assert.equal(await stamp.evaluate(el => getComputedStyle(el).visibility), 'hidden');
  await anyMsg.hover();
  assert.equal(await stamp.evaluate(el => getComputedStyle(el).visibility), 'visible');
  assert.match(await stamp.innerText(), /\d{4}.*\d{1,2}:\d{2}:\d{2}/);
  // The reaction button comes after it, so the row of tools is what touches the edge
  const gap = await anyMsg.evaluate(el => el.getBoundingClientRect().right - el.querySelector('.tools')!.getBoundingClientRect().right);
  assert.ok(gap >= 0 && gap < 20, `message tools at the right edge: ${gap}`);
  const [stampEnd, reactStart] = await anyMsg.evaluate(el => [el.querySelector('.stamp')!.getBoundingClientRect().right, el.querySelector('.tools .react')!.getBoundingClientRect().left]);
  assert.ok(stampEnd <= reactStart, `stamp ${stampEnd} before the reaction button ${reactStart}`);
  await page.mouse.move(5, 5);
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

  // Emoji picker: the whole palette, search and skin tone, inserted where the caret was
  await page.evaluate(() => localStorage.removeItem('mumh5.emojiTone'));
  const emojiButton = page.locator('.chat .composer').getByRole('button', { name: 'Emoji', exact: true });
  const emojiPop = page.getByRole('dialog', { name: 'Emoji' });
  await composer.fill('before after');
  await composer.press('Home');
  for (let i = 0; i < 7; i++) await composer.press('ArrowRight');
  await emojiButton.click();
  await emojiPop.locator('.emoji-cell').first().waitFor();
  assert.ok(await emojiPop.locator('.emoji-cell').count() > 1900, 'the full palette is there');
  await emojiPop.getByRole('button', { name: 'Flags', exact: true }).click();
  await emojiPop.locator('[data-group="flags"] .emoji-cell').first().waitFor();
  for (let i = 0; i < 3; i++) await emojiPop.getByRole('button', { name: /^Skin tone/ }).click();
  await emojiPop.getByLabel('Search emoji').fill('thumbs up');
  await emojiPop.locator('.emoji-cell').first().click();
  await emojiPop.waitFor({ state: 'detached' });
  const wantEmoji = 'before \u{1F44D}\u{1F3FD}after';
  const gotEmoji = new Promise<string>(res => bob.on('text', m => { if (m.html.includes(wantEmoji)) res(m.html); }));
  await composer.press('Enter');
  await within(gotEmoji, 'message with an emoji');
  await emojiButton.click();
  await emojiPop.waitFor();
  await page.keyboard.press('Escape');
  await emojiPop.waitFor({ state: 'detached' });
  await page.evaluate(() => localStorage.removeItem('mumh5.emojiTone'));
  console.log('ok: emoji picker with the full palette, search and skin tone');

  // Reactions: plugin data to the people in the channel, naming the message by its text, author and age
  const reactHtml = 'react to this, alice';
  const reactMsg = page.locator('.chat .msg', { hasText: reactHtml });
  const reactSignals: ReactSignal[] = [];
  const offReact = bob.on('pluginData', (_from, id, data) => { const sig = id === REACT_DATA_ID ? decodeReact(data) : null; if (sig) reactSignals.push(sig); });
  const nextReact = (n: number) => within(new Promise<ReactSignal>(res => { const check = () => (reactSignals.length > n ? res(reactSignals[n]) : setTimeout(check, 50)); check(); }), 'reaction signal');
  bob.sendText({ channels: [0] }, reactHtml);
  await reactMsg.waitFor();
  await reactMsg.hover();
  await reactMsg.getByRole('button', { name: 'Add reaction' }).first().click();
  await emojiPop.getByLabel('Search emoji').fill('thumbs up');
  await emojiPop.locator('.emoji-cell').first().click();
  await emojiPop.waitFor({ state: 'detached' });
  const thumbs = '\u{1F44D}', party = '\u{1F389}';
  const added = await nextReact(0);
  assert.deepEqual({ ...added, a: 0 }, { c: 0, r: messageRef(reactHtml), s: bob.session, a: 0, e: thumbs, on: true });
  const thumbsChip = reactMsg.locator('.reaction', { hasText: thumbs });
  await reactMsg.locator('.reaction.mine', { hasText: `${thumbs}1` }).waitFor();
  // The new reaction row must not leave the chat scrolled above the bottom
  const reactGap = await page.locator('.chat .list').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
  assert.ok(reactGap < 4, `chat stays at the bottom after a reaction (reactGap ${reactGap})`);
  // Bob reacts to the same message, once with the same emoji and once with another
  const fromBob = (e: string) => bob.sendPluginData([aliceSession()], REACT_DATA_ID, encodeReact({ c: 0, r: messageRef(reactHtml), s: bob.session, a: 1, e, on: true }));
  fromBob(thumbs);
  fromBob(party);
  await reactMsg.locator('.reaction.mine', { hasText: `${thumbs}2` }).waitFor();
  await reactMsg.locator('.reaction:not(.mine)', { hasText: `${party}1` }).waitFor();
  assert.equal(await thumbsChip.getAttribute('title'), null);
  await thumbsChip.hover();
  const reactors = page.locator('.reactors');
  await reactors.waitFor();
  assert.deepEqual(await reactors.locator('li').allTextContents(), ['You', 'bob']);
  await page.keyboard.press('Escape');
  await reactors.waitFor({ state: 'detached' });
  // A click on your own takes it back
  await thumbsChip.click();
  assert.equal((await nextReact(1)).on, false);
  await reactMsg.locator('.reaction:not(.mine)', { hasText: `${thumbs}1` }).waitFor();
  offReact();
  console.log('ok: reactions sent, received and taken back');

  // Code: ```fences``` in the message box (Enter inside one adds a line), sent as <pre> with the language as title
  const gotFence = new Promise<string>(res => bob.on('text', m => { if (m.html.includes('def f')) res(m.html); }));
  await composer.click();
  await page.keyboard.type('look `inline` here');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('```py');
  for (const line of ['def f(x):', '    return x < 1', '```']) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Enter');
  assert.equal(await within(gotFence, 'fenced code'), 'look <code>inline</code> here<pre title="python">def f(x):\n    return x &lt; 1</pre>');
  const pyBlock = page.locator('.msg .code[data-lang="Python"]');
  await pyBlock.locator('.hljs-keyword', { hasText: 'def' }).waitFor();
  assert.equal(await pyBlock.locator('pre').innerText(), 'def f(x):\n    return x < 1');
  assert.equal(await page.locator('.msg code', { hasText: 'inline' }).count(), 1);
  // Copy button: the code alone, as text
  await pyBlock.getByRole('button', { name: 'Copy code' }).click();
  await pyBlock.locator('.copy.copied').waitFor();
  await composer.click({ button: 'right' });
  await menuItem('Paste').click();
  assert.equal(await composerText(), 'def f(x):\n    return x < 1');
  await composer.fill('');
  // From the desktop client's Markdown: <pre> with <br/>, no language; detected. Markup inside stays text.
  bob.sendText({ channels: [0] }, '<pre>#include &lt;stdio.h&gt;<br/>int main(void) { printf("hi"); return 0; }</pre>'
    + '<pre title="html">&lt;img src=x onerror="window.pwned=2"&gt;</pre><pre><button class="copy">x</button><span class="hljs-keyword">fake</span></pre>');
  const cBlock = page.locator('.msg .code[data-lang="C++"]');
  await cBlock.locator('.hljs-meta', { hasText: '#include' }).waitFor();
  assert.equal(await cBlock.locator('pre').innerText(), '#include <stdio.h>\nint main(void) { printf("hi"); return 0; }');
  const htmlBlock = page.locator('.msg .code[data-lang="HTML / XML"]');
  assert.equal(await htmlBlock.locator('pre').innerText(), '<img src=x onerror="window.pwned=2">');
  assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
  assert.equal(await page.locator('.msg .code[data-lang="Text"] pre').innerText(), 'xfake');
  assert.equal(await page.locator('.msg .code[data-lang="Text"] button, .msg .code[data-lang="Text"] .hljs-keyword').count(), 1, 'only our copy button');
  // The snippet dialog: language, highlighted while typing, Ctrl+Enter sends
  const gotSnippet = new Promise<string>(res => bob.on('text', m => { if (m.html.includes('fn main')) res(m.html); }));
  await page.locator('.chat .composer').getByRole('button', { name: 'Code snippet' }).click();
  const snippet = page.getByRole('dialog', { name: 'Code snippet' });
  await snippet.getByLabel('Language').selectOption('rust');
  await snippet.getByLabel('Code').fill('fn main() {\n    println!("hi");\n}');
  await snippet.locator('.hljs-keyword', { hasText: 'fn' }).waitFor();
  if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, 'code-dialog.png') }); }
  await snippet.getByLabel('Code').press('Control+Enter');
  assert.equal(await within(gotSnippet, 'snippet from the dialog'), '<pre title="rust">fn main() {\n    println!("hi");\n}</pre>');
  await snippet.waitFor({ state: 'detached' });
  await page.locator('.msg .code[data-lang="Rust"]').waitFor();
  // Long code scrolls inside its block; the language and copy button stay in view
  const lines = Array.from({ length: 60 }, (_, i) => `    total += step(${i})  # line ${i + 1}`);
  bob.sendText({ channels: [0] }, `<pre title="python">def run(step):\n    total = 0\n${lines.join('\n')}\n    return total</pre>`);
  const longBlock = page.locator('.msg .code[data-lang="Python"]', { hasText: 'line 60' });
  const longPre = longBlock.locator('pre');
  await longPre.waitFor();
  const longBox = await longPre.evaluate(el => ({ height: el.getBoundingClientRect().height, scroll: el.scrollHeight }));
  assert.ok(longBox.height <= 321 && longBox.scroll > longBox.height * 2, `long code capped and scrollable: ${JSON.stringify(longBox)}`);
  await longPre.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await longPre.getByText('line 60').waitFor({ state: 'visible' });
  await longBlock.getByRole('button', { name: 'Copy code' }).waitFor({ state: 'visible' });
  if (shots) {
    await page.screenshot({ path: path.join(shots, 'code-chat.png') });
    const was = await page.evaluate(() => { const t = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'snow'; return t; });
    await page.screenshot({ path: path.join(shots, 'code-chat-light.png') });
    await page.evaluate(t => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }, was);
  }
  console.log('ok: code snippets: fences, dialog, highlighting, detection, copy');

  // YouTube links are plain links by default
  bob.sendText({ channels: [0] }, 'watch <a href="https://youtu.be/dQw4w9WgXcQ?t=1m30s">https://youtu.be/dQw4w9WgXcQ?t=1m30s</a>');
  const ytMsg = page.locator('.msg', { hasText: 'watch' });
  await ytMsg.getByRole('link', { name: 'https://youtu.be/dQw4w9WgXcQ?t=1m30s' }).waitFor();
  assert.equal(await ytMsg.locator('.yt').count(), 0, 'no YouTube card by default');
  // Turned on, they become a click-to-play card; nothing loads from YouTube before the click
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Chat and files' }).click();
  await page.getByLabel('YouTube links').selectOption('click');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const card = ytMsg.locator('.yt');
  await card.getByText('from 1:30, click to play').waitFor();
  assert.equal(await card.locator('iframe').count(), 0);
  assert.equal(await card.locator('.facade').evaluate(el => getComputedStyle(el).backgroundImage), 'none', 'no thumbnail request in click mode');
  await card.locator('.facade').click();
  assert.equal(await card.locator('iframe').getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=90');
  console.log('ok: YouTube link plain by default, click-to-play when turned on');

  // Direct links to media: a card that loads nothing until clicked, or at once from a listed host
  const mediaHttp = await import('node:http');
  const linkedPic = testPng(300, 200);
  const clipWav = Buffer.alloc(44 + 8000);
  clipWav.write('RIFF', 0); clipWav.writeUInt32LE(36 + 8000, 4); clipWav.write('WAVEfmt ', 8); clipWav.writeUInt32LE(16, 16);
  clipWav.writeUInt16LE(1, 20); clipWav.writeUInt16LE(1, 22); clipWav.writeUInt32LE(8000, 24); clipWav.writeUInt32LE(8000, 28);
  clipWav.writeUInt16LE(1, 32); clipWav.writeUInt16LE(8, 34); clipWav.write('data', 36); clipWav.writeUInt32LE(8000, 40); clipWav.fill(128, 44);
  const mediaHits: string[] = [];
  const mediaServer = mediaHttp.createServer((req, res) => {
    mediaHits.push(req.url ?? '');
    const body = req.url === '/pic.png' ? linkedPic : req.url === '/clip.wav' ? clipWav : null;
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': req.url === '/pic.png' ? 'image/png' : 'audio/wav', 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise<void>(res => mediaServer.listen(0, '127.0.0.1', res));
  const mediaHost = `127.0.0.1:${(mediaServer.address() as { port: number }).port}`;
  bob.sendText({ channels: [0] }, `look <a href="http://${mediaHost}/pic.png">http://${mediaHost}/pic.png</a> and <a href="http://${mediaHost}/clip.wav">http://${mediaHost}/clip.wav</a>`);
  const mediaMsg = page.locator('.msg', { hasText: 'look' });
  await mediaMsg.locator('.ask').nth(1).waitFor();
  await mediaMsg.getByText(`Picture from ${mediaHost}, click to show`).waitFor();
  await page.waitForTimeout(300);
  assert.deepEqual(mediaHits, [], 'nothing fetched before a click');
  await mediaMsg.locator('.media-card', { hasText: 'pic.png' }).locator('.load').click();
  await page.waitForFunction(() => (document.querySelector('.msg .embed img[alt="pic.png"]') as HTMLImageElement)?.naturalWidth === 300);
  assert.deepEqual(mediaHits, ['/pic.png'], 'only the clicked picture is fetched');
  // The card is as wide as the picture, plus its border
  const picSpare = await mediaMsg.locator('.media-card', { hasText: 'pic.png' }).evaluate(el =>
    el.getBoundingClientRect().width - el.querySelector('img')!.getBoundingClientRect().width);
  assert.ok(Math.abs(picSpare - 2) < 1, `picture card has ${picSpare}px beside the picture`);
  // "Always from this host" lists it in the settings; its media then loads at once
  await mediaMsg.locator('.media-card', { hasText: 'clip.wav' }).getByRole('button', { name: 'Always from this host' }).click();
  await page.waitForFunction(() => ((document.querySelector('.msg .embed audio') as HTMLAudioElement)?.duration ?? 0) > 0.9);
  assert.equal(await mediaMsg.locator('.ask').count(), 0);
  assert.equal(await mediaMsg.locator('.media-card').count(), 2, 'linked media keeps one uniform card per item');
  await mediaMsg.getByRole('link', { name: 'Open pic.png', exact: true }).waitFor();
  await mediaMsg.getByRole('link', { name: 'Open clip.wav', exact: true }).waitFor();
  assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).embedHosts as string[])).includes(mediaHost));
  mediaServer.close();
  console.log('ok: media links load when clicked, or at once from a listed host');

  // Bob -> DM
  const alice = [...bob.users.values()].find(u => u.name === 'alice')!;
  bob.sendText({ users: [alice.session] }, 'psst');
  // Modern layout: private chats are in the channel list (tabs are covered by private-chats.e2e.ts)
  const dmRow = page.locator('.sidebar .dm-row', { hasText: 'bob' });
  await dmRow.locator('.dm').click();
  await page.locator('.msg', { hasText: 'psst' }).waitFor();
  console.log('ok: direct message shown in its own view');
  const soundLog = () => page.evaluate(() => [...((window as any).__mumh5Sounds ?? [])] as string[]);
  const played = await soundLog();
  for (const ev of ['connected', 'message', 'privateMessage']) assert.ok(played.includes(ev), `sound for ${ev}: ${played}`);
  console.log('ok: sounds for connect, channel and direct messages');
  await dmRow.getByRole('button', { name: 'Close conversation with bob' }).click();
  await dmRow.waitFor({ state: 'detached' });
  await page.locator('.msg', { hasText: 'psst' }).waitFor({ state: 'detached' });
  console.log('ok: direct message closed');
  await page.locator('.channel .name').first().dblclick();

  // Mute toggles propagate
  const muted = new Promise<boolean>(res => bob.on('user', (u, changed) => { if (u.name === 'alice' && changed.includes('selfMute')) res(u.selfMute); }));
  await page.locator('.me').getByRole('button', { name: 'Mute', exact: true }).click();
  assert.equal(await within(muted, 'mute state'), true);
  await page.locator('.me').getByRole('button', { name: 'Unmute', exact: true }).waitFor();

  // Right-click on mute / deafen opens quick audio options
  const micButton = page.locator('.me').getByRole('button', { name: 'Unmute', exact: true });
  await micButton.click({ button: 'right' });
  const micPop = page.getByRole('dialog', { name: 'Microphone' });
  await micPop.getByLabel('Microphone').waitFor();
  await micPop.getByRole('radio', { name: 'Always on' }).waitFor();
  // This bar is at the bottom of the window: no room below, so it opens above the button
  const over = { button: (await micButton.boundingBox())!, pop: (await micPop.boundingBox())! };
  assert.ok(over.pop.y + over.pop.height <= over.button.y, 'quick audio opens above a button at the bottom');
  // Lit while its popup is open, with the pointer elsewhere
  await page.mouse.move(over.pop.x + 5, over.pop.y + 5);
  const micHandle = await micButton.elementHandle();
  await page.waitForFunction(b => getComputedStyle(b as Element).backgroundColor !== 'rgba(0, 0, 0, 0)', micHandle);
  await micPop.getByLabel(/Input volume/).fill('1.5');
  await micPop.getByText('Input volume: 150%').waitFor();
  await page.keyboard.press('Escape');
  await micPop.waitFor({ state: 'detached' });
  await page.waitForFunction(b => getComputedStyle(b as Element).backgroundColor === 'rgba(0, 0, 0, 0)', micHandle);
  await page.locator('.me').getByRole('button', { name: 'Deafen', exact: true }).click({ button: 'right' });
  const outPop = page.getByRole('dialog', { name: 'Output' });
  await outPop.getByLabel('Output device').waitFor();
  await outPop.getByRole('button', { name: 'Voice settings...' }).click();
  await page.getByRole('tab', { name: 'Voice', selected: true }).waitFor();
  await page.getByText('Microphone volume: 150%').waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: quick audio options on right-click');

  // STUN server for screen sharing: none by default, presets, or a typed address
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Screen sharing' }).click();
  const stun = page.getByLabel('STUN server', { exact: true });
  assert.equal(await stun.inputValue(), '');
  await stun.selectOption({ label: 'Cloudflare (stun.cloudflare.com:3478)' });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).stunServer), 'stun.cloudflare.com:3478');
  await stun.selectOption('custom');
  await page.getByLabel('STUN server address').fill('stun.example.org:3478');
  await page.getByLabel('STUN server address').blur();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).stunServer), 'stun.example.org:3478');
  await stun.selectOption('');
  // Values equal to the default are not saved
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).stunServer ?? ''), '');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: STUN server choices');

  // Noise suppression: the model loads in the real app and can be switched off and on
  await page.getByTitle('Settings').click();
  const noise = page.locator('#v-noise');
  assert.equal(await noise.inputValue(), 'browser');
  await noise.selectOption('deepfilter');
  await page.locator('[data-denoise="on"]').waitFor({ timeout: 30000 });
  await noise.selectOption('off');
  assert.equal(await page.locator('[data-denoise]').count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.voice')!).noiseSuppression), false);
  await noise.selectOption('deepfilter');
  await page.locator('[data-denoise="on"]').waitFor({ timeout: 30000 });
  await noise.selectOption('browser');
  assert.equal(await page.locator('[data-denoise]').count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.voice')!).noiseEngine), 'browser');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: DeepFilterNet noise suppression');

  // Color schemes apply right away and are remembered
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Windows 95' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'win95');
  assert.equal(await page.locator('.rail').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 128, 128)');
  for (const [name, id, bg] of [['Forest', 'forest', 'rgb(22, 35, 28)'], ['Ember', 'ember', 'rgb(33, 25, 20)'], ['Ocean', 'ocean', 'rgb(15, 30, 44)'],
    ['Plum', 'plum', 'rgb(32, 22, 40)'], ['Paper', 'paper', 'rgb(248, 243, 231)'], ['High contrast', 'contrast', 'rgb(0, 0, 0)']]) {
    await page.getByRole('radio', { name }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), id);
    assert.equal(await page.locator('.chat').evaluate(el => getComputedStyle(el).backgroundColor), bg, `${name} colors the chat`);
    if (shots) await page.screenshot({ path: path.join(shots, `theme-pick-${id}.png`) });
  }
  // Generated schemes, and narrowing the list
  assert.equal(await page.getByRole('radiogroup', { name: 'Color scheme' }).getByRole('radio').count(), 100);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  assert.equal(await page.getByRole('radiogroup', { name: 'Color scheme' }).getByRole('radio').count(), 28);
  await page.getByRole('radio', { name: 'Lavender' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'lavender');
  if (shots) await page.screenshot({ path: path.join(shots, 'theme-pick-lavender.png') });
  await page.getByRole('button', { name: 'All 100' }).click();
  await page.getByLabel('Find a color scheme').fill('synth');
  assert.equal(await page.getByRole('radiogroup', { name: 'Color scheme' }).getByRole('radio').count(), 1);
  await page.getByRole('radio', { name: 'Synthwave' }).click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim()), 'dark');
  if (shots) { await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.screenshot({ path: path.join(shots, 'theme-synthwave.png') }); await page.getByTitle('Settings').click(); await page.getByRole('tab', { name: 'Appearance' }).click(); }
  await page.getByLabel('Find a color scheme').fill('');
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  // Settings keep one size, and each section opens at its top
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  const settingsBox = await settingsDialog.boundingBox();
  await settingsDialog.locator('.body').evaluate(el => { el.scrollTop = 800; });
  await page.getByRole('tab', { name: 'Voice' }).click();
  assert.equal(await settingsDialog.locator('.body').evaluate(el => el.scrollTop), 0, 'a section opens at its top');
  await page.getByRole('tab', { name: 'Accessibility' }).click();
  assert.deepEqual(await settingsDialog.boundingBox(), settingsBox, 'the dialog does not change size between sections');
  // Hints are off by default: the title under the pointer is set aside while hovered, and back afterwards
  const hintTarget = page.locator('.rail').getByRole('button', { name: 'Add a server' });
  const titleOf = () => page.locator('.rail .tile.add').first().getAttribute('title');
  await page.getByRole('tab', { name: 'Accessibility' }).click();
  assert.equal(await page.getByLabel('Show hints when the pointer rests').isChecked(), false);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await hintTarget.hover();
  assert.equal(await titleOf(), null, 'no tooltip while hints are off');
  await page.mouse.move(700, 400);
  assert.equal(await titleOf(), 'Add a server');
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Accessibility' }).click();
  await page.getByLabel('Show hints when the pointer rests').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await hintTarget.hover();
  assert.equal(await titleOf(), 'Add a server', 'tooltip kept while hints are on');
  await page.mouse.move(700, 400);
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Accessibility' }).click();
  await page.getByLabel('Show hints when the pointer rests').uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: color schemes, hints off by default and can be turned on');

  // A newer build on GitHub: a bar on top, the same in Settings > About, hidden until the next one
  const updateBar = page.locator('.update-bar');
  await updateBar.getByText('A newer mumh5 is available (3 changes).').waitFor();
  assert.match(updateAsks[0], /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/compare\/[0-9a-f]{40}\.\.\.snapshot/);
  assert.match(await updateBar.getByRole('link', { name: 'Download' }).getAttribute('href') ?? '', /\/releases\/tag\/snapshot$/);
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'About' }).click();
  await page.getByRole('status').getByText('A newer build is available (3 changes).').waitFor();
  assert.ok(await page.getByLabel('Check for updates').isChecked());
  await page.getByRole('button', { name: 'Check now' }).click();
  for (let i = 0; i < 50 && updateAsks.length < 2; i++) await page.waitForTimeout(100);
  assert.equal(updateAsks.length, 2, 'Check now asks again');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await updateBar.getByRole('button', { name: 'Not now' }).click();
  await updateBar.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.updateCheck')!).dismissed), 3);
  console.log('ok: update check shows a newer build and can be dismissed');

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
  // Classic can have the channel list on either side
  const listSide = page.getByRole('group', { name: 'Channel list', exact: true });
  await listSide.getByRole('button', { name: 'Left' }).click();
  await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().x < document.querySelector('.chat')!.getBoundingClientRect().x);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).classicSide), 'left');
  assert.equal(await page.getByRole('separator', { name: 'Resize channel list' }).count(), 1, 'still resizable on the left');
  await listSide.getByRole('button', { name: 'Right' }).click();
  await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().x > document.querySelector('.chat')!.getBoundingClientRect().x);
  await page.getByRole('radio', { name: 'Stacked' }).click();
  assert.equal(await listSide.count(), 0, 'the switch belongs to Classic');
  // Stacked can give its tab bar the channel list's or the chat's background
  const tabBg = page.getByRole('group', { name: 'Tab bar background' });
  await tabBg.getByRole('button', { name: 'Same as chat', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).tabBarBackground), 'chat');
  await tabBg.getByRole('button', { name: 'Same as channel list', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).tabBarBackground), 'tree');
  await tabBg.getByRole('button', { name: 'Plain', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.app.stacked').waitFor();
  // The stacked toolbar names you at its far end
  await page.locator('.me .you').getByText('alice', { exact: true }).waitFor();
  console.log('ok: you shown in the stacked toolbar');
  // In the toolbar along the top, the mic's popup opens under the button
  const topMic = page.locator('.me').getByRole('button', { name: /^(Mute|Unmute)$/ });
  await topMic.click({ button: 'right' });
  const topPop = page.getByRole('dialog', { name: 'Microphone' });
  await topPop.getByLabel('Microphone').waitFor();
  const topButton = (await topMic.boundingBox())!, topBox = (await topPop.boundingBox())!;
  assert.ok(topBox.y >= topButton.y + topButton.height, 'quick audio opens under a button at the top');
  await page.keyboard.press('Escape');
  await topPop.waitFor({ state: 'detached' });
  // Your name starts in the far corner, moves between the buttons and can be hidden
  const topTools = page.locator('.me .tools');
  const you = topTools.locator('.you');
  const youBox = async () => (await you.locator('.profile').boundingBox())!;
  const topToolsBox = (await topTools.boundingBox())!;
  const youStart = await youBox();
  assert.ok(Math.abs(youStart.x + youStart.width - (topToolsBox.x + topToolsBox.width)) <= 1, 'name in the right corner');
  await topTools.getByRole('button', { name: 'Configure' }).click({ button: 'right' });
  const nameEditor = page.getByRole('dialog', { name: 'Customize toolbar' });
  await nameEditor.getByRole('button', { name: /^Move Name and picture \d+ up$/ }).click();
  await page.waitForFunction(() => !document.querySelector('.me .tools .you')!.classList.contains('corner'));
  const lastButton = topTools.getByRole('button', { name: /^(Expand|Collapse) all channels$/ });
  assert.ok((await youBox()).x < (await lastButton.boundingBox())!.x, 'name moved before the last button');
  await nameEditor.getByRole('checkbox', { name: 'Show Name and picture' }).uncheck();
  await you.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).toolbar.hidden), ['you']);
  await nameEditor.getByRole('checkbox', { name: 'Show Name and picture' }).check();
  await you.waitFor();
  await nameEditor.getByRole('button', { name: 'Reset' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mumh5.settings')!).toolbar === undefined);
  await page.keyboard.press('Escape');
  await nameEditor.waitFor({ state: 'detached' });
  console.log('ok: your name in the toolbar can be moved and hidden');
  const chatBox = await box('.chat'), treeBox = await box('.sidebar');
  assert.ok(chatBox.y >= treeBox.y + treeBox.height - 1, 'stacked: chat below channel list');
  // The split between chat and channel list drags
  const handle = page.getByRole('separator', { name: 'Resize channel list' });
  const hb = (await handle.boundingBox())!;
  // Its line is the lower edge of the tab bar, not the edge between the list and the tabs
  const tabBar = await box('.tabs-wrap');
  assert.ok(Math.abs(hb.y - (tabBar.y + tabBar.height - 1)) <= 1, `stacked: handle under the tabs (${hb.y}, bar ends at ${tabBar.y + tabBar.height})`);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  const dragged = (await box('.sidebar')).height - treeBox.height;
  assert.ok(Math.abs(dragged - 60) <= 2, `stacked: split follows the pointer without a jump (${dragged})`);
  // Dragged past the bottom, the split stops where the message box still fits
  const hb2 = (await handle.boundingBox())!;
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb2.x + hb2.width / 2, page.viewportSize()!.height + 300, { steps: 6 });
  await page.mouse.up();
  const composerBottom = (await box('.chat .composer')).y + (await box('.chat .composer')).height;
  assert.ok(composerBottom <= page.viewportSize()!.height + 1, `stacked: message box stays visible (${composerBottom})`);
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
  await row.getByRole('button', { name: 'Connect' }).waitFor();
  // Column headers sort; a second click reverses
  const firstRow = pub.locator('tbody tr').first();
  await pub.getByRole('button', { name: 'Server', exact: true }).click();
  await firstRow.getByText('E2E Murmur').waitFor();
  await pub.getByRole('button', { name: 'Server', exact: true }).click();
  await firstRow.getByText('Offline one').waitFor();
  await pub.getByRole('button', { name: 'People', exact: true }).click();
  await firstRow.getByText('E2E Murmur').waitFor();
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
  // The sphere takes the color scheme's accent
  const trayIcon = () => app.evaluate(() => (globalThis as any).__mumh5Tray.fullIcon as string);
  const darkIcon = await trayIcon();
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Forest' }).click();
  await within((async () => { while ((await trayIcon()) === darkIcon) await new Promise(r => setTimeout(r, 100)); })(), 'tray icon follows the accent');
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await within((async () => { while ((await trayIcon()) !== darkIcon) await new Promise(r => setTimeout(r, 100)); })(), 'tray icon back to the dark accent');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await app.evaluate(() => (globalThis as any).__mumh5Tray.click('Mute'));
  await trayUntil('muted again', t => /muted/.test(t.tooltip));
  console.log('ok: tray icon follows voice state and its menu mutes');
  // Clicking the tray icon hides a shown window and shows it again
  const winVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  await app.evaluate(() => (globalThis as any).__mumh5Tray.activate());
  await within((async () => { while (await winVisible()) await new Promise(r => setTimeout(r, 100)); })(), 'tray click hides the window');
  await app.evaluate(() => (globalThis as any).__mumh5Tray.activate());
  await within((async () => { while (!(await winVisible())) await new Promise(r => setTimeout(r, 100)); })(), 'tray click shows the window');
  console.log('ok: tray icon click toggles the window');
  await page.locator('.channel + .users, .users').getByTitle('Muted', { exact: true }).first().waitFor();
  const mutedRow = page.locator('.users .row.user', { has: page.getByTitle('Muted', { exact: true }) }).first();
  assert.equal(await mutedRow.locator('.orb').count(), 0, 'the mute icon takes the place of the sphere');
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

  // ─── Files through the Mumble server ─────────────────────────────────────
  {
    const alice = aliceSession();
    const fileAsm = new FileAssembler();
    const signals: { from: number; type: number; body: any }[] = [];
    let onSignal: (() => void) | null = null;
    const bobSignal = async (to: number[], type: (typeof FILE)[keyof typeof FILE], body: unknown) => {
      for (const packet of await encodeFileSignal(type, body)) bob.sendPluginData(to, FILE_DATA_ID, packet);
    };
    const signalFrom = (type: number) => new Promise<{ from: number; body: any }>(res => {
      const look = () => { const i = signals.findIndex(x => x.type === type); if (i >= 0) { onSignal = null; res(signals.splice(i, 1)[0]); } };
      onSignal = look;
      look();
    });
    // Bob serves his own files the way the app does
    const sender = new Sender();
    const served = new Map<string, { meta: { s: number; c: number }; data: Buffer }>();
    let pumping = false;
    bob.on('pluginData', async (from, id, packet) => {
      if (id !== FILE_DATA_ID) return;
      const sig = await fileAsm.push(from, packet);
      if (!sig) return;
      const body = JSON.parse(sig.text!);
      const mine = served.get(body.i);
      if (sig.type === FILE.who && mine) return bobSignal([from], FILE.have, { i: body.i });
      if (sig.type === FILE.want && mine) {
        sender.want(body.i, from, fromRanges(body.r, pieceCount(mine.meta))!);
        if (!pumping) {
          pumping = true;
          pumpPieces({
            client: bob, sender, alive: () => true,
            read: async (f, k) => { const x = served.get(f)!; return pieceMessage(pieceForm(bob.config), f, k, encode15(x.data.subarray(k * x.meta.c, k * x.meta.c + pieceSize(x.meta, k)))); },
            done: (r, f) => bobSignal([r], FILE.done, { i: f }), gone: () => {}
          }).finally(() => { pumping = false; });
        }
        return;
      }
      signals.push({ from, type: sig.type, body });
      onSignal?.();
    });

    // The app sends a file: announced in the chat, then sent in pieces to whoever asks
    const data = Buffer.alloc(600_000);
    for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536));
    const bin = path.join(userData, 'clip.bin');
    writeFileSync(bin, data);
    const announced = new Promise<string>(res => bob.on('text', m => { if (m.html.includes('<!--mumh5:file:')) res(m.html); }));
    await page.locator('.chat .composer input[type=file]').first().setInputFiles(bin);
    const html = await within(announced, 'file announcement', 15000);
    assert.match(html, /<b>clip\.bin<\/b> \(585\.9 KB, file shared with mumh5\)/);
    const [f] = takeFiles(html).files;
    assert.equal(f.meta.n, 'clip.bin');
    assert.equal(f.meta.s, data.length);
    const count = pieceCount(f.meta);
    const parts: Buffer[] = [];
    const gotAll = new Promise<void>(res => bob.on('text', m => {
      if (!isPiece(m.html) || m.actor !== alice) return;
      const p = parsePiece(m.html)!;
      parts[p.index] = Buffer.from(decode15(p.payload, pieceSize(f.meta, p.index))!);
      if (parts.filter(Boolean).length === count) res();
    }));
    const done = signalFrom(FILE.done);
    await bobSignal([alice], FILE.want, { i: f.meta.i, r: [[0, count]] });
    await within(gotAll, 'file pieces', 20000);
    assert.ok(Buffer.concat(parts).equals(data), 'the file arrives as it was');
    assert.equal(await rootHash(await Promise.all(parts.map(p => sha256(p)))), f.meta.h);
    assert.equal((await within(done, 'done signal')).body.i, f.meta.i);
    await page.locator('.chat .msg .file', { hasText: 'clip.bin' }).locator('a[download="clip.bin"]').waitFor();
    // Asked who has it, the app says it does
    const have = signalFrom(FILE.have);
    await bobSignal([alice], FILE.who, { i: f.meta.i });
    assert.equal((await within(have, 'have signal')).body.i, f.meta.i);
    console.log(`ok: a file goes from the app to another client through the server (${count} pieces)`);

    // Someone else sends a portrait picture: the app fetches it by itself and shows it unstretched
    const png = testPng(500, 700);
    const c = pieceBytes(bob.config);
    const pm = { s: png.length, c };
    const digests: Uint8Array[] = [];
    for (let k = 0; k < pieceCount(pm); k++) digests.push(await sha256(png.subarray(k * c, k * c + pieceSize(pm, k))));
    const meta = { i: 'e2enoise' + Date.now().toString(36), n: 'noise.png', s: png.length, m: 'image/png', c, h: await rootHash(digests) };
    served.set(meta.i, { meta, data: png });
    bob.sendText({ channels: [0] }, announce(meta, `<b>noise.png</b> (${png.length} B, file shared with mumh5)<br/><img src="data:image/png;base64,${testPng(30, 40).toString('base64')}"/>`));
    const shown = page.locator('.chat .msg .file img[alt="noise.png"]');
    await shown.waitFor({ timeout: 30000 });
    await page.waitForFunction(() => (document.querySelector('.chat .msg .file img[alt="noise.png"]') as HTMLImageElement)?.naturalWidth === 500);
    const box = (await shown.boundingBox())!;
    assert.ok(Math.abs(box.width / box.height - 500 / 700) < 0.02, `picture keeps its ratio (${box.width}x${box.height})`);
    assert.equal(await page.locator('.chat .msg', { hasText: 'file shared with mumh5' }).count(), 0, 'the text for other clients is not shown');
    console.log(`ok: the app fetches a file by itself and shows it (${pieceCount(pm)} pieces)`);

    // Posted by someone who left right after: the app finds another client that has the file
    const relay = Buffer.alloc(300_000);
    crypto.getRandomValues(relay.subarray(0, 65536));
    relay.copyWithin(65536, 0, 300_000 - 65536);
    const rm = { s: relay.length, c };
    const rd: Uint8Array[] = [];
    for (let k = 0; k < pieceCount(rm); k++) rd.push(await sha256(relay.subarray(k * c, k * c + pieceSize(rm, k))));
    const relayMeta = { i: 'e2erelay' + Date.now().toString(36), n: 'relay.bin', s: relay.length, m: '', c, h: await rootHash(rd) };
    served.set(relayMeta.i, { meta: relayMeta, data: relay });
    const carol = await headless('carol');
    carol.sendText({ channels: [0] }, announce(relayMeta, '<b>relay.bin</b> (293 KB, file shared with mumh5)'));
    await new Promise(r => setTimeout(r, 200));
    carol.disconnect();
    await page.locator('.chat .msg .file', { hasText: 'relay.bin' }).locator('a[download="relay.bin"]').waitFor({ timeout: 30000 });
    console.log('ok: a file whose sender left comes from someone else who has it');
  }

  if (process.env.E2E_INTERNET) {
    // Link previews, fetched by this computer
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Chat and files' }).click();
    await page.getByLabel('Link previews').selectOption('direct');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    bob.sendText({ channels: [0] }, '<a href="https://github.com/mumble-voip/mumble">https://github.com/mumble-voip/mumble</a>');
    const gh = page.locator('.msg', { hasText: 'github.com/mumble-voip' }).locator('.card');
    await gh.locator('.title', { hasText: /mumble/i }).waitFor({ timeout: 15000 });
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Chat and files' }).click();
    await page.getByLabel('Link previews').selectOption('off');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    console.log('ok: link preview fetched directly');
  }

  // The header wave follows the measured connection
  await page.locator('.sidebar header canvas.conn-wave[data-tone="good"]').waitFor({ state: 'attached' });
  await page.locator('.sidebar header .status').hover();
  // With hints off the title is set aside while hovered and comes back afterwards
  await page.locator('.sidebar header strong').hover();
  await page.mouse.move(1, 1);
  assert.match(await page.locator('.sidebar header .status').getAttribute('title') ?? '', /^Stable: \d+ ms, varies by \d+ ms$/);
  console.log('ok: connection wave follows the measured link');

  // Server certificate viewer from the header (the Docker server is self-signed)
  await page.locator('.sidebar header .title').click();
  await page.getByRole('dialog', { name: /Certificate of/ }).getByText('self-signed').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  console.log('ok: server certificate viewer');

  // Own description: rich text with a picture, as Mumble-compatible XHTML
  await page.locator('.me').getByRole('button', { name: 'Edit your profile' }).click();
  const area = page.getByRole('dialog', { name: 'Edit profile' }).locator('.rich .area');
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
  await page.getByRole('dialog', { name: 'Edit profile' }).waitFor({ state: 'detached' });
  await page.locator('.me .profile').click();
  await page.getByRole('dialog', { name: /^Profile of / }).locator('.html img').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: /^Profile of / }).waitFor({ state: 'detached' });
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
  await page.getByRole('dialog', { name: 'Profile of bob' }).locator('h3', { hasText: 'bob' }).waitFor();
  assert.equal(await page.locator('.sidebar .user', { hasText: 'bob' }).getAttribute('data-card-on'), '', 'row lit when opened from the menu too');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Profile of bob' }).waitFor({ state: 'detached' });
  console.log('ok: user context menu and profile');

  // Poke: a private message with a marker; mumh5 shows it as a popup with its own sound
  const poked = new Promise<string>(res => bob.on('text', m => { if (decodePoke(m.html) != null) res(m.html); }));
  await page.locator('.sidebar .user', { hasText: 'bob' }).click({ button: 'right' });
  await menuItem('Poke...').click();
  await page.getByRole('dialog', { name: 'Poke bob' }).getByLabel('Message (optional)').fill('Hey wake up!');
  await page.getByRole('dialog', { name: 'Poke bob' }).getByRole('button', { name: 'Poke' }).click();
  const pokeHtml = await within(poked, 'bob poked');
  assert.equal(decodePoke(pokeHtml), 'Hey wake up!');
  assert.ok(pokeHtml.includes('Poked you: Hey wake up!'), 'readable in other clients');
  // System notification: the desktop app may show them; the page records them here, as if in the background
  assert.equal(await page.evaluate(() => Notification.permission), 'granted', 'notifications allowed');
  // Full screen, which the controls of videos in the chat use, must be granted too
  assert.ok(await page.evaluate(async () => {
    const v = document.body.appendChild(document.createElement('video'));
    try { await v.requestFullscreen(); return document.fullscreenElement === v; } catch { return false; } finally { await document.exitFullscreen().catch(() => {}); v.remove(); }
  }), 'full screen allowed');
  await page.evaluate(() => {
    const w = window as any;
    w.__notes = [];
    w.__RealNotification = w.Notification;
    w.Notification = class { static permission = 'granted'; onclick = null; constructor(title: string, o: NotificationOptions) { w.__notes.push({ title, body: o.body, silent: o.silent }); } close() {} };
    document.hasFocus = () => false;
  });
  // The window loses focus in main too, so the taskbar flashes and the tray icon blinks
  const unfocused = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.blur(); return !w.isFocused(); });
  bob.sendText({ users: [aliceId] }, encodePoke('Wake up <b>now</b>'));
  const pokeDialog = page.getByRole('dialog', { name: 'bob poked you' });
  await pokeDialog.locator('.note', { hasText: 'Wake up <b>now</b>' }).waitFor();
  // Logged once it really started playing, after the tone is rendered
  await page.waitForFunction(() => ((window as any).__mumh5Sounds ?? []).includes('poke'), null, { timeout: 5000 });
  const blinking = () => app.evaluate(() => (globalThis as any).__mumh5Tray.blinking as boolean);
  if (unfocused) {
    await within((async () => { while (!(await blinking())) await new Promise(r => setTimeout(r, 100)); })(), 'tray icon blinks');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await within((async () => { while (await blinking()) await new Promise(r => setTimeout(r, 100)); })(), 'blinking stops on focus');
    console.log('ok: tray icon blinks until the window is focused');
  } else console.log('skip: window cannot lose focus on this display, tray blinking not checked');
  const notes = await page.evaluate(() => { const w = window as any; w.Notification = w.__RealNotification; delete (document as any).hasFocus; return w.__notes; });
  assert.deepEqual(notes, [{ title: 'bob poked you', body: 'Wake up <b>now</b>', silent: true }], 'one system notification');
  await pokeDialog.getByRole('button', { name: 'Reply' }).click();
  await pokeDialog.waitFor({ state: 'detached' });
  await page.locator('.chat .system', { hasText: 'bob poked you: Wake up <b>now</b>' }).waitFor();
  await page.locator('.chat .system', { hasText: 'You poked bob: Hey wake up!' }).waitFor();
  console.log('ok: poke sent, received as a popup, reply opens the conversation');
  await page.locator('.channel .name').first().dblclick();

  // Profile cards open beside what was clicked; pictures go both ways as Mumble textures
  const bobInTree = page.locator('.sidebar .user', { hasText: 'bob' });
  bob.setTexture(testPng(64, 64));
  // Spheres are the default in lists; the picture shows there once chosen
  await bobInTree.locator('.orb').waitFor();
  const showPeopleAs = async (value: string) => {
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByLabel('Show people as').selectOption(value);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  };
  await showPeopleAs('pictures');
  await bobInTree.locator('.avatar img').waitFor();
  await showPeopleAs('spheres');
  await bobInTree.locator('.orb').waitFor();
  await bobInTree.click();
  const bobCard = page.getByRole('dialog', { name: 'Profile of bob' });
  await bobCard.locator('.avatar img').waitFor();
  // The row stays lit while its card is open, with the pointer elsewhere
  const rowColor = () => bobInTree.evaluate(e => getComputedStyle(e).backgroundColor);
  await page.mouse.move(640, 700);
  await page.waitForTimeout(180);
  const litColor = await rowColor();
  assert.equal(await bobInTree.getAttribute('data-card-on'), '', 'row marked while the card is open');
  assert.ok((await bobCard.boundingBox())!.x >= (await bobInTree.boundingBox())!.x + (await bobInTree.boundingBox())!.width, 'card beside the row');
  assert.equal(await page.locator('aside.panel h3', { hasText: 'bob' }).count(), 0, 'no side panel for a profile');
  await bobCard.getByRole('button', { name: 'Send message' }).waitFor();
  await page.keyboard.press('Escape');
  await bobCard.waitFor({ state: 'detached' });
  await page.waitForTimeout(180);
  assert.notEqual(await rowColor(), litColor, 'row back to normal after the card closes');
  const pictureSet = new Promise<void>(res => bob.on('user', (u, changed) => { if (u.session === aliceId && changed.includes('textureHash')) res(); }));
  // Your own card only shows; editing is in the profile dialog
  await page.locator('.me .profile').click();
  const shownCard = page.getByRole('dialog', { name: /^Profile of / });
  await shownCard.locator('h3').waitFor();
  assert.equal(await shownCard.locator('.actions').count(), 0, 'no buttons on your own card');
  assert.equal(await shownCard.locator('input[type=file]').count(), 0, 'no picture button on your own card');
  await page.keyboard.press('Escape');
  await shownCard.waitFor({ state: 'detached' });
  await page.locator('.me').getByRole('button', { name: 'Edit your profile' }).click();
  const ownCard = page.getByRole('dialog', { name: 'Edit profile' });
  await ownCard.getByLabel('Picture file').setInputFiles(pic);
  await within(pictureSet, 'own picture announced');
  const pictureBytes = new Promise<Uint8Array>(res => bob.on('user', (u, changed) => { if (u.session === aliceId && changed.includes('texture') && u.texture?.length) res(u.texture); }));
  bob.requestBlob({ textures: [aliceId] });
  const sentPicture = await within(pictureBytes, 'own picture fetched');
  assert.ok((sentPicture[0] === 0x89 && sentPicture[1] === 0x50) || (sentPicture[0] === 0xff && sentPicture[1] === 0xd8), 'PNG or JPEG');
  assert.ok(sentPicture.length <= 131072, 'within the image limit');
  await ownCard.locator('.avatar img').waitFor();
  const pictureGone = new Promise<number>(res => bob.on('user', (u, changed) => { if (u.session === aliceId && changed.includes('texture')) res(u.texture!.length); }));
  await ownCard.getByRole('button', { name: 'Remove picture' }).click();
  assert.equal(await within(pictureGone, 'picture removed'), 0);
  await ownCard.locator('.avatar img').waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');
  bob.setTexture(new Uint8Array(0));
  await bobInTree.locator('.avatar img').waitFor({ state: 'detached' });
  console.log('ok: profile cards, pictures sent, shown and removed');


  // Server information from the button next to mute
  await page.locator('.me').getByRole('button', { name: 'Server information' }).click();
  const srvInfo = page.getByRole('dialog', { name: 'Server information' });
  await srvInfo.getByText(`${host}:${port}`).waitFor();
  await srvInfo.getByText(/^\d+ of \d+$/).waitFor();
  await srvInfo.getByText(/^\d+ characters$/).first().waitFor();
  await srvInfo.getByRole('button', { name: 'Close', exact: true }).last().click();
  await srvInfo.waitFor({ state: 'detached' });
  console.log('ok: server information dialog');

  // Toolbar: the profile editor is a dialog, and unsaved text survives a stray Escape
  await page.locator('.me').getByRole('button', { name: 'Edit your profile' }).click();
  const profileEditor = page.getByRole('dialog', { name: 'Edit profile' });
  await profileEditor.locator('.rich').waitFor();
  assert.equal(await page.locator('.panel .rich').count(), 0, 'not in the side panel');
  // On the first line of text: the middle of the box is the description's picture
  await profileEditor.locator('.rich .area').click({ position: { x: 14, y: 14 } });
  await page.keyboard.type(' more');
  await page.keyboard.press('Escape');
  await profileEditor.getByText('Discard your changes?').waitFor();
  await profileEditor.getByRole('button', { name: 'Keep editing' }).click();
  await profileEditor.getByRole('button', { name: 'Cancel' }).click();
  await profileEditor.getByRole('button', { name: 'Discard' }).click();
  await profileEditor.waitFor({ state: 'detached' });
  // Your own menu edits the profile; other people's views it
  await page.locator('.sidebar .user.self').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit profile' }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: 'View profile' }).count(), 0, 'no View profile on yourself');
  await page.getByRole('menuitem', { name: 'Edit profile' }).click();
  await profileEditor.locator('.rich').waitFor();
  await profileEditor.getByRole('button', { name: 'Cancel' }).click();
  await profileEditor.waitFor({ state: 'detached' });
  await page.locator('.me').getByRole('button', { name: 'Configure' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: toolbar opens the profile dialog and settings');

  // Right-clicking the toolbar customizes it, also on a disabled button
  const tools = page.locator('.me .tools');
  const toolbarEditor = page.getByRole('dialog', { name: 'Customize toolbar' });
  const savedToolbar = () => page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!).toolbar as { items: string[]; hidden: string[] } | undefined);
  const spacers = await tools.locator('.sep').count();
  const camera = tools.getByRole('button', { name: 'Turn on your camera' });
  await camera.evaluate(b => { (b as HTMLButtonElement).disabled = true; });
  await camera.click({ button: 'right', force: true });
  await toolbarEditor.waitFor();
  if (shots) { await page.waitForTimeout(200); await page.screenshot({ path: path.join(shots, 'toolbar-editor.png') }); }
  await camera.evaluate(b => { (b as HTMLButtonElement).disabled = false; });
  await toolbarEditor.getByRole('checkbox', { name: 'Show Camera' }).uncheck();
  await camera.waitFor({ state: 'detached' });
  assert.deepEqual((await savedToolbar())!.hidden, ['camera']);
  await toolbarEditor.getByRole('checkbox', { name: 'Show Camera' }).check();
  await tools.getByRole('button', { name: 'Turn on your camera' }).waitFor();
  // A new spacer lands after the clicked button and can be removed again
  await toolbarEditor.getByRole('button', { name: 'Add spacer' }).click();
  await page.waitForFunction(n => document.querySelectorAll('.me .tools .sep').length === n, spacers + 1);
  const withSpacer = (await savedToolbar())!.items;
  assert.equal(withSpacer[withSpacer.indexOf('camera') + 1], 'sep');
  await toolbarEditor.getByRole('button', { name: `Remove spacer ${withSpacer.indexOf('camera') + 2}`, exact: true }).click();
  await page.waitForFunction(n => document.querySelectorAll('.me .tools .sep').length === n, spacers);
  // Buttons and dragging both reorder, and the toolbar follows
  const order = () => tools.locator('[data-tool]:not(.sep)').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
  await toolbarEditor.getByRole('button', { name: /^Move Configure \d+ up$/ }).click();
  const movedUp = (await savedToolbar())!.items;
  assert.equal(movedUp[movedUp.indexOf('profile') + 1], 'settings', 'moved above the spacer before it');
  const configureRow = toolbarEditor.locator('li', { hasText: 'Configure' });
  const top = toolbarEditor.locator('li').first();
  const from = (await configureRow.locator('.grip').boundingBox())!, to = (await top.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 8 });
  await page.mouse.up();
  assert.equal((await savedToolbar())!.items[0], 'settings', 'dragged to the top');
  assert.equal((await order())[0], 'Configure');
  await toolbarEditor.getByRole('button', { name: 'Reset' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('mumh5.settings')!).toolbar === undefined);
  await toolbarEditor.getByText('Spacers and your name show only in the top toolbar.').waitFor();
  await page.keyboard.press('Escape');
  await toolbarEditor.waitFor({ state: 'detached' });
  // Mute keeps its audio popup, which leads to the editor
  await tools.getByRole('button', { name: /^(Mute|Unmute)$/ }).click({ button: 'right' });
  await page.getByRole('dialog', { name: 'Microphone' }).getByRole('button', { name: 'Customize toolbar...' }).click();
  await toolbarEditor.waitFor();
  await page.keyboard.press('Escape');
  await toolbarEditor.waitFor({ state: 'detached' });
  console.log('ok: toolbar buttons and spacers can be reordered, hidden, added and removed');

  // Information: own connection shows client details and the full certificate
  await page.locator('.sidebar .user.self').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Information' }).click();
  const info = page.getByRole('dialog', { name: /^Information: alice/ });
  await info.getByText('mumh5 0.2.0').waitFor();
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
  assert.equal(await bobInfo.getByText('mumh5 0.2.0').count(), 0);
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

    // Single click only selects the channel: no panel, no joining
    await page.locator('.channel .name', { hasText: 'Lobby' }).click();
    await page.locator('.channel.selected', { hasText: 'Lobby' }).waitFor();
    assert.equal(await page.locator('aside.panel h2', { hasText: 'Lobby' }).count(), 0, 'no channel panel on a single click');
    assert.equal(await page.locator('.me .who span').textContent(), 'Root');
    console.log('ok: single click selects without opening a panel or joining');

    // Description marker: only on channels that have one. Resting on the row previews, clicking the marker pins the preview
    const marker = page.locator('.channel', { hasText: 'Lobby' }).getByRole('button', { name: 'Show description of Lobby' });
    assert.equal(await page.locator('.channel', { hasText: 'Games' }).locator('.desc').count(), 0);
    await page.locator('.channel .name', { hasText: 'Games' }).hover();
    await page.waitForTimeout(2000);
    assert.equal(await page.locator('.desc-pop').count(), 0, 'no preview for a channel without description');
    for (const spot of [page.locator('.channel .name', { hasText: 'Lobby' }), marker]) {
      await spot.hover();
      await page.waitForTimeout(500);
      assert.equal(await page.locator('.desc-pop').count(), 0, 'no preview before 1 second');
      await page.locator('.desc-pop .html', { hasText: 'Welcome to the lobby' }).waitFor({ timeout: 3000 });
      // Opens at the pointer
      const at = (await spot.boundingBox())!;
      const pop = (await page.locator('.desc-pop').boundingBox())!;
      assert.ok(Math.abs(pop.x - (at.x + at.width / 2 + 12)) < 3 && Math.abs(pop.y - (at.y + at.height / 2 + 12)) < 3, 'preview at the pointer');
      await page.mouse.move(700, 400);
      await page.locator('.desc-pop').waitFor({ state: 'detached' });
    }
    await marker.click();
    await page.locator('.desc-pop .html', { hasText: 'Welcome to the lobby' }).waitFor();
    // Wider than the channel list, and on top of the chat beside it
    const overChat = await page.locator('.desc-pop').evaluate(el => {
      const r = el.getBoundingClientRect();
      const chat = document.querySelector('.chat')!.getBoundingClientRect();
      return r.right > chat.left && el.contains(document.elementFromPoint(r.right - 6, r.top + 6));
    });
    assert.ok(overChat, 'description opens over the chat');
    // Opened on purpose, it stays when the pointer moves away; Escape closes it
    await page.mouse.move(700, 400);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.desc-pop').count(), 1, 'pinned preview stays');
    await page.keyboard.press('Escape');
    await page.locator('.desc-pop').waitFor({ state: 'detached' });
    // The same from the menu
    await page.locator('.channel .name', { hasText: 'Lobby' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show description' }).click();
    await page.locator('.desc-pop .html', { hasText: 'Welcome to the lobby' }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.desc-pop').waitFor({ state: 'detached' });
    console.log('ok: description previews on hover, marker and menu pin it');

    // Side chat sends to that channel while staying in Root
    const lobby = [...bob.channels.values()].find(c => c.name === 'Lobby')!;
    await page.locator('.channel .name', { hasText: 'Lobby' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Send message to channel' }).click();
    await page.locator('.panel [role=tab][aria-selected=true]', { hasText: 'Chat' }).waitFor();
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
    // Messaging a channel from its menu opens the side chat, ready to type, without joining
    await page.locator('.channel .name', { hasText: 'Games' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Send message to channel' }).click();
    const sideInput = page.locator('.panel .composer [contenteditable]');
    await sideInput.waitFor();
    assert.equal(await sideInput.getAttribute('data-placeholder'), 'Message #Games');
    await page.waitForFunction(() => document.activeElement === document.querySelector('.panel .composer [contenteditable]'), null, { timeout: 3000 });
    await page.locator('.me .who span', { hasText: 'Lobby' }).waitFor();
    console.log('ok: channel context menu joins, and messages a channel from the side chat');

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

    // ACL messages are paced, so a save is done when the server answers with it
    const aclSaved = async (id: number, ok: (a: ChannelAcl) => boolean, label: string) => {
      for (let i = 0; i < 30; i++) {
        const got = new Promise<ChannelAcl>(res => { const off = admin.on('acl', a => { if (a.channelId === id) { off(); res(a); } }); });
        admin.queryAcl(id);
        const a = await within(got, label);
        if (ok(a)) return a;
        await page.waitForTimeout(300);
      }
      throw new Error(`Not saved: ${label}`);
    };

    // Permissions: deny Enter for everyone
    await page.locator('.channel .name', { hasText: 'Team Room' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Permissions...' }).click();
    const dlg = page.getByRole('dialog', { name: 'Channel: Team Room' });
    await dlg.getByRole('button', { name: 'Advanced rules' }).click();
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
    const ta = await aclSaved(teamId, a => a.acls.some(r => !r.inherited && (r.deny & 0x4) !== 0), 'team rules saved');
    const deniedEnter = new Promise<number>(res => { const off = bob.on('permissionDenied', d => { off(); res(d.permission); }); });
    bob.joinChannel(teamId);
    assert.equal(await within(deniedEnter, 'enter denied'), 0x4);
    assert.deepEqual(ta.groups.find((g: any) => g.name === 'mods')?.add, [0]);
    console.log('ok: permissions and groups saved and enforced');

    // Access tab: a preset and a grid cell, explained by the checker before saving
    await page.mouse.click(listBox.x + listBox.width / 2, listBox.y + listBox.height - 20, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Create channel...' }).click();
    await page.getByLabel('Name').fill('Access Room');
    await page.getByRole('button', { name: 'Create channel' }).click();
    await bobSees('access room', () => !!chByName('Access Room'));
    const accessId = chByName('Access Room')!.id;
    await page.locator('.channel .name', { hasText: 'Access Room' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Permissions...' }).click();
    const accessDlg = page.getByRole('dialog', { name: 'Channel: Access Room' });
    await accessDlg.getByRole('button', { name: /^Registered only/ }).click();
    await accessDlg.getByRole('button', { name: 'Everyone, Speak: not set' }).click();
    await accessDlg.getByRole('button', { name: 'Everyone, Speak: allowed here' }).click();
    await accessDlg.getByRole('button', { name: 'Everyone, Speak: denied here' }).waitFor();
    // Administrator does not include Speak, so the deny must not silence admins
    await accessDlg.getByRole('button', { name: 'Admin, Speak: allowed here' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'access.png') });
    await accessDlg.getByRole('tab', { name: 'Check' }).click();
    await accessDlg.getByLabel('Person').selectOption({ label: bob.self!.name });
    await accessDlg.getByLabel('Action').selectOption({ label: 'Join' });
    await accessDlg.getByText(`${bob.self!.name} cannot join this channel`).waitFor();
    await accessDlg.getByText('Decided by Everyone in Access Room.').waitFor();
    await accessDlg.getByText('Includes your unsaved changes.').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'access-check.png') });
    // Phone width: the grid scrolls inside the dialog, the dialog itself stays on screen
    await page.setViewportSize({ width: 390, height: 800 });
    const fits = () => accessDlg.evaluate(d => {
      const box = d.getBoundingClientRect();
      const body = d.querySelector('.body')!;
      return box.left >= 0 && box.right <= innerWidth && body.scrollWidth <= body.clientWidth && document.documentElement.scrollWidth <= innerWidth;
    });
    assert.ok(await fits(), 'the checker fits a phone');
    if (shots) await page.screenshot({ path: path.join(shots, 'access-check-phone.png') });
    await accessDlg.getByRole('tab', { name: 'Access' }).click();
    await accessDlg.getByRole('button', { name: 'Everyone, Join: denied here' }).waitFor();
    assert.ok(await fits(), 'the grid fits a phone');
    if (shots) await page.screenshot({ path: path.join(shots, 'access-phone.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await accessDlg.getByRole('button', { name: 'Save', exact: true }).click();
    const accessSaved = await aclSaved(accessId, a => a.acls.some(r => !r.inherited), 'access rules saved');
    const savedAccess = accessSaved.acls.filter(r => !r.inherited);
    assert.deepEqual(savedAccess.map(r => [r.group, r.grant, r.deny]), [['all', 0, 0x4 | 0x8], ['auth', 0x4, 0], ['admin', 0x8, 0]]);
    const accessDenied = new Promise<number>(res => { const off = bob.on('permissionDenied', d => { off(); res(d.permission); }); });
    bob.joinChannel(accessId);
    assert.equal(await within(accessDenied, 'preset enforced'), 0x4);
    admin.removeChannel(accessId);
    await bobSees('access room removed', () => !chByName('Access Room'));
    console.log('ok: access presets, grid and checker');

    // Roles: permission, look, member and access key in one dialog, enforced by the server
    const carol = await headless('carol');
    admin.register(carol.session!);
    await within((async () => { while (carol.self?.userId == null) await page.waitForTimeout(50); })(), 'carol registered');
    const carolId = carol.self!.userId!;
    const holds = (c: MumbleClient, bit: number, label: string) => within((async () => {
      for (;;) {
        c.requestPermissions(0);
        await page.waitForTimeout(200);
        if ((c.permissions.get(0) ?? 0) & bit) return;
      }
    })(), label);
    const openRoles = async () => {
      await page.locator('.channel .name', { hasText: 'Team Room' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Roles and members...' }).click();
      const d = page.getByRole('dialog', { name: 'Roles and members' });
      await d.getByLabel('New role name').waitFor();
      return d;
    };
    const rolesDlg = await openRoles();
    await rolesDlg.getByLabel('New role name').fill('Moderator');
    await rolesDlg.getByRole('button', { name: 'Add', exact: true }).click();
    await rolesDlg.getByRole('button', { name: 'Move people: Allow' }).click();
    if (shots) await page.screenshot({ path: path.join(shots, 'roles.png') });
    const roleSections = rolesDlg.getByRole('tablist', { name: 'Role sections' });
    await roleSections.getByRole('tab', { name: 'Display' }).click();
    await rolesDlg.getByRole('button', { name: 'Icon star' }).click();
    await rolesDlg.getByRole('button', { name: 'Color #6fb3ff' }).click();
    // An uploaded picture becomes a small raster icon
    const roleIconFile = { name: 'icon.png', mimeType: 'image/png', buffer: testPng(64, 64) };
    await rolesDlg.getByLabel('Icon file').setInputFiles(roleIconFile);
    await rolesDlg.getByRole('button', { name: 'Your picture' }).waitFor();
    await roleSections.getByRole('tab', { name: 'Members' }).click();
    await rolesDlg.locator('#role-people option[value="carol"]').waitFor({ state: 'attached' });
    await rolesDlg.getByLabel('Add a member').fill('carol');
    await rolesDlg.getByRole('button', { name: 'Add member' }).click();
    await rolesDlg.locator('.people', { hasText: 'carol' }).waitFor();
    await rolesDlg.getByRole('tab', { name: 'Access keys' }).click();
    await rolesDlg.getByRole('button', { name: 'New key' }).click();
    const roleKey = (await rolesDlg.locator('.key code').textContent())!;
    assert.match(roleKey, /^mk\.[A-Z2-9-]{14}\.role\.moderator-/);
    if (shots) await page.screenshot({ path: path.join(shots, 'roles-keys.png') });
    await page.setViewportSize({ width: 390, height: 800 });
    assert.ok(await rolesDlg.evaluate(d => {
      const box = d.getBoundingClientRect();
      const body = d.querySelector('.body')!;
      return box.left >= 0 && box.right <= innerWidth && body.scrollWidth <= body.clientWidth;
    }), 'the roles dialog fits a phone');
    await rolesDlg.getByRole('tab', { name: 'Roles', exact: true }).click();
    if (shots) await page.screenshot({ path: path.join(shots, 'roles-phone.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await rolesDlg.getByRole('button', { name: 'Save', exact: true }).click();
    const rolesSaved = await aclSaved(0, a => a.acls.some(r => r.group === `#${roleKey}`), 'role saved');
    const roleGroup = rolesSaved.groups.find(g => g.name.startsWith('role.moderator-'))!;
    assert.deepEqual(roleGroup.add, [carolId]);
    await holds(carol, PERM.Move, 'the role gives carol Move');
    assert.ok(!((bob.permissions.get(0) ?? 0) & PERM.Move), 'bob has no role');
    bob.setTokens([roleKey]);
    await holds(bob, PERM.Move, 'the access key gives bob Move');
    bob.setTokens([]);
    await page.locator('.sidebar .user', { hasText: 'carol' }).getByLabel('Moderator').waitFor();
    await page.locator('.sidebar .user', { hasText: 'carol' }).click();
    await page.getByRole('list', { name: 'Roles' }).getByText('Moderator').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'roles-badge.png') });
    await page.keyboard.press('Escape');
    const carolIcon = page.locator('.sidebar .user', { hasText: 'carol' }).getByLabel('Moderator').locator('img');
    await carolIcon.waitFor();
    // Away from the picture and back: the description returns to text the client has seen before
    const changeIcon = async (pick: (d: Locator) => Promise<void>) => {
      const d = await openRoles();
      await d.getByRole('list', { name: 'Roles' }).getByRole('button', { name: /^Moderator/ }).click();
      await d.getByRole('tablist', { name: 'Role sections' }).getByRole('tab', { name: 'Display' }).click();
      await pick(d);
      await d.getByRole('button', { name: 'Save', exact: true }).click();
      await d.waitFor({ state: 'detached' });
    };
    await changeIcon(d => d.getByRole('button', { name: 'Icon star' }).click());
    await carolIcon.waitFor({ state: 'detached' });
    await changeIcon(d => d.getByLabel('Icon file').setInputFiles(roleIconFile));
    await carolIcon.waitFor();
    await changeIcon(d => d.getByRole('button', { name: 'Icon star' }).click());
    await carolIcon.waitFor({ state: 'detached' });
    // Each person can turn role icons off
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByLabel('Show next to names').selectOption('off');
    await page.locator('.sidebar .user', { hasText: 'carol' }).getByLabel('Moderator').waitFor({ state: 'detached' });
    await page.getByLabel('Show next to names').selectOption('all');
    await page.locator('.sidebar .user', { hasText: 'carol' }).getByLabel('Moderator').waitFor();
    // Spheres are the default; switching to pictures and back does not move the names
    const carolName = page.locator('.sidebar .user', { hasText: 'carol' }).locator('.label');
    const nameAt = (await carolName.boundingBox())!.x;
    await page.locator('.sidebar .user', { hasText: 'carol' }).locator('.orb .ball').waitFor();
    await page.getByLabel('Show people as').selectOption('pictures');
    await page.locator('.sidebar .user', { hasText: 'carol' }).locator('.orb').waitFor({ state: 'detached' });
    assert.equal((await carolName.boundingBox())!.x, nameAt, 'the name stays where it was');
    await page.getByLabel('Show people as').selectOption('spheres');
    await page.locator('.sidebar .user', { hasText: 'carol' }).locator('.orb .ball').waitFor();
    assert.equal(await page.locator('.chat .msg .orb').count(), 0, 'chat keeps pictures and letters');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // The panel may be closed or showing a channel; one click brings up the members either way
    const panelWasOpen = await page.locator('aside.panel').count() > 0;
    const membersPanel = page.locator('aside.panel', { has: page.locator('h2', { hasText: /^Members$/ }) });
    if (!(await membersPanel.count())) await page.getByTitle('Members').click();
    await membersPanel.locator('.avatar').first().waitFor();
    assert.equal(await membersPanel.locator('.orb').count(), 0, 'the member list keeps pictures and letters');
    if (!panelWasOpen) {
      await page.getByTitle('Members').click();
      await page.locator('aside.panel').waitFor({ state: 'detached' });
    }
    console.log('ok: people shown as spheres');
    // The published role data is never drawn
    assert.equal(await page.locator('img[src^="data:,mumh5roles"]').count(), 0);
    // The user menu switches roles directly and stays open for the next one
    const carolRow = page.locator('.sidebar .user', { hasText: 'carol' });
    const quickRole = async () => {
      await carolRow.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Roles', exact: true }).hover();
      const item = page.getByRole('menuitemcheckbox', { name: 'Moderator' });
      await item.waitFor();
      return item;
    };
    const quick = await quickRole();
    assert.equal(await quick.getAttribute('aria-checked'), 'true');
    await quick.click();
    await page.locator('.menu.side [role=menuitemcheckbox][aria-checked=false]', { hasText: 'Moderator' }).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await aclSaved(0, a => !a.groups.find(g => g.name === roleGroup.name)!.add.includes(carolId), 'role removed from the menu');
    await carolRow.getByLabel('Moderator').waitFor({ state: 'detached' });
    await (await quickRole()).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await aclSaved(0, a => a.groups.find(g => g.name === roleGroup.name)!.add.includes(carolId), 'role added from the menu');
    await carolRow.getByLabel('Moderator').waitFor();
    // The row a menu belongs to stays marked until the menu closes
    const menuRow = page.locator('[data-menu-on]');
    await carolRow.click({ button: 'right' });
    assert.equal(await menuRow.count(), 1);
    assert.match((await menuRow.textContent())!, /carol/);
    if (shots) await page.screenshot({ path: path.join(shots, 'menu-row.png') });
    await page.keyboard.press('Escape');
    await menuRow.waitFor({ state: 'detached' });
    await page.locator('.row.channel', { hasText: 'Team Room' }).click({ button: 'right' });
    assert.match((await menuRow.textContent())!, /Team Room/);
    assert.equal(await menuRow.count(), 1);
    await page.keyboard.press('Escape');
    await menuRow.waitFor({ state: 'detached' });
    // On a phone the side menu stays on screen
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole('button', { name: 'Open channels' }).click();
    await carolRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Roles', exact: true }).click();
    const phoneSide = page.locator('.menu.side');
    await phoneSide.getByRole('menuitemcheckbox', { name: 'Moderator' }).waitFor();
    assert.ok(await phoneSide.evaluate(m => {
      const box = m.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    }), 'the side menu fits a phone');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
    console.log('ok: roles switched from the user menu');
    // Deleting the role removes its group, its rules and its key
    const rolesAgain = await openRoles();
    await rolesAgain.getByRole('list', { name: 'Roles' }).getByRole('button', { name: /^Moderator/ }).click();
    await rolesAgain.getByRole('button', { name: 'Delete role' }).click();
    await rolesAgain.getByRole('button', { name: 'Save', exact: true }).click();
    const rolesGone = await aclSaved(0, a => !a.groups.some(g => g.name === roleGroup.name), 'role deleted');
    assert.ok(!rolesGone.acls.some(r => r.group === `#${roleKey}`));
    await page.locator('.sidebar .user', { hasText: 'carol' }).getByLabel('Moderator').waitFor({ state: 'detached' });
    carol.disconnect();
    console.log('ok: roles with a permission, icon, member and access key');

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

    // Channel password: set in the dialog, in the form the desktop client uses
    const aclOf = (id: number) => {
      const got = new Promise<ChannelAcl>(res => { const off = admin.on('acl', a => { if (a.channelId === id) { off(); res(a); } }); });
      admin.queryAcl(id);
      return within(got, `ACL of channel ${id}`);
    };
    await page.mouse.click(listBox.x + listBox.width / 2, listBox.y + listBox.height - 20, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Create channel...' }).click();
    await page.getByLabel('Name').fill('Vault');
    await page.getByLabel('Password', { exact: true }).fill('!bad');
    await page.getByRole('button', { name: 'Create channel' }).click();
    await page.getByText('cannot start with').waitFor();
    await page.getByLabel('Password', { exact: true }).fill('first pass');
    await page.getByRole('button', { name: 'Create channel' }).click();
    await bobSees('password locks the channel', () => chByName('Vault')?.canEnter === false);
    const vaultId = chByName('Vault')!.id;
    assert.equal(channelPassword(await aclOf(vaultId)), 'first pass');

    // Changing it: the dialog shows the current one, and the old one stops working
    const vaultRow = page.locator('.channel .name', { hasText: 'Vault' });
    await vaultRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit channel...' }).click();
    const vaultDlg = page.getByRole('dialog', { name: 'Channel: Vault' });
    await vaultDlg.locator('#ch-password:not([disabled])').waitFor();
    assert.equal(await vaultDlg.locator('#ch-password').inputValue(), 'first pass');
    await vaultDlg.locator('#ch-password').fill('vault pass');
    await vaultDlg.getByRole('button', { name: 'Save', exact: true }).click();
    await vaultDlg.waitFor({ state: 'detached' });
    await within((async () => { while (channelPassword(await aclOf(vaultId)) !== 'vault pass') await page.waitForTimeout(200); })(), 'password changed');
    bob.setTokens(['first pass']);
    await bob.flushed();
    assert.equal(chByName('Vault')!.canEnter, false, 'the old password no longer opens it');
    bob.setTokens(['VAULT PASS']);
    await bobSees('the new password opens it, in any case', () => chByName('Vault')?.canEnter === true);
    bob.setTokens([]);
    await bobSees('locked again without it', () => chByName('Vault')?.canEnter === false);

    // Alice has Write everywhere and keeps the password she set. To meet the prompt she loses
    // Write here, and the password changes to one she does not have.
    const aliceId = [...admin.users.values()].find(u => u.name === 'alice')!.session;
    const aliceWas = admin.users.get(aliceId)!.channelId;
    const vaultRules = withPassword(await aclOf(vaultId), 'door pass');
    admin.saveAcl({ ...vaultRules, acls: [...vaultRules.acls, { applyHere: true, applySubs: false, inherited: false, userId: null, group: `$${aliceHash}`, grant: 0, deny: PERM.Write }] });
    await within((async () => { while (await vaultRow.getAttribute('title') !== 'Locked. Double-click to enter the password') await page.waitForTimeout(100); })(), 'locked for alice');
    await vaultRow.locator('svg').first().waitFor();
    await vaultRow.dblclick();
    const ask = page.getByRole('dialog', { name: 'Join Vault' });
    await ask.getByLabel('Channel password').fill('nope');
    await ask.getByRole('button', { name: 'Join', exact: true }).click();
    await ask.getByText('Wrong password').waitFor();
    assert.notEqual(admin.users.get(aliceId)!.channelId, vaultId);
    await ask.getByLabel('Channel password').fill('door pass');
    await ask.getByRole('button', { name: 'Join', exact: true }).click();
    await within(new Promise<void>(res => {
      const check = () => admin.users.get(aliceId)?.channelId === vaultId ? res() : setTimeout(check, 100);
      check();
    }), 'alice joined with the password');
    assert.deepEqual(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('mumh5.tokens') ?? '{}')).flat().includes('door pass')), true, 'a password that worked is kept');
    admin.setUserState(aliceId, { channel_id: aliceWas });
    admin.saveAcl(vaultRules);
    await within(new Promise<void>(res => {
      const check = () => admin.users.get(aliceId)?.channelId === aliceWas ? res() : setTimeout(check, 100);
      check();
    }), 'alice back');
    await within((async () => { while ((await aclOf(vaultId)).acls.some(r => !r.inherited && r.group === `$${aliceHash}`)) await page.waitForTimeout(200); })(), 'rule removed');

    // Clearing the field removes the password for everyone
    await vaultRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit channel...' }).click();
    await vaultDlg.locator('#ch-password:not([disabled])').waitFor();
    await vaultDlg.locator('#ch-password').fill('');
    await vaultDlg.getByRole('button', { name: 'Save', exact: true }).click();
    await bobSees('password removed', () => chByName('Vault')?.canEnter === true);
    admin.removeChannel(vaultId);
    await bobSees('vault gone', () => !chByName('Vault'));
    console.log('ok: channel password set, changed, asked for, kept and removed');

    // Admin badge: from the root group, published by a client that may read it
    const crownName = `crown-${Date.now() % 100000}`;
    const crown = await headless(crownName);
    try {
      admin.register(crown.session!);
      await within(new Promise<void>(res => {
        const check = () => admin.users.get(crown.session!)?.userId != null ? res() : setTimeout(check, 100);
        check();
      }), 'registered');
      const crownId = admin.users.get(crown.session!)!.userId!;
      const rootBefore = await aclOf(0);
      const groups = rootBefore.groups.some(g => g.name === 'admin')
        ? rootBefore.groups.map(g => g.name === 'admin' ? { ...g, add: [...g.add, crownId] } : g)
        : [...rootBefore.groups, { name: 'admin', inherited: false, inherit: true, inheritable: true, add: [crownId], remove: [], inheritedMembers: [] }];
      const crownRow = page.locator('.sidebar .user', { hasText: crownName });
      await crownRow.waitFor();
      assert.equal(await crownRow.getByLabel('Server admin').count(), 0, 'no badge before joining the group');
      // Changed by someone else: alice's client has Write, notices and publishes the list
      admin.saveAcl({ ...rootBefore, groups });
      await crownRow.getByLabel('Server admin').waitFor();
      await page.locator('.sidebar .user', { hasText: 'SuperUser' }).getByLabel('Server admin').waitFor();
      assert.equal(await page.locator('.sidebar .user', { hasText: 'bob' }).getByLabel('Server admin').count(), 0);
      if (shots) await page.screenshot({ path: path.join(shots, 'admin-badge.png') });
      await crownRow.click();
      await page.getByRole('dialog', { name: `Profile of ${crownName}` }).getByText('Admin', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      admin.saveAcl(rootBefore);
      await within((async () => { while (await crownRow.getByLabel('Server admin').count()) await page.waitForTimeout(100); })(), 'badge gone when removed from the group');
    } finally {
      crown.disconnect();
    }
    console.log('ok: admin badge follows the root admin group');

    // Move a group of six by dragging, then by the channel picker.
    const movers: MumbleClient[] = [];
    try {
      for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f']) movers.push(await headless(`move-${suffix}`));
      const mover = (suffix: string) => page.locator('.sidebar .user', { hasText: `move-${suffix}` });
      await mover('f').waitFor();
      // Shift and Ctrl/Cmd both add or remove one person; Shift does not select a range
      await mover('a').click({ modifiers: ['Shift'] });
      await page.locator('.sidebar').getByRole('button', { name: 'Clear', exact: true }).waitFor();
      assert.ok(await page.locator('.sidebar .user .user-check').count() > 0, 'modifier-click shows the same selection controls');
      await mover('f').click();
      assert.equal(await page.locator('.sidebar .user[aria-pressed="true"]').count(), 2, 'a plain click continues the selection started with Shift');
      for (const suffix of ['b', 'c']) await mover(suffix).click({ modifiers: ['Control'] });
      for (const suffix of ['d', 'e']) await mover(suffix).click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('.sidebar .user[aria-pressed="true"]').count(), 6);
      await mover('c').click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('.sidebar .user[aria-pressed="true"]').count(), 5);
      await mover('c').click({ modifiers: ['Meta'] });
      assert.equal(await page.locator('.sidebar .user[aria-pressed="true"]').count(), 6);
      assert.equal(await page.getByRole('dialog', { name: /Profile of move-/ }).count(), 0, 'selection gestures do not open profiles');

      const allMoved = (id: number) => within(new Promise<void>(resolve => {
        const check = () => {
          if (movers.every(c => bob.users.get(c.session!)?.channelId === id)) resolve();
          else setTimeout(check, 100);
        };
        check();
      }), `all six clients in channel ${id}`, 20000);
      await mover('a').dragTo(page.locator('.channel', { hasText: 'Lobby' }).first());
      await allMoved(lobby.id);
      assert.equal(await page.locator('.sidebar .user[aria-pressed="true"]').count(), 0, 'a move clears the selection');
      await page.locator('.selection [role="status"]').filter({ hasText: 'Moved 6 of 6' }).waitFor();
      await page.locator('.selection').getByRole('button', { name: 'Done', exact: true }).click();
      for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f']) await mover(suffix).click({ modifiers: ['Control'] });
      await page.locator('.sidebar').getByLabel('Move selected people to').selectOption('0');
      assert.ok(movers.every(c => bob.users.get(c.session!)?.channelId === lobby.id), 'choosing a destination does not submit');
      // On a short window the bar takes at most half of the list, and the move row stays in it
      await page.setViewportSize({ width: 900, height: 420 });
      const area = await box('.sidebar .scroll'), bar = await box('.selection'), moveRow = await box('.selection .move');
      assert.ok(bar.height <= Math.max(area.height / 2, 100) + 1, `selection bar leaves the list visible (${bar.height} of ${area.height})`);
      assert.ok(moveRow.y + moveRow.height <= bar.y + bar.height, 'move row visible without scrolling the bar');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.locator('.selection').getByRole('button', { name: 'Move 6 people', exact: true }).click();
      await allMoved(0);
      assert.equal(await page.locator('.sidebar .user[aria-pressed="true"]').count(), 0, 'Move to clears the selection');
      for (const suffix of ['a', 'b']) await mover(suffix).click({ modifiers: ['Shift'] });
      await page.locator('.sidebar .user', { hasText: 'bob' }).dragTo(page.locator('.channel', { hasText: 'Lobby' }).first());
      await within(new Promise<void>(resolve => {
        const check = () => bob.self?.channelId === lobby.id ? resolve() : setTimeout(check, 100);
        check();
      }), 'only the unselected client moved');
      assert.ok(movers.every(c => bob.users.get(c.session!)?.channelId === 0));
      assert.equal(await page.locator('.sidebar .user[aria-pressed="true"]').count(), 2, 'dragging an unselected client keeps the selection');
      bob.joinChannel(0);
      await within(new Promise<void>(resolve => {
        const check = () => bob.self?.channelId === 0 ? resolve() : setTimeout(check, 100);
        check();
      }), 'bob back in Root');
      const selected = () => page.locator('.sidebar .user[aria-pressed="true"]').count();
      assert.equal(await page.locator('.selection').count(), 1, `one selection bar (members panel open: ${await page.locator('aside.members').count() > 0})`);
      await page.locator('.sidebar').getByLabel('Move selected people to').focus();
      await page.keyboard.press('Escape');
      assert.equal(await selected(), 0);
      assert.equal(await page.locator('.selection').count(), 0, 'no bar without a selection');
      await mover('a').click({ modifiers: ['Shift'] });
      await mover('b').click({ modifiers: ['Control'] });
      await mover('c').click({ modifiers: ['Control'] });
      assert.equal(await selected(), 3);
      movers[2].disconnect();
      await mover('c').waitFor({ state: 'detached' });
      assert.equal(await selected(), 2, 'disconnected clients leave the selection');
      await mover('f').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'View profile', exact: true }).click();
      await page.getByRole('dialog', { name: 'Profile of move-f' }).waitFor();
      assert.equal(await selected(), 2, 'the profile menu keeps the selection');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: /Profile of move-/ }).waitFor({ state: 'detached' });
      assert.equal(await selected(), 2, 'Escape that closes a profile keeps the selection');
      await mover('a').focus();
      await page.keyboard.press('Escape');
      assert.equal(await selected(), 0, 'Escape on a selected row clears the selection');
      // Once one person is selected, plain clicks and keyboard activation select more.
      await mover('a').click({ modifiers: ['Control'] });
      await mover('b').focus();
      await page.keyboard.press('Space');
      assert.equal(await selected(), 2);
      assert.equal(await page.getByRole('dialog', { name: /Profile of move-/ }).count(), 0);
      await mover('a').click();
      assert.equal(await selected(), 1, 'a second click deselects');
      await page.locator('.selection').focus();
      await page.keyboard.press('Escape');
      assert.equal(await selected(), 0);
      assert.equal(await page.locator('.selection').count(), 0, 'Escape closes the bar');
      console.log('ok: modifier and explicit selection, group moves and keyboard focus');
    } finally {
      for (const client of movers) client.disconnect();
    }
    // Their rows leaving moves the channels up, so the drag below has to start after that
    await page.locator('.sidebar .user', { hasText: 'move-' }).first().waitFor({ state: 'detached' });

    // Dropped on the lower or upper third of a row, a channel goes behind or in front of it.
    // A line shows where it will land.
    const topOrder = () => [...bob.channels.values()].filter(c => c.parent === 0).sort(byOrder).map(c => c.name);
    assert.deepEqual(topOrder(), ['Games', 'Lobby']);
    await page.locator('.channel .name', { hasText: 'Games' }).hover();
    await page.mouse.down();
    const lobbyBox = (await page.locator('.channel', { hasText: 'Lobby' }).first().boundingBox())!;
    await page.mouse.move(lobbyBox.x + 60, lobbyBox.y + lobbyBox.height - 4, { steps: 8 });
    // Lobby is open (people inside), so the line sits below them
    await page.locator('li.after-end', { hasText: 'Lobby' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'drag-line.png') });
    assert.equal(await page.locator('.channel.dragging', { hasText: 'Games' }).count(), 1, 'the dragged channel is dimmed');
    await page.mouse.up();
    await bobSees('Games behind Lobby', () => topOrder().join() === 'Lobby,Games');
    assert.equal(await page.locator('li.after-end, .channel.after, .channel.before, .channel.into').count(), 0);
    await page.locator('.channel .name', { hasText: 'Games' }).dragTo(page.locator('.channel', { hasText: 'Lobby' }).first(), { targetPosition: { x: 60, y: 3 } });
    await bobSees('Games in front of Lobby again', () => topOrder().join() === 'Games,Lobby');
    // The pointer rests on a row with a description; move away so no preview covers the list
    await page.mouse.move(700, 400);
    await page.locator('.desc-pop').waitFor({ state: 'detached' });
    console.log('ok: drag and drop puts a channel in front of or behind another, with a line where it lands');

    // Delete (Team Room is now inside Games, which stays collapsed while empty)
    await page.locator('.channel', { hasText: 'Games' }).first().getByRole('button', { name: 'Expand' }).click();
    await page.locator('.channel .name', { hasText: 'Team Room' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete channel...' }).click();
    await page.getByRole('button', { name: 'Delete channel' }).click();
    await bobSees('deleted', () => !chByName('Team Room'));
    console.log('ok: channel deleted');

    // Toolbar: expand and collapse the whole tree
    // The button follows the tree, so make sure something is closed before asking for Expand
    const treeButton = (name: string) => page.locator('.me').getByRole('button', { name });
    if (await treeButton('Collapse all channels').count()) await treeButton('Collapse all channels').click();
    await treeButton('Expand all channels').click();
    await page.locator('.channel', { hasText: 'Minecraft' }).waitFor();
    await treeButton('Collapse all channels').click();
    await page.locator('.channel', { hasText: 'Minecraft' }).waitFor({ state: 'detached' });
    // Occupied channels close too, and the button works again after that
    assert.notEqual(await page.locator('.me .who span').textContent(), 'Root');
    await page.locator('.sidebar .row.user.self').waitFor({ state: 'detached' });
    await treeButton('Expand all channels').click();
    await page.locator('.sidebar .row.user.self').waitFor();
    await page.locator('.channel', { hasText: 'Minecraft' }).waitFor();
    // Root has no caret, and the server name starts where the status text does
    assert.equal(await page.locator('.channel').first().locator('.caret').count(), 0);
    const textLeft = (sel: string) => page.locator(sel).evaluate(el => {
      const range = document.createRange();
      const text = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())!;
      range.selectNodeContents(text);
      return range.getBoundingClientRect().left;
    });
    assert.ok(Math.abs(await textLeft('.sidebar header .server-name') - await textLeft('.sidebar header .status')) < 1);
    console.log('ok: toolbar expands and collapses all channels repeatedly, root has no caret, header text lines up');

    // Tree lines: root has its node, the line stops at the last channel, and people hang from their channel's line
    assert.equal(await page.locator('.channel').first().locator('.root-mark svg').count(), 1);
    const rootChannels = page.locator('.sidebar .tree > li > ul:not(.users) > li');
    const rootChannelCount = await rootChannels.count();
    assert.ok(rootChannelCount > 1);
    assert.equal(await rootChannels.first().locator(':scope > .trunk').count(), 1);
    assert.equal(await rootChannels.last().locator(':scope > .trunk').count(), 0);
    assert.equal(await rootChannels.last().locator(':scope > .row .branch.end').count(), 1);
    const lineOffset = await page.locator('.sidebar li:has(> .row.channel.here)').evaluate(li => {
      const stem = li.querySelector(':scope > .row .stem')!;
      const person = li.querySelector(':scope > .users .branch')!;
      return Math.abs(stem.getBoundingClientRect().left - person.getBoundingClientRect().left);
    });
    assert.ok(lineOffset < 0.5, `people's line is ${lineOffset}px off their channel's line`);
    console.log('ok: tree lines end at the last channel and connect people to their channel');
    const setTreeLines = async (on: boolean) => {
      await page.getByRole('button', { name: 'Configure', exact: true }).click();
      await page.getByRole('tab', { name: 'Appearance' }).click();
      await page.getByRole('checkbox', { name: 'Show tree lines', exact: true }).setChecked(on);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
    };
    const treeMarks = page.locator('.sidebar .tree :is(.branch, .stem, .trunk, .root-mark)');
    await setTreeLines(false);
    assert.equal(await treeMarks.count(), 0);
    await setTreeLines(true);
    assert.ok(await treeMarks.count() > 0);
    console.log('ok: tree lines turn off and on in Appearance');

    // ─── Text channels: read and written without joining, between mumh5 clients ───
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.getByRole('tab', { name: 'Chat and files', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Save chat history on this device', exact: true }).check();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // Bob plays a second mumh5 client by speaking the plugin data protocol
    const assembler = new TextAssembler();
    const signals: { type: number; text?: string }[] = [];
    const waiting: { want: (s: { type: number; text?: string }) => boolean; res: (s: { type: number; text?: string }) => void }[] = [];
    const bobSend = async (to: number[], type: Parameters<typeof encodeText>[0], body?: unknown) => {
      for (const p of await encodeText(type, body)) { bob.sendPluginData(to, TEXT_DATA_ID, p); await new Promise(r => setTimeout(r, 120)); }
    };
    bob.on('pluginData', async (sender, dataId, data) => {
      if (dataId !== TEXT_DATA_ID) return;
      const signal = await assembler.push(sender, data);
      if (!signal) return;
      // Like a mumh5 client that was here before: answers a newcomer and hands over an old message
      if (signal.type === TEXT.hello) bobSend([sender], TEXT.here);
      if (signal.type === TEXT.want && notesId != null) {
        bobSend([sender], TEXT.history, { c: notesId, m: [{ i: 'from-before', t: Date.now() - 3600_000, n: 'dave', k: '', h: 'said while you were away' }] });
      }
      signals.push(signal);
      const at = waiting.findIndex(w => w.want(signal));
      if (at >= 0) waiting.splice(at, 1)[0].res(signal);
    });
    const bobGets = (label: string, want: (s: { type: number; text?: string }) => boolean) =>
      within(new Promise<{ type: number; text?: string }>(res => waiting.push({ want, res })), label);

    await page.mouse.click(listBox.x + listBox.width / 2, listBox.y + listBox.height - 20, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Create channel...' }).click();
    await page.getByLabel('Name').fill('notes');
    await page.getByLabel('Text channel (mumh5 only)').check();
    await page.getByRole('button', { name: 'Create channel' }).click();
    await bobSees('text channel', () => !!chByName('notes')?.description.startsWith(TEXT_MARK));
    notesId = chByName('notes')!.id;
    const notesRow = page.locator('.channel', { hasText: 'notes' });
    // No description marker for a channel whose description is only the text channel mark
    assert.equal(await notesRow.locator('.desc').count(), 0);
    const voiceChannel = await page.locator('.me .who span').textContent();
    await notesRow.locator('.name').click();
    await page.locator('.chat h1', { hasText: 'notes' }).waitFor();
    assert.equal(await page.locator('.me .who span').textContent(), voiceChannel, 'opening a text channel does not join it');
    const sent = bobGets('text channel message', m => m.type === TEXT.msg);
    await page.locator('.chat .composer [contenteditable]').fill('text hello');
    await page.locator('.chat .composer [contenteditable]').press('Enter');
    const got = parseMsg((await sent).text);
    assert.equal(got?.c, notesId);
    assert.equal(got?.h, 'text hello');
    await page.locator('.chat .msg', { hasText: 'text hello' }).waitFor();
    console.log('ok: text channel created, opened without joining, message reaches others');

    // Narrow: the text channel is a tab beside the voice channel's, which keeps its own tab
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator('.chat-tab [role="tab"]', { hasText: 'notes' }).waitFor();
    assert.equal(await page.locator('.chat-tab [role="tab"]').first().locator('.name').textContent(), voiceChannel, 'first tab stays on the voice channel');
    await page.locator('.chat-tab', { hasText: 'notes' }).locator('.close').click();
    assert.equal(await page.locator('.chat-tab', { hasText: 'notes' }).count(), 0);
    await page.setViewportSize({ width: 1280, height: 800 });
    console.log('ok: text channel as a closable tab next to the voice channel tab');

    // Files go into text channels too, announced with a preview that fits a text channel message
    const notePng = path.join(userData, 'note.png');
    writeFileSync(notePng, testPng(800, 600));
    const sentFile = bobGets('file in a text channel', m => m.type === TEXT.msg && !!parseMsg(m.text)?.h.includes('note.png'));
    await page.locator('.chat .composer input[type=file]').first().setInputFiles(notePng);
    const fileMsg = parseMsg((await sentFile).text)!;
    assert.equal(fileMsg.c, notesId);
    const [noteFile] = takeFiles(fileMsg.h).files;
    assert.equal(noteFile.meta.n, 'note.png');
    assert.ok(noteFile.poster.startsWith('data:image/jpeg;base64,'), 'with a preview picture');
    await page.locator('.chat .msg .file img[alt="note.png"]').waitFor();
    console.log(`ok: file sent into a text channel (${fileMsg.h.length} chars)`);

    // A message from someone in another channel arrives; unread while another chat is open
    await bobSend([aliceSession()], TEXT.msg, { i: 'bob-1', c: notesId, h: 'hello from <b>bob</b>' });
    await page.locator('.chat .msg', { hasText: 'hello from bob' }).locator('strong', { hasText: 'bob' }).first().waitFor();
    await page.locator('.channel .name', { hasText: voiceChannel! }).first().dblclick();
    await page.locator('.chat h1', { hasText: voiceChannel! }).waitFor();
    await bobSend([aliceSession()], TEXT.msg, { i: 'bob-2', c: notesId, h: 'second from bob' });
    await notesRow.locator('.badge', { hasText: '1' }).waitFor();
    // The same message again is not shown twice
    await bobSend([aliceSession()], TEXT.msg, { i: 'bob-2', c: notesId, h: 'second from bob' });
    await page.waitForTimeout(500);
    await notesRow.locator('.name').click();
    await page.locator('.chat .msg', { hasText: 'second from bob' }).waitFor();
    assert.equal(await page.locator('.chat .html', { hasText: 'second from bob' }).count(), 1);
    assert.equal(await notesRow.locator('.badge').count(), 0);
    // Not into ordinary channels
    await bobSend([aliceSession()], TEXT.msg, { i: 'bob-3', c: gamesId, h: 'sneaked in' });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.channel', { hasText: 'Games' }).first().locator('.badge').count(), 0);
    console.log('ok: text channel messages arrive, count as unread, no duplicates, only in text channels');

    // The app hands its messages to a client that asks
    const handed = bobGets('history', m => m.type === TEXT.history && parseHistory(m.text).length > 0);
    await bobSend([aliceSession()], TEXT.want);
    const history = parseHistory((await handed).text);
    assert.deepEqual(history.map(m => m.h), ['text hello', fileMsg.h, 'hello from <b>bob</b>', 'second from bob']);
    assert.deepEqual(history.map(m => m.n), ['alice', 'alice', 'bob', 'bob']);
    assert.equal(history[0].c, notesId);
    await page.locator('.channel .name', { hasText: voiceChannel! }).first().dblclick();
    await page.locator('.chat h1', { hasText: voiceChannel! }).waitFor();
    console.log('ok: text channel messages handed to a client that asks');
  }

  // A picture too large for a message goes as a file, with a scaled preview for other clients
  await page.locator('.channel .name', { hasText: 'Root' }).dblclick();
  await page.locator('.me .who span', { hasText: 'Root' }).waitFor();
  const big = path.join(userData, 'big.png');
  writeFileSync(big, testPng(1600, 1200));
  const gotBig = new Promise<string>(res => bob.on('text', m => { if (m.html.includes('big.png')) res(m.html); }));
  await page.locator('.chat .composer input[type=file]').first().setInputFiles(big);
  const announcedBig = await within(gotBig, 'large picture', 15000);
  assert.match(announcedBig, /<b>big\.png<\/b> \([\d.]+ MB, file shared with mumh5\)<br\/><img src="data:image\/jpeg;base64,[^"]+"\/><!--\/mumh5:file-->$/);
  assert.ok(announcedBig.length <= 131072, `within the server limit (${announcedBig.length})`);
  // A small one goes inline as it is, for everyone
  const small = path.join(userData, 'small.png');
  writeFileSync(small, testPng(60, 40));
  const gotSmall = new Promise<string>(res => bob.on('text', m => { if (m.html.startsWith('<img')) res(m.html); }));
  await page.locator('.chat .composer input[type=file]').first().setInputFiles(small);
  assert.match(await within(gotSmall, 'small picture'), /^<img src="data:image\/png;base64,[^"]+" alt="small\.png"\/>$/);
  console.log(`ok: large picture sent as a file with a preview (${announcedBig.length} chars), small one inline`);

  // A click on an image in the chat shows it large; Escape or a click closes it
  await page.locator('.chat .msg .file img[alt="big.png"]').click();
  const viewer = page.getByRole('dialog', { name: 'Image' });
  await viewer.waitFor();
  const shown = await viewer.locator('img').evaluate((i: HTMLImageElement) => [i.naturalWidth > 0, i.getBoundingClientRect().width]);
  assert.ok(shown[0] && (shown[1] as number) > 300, `image shown large: ${shown}`);
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'detached' });
  await page.locator('.chat .msg .embed img').last().click();
  await viewer.waitFor();
  await viewer.getByRole('button', { name: 'Close image' }).click({ position: { x: 5, y: 5 } });
  await viewer.waitFor({ state: 'detached' });
  console.log('ok: images open large on click');

  // The wheel zooms toward the pointer, a zoomed image can be dragged and a click on it keeps it open
  await page.locator('.chat .msg .file img[alt="big.png"]').click();
  await viewer.waitFor();
  const pictureBox = () => viewer.locator('img').evaluate(i => {
    const r = i.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const fitted = await pictureBox();
  const aimX = fitted.left + fitted.width * 0.4, aimY = fitted.top + fitted.height * 0.4;
  await page.mouse.move(aimX, aimY);
  await page.mouse.wheel(0, -500);
  await page.waitForFunction(w => document.querySelector('[aria-label="Image"] img')!.getBoundingClientRect().width > w * 2, fitted.width);
  const zoomedIn = await pictureBox();
  assert.ok(Math.abs((aimX - zoomedIn.left) / zoomedIn.width - 0.4) < 0.01, `zoom keeps the point under the pointer: ${JSON.stringify(zoomedIn)}`);
  assert.ok(Math.abs((aimY - zoomedIn.top) / zoomedIn.height - 0.4) < 0.01, `zoom keeps the point under the pointer: ${JSON.stringify(zoomedIn)}`);
  await page.mouse.down();
  await page.mouse.move(aimX - 60, aimY - 40, { steps: 5 });
  await page.mouse.up();
  const draggedTo = await pictureBox();
  assert.ok(Math.abs(draggedTo.left - zoomedIn.left + 60) <= 1 && Math.abs(draggedTo.top - zoomedIn.top + 40) <= 1, `drag moves the image: ${JSON.stringify(draggedTo)}`);
  assert.equal(await viewer.count(), 1, 'a drag does not close the image');
  await page.mouse.click(aimX - 60, aimY - 40);
  assert.equal(await viewer.count(), 1, 'a click on the zoomed image does not close it');
  await page.mouse.wheel(0, 5000);
  await page.waitForFunction(w => Math.abs(document.querySelector('[aria-label="Image"] img')!.getBoundingClientRect().width - w) < 1, fitted.width);
  const backToFit = await pictureBox();
  assert.ok(Math.abs(backToFit.left - fitted.left) < 1 && Math.abs(backToFit.top - fitted.top) < 1, `zooming out centers it again: ${JSON.stringify(backToFit)}`);
  await page.mouse.click(aimX, aimY);
  await viewer.waitFor({ state: 'detached' });
  console.log('ok: image viewer zooms with the wheel and drags');

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
  // A newer sound cuts off the one playing, and the second server's connect sound lands right
  // on alice-b arriving, so this is checked with someone arriving on their own
  await page.evaluate(() => { (window as any).__mumh5Sounds = []; });
  const visitor = await headless('sound-visitor');
  try {
    await page.waitForFunction(() => ((window as any).__mumh5Sounds ?? []).includes('userConnected'), null, { timeout: 5000 });
  } finally {
    visitor.disconnect();
  }
  await page.locator('.sidebar .user', { hasText: 'sound-visitor' }).waitFor({ state: 'detached' });

  // Joining a channel on the second server moves voice there
  await page.locator('.channel .name', { hasText: 'Root' }).dblclick();
  await until2('voice moved to the second server', () => !userState('alice-b')?.selfDeaf && !!userState('alice')?.selfDeaf);
  assert.equal(await page.locator('.rail .tile.voice').getAttribute('title').then(t => t?.startsWith('Second')), true);
  // The server with voice leads the rail, although it was added last
  const railTop = (title: string) => page.locator(`.rail .tile[title^="${title}"]`).boundingBox().then(b => b!.y);
  assert.ok(await railTop('Second') < await railTop('Test Server'), 'voice server on top');
  assert.match(await page.locator('.rail .tile').first().getAttribute('title') ?? '', /^Test Server/, 'the saved order is untouched');
  console.log('ok: voice follows the channel you join');

  // Messages on the server not on screen show as unread on its tile
  bob.sendText({ channels: [0] }, 'ping both');
  await page.locator('.rail .tile[title^="Test Server"] .unread').waitFor();
  console.log('ok: unread badge on the background server');

  // With the list hidden, the button carries the other server's unread count
  await page.getByRole('button', { name: 'Hide server list' }).click();
  await page.locator('.rail').waitFor({ state: 'detached' });
  await page.locator('.server-btn .unread').waitFor();
  console.log('ok: hidden server list shows unread on the current server button');

  // Right-click on the button: the server's actions, switching, and what the hidden list offers
  const serverBtnMenu = () => page.locator('.server-btn').click({ button: 'right' });
  await serverBtnMenu();
  await page.locator('.menu .head', { hasText: 'Second' }).waitFor();
  for (const item of ['Disconnect', 'Change icon...', 'Edit...', 'Add a server...', 'Browse public servers...', 'Show server list']) {
    await page.getByRole('menuitem', { name: item, exact: true }).waitFor();
  }
  await page.getByRole('menuitem', { name: /^Test Server \(\d+\)$/ }).click();
  await page.locator('.sidebar .title', { hasText: 'Test Server' }).waitFor();
  await page.locator('.server-btn .unread').waitFor({ state: 'detached' });
  await serverBtnMenu();
  await page.getByRole('menuitem', { name: 'Second', exact: true }).click();
  await page.locator('.sidebar .title', { hasText: 'Second' }).waitFor();
  await serverBtnMenu();
  await page.getByRole('menuitem', { name: 'Edit...', exact: true }).click();
  assert.equal(await page.getByLabel('Label').inputValue(), 'Second');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // The home screen opens over the running server: a draft in the message box survives it
  await page.getByLabel('Message').fill('draft kept');
  await serverBtnMenu();
  await page.getByRole('menuitem', { name: 'Go to home screen', exact: true }).click();
  const homeOver = page.locator('.home-over section.home');
  await homeOver.getByRole('heading', { name: 'Servers' }).waitFor();
  assert.ok(await page.getByLabel('Message').evaluate(el => !!el.closest('[inert]')), 'the view behind is out of reach');
  await homeOver.locator('.server-btn').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Back to server', exact: true }).click();
  await homeOver.waitFor({ state: 'detached' });
  assert.equal(await page.getByLabel('Message').textContent().then(t => t?.trim()), 'draft kept');
  await page.getByLabel('Message').fill('');
  await serverBtnMenu();
  await page.getByRole('menuitem', { name: 'Go to home screen', exact: true }).click();
  await homeOver.locator('.server', { hasText: 'Second' }).getByRole('button', { name: 'Open', exact: true }).click();
  await homeOver.waitFor({ state: 'detached' });
  await page.locator('.sidebar .title', { hasText: 'Second' }).waitFor();
  console.log('ok: home screen over a connected server');

  await serverBtnMenu();
  await page.getByRole('menuitem', { name: 'Show server list', exact: true }).click();
  await page.locator('.rail').waitFor();
  await page.getByRole('button', { name: 'Go to home screen' }).click();
  await homeOver.waitFor();
  assert.ok((await homeOver.boundingBox())!.x >= (await page.locator('.rail').boundingBox())!.width, 'the server list stays beside it');
  // Home carries the active marker while it is open, the server gets it back afterwards
  assert.equal(await page.locator('.rail .tile.active').count(), 1);
  assert.equal(await page.locator('.rail .tile.active').getAttribute('aria-label'), 'Back to server');
  await page.getByRole('button', { name: 'Back to server' }).click();
  await homeOver.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.rail .tile.active').count(), 1);
  assert.match(await page.locator('.rail .tile.active').getAttribute('title') ?? '', /^Second/);

  // Double click: on a server it closes the list, on the button it opens it and stays open
  await page.locator('.rail .tile[title^="Second"]').dblclick();
  await page.locator('.rail').waitFor({ state: 'detached' });
  await page.locator('.server-btn').dblclick();
  await page.locator('.rail').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.rail').count(), 1, 'the second click does not close it again');
  await page.locator('.sidebar .title', { hasText: 'Second' }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'the second click opens nothing');
  // With hints off, the tile under the pointer has its title set aside
  await page.mouse.move(700, 400);
  console.log('ok: right-click on the current server button');

  // Reorder by dragging Second above Test Server
  await page.locator('.rail .tile[title^="Second"]').dragTo(page.locator('.rail .tile[title^="Test Server"]'), { targetPosition: { x: 22, y: 4 } });
  assert.match(await page.locator('.rail .tile').first().getAttribute('title') ?? '', /^Second/);
  console.log('ok: servers reordered by drag and drop');

  // Custom icon from the tile's context menu: square-cropped and shown instead of initials
  const iconFile = path.join(userData, 'icon.png');
  writeFileSync(iconFile, testPng(300, 200));
  // With hints off, the title of whatever the pointer rests on is set aside; move off the tile first
  await page.mouse.move(700, 400);
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

  // Display name: changes at once, on the same connection, and the account name stays
  const chooseName = async (name: string) => {
    await page.locator('.me').getByRole('button', { name: 'Edit your profile' }).click();
    await page.getByRole('dialog', { name: 'Edit profile' }).getByRole('button', { name: 'Change name' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change your name' });
    await dialog.getByLabel('Display name').fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
  };
  const sessionBefore = userState('alice')!.session;
  await chooseName('Alice Display');
  await page.locator('.me .who strong', { hasText: 'Alice Display' }).waitFor();
  await until2('bob receives the display name', () => userState('alice')?.chosenName === 'Alice Display');
  assert.equal(userState('alice')!.session, sessionBefore, 'no reconnect');
  await page.locator('.sidebar .user', { hasText: 'Alice Display' }).first().waitFor();

  // Someone else's name keeps the account name beside it
  await chooseName('BOB');
  await page.locator('.me .who strong', { hasText: 'BOB (alice)' }).waitFor();
  await chooseName('Alice Display');
  await page.locator('.me .who strong', { hasText: 'Alice Display' }).waitFor();
  await until2('bob receives the name again', () => userState('alice')?.chosenName === 'Alice Display');
  console.log('ok: display name changes live and cannot pass as someone else');

  // A different account name is still set on the server entry. The chosen name comes back after
  // the reconnect, since guests lose their comment. Unique per run: a reused test server may
  // still have an earlier run's name registered.
  const newName = `alice${Date.now() % 100000}`;
  await page.locator('.rail .tile[title^="Test Server"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit...' }).click();
  await page.getByLabel('Username').fill(newName);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await until2('bob sees the new account with the chosen name', () => userState(newName)?.chosenName === 'Alice Display');
  await page.locator('.me .who strong', { hasText: 'Alice Display' }).waitFor();
  await chooseName('');
  await page.locator('.me .who strong', { hasText: newName }).waitFor();
  await until2('display name removed', () => userState(newName)?.chosenName === '');
  console.log('ok: display name survives a reconnect and can be removed');

  // Text channel after reconnecting: what this computer kept, plus what another client hands over
  if (notesId != null) {
    await page.locator('.channel .name', { hasText: 'notes' }).click();
    await page.locator('.chat .msg', { hasText: 'said while you were away' }).locator('strong', { hasText: 'dave' }).waitFor();
    const texts = await page.locator('.chat .msg .html').allTextContents();
    assert.deepEqual(texts.map(t => t.trim()).filter(t => !t.startsWith('You joined')), ['said while you were away', 'text hello', 'hello from bob', 'second from bob']);
    assert.equal(await page.locator('.channel', { hasText: 'notes' }).locator('.badge').count(), 0, 'old messages are not unread');
    // The file sent there was kept on this computer
    await page.locator('.chat .msg .file img[alt="note.png"]').waitFor();
    await page.locator('.channel .name', { hasText: 'Root' }).dblclick();
    await page.locator('.chat h1', { hasText: 'Root' }).waitFor();
    console.log('ok: text channel keeps its messages and catches up from another client');
  }

  // Self-registration from the right-click menu on yourself; the profile shows no badge either way
  const meRow = page.locator('.sidebar .user.self');
  await meRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Register on this server' }).click();
  await meRow.locator('.reg').waitFor();
  await meRow.click({ button: 'right' });
  assert.equal(await page.getByRole('menuitem', { name: 'Register on this server' }).count(), 0, 'no register item once registered');
  await page.keyboard.press('Escape');
  console.log('ok: registered on the server');

  // Giving the microphone back while muted (for Bluetooth headsets), and taking it again
  {
    const muteBtn = (name: 'Mute' | 'Unmute') => page.locator('.me').getByRole('button', { name, exact: true });
    if (!userState(newName)!.selfMute) {
      await muteBtn('Mute').click();
      await until2('muted', () => !!userState(newName)!.selfMute);
    }
    await page.getByTitle('Settings').click();
    assert.equal(await page.getByLabel('Give the microphone back while muted').isChecked(), false, 'off by default on a desktop');
    await page.getByLabel('Give the microphone back while muted').check();
    await page.getByText('The microphone is given back now.').waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // Unmuting takes it again
    const heard = new Promise<void>(res => { const off = bob.on('voice', raw => { if (decodeVoice(raw)?.session === userState(newName)!.session) { off(); res(); } }); });
    await muteBtn('Unmute').click();
    await until2('unmuted', () => !userState(newName)!.selfMute);
    await page.getByTitle('Settings').click();
    await page.getByText('The microphone is open now.').waitFor();
    await page.getByLabel('Give the microphone back while muted').uncheck();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    // Push to talk is the mode at this point: hold the key until bob hears the fake microphone
    await page.locator('.chat header h1').click();
    await page.keyboard.down('Backquote');
    await within(heard, 'voice after taking the microphone again', 15000);
    await page.keyboard.up('Backquote');
    await muteBtn('Mute').click();
    await until2('muted again', () => !!userState(newName)!.selfMute);
    console.log('ok: microphone given back while muted and taken again on unmute');
  }

  // ─── The Rooms interface: the same app arranged for phones ─────────────────
  {
    const before = page.viewportSize()!;
    await page.getByTitle('Settings').click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByRole('radio', { name: 'Rooms' }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 800 });
    const nav = page.getByRole('navigation', { name: 'Screens' });
    const rooms = page.getByRole('region', { name: 'Rooms' });
    await rooms.getByRole('heading', { name: 'Test Server' }).waitFor();
    assert.equal(await page.locator('.sidebar').count(), 0, 'the standard interface is gone');
    // People show in their room without opening it; the dock names the room you are in
    await rooms.locator('.room.here .person', { hasText: 'bob' }).waitFor();
    await page.locator('.dock', { hasText: 'Root' }).waitFor();
    await rooms.locator('.person', { hasText: 'bob' }).click({ modifiers: ['Control'] });
    await rooms.locator('.person', { hasText: newName }).click();
    assert.ok(await rooms.locator('.person[aria-pressed="true"]').count() >= 2);
    if (admin) {
      const games = [...bob.channels.values()].find(c => c.name === 'Games')!;
      await rooms.getByLabel('Move selected people to').selectOption(String(games.id));
      await rooms.getByRole('button', { name: 'Move 2 people', exact: true }).click();
      await until2('selected clients in Games', () => bob.self?.channelId === games.id && userState(newName)?.channelId === games.id);
      assert.equal(await rooms.locator('.person[aria-pressed="true"]').count(), 0, 'a move clears the selection');
      await rooms.locator('.person', { hasText: 'bob' }).click({ modifiers: ['Control'] });
      await rooms.locator('.person', { hasText: newName }).click({ modifiers: ['Shift'] });
      await rooms.getByLabel('Move selected people to').selectOption('0');
      await rooms.getByRole('button', { name: 'Move 2 people', exact: true }).click();
      await until2('selected clients back in Root', () => bob.self?.channelId === 0 && userState(newName)?.channelId === 0);
    } else await rooms.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await rooms.locator('.person[aria-pressed="true"]').count(), 0);
    if (admin) {
      await rooms.getByRole('button', { name: 'Join Games' }).click();
      await until2('alice in Games', () => bob.channels.get(userState(newName)!.channelId)?.name === 'Games');
      await page.locator('.dock', { hasText: 'Games' }).waitFor();
      await rooms.getByRole('button', { name: 'Join Root' }).click();
      await until2('alice back in Root', () => userState(newName)!.channelId === 0);
      await page.locator('.dock', { hasText: 'Root' }).waitFor();
    }
    console.log('ok: rooms interface lists rooms with their people and joins from the list');

    // Mute from the dock
    const wasMuted = !!userState(newName)!.selfMute;
    await page.locator('.dock').getByRole('button', { name: wasMuted ? 'Unmute' : 'Mute', exact: true }).click();
    await until2('mute toggled from the dock', () => !!userState(newName)!.selfMute === !wasMuted);
    await page.locator('.dock').getByRole('button', { name: wasMuted ? 'Mute' : 'Unmute', exact: true }).click();
    await until2('mute restored', () => !!userState(newName)!.selfMute === wasMuted);

    // Chat is a screen of its own
    await nav.getByRole('button', { name: 'Chat' }).click();
    const roomsMsg = new Promise<void>(res => bob.on('text', m => { if (m.html === 'hello from rooms') res(); }));
    await page.locator('.chat2 .composer [contenteditable]').fill('hello from rooms');
    await page.locator('.chat2 .composer [contenteditable]').press('Enter');
    await within(roomsMsg, 'message from the rooms interface');
    await page.locator('.chat2 .msg', { hasText: 'hello from rooms' }).waitFor();
    // Code snippets from the same message box; the dialog fits the phone width
    await page.locator('.chat2 .composer').getByRole('button', { name: 'Code snippet' }).click();
    const roomsSnippet = page.getByRole('dialog', { name: 'Code snippet' });
    assert.ok((await roomsSnippet.boundingBox())!.width <= 390);
    await roomsSnippet.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Back to rooms' }).click();
    await rooms.waitFor();

    // The voice screen shows the room as tiles with the large controls
    await nav.getByRole('button', { name: 'Voice' }).click();
    const voiceScreen = page.getByRole('region', { name: 'Voice', exact: true });
    await voiceScreen.locator('.tile', { hasText: 'bob' }).waitFor();
    await voiceScreen.getByRole('button', { name: /^Share your screen or camera$/ }).waitFor();
    await voiceScreen.getByRole('button', { name: 'Turn on your camera' }).waitFor();
    assert.equal(await page.locator('.dock').count(), 0, 'no dock on the voice screen');

    // People: a profile opens over the screen, a message opens the chat
    await nav.getByRole('button', { name: 'People' }).click();
    const people = page.getByRole('region', { name: 'People' });
    if (admin) await people.locator('.entry', { hasText: 'SuperUser' }).getByLabel('Server admin').waitFor();
    assert.equal(await people.locator('.entry', { hasText: 'bob' }).getByLabel('Server admin').count(), 0);
    await people.locator('.entry', { hasText: 'bob' }).locator('.main').click({ modifiers: ['Control'] });
    await people.locator('.entry', { hasText: newName }).locator('.main').click({ modifiers: ['Shift'] });
    assert.ok(await people.locator('.main[aria-pressed="true"]').count() >= 2);
    await people.getByRole('button', { name: 'Clear', exact: true }).click();
    await people.locator('.entry', { hasText: 'bob' }).locator('.main').click();
    await page.getByRole('dialog', { name: 'Profile of bob' }).locator('h3', { hasText: 'bob' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Profile of bob' }).waitFor({ state: 'detached' });
    await people.getByRole('button', { name: 'Message bob' }).click();
    await page.locator('.chat2 h1', { hasText: 'bob' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'rooms-phone.png') });

    // Wide windows keep the rooms next to the screen
    await page.setViewportSize({ width: 1280, height: 800 });
    await rooms.waitFor();
    await page.locator('.chat2').waitFor();
    assert.equal(await nav.getByRole('button', { name: 'Rooms' }).count(), 0);
    if (notesId != null) {
      await rooms.locator('.entry', { hasText: 'notes' }).locator('.main').click();
      await page.locator('.chat2 .msg', { hasText: 'text hello' }).waitFor();
    }
    if (shots) await page.screenshot({ path: path.join(shots, 'rooms-wide.png') });
    console.log('ok: rooms interface: dock, chat, voice screen, people, profile sheet, wide layout');

    // Back to the standard interface from the You screen
    await nav.getByRole('button', { name: 'You' }).click();
    await page.getByRole('region', { name: 'You' }).getByRole('button', { name: /^Appearance/ }).click();
    await page.getByRole('radio', { name: 'Standard' }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('.sidebar').waitFor();
    await page.setViewportSize(before);
    await page.locator('.channel .name', { hasText: 'Root' }).dblclick();
    await page.locator('.chat h1', { hasText: 'Root' }).waitFor();
    console.log('ok: back to the standard interface from the You screen');
  }

  // Kicked: the reason is shown with a Reconnect button
  if (admin) {
    const me = [...admin.users.values()].find(u => u.name === newName)!;
    admin.kick(me.session, 'testing kicks');
    const card = page.locator('.ended');
    await card.getByText('You were kicked by SuperUser').waitFor();
    await card.getByText('testing kicks').waitFor();
    // Back on the start screen, which shows who is on the saved servers
    await page.locator('.home .server', { hasText: 'Test Server' }).getByText(/\d+( of \d+)? online/).waitFor({ timeout: 70000 });
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
    await page.locator('.me').getByRole('button', { name: 'Edit your profile' }).click();
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
    await page.keyboard.press('Escape');
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
