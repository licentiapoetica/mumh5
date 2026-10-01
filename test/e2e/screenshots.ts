// Generates the README screenshots in docs/screenshots from a scripted scene.
//   docker run -d --name mumh5-shots -p 64740:64738 -e MUMBLE_SUPERUSER_PASSWORD=shots \
//     -e MUMBLE_CONFIG_AUTOBANATTEMPTS=0 -e "MUMBLE_CONFIG_WELCOMETEXT=Welcome to the community voice server." \
//     mumblevoip/mumble-server
//   npm run build && MUMBLE_TEST_HOST=localhost:64740 MUMBLE_SUPERUSER_PASSWORD=shots npm run screenshots
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodec } from '../../src/core/proto.ts';
import { MumbleClient } from '../../src/core/client.ts';
import type { Transport } from '../../src/core/transport.ts';
import { openTls } from '../../electron/tls-transport.ts';
import { generateIdentity } from '../../electron/identity.ts';

const target = process.env.MUMBLE_TEST_HOST;
const superPw = process.env.MUMBLE_SUPERUSER_PASSWORD;
if (!target || !superPw) {
  console.log('Set MUMBLE_TEST_HOST and MUMBLE_SUPERUSER_PASSWORD');
  process.exit(1);
}
const [host, port] = target.split(':');
const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function headless(username: string, password = ''): Promise<MumbleClient> {
  const id = generateIdentity(username);
  const client = new MumbleClient(createCodec());
  const t: Transport = { onData: null, onClose: null, send: b => conn.send(b), close: () => conn.close() };
  const conn = openTls(host, Number(port), id.certPem, id.keyPem, {
    onSecure: () => {}, onData: c => t.onData?.(c), onClose: r => t.onClose?.(r)
  });
  client.connect(t, { username, password, os: 'Linux' });
  return new Promise((res, rej) => { client.on('synced', () => res(client)); client.on('close', rej); });
}

const byName = (c: MumbleClient, name: string) => [...c.channels.values()].find(x => x.name === name)!;

// ─── Server scene ─────────────────────────────────────────────────────────────
const admin = await headless('SuperUser', superPw);
// Start from an empty tree when the server is reused
for (const c of [...admin.channels.values()]) if (c.id !== 0 && c.parent === 0) admin.send('ChannelRemove', { channel_id: c.id });
await wait(500);
admin.send('ChannelState', { parent: 0, name: 'Lobby', position: 0, description: '<p><b>Welcome!</b> Hang out, say hi, and drop your clips here.</p><p>Be nice. Push to talk is appreciated in busy rooms.</p>' });
admin.send('ChannelState', { parent: 0, name: 'Gaming', position: 1 });
admin.send('ChannelState', { parent: 0, name: 'Music', position: 2, description: 'Listening parties every Friday.' });
admin.send('ChannelState', { parent: 0, name: 'AFK', position: 3 });
await wait(1500);
admin.send('ChannelState', { parent: byName(admin, 'Gaming').id, name: 'Minecraft' });
admin.send('ChannelState', { parent: byName(admin, 'Gaming').id, name: 'Valorant' });
await wait(1500);
const lobby = byName(admin, 'Lobby').id;
admin.disconnect();

const sarah = await headless('sarah');
const max = await headless('max');
const jonas = await headless('jonas');
const lena = await headless('lena');
sarah.joinChannel(lobby);
max.joinChannel(lobby);
await wait(300);
jonas.joinChannel(lobby);
lena.joinChannel(byName(lena, 'Music').id);
await wait(1200);
lena.setSelfMute(true);
max.setSelfDeaf(true);
sarah.setComment('<p><b>sarah</b> <span style="color:#e8b23c">streamer, night owl</span></p><p>Mostly playing <i>Minecraft</i> and <i>Valorant</i>. Ask me about modpacks.</p><ul><li>EU evenings</li><li>Push to talk</li></ul>');

// ─── App ──────────────────────────────────────────────────────────────────────
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [root, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-'))}`, '--ozone-platform=x11',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  env: env as Record<string, string>
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });

await page.getByRole('button', { name: /Create a new identity/ }).click();
await page.getByLabel('Name', { exact: true }).fill('kibi');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.getByRole('button', { name: 'Skip for now' }).click();
await page.getByRole('button', { name: 'Done' }).click();

await page.getByTitle('Settings').click();
await page.getByRole('tab', { name: 'Chat and files' }).click();
await page.getByLabel('YouTube links').selectOption('thumbnail');
await page.getByLabel('Link previews').selectOption('direct');
await page.getByRole('tab', { name: 'Voice' }).click();
await page.getByRole('radio', { name: /Always on/ }).click();
await page.getByRole('button', { name: 'Done', exact: true }).click();

await page.getByTitle('Add a server').click();
await page.getByLabel('Address').fill(host);
await page.getByLabel('Port').fill(port);
await page.getByLabel('Username').fill('kibi');
await page.getByLabel('Label').fill('Community');
await page.getByRole('button', { name: 'Save and connect' }).click();
await page.getByText(/Connected/).first().waitFor();
await page.locator('.channel .name', { hasText: 'Lobby' }).dblclick();
await page.locator('.me .who span', { hasText: 'Lobby' }).waitFor();
await wait(800);

sarah.sendText({ channels: [lobby] }, 'anyone up for a round later?');
await wait(1200);
max.sendText({ channels: [lobby] }, 'yes, after dinner. 8pm?');
await wait(1200);
jonas.sendText({ channels: [lobby] }, 'btw this is what we are using: <a href="https://github.com/mumble-voip/mumble">https://github.com/mumble-voip/mumble</a>');
await wait(1200);
await page.getByLabel('Message').fill('works for me. meanwhile, a classic: https://www.youtube.com/watch?v=dQw4w9WgXcQ');
await page.getByLabel('Message').press('Enter');
await wait(1200);
sarah.sendText({ channels: [lobby] }, '<b>no.</b> not again <i>(ok it is a good song)</i>');
await wait(3000);
await page.locator('.card img').first().waitFor({ timeout: 15000 }).catch(() => {});
await wait(1000);
// Show the whole conversation
await page.locator('.chat .list').evaluate(el => { el.scrollTop = el.scrollHeight; });
await page.screenshot({ path: path.join(out, 'main.png') });

await page.locator('.sidebar .user', { hasText: 'sarah' }).click();
await page.locator('.panel .html', { hasText: 'streamer' }).waitFor();
await wait(500);
await page.screenshot({ path: path.join(out, 'profile.png') });

await page.getByTitle('Settings').click();
await wait(800);
await page.screenshot({ path: path.join(out, 'voice-settings.png') });
await page.getByRole('button', { name: 'Done', exact: true }).click();

// Every color scheme, main view with the member list
await page.locator('.panel .icon-btn[aria-label="Close"]').click().catch(() => {});
for (const t of ['light', 'midnight', 'frost', 'win95', 'dark']) {
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.locator(`[data-theme-preview="${t}"]`).click();
  if (t === 'win95') await page.screenshot({ path: path.join(out, 'settings-appearance.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await wait(400);
  if (t !== 'dark') await page.screenshot({ path: path.join(out, `theme-${t}.png`) });
}

await page.setViewportSize({ width: 390, height: 844 });
await page.locator('.scrim').first().click().catch(() => {});
await wait(500);
await page.screenshot({ path: path.join(out, 'mobile.png') });

await app.close();
for (const c of [sarah, max, jonas, lena]) c.disconnect();
console.log(`Screenshots written to ${out}`);
process.exit(0);
