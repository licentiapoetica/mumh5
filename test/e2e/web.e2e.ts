// Drives the browser build through the web proxy against a real Mumble server.
//   npm run build:web && MUMBLE_TEST_HOST=localhost:64739 npm run test:e2e:web
// The page runs in a plain Chromium window (Electron without the preload), served by the bundled proxy.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodec } from '../../src/core/proto.ts';
import { decodeVoice, type VoicePacket } from '../../src/core/voice-packet.ts';
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
const root = path.resolve(import.meta.dirname, '../..');

function headless(username: string): Promise<MumbleClient> {
  const id = generateIdentity(username);
  const client = new MumbleClient(createCodec());
  const t: Transport = { onData: null, onClose: null, send: b => conn.send(b), close: () => conn.close() };
  const conn = openTls(host, Number(port), id.certPem, id.keyPem, {
    onSecure: () => {}, onData: c => t.onData?.(c), onClose: r => t.onClose?.(r)
  });
  client.connect(t, { username, os: 'test' });
  return new Promise((res, rej) => { client.on('synced', () => res(client)); client.on('close', rej); });
}

function within<T>(p: Promise<T>, label: string, ms = 10000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Timed out waiting for: ${label}`)), ms))]);
}

// The bundled proxy, as it would be deployed: one allowed server, serving dist-web
const proxyPort = 18000 + Math.floor(Math.random() * 1000);
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const proxy = spawn(process.execPath, [path.join(root, 'dist-proxy/proxy.mjs')], {
  env: { ...env, MUMH5_PORT: String(proxyPort), MUMH5_SERVERS: `${target}=Test Server`, MUMH5_STUN_PORT: String(proxyPort + 1000), MUMH5_STUN_BIND: '127.0.0.1',
    // Everything is on this machine, so the relay has to be allowed to reach loopback
    MUMH5_ALLOW_PRIVATE: '1', MUMH5_TURN_IP: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit']
});
await within(new Promise<void>((res, rej) => {
  proxy.stdout.on('data', d => { if (String(d).includes('listening')) res(); });
  proxy.on('exit', code => rej(new Error(`proxy exited with ${code}`)));
}), 'proxy start');

const downloads = mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-dl-'));
const browser = () => electron.launch({
  executablePath: electronPath as unknown as string,
  args: [path.join(root, 'test/e2e/web-shell.cjs'), `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-'))}`, '--ozone-platform=x11',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  env: { ...env, MUMH5_WEB_URL: `http://127.0.0.1:${proxyPort}/`, MUMH5_DOWNLOADS: downloads } as Record<string, string>
});
const app = await browser();
let second: Awaited<ReturnType<typeof browser>> | null = null;
const bob = await headless('bob');
const name = `webalice${Date.now() % 100000}`;
try {
  const page = await app.firstWindow();
  page.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.evaluate(() => 'mumh5Native' in window), false, 'no desktop API in the page');

  // Identity: created through the proxy, kept in the browser
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor();
  await page.getByText(/passed to the proxy at/).waitFor();
  await page.getByRole('button', { name: /Create a new identity/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('alice');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  // Backup: downloaded as a .p12 file
  await page.getByLabel(/^Backup password/).fill('backup-pass');
  await page.getByLabel('Repeat password').fill('backup-pass');
  await page.getByRole('button', { name: 'Save backup...' }).click();
  await page.getByText('Backup saved to your downloads as alice.p12').waitFor();
  const saved = path.join(downloads, 'alice.p12');
  for (let i = 0; i < 50 && !existsSync(saved + '.done'); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(existsSync(saved + '.done') && statSync(saved).size > 1000, 'backup file downloaded');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor({ state: 'detached' });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.identities')!));
  assert.equal(stored.identities.length, 1);
  assert.equal(stored.setupDone, true);
  console.log('ok: identity created through the proxy and backed up');

  // Desktop-only features are not offered
  assert.equal(await page.getByTitle('Browse public servers').count(), 0);
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Chat and files' }).click();
  assert.ok(await page.getByLabel('Link previews').locator('option[value=direct]').isDisabled());
  await page.getByRole('tab', { name: 'Identities' }).click();
  await page.getByText('alice', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: public list and direct previews are desktop only');

  // The connect dialog offers the proxy's servers
  await page.getByTitle('Add a server').click();
  const pick = page.getByLabel('Server', { exact: true });
  await pick.waitFor();
  await page.waitForFunction(v => (document.getElementById('c-host') as HTMLSelectElement)?.value === v, `${host}:${port}`);
  assert.equal(await page.getByLabel('Label').inputValue(), 'Test Server');
  await page.getByLabel('Username').fill(name);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.getByText(/Connected/).first().waitFor();
  await page.locator('.sidebar').getByText('bob').waitFor();
  console.log('ok: connected through the proxy, sees bob');

  // Text both ways
  const got = new Promise<string>(res => bob.on('text', m => res(m.html)));
  await page.getByLabel('Message').fill('hello from the browser');
  await page.keyboard.press('Enter');
  assert.match(await within(got, 'text from the page'), /hello from the browser/);
  bob.sendText({ channels: [0] }, 'hello browser');
  await page.locator('.msg', { hasText: 'hello browser' }).waitFor();
  console.log('ok: text in both directions');

  // Voice goes through the TCP tunnel
  const session = () => [...bob.users.values()].find(u => u.name === name)!.session;
  const stream = new Promise<VoicePacket[]>(res => {
    const packets: VoicePacket[] = [];
    const off = bob.on('voice', raw => {
      const p = decodeVoice(raw);
      if (!p || p.session !== session()) return;
      packets.push(p);
      if (packets.length >= 20) { off(); res(packets); }
    });
  });
  await page.getByTitle('Settings').click();
  await page.getByRole('radio', { name: /Always on/ }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const packets = await within(stream, 'voice packets from the page', 20000);
  assert.ok(packets.every(p => p.opus.length > 0));
  console.log(`ok: page sends Opus voice through the proxy (${packets[0].opus.length} bytes per packet)`);

  await page.locator('.me').getByRole('button', { name: 'Server information' }).click();
  await page.getByRole('dialog', { name: 'Server information' }).getByText('Through the TCP connection').waitFor();
  await page.getByRole('dialog', { name: 'Server information' }).getByRole('button', { name: 'Close', exact: true }).last().click();
  console.log('ok: server information shows voice over TCP');

  // Own information: with the proxy on this machine the server sees our own address, shown as such
  await page.locator('.sidebar .row.user.self').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Information' }).click();
  const own = page.getByRole('dialog', { name: /^Information:/ });
  await own.getByText('Address', { exact: true }).waitFor();
  assert.equal(await own.getByText('Seen by the server').count(), 0);
  await own.getByRole('button', { name: 'Close', exact: true }).last().click();
  console.log('ok: own information shows the address the server sees');

  // The identity survives a reload and the server recognizes the same certificate
  const hash = () => [...bob.users.values()].find(u => u.name === name)?.hash;
  const before = hash();
  assert.ok(before, 'bob sees the certificate hash');
  await page.reload();
  await page.locator('.rail .tile[title^="Test Server"]').click();
  await page.getByText(/Connected/).first().waitFor();
  const deadline = Date.now() + 5000;
  while (hash() !== before && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  assert.equal(hash(), before, 'same certificate after a reload');
  console.log('ok: identity kept across a reload');

  // Screen sharing between two browsers: the proxy's own STUN is used without any setting
  assert.equal((await (await fetch(`http://127.0.0.1:${proxyPort}/api/config`)).json()).stun, proxyPort + 1000);
  second = await browser();
  const page2 = await second.firstWindow();
  page2.on('console', m => { if (m.type() === 'error') console.log('[page2]', m.text()); });
  await page2.setViewportSize({ width: 1280, height: 800 });
  await page2.getByRole('button', { name: /Create a new identity/ }).click();
  await page2.getByLabel('Name', { exact: true }).fill(`webcarol${Date.now() % 100000}`);
  await page2.getByRole('button', { name: 'Create', exact: true }).click();
  await page2.getByRole('button', { name: 'Skip for now' }).click();
  await page2.getByRole('button', { name: 'Done' }).click();
  await page2.getByTitle('Add a server').click();
  await page2.getByRole('button', { name: 'Save and connect' }).click();
  await page2.getByText(/Connected/).first().waitFor();

  await page.locator('.me').getByRole('button', { name: 'Share your screen' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share your screen' });
  await dialog.getByRole('button', { name: 'Choose a screen or window...' }).click();
  await page.waitForFunction(() => (document.querySelector('.preview video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 60000 });
  await dialog.getByRole('button', { name: 'Start sharing' }).click();
  await page.locator('.stage .status', { hasText: '0 watching' }).waitFor();
  // The viewer is limited to what a browser without direct UDP has (Vanadium's default): only
  // the proxy's relay, reached over TCP
  await page2.evaluate(() => localStorage.setItem('mumh5.iceDebug', 'relay-tcp'));
  await page2.locator('.stage .tile', { hasText: name }).click();
  await page2.getByRole('button', { name: 'Continue' }).click();
  await page2.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 30000 });
  await page.locator('.stage .status', { hasText: '1 watching' }).waitFor();
  // Phone-sized window: the picture still has room and frames
  await page2.setViewportSize({ width: 390, height: 780 });
  await page2.waitForFunction(() => {
    const v = document.querySelector('.spot video') as HTMLVideoElement | null;
    return !!v && v.videoWidth > 0 && !v.paused && v.getBoundingClientRect().height > 100 && v.getBoundingClientRect().width > 300;
  }, null, { timeout: 15000 });
  if (process.env.SHOTS_DIR) await page2.screenshot({ path: `${process.env.SHOTS_DIR}/phone.png` });
  // The statistics confirm which way the stream came
  await page2.setViewportSize({ width: 1280, height: 800 });
  await page2.locator('.spot video').click({ button: 'right' });
  await page2.getByRole('menuitem', { name: 'Stats for nerds' }).click();
  const stats = page2.getByRole('status', { name: 'Stream statistics' });
  await stats.getByText(/^(direct|relayed)/).first().waitFor({ timeout: 8000 });
  const route = (await stats.innerText()).replace(/\n+/g, ' | ');
  assert.match(route, /relayed \(TURN\), reached over TCP/, route);
  assert.match(route, /0 direct, 0 through STUN, [1-9]\d* relayed/, route);
  await stats.getByText(/^\d+ kbit\/s$/).first().waitFor({ timeout: 8000 });
  console.log('ok: screen sharing to a browser without direct UDP, through the relay over TCP');

  // A camera instead, still watched through the relay over TCP
  await page.locator('.me').getByRole('button', { name: 'Stop sharing your screen' }).click();
  await page2.getByRole('region', { name: 'Screen share' }).waitFor({ state: 'detached' });
  await page.locator('.me').getByRole('button', { name: 'Share your screen or camera' }).click();
  await dialog.getByRole('tab', { name: 'Camera' }).click();
  await page.waitForFunction(() => (document.querySelector('.preview video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 30000 });
  await dialog.getByRole('button', { name: 'Start sharing' }).click();
  await page2.locator('.sidebar').getByRole('button', { name: `Watch the camera of ${name}`, exact: true }).click();
  await page2.waitForFunction(() => (document.querySelector('.stage .tile video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 30000 });
  await page.locator('.stage .status', { hasText: '1 watching' }).waitFor();
  console.log('ok: camera shared between two browsers, shown in the tile, through the relay');

  console.log('WEB E2E PASSED');
} finally {
  bob.disconnect();
  await app.close().catch(() => {});
  await second?.close().catch(() => {});
  proxy.kill();
}
