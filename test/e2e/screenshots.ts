// Generates the README screenshots in docs/screenshots from a scripted scene. The screen sharing
// picture needs three more copies of the app (the streamer and two viewers), so up to four windows
// open; on Linux they can go to a virtual display (Xvfb) like the end-to-end tests.
//   docker run -d --name mumh5-shots -p 64740:64738 -e MUMBLE_SUPERUSER_PASSWORD=shots \
//     -e MUMBLE_CONFIG_AUTOBANATTEMPTS=0 -e "MUMBLE_CONFIG_WELCOMETEXT=Welcome to the community voice server." \
//     mumblevoip/mumble-server
//   npm run build && MUMBLE_TEST_HOST=localhost:64740 MUMBLE_SUPERUSER_PASSWORD=shots npm run screenshots
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
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

// A neon profile picture: a diagonal gradient between two colors with a bright ring, as a PNG
function neon(size: number, a: number[], b: number[]): Uint8Array {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const t = (x + y) / (2 * size), d = Math.hypot(x - size / 2, y - size / 2) / size;
    const ring = Math.abs(d - 0.28) < 0.035 ? 1 : 0;
    raw.set(a.map((v, i) => Math.round(ring ? 255 - (255 - b[i]) * 0.3 : v * (1 - t) + b[i] * t * 0.6)), y * (size * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// What v0id's screen share shows: a neon racing game drawn on a canvas, the road moving.
// It replaces getDisplayMedia in that window (a fake capture device only shows a test pattern).
const SCENE = `(() => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const g = c.getContext('2d'), W = 1280, H = 720, HZ = 400;
  const draw = t => {
    const sky = g.createLinearGradient(0, 0, 0, HZ);
    sky.addColorStop(0, '#0b0322'); sky.addColorStop(0.55, '#3a0f5c'); sky.addColorStop(1, '#ff3d8b');
    g.fillStyle = sky; g.fillRect(0, 0, W, HZ);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 140; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.3 + rnd() * 0.7) + ')'; g.fillRect(rnd() * W, rnd() * HZ * 0.6, 2, 2); }
    const sx = W / 2, sy = 300, sr = 150;
    g.save(); g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.clip();
    const sun = g.createLinearGradient(0, sy - sr, 0, sy + sr); sun.addColorStop(0, '#ffe66b'); sun.addColorStop(0.5, '#ff7a3d'); sun.addColorStop(1, '#ff2d95');
    g.fillStyle = sun; g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    g.fillStyle = '#2a0b47'; for (let i = 0; i < 7; i++) g.fillRect(sx - sr, sy + 10 + i * 18, sr * 2, 3 + i * 1.6);
    g.restore();
    const ridge = (base, amp, color, s) => { seed = s; g.fillStyle = color; g.beginPath(); g.moveTo(0, HZ); let x = 0; while (x <= W) { g.lineTo(x, base - rnd() * amp); x += 40 + rnd() * 50; } g.lineTo(W, HZ); g.fill(); };
    ridge(HZ - 20, 110, '#1a0833', 3); ridge(HZ, 60, '#0e0420', 11);
    const floor = g.createLinearGradient(0, HZ, 0, H); floor.addColorStop(0, '#12052a'); floor.addColorStop(1, '#05010d');
    g.fillStyle = floor; g.fillRect(0, HZ, W, H - HZ);
    g.strokeStyle = '#00e5ff'; g.shadowColor = '#00e5ff'; g.shadowBlur = 12; g.lineWidth = 2;
    for (let i = -24; i <= 24; i++) { g.beginPath(); g.moveTo(W / 2 + i * 6, HZ); g.lineTo(W / 2 + i * 140, H); g.stroke(); }
    for (let i = 0; i < 14; i++) { const t2 = Math.pow(((i + t * 2) % 14) / 13, 2.2), y = HZ + t2 * (H - HZ); g.globalAlpha = 0.25 + Math.min(1, t2) * 0.75; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.globalAlpha = 1; g.shadowBlur = 0;
    g.fillStyle = '#0a0414'; g.beginPath(); g.moveTo(560, 650); g.lineTo(720, 650); g.lineTo(745, 690); g.lineTo(535, 690); g.closePath(); g.fill();
    g.fillStyle = '#1b0f33'; g.beginPath(); g.moveTo(590, 650); g.lineTo(690, 650); g.lineTo(675, 628); g.lineTo(605, 628); g.closePath(); g.fill();
    g.shadowColor = '#ff2d55'; g.shadowBlur = 25; g.fillStyle = '#ff2d55'; g.fillRect(545, 668, 60, 8); g.fillRect(675, 668, 60, 8); g.shadowBlur = 0;
    g.textAlign = 'left'; g.font = '700 46px monospace'; g.fillStyle = '#fff'; g.shadowColor = '#ff3d8b'; g.shadowBlur = 18; g.fillText('NEON DRIFT', 48, 80); g.shadowBlur = 0;
    g.font = '600 22px monospace'; g.fillStyle = '#00e5ff'; g.fillText('LAP 2/3', 48, 120); g.fillText('POS 1/8', 48, 150);
    g.textAlign = 'right'; g.fillStyle = '#ffe66b'; g.font = '700 64px monospace'; g.fillText('287', W - 48, H - 60);
    g.font = '600 20px monospace'; g.fillStyle = '#ffffffcc'; g.fillText('KM/H', W - 48, H - 30); g.fillText('01:42.37', W - 48, 80);
  };
  let t = 0; draw(t); setInterval(() => draw(t += 1 / 30), 33);
  const stream = c.captureStream(30);
  navigator.mediaDevices.getDisplayMedia = async () => stream.clone();
})()`;

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

const v0id = await headless('v0id');
const gl1tch = await headless('gl1tch');
const cipher = await headless('cipher');
const nullbyte = await headless('nullbyte');
v0id.joinChannel(lobby);
gl1tch.joinChannel(lobby);
await wait(300);
cipher.joinChannel(lobby);
nullbyte.joinChannel(byName(nullbyte, 'Music').id);
await wait(1200);
nullbyte.setSelfMute(true);
gl1tch.setSelfDeaf(true);
v0id.setComment('<p><b>v0id</b> <span style="color:#e8b23c">streamer, night owl</span></p><p>Mostly in <i>Minecraft</i> and <i>Valorant</i>. Ask me about modpacks.</p><ul><li>EU evenings</li><li>Push to talk</li></ul>');
// Pictures for some, the letter for gl1tch
v0id.setTexture(neon(128, [255, 46, 136], [120, 40, 255]));
cipher.setTexture(neon(128, [0, 229, 255], [20, 60, 160]));
nullbyte.setTexture(neon(128, [57, 255, 120], [10, 90, 70]));

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
await page.getByLabel('Name', { exact: true }).fill('n3on');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.getByRole('button', { name: 'Skip for now' }).click();
await page.getByRole('button', { name: 'Done' }).click();

// A real mouse press: Playwright's click() first scrolls the settings, which nobody sees
const press = async (loc: ReturnType<typeof page.locator>) => { const b = (await loc.boundingBox())!; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
const tab = (name: string) => press(page.getByRole('tab', { name }));

// The README shows the Modern layout (channels left, members right); Stacked is the default
await page.getByTitle('Settings').click();
await tab('Appearance');
await page.getByRole('radio', { name: 'Modern', exact: true }).click();
await tab('Chat and files');
await page.getByLabel('YouTube links').selectOption('thumbnail');
await page.getByLabel('Link previews').selectOption('direct');
await tab('Voice');
await page.getByRole('radio', { name: /Always on/ }).click();
await page.getByRole('button', { name: 'Done', exact: true }).click();

await page.getByTitle('Add a server').click();
await page.getByLabel('Address').fill(host);
await page.getByLabel('Port').fill(port);
await page.getByLabel('Username').fill('n3on');
await page.getByLabel('Label').fill('Community');
await page.getByRole('button', { name: 'Save and connect' }).click();
await page.getByText(/Connected/).first().waitFor();
await page.locator('.channel .name', { hasText: 'Lobby' }).dblclick();
await page.locator('.me .who span', { hasText: 'Lobby' }).waitFor();
await wait(800);

v0id.sendText({ channels: [lobby] }, 'anyone up for a run tonight?');
await wait(1200);
gl1tch.sendText({ channels: [lobby] }, 'yes, after dinner. 8pm?');
await wait(1200);
cipher.sendText({ channels: [lobby] }, 'btw this is what we are running: <a href="https://github.com/mumble-voip/mumble">https://github.com/mumble-voip/mumble</a>');
await wait(1200);
await page.getByLabel('Message').fill('works for me. meanwhile, a classic: https://www.youtube.com/watch?v=dQw4w9WgXcQ');
await page.getByLabel('Message').press('Enter');
await wait(1200);
v0id.sendText({ channels: [lobby] }, '<b>no.</b> not again <i>(ok it is a good song)</i>');
await wait(3000);
await page.locator('.card img').first().waitFor({ timeout: 15000 }).catch(() => {});
await wait(1000);
// Nothing under the pointer is highlighted in the pictures
await page.mouse.move(1300, 700);
// From cipher's message with the link preview down to the last one
await page.locator('.chat .list').evaluate(list => {
  const msg = [...list.querySelectorAll('.msg')].find(m => m.textContent?.includes('what we are running'));
  if (msg) list.scrollTop += msg.getBoundingClientRect().top - list.getBoundingClientRect().top - 12;
});
await page.screenshot({ path: path.join(out, 'main.png') });

await page.locator('.sidebar .user', { hasText: 'v0id' }).click();
await page.getByRole('dialog', { name: 'Profile of v0id' }).locator('.html', { hasText: 'streamer' }).waitFor();
await wait(500);
await page.screenshot({ path: path.join(out, 'profile.png') });
await page.keyboard.press('Escape');

await page.getByTitle('Settings').click();
await wait(800);
await page.screenshot({ path: path.join(out, 'voice-settings.png') });
await page.getByRole('button', { name: 'Done', exact: true }).click();

// Every color scheme, main view with the member list
for (const t of ['light', 'midnight', 'frost', 'win95', 'dark']) {
  await page.getByTitle('Settings').click();
  await tab('Appearance');
  await page.locator(`[data-theme-preview="${t}"]`).click();
  // Clicking scrolled the list to the scheme; the picture shows it from the top
  await page.locator('.modal .body').evaluate(el => { el.scrollTop = 0; });
  if (t === 'win95') await page.screenshot({ path: path.join(out, 'settings-appearance.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.mouse.move(1300, 700);
  await wait(400);
  if (t !== 'dark') await page.screenshot({ path: path.join(out, `theme-${t}.png`) });
}

await page.setViewportSize({ width: 390, height: 844 });
await page.locator('.scrim').first().click().catch(() => {});
await wait(500);
await page.screenshot({ path: path.join(out, 'mobile.png') });

// ─── Screen sharing: v0id streams a game from a window of their own, three people watch ──
await page.setViewportSize({ width: 1440, height: 900 });
const work = mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-shots-'));
// The bots step aside so windows can use their names
for (const c of [v0id, cipher, gl1tch]) c.disconnect();
await wait(800);

// Waits for a dialog's button, which may take a moment to appear, and presses it when it does
const answer = (p: typeof page, name: string, ms = 3000) =>
  p.getByRole('button', { name, exact: true }).waitFor({ timeout: ms }).then(() => p.getByRole('button', { name, exact: true }).click()).catch(() => {});

// Another copy of the app, signed in under `name`, in Lobby, with a picture when colors are given
async function client(name: string, colors?: [number[], number[]], stageHeight?: number) {
  const instance = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [root, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-'))}`, '--ozone-platform=x11',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: env as Record<string, string>
  });
  const p = await instance.firstWindow();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.getByRole('button', { name: /Create a new identity/ }).click();
  await p.getByLabel('Name', { exact: true }).fill(name);
  await p.getByRole('button', { name: 'Create', exact: true }).click();
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.getByRole('button', { name: 'Done' }).click();
  // A taller meeting view than the default, so the stream fills the picture
  if (stageHeight) await p.evaluate(h => localStorage.setItem('mumh5.stageHeightMeeting', String(h)), stageHeight);
  await p.getByTitle('Settings').click();
  { const b = (await p.getByRole('tab', { name: 'Appearance' }).boundingBox())!; await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
  await p.getByRole('radio', { name: 'Modern', exact: true }).click();
  await p.getByRole('button', { name: 'Done', exact: true }).click();
  await p.getByTitle('Add a server').click();
  await p.getByLabel('Address').fill(host);
  await p.getByLabel('Port').fill(port);
  await p.getByLabel('Username').fill(name);
  await p.getByLabel('Label').fill('Community');
  await p.getByRole('button', { name: 'Save and connect' }).click();
  await p.getByText(/Connected/).first().waitFor();
  await p.locator('.channel .name', { hasText: 'Lobby' }).dblclick();
  await p.locator('.me .who span', { hasText: 'Lobby' }).waitFor();
  if (colors) {
    const file = path.join(work, `${name}.png`);
    writeFileSync(file, neon(256, colors[0], colors[1]));
    await p.locator('.me .profile').click();
    await p.getByRole('dialog', { name: /^Profile of / }).locator('input[type=file]').setInputFiles(file);
    await p.locator('.me .profile .avatar img').waitFor();
    await p.keyboard.press('Escape');
  }
  return { instance, page: p };
}

// Watches v0id's screen until the picture plays, trying again if the first attempt does not connect
async function watchStream(p: typeof page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await p.locator('.sidebar').getByRole('button', { name: 'Watch the screen of v0id', exact: true }).click({ timeout: 20000 });
    await answer(p, 'Continue');
    const ok = await p.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 }).then(() => true, () => false);
    if (ok) return;
  }
  await p.screenshot({ path: path.join(work, 'viewer.png') });
  throw new Error(`The stream did not arrive; a picture of the viewer is in ${work}`);
}

const streamer = await client('v0id', [[255, 46, 136], [120, 40, 255]], 640);
const viewers = [await client('cipher', [[0, 229, 255], [20, 60, 160]]), await client('gl1tch')];
const page2 = streamer.page;
await page2.evaluate(SCENE);
await page2.locator('.me').getByRole('button', { name: 'Share your screen or camera' }).click();
await answer(page2, 'Continue');
const picker = page2.getByRole('dialog', { name: 'Share your screen' });
for (let i = 0; i < 6 && !(await picker.locator('.sources button').count()); i++) {
  await Promise.race([picker.locator('.sources button').first().waitFor({ timeout: 30000 }), picker.getByText('Nothing found').waitFor({ timeout: 30000 })]).catch(() => {});
  if (await picker.getByText('Nothing found').count()) await picker.getByRole('button', { name: 'Refresh' }).click();
}
await picker.locator('.sources button').first().click();
await page2.waitForFunction(() => (document.querySelector('.preview video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
await picker.getByLabel('Quality').selectOption('high').catch(() => {});
await picker.getByRole('button', { name: 'Start sharing' }).click();
await page2.locator('.stage .status', { hasText: 'watching' }).first().waitFor();

for (const p of [page, ...viewers.map(v => v.page)]) await watchStream(p);
await page2.locator('.stage .status', { hasText: '3 watching' }).first().waitFor({ timeout: 15000 });
await page2.mouse.move(1300, 800);
await wait(1500);
await page2.screenshot({ path: path.join(out, 'sharing.png') });

for (const c of [streamer, ...viewers]) await c.instance.close();
await app.close();
nullbyte.disconnect();
console.log(`Screenshots written to ${out}`);
process.exit(0);
