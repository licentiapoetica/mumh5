// Screen sharing between two instances of the built app on a real Mumble server.
//   npm run build && MUMBLE_TEST_HOST=localhost:64739 npm run test:e2e:share
import { _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const target = process.env.MUMBLE_TEST_HOST;
if (!target) {
  console.log('MUMBLE_TEST_HOST not set, skipping');
  process.exit(0);
}
const [host, port] = target.split(':');
const root = path.resolve(import.meta.dirname, '../..');
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const tag = Date.now() % 100000;

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [root, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-'))}`, '--ozone-platform=x11',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: env as Record<string, string>
  });
  const page = await app.firstWindow();
  page.on('console', m => { if (m.type() === 'error') console.log('[renderer]', m.text()); });
  await page.setViewportSize({ width: 1280, height: 800 });
  return { app, page };
}

// Identity wizard, then connect; the username comes from the identity
async function join(page: Page, name: string) {
  await page.getByRole('dialog', { name: 'Set up your identity' }).waitFor();
  await page.getByRole('button', { name: /Create a new identity/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByTitle('Add a server').click();
  await page.getByLabel('Address').fill(host);
  await page.getByLabel('Port').fill(port);
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await page.getByText(/Connected/).first().waitFor();
}

const cleanup: (() => void)[] = [];
const alice = await launch();
const bob = await launch();
const aliceName = `share-a-${tag}`, bobName = `share-b-${tag}`;
try {
  await join(alice.page, aliceName);

  // Alice starts sharing: a note about IP addresses once, then the source picker
  const shareBtn = alice.page.locator('.me').getByRole('button', { name: 'Share your screen' });
  await shareBtn.click();
  await alice.page.getByText(/You see each other's IP address/).waitFor();
  await alice.page.getByRole('button', { name: 'Continue' }).click();
  // The dialog: pick a source, see the preview, then start
  const picker = alice.page.getByRole('dialog', { name: 'Share your screen' });
  const startBtn = picker.getByRole('button', { name: 'Start sharing' });
  const pickAndStart = async () => {
    assert.ok(await startBtn.isDisabled(), 'nothing can start before a source is chosen');
    // Listing is slow on the bare test display and can come back empty the first time
    for (let i = 0; i < 6 && !(await picker.locator('.sources button').count()); i++) {
      await Promise.race([picker.locator('.sources button').first().waitFor({ timeout: 40000 }), picker.getByText('Nothing found').waitFor({ timeout: 40000 })]).catch(() => {});
      if (await picker.getByText('Nothing found').count()) await picker.getByRole('button', { name: 'Refresh' }).click();
    }
    await picker.locator('.sources button').first().click();
    await alice.page.waitForFunction(() => (document.querySelector('.preview video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
    await startBtn.click();
  };
  await picker.getByLabel('Quality').selectOption('low');
  await pickAndStart();
  await alice.page.locator('.stage .status', { hasText: '0 watching' }).waitFor();
  await alice.page.locator('.sidebar .row.user.self').getByTitle('You are sharing your screen').waitFor();
  // The sharer sees what is being sent, large by default; the tiles themselves never carry the picture
  const ownView = alice.page.getByRole('region', { name: 'Screen share' });
  await ownView.getByText('Your screen').waitFor();
  await alice.page.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
  assert.equal(await alice.page.locator('.stage .tile video').count(), 0);
  await ownView.getByRole('button', { name: 'Back to tiles' }).click();
  await ownView.waitFor({ state: 'detached' });
  await alice.page.locator('.stage .tile.self').click();
  await ownView.waitFor();
  console.log('ok: sharing started from the dialog, own stream shown large');

  // Stacked layout: only the picture, as wide as the chat, and the layout stays stacked on narrow windows
  const setLayout = async (name: string) => {
    await alice.page.getByTitle('Settings').click();
    await alice.page.getByRole('tab', { name: 'Appearance' }).click();
    await alice.page.getByRole('radio', { name }).click();
    await alice.page.getByRole('button', { name: 'Done', exact: true }).click();
  };
  await setLayout('Stacked');
  await alice.page.locator('.app.stacked .stage.solo').waitFor();
  assert.equal(await alice.page.locator('.stage .tiles').count(), 0, 'no participant tiles in the stacked layout');
  const fits = () => alice.page.evaluate(() => {
    const v = document.querySelector('.stage.solo video') as HTMLVideoElement, c = document.querySelector('.chat')!;
    return v.videoWidth > 0 && Math.abs(v.getBoundingClientRect().width - c.getBoundingClientRect().width) < 2;
  });
  await alice.page.waitForFunction(() => (document.querySelector('.stage.solo video') as HTMLVideoElement | null)?.videoWidth! > 0);
  assert.ok(await fits(), 'picture as wide as the chat');
  await alice.page.setViewportSize({ width: 600, height: 800 });
  await alice.page.locator('.app.stacked .stage.solo video').waitFor();
  assert.ok(await fits(), 'still as wide as the chat on a narrow window');
  // On a short window the picture gives way and the chat keeps about five lines
  await alice.page.setViewportSize({ width: 600, height: 700 });
  const heights = () => alice.page.evaluate(() => [document.querySelector('.chat [role=log]')!.getBoundingClientRect().height, document.querySelector('.stage.solo video')!.getBoundingClientRect().height]);
  await alice.page.waitForFunction(() => document.querySelector('.stage.solo video')!.getBoundingClientRect().height < 250);
  const [logH, videoH] = await heights();
  assert.ok(logH >= 120, `chat keeps its lines: ${logH}`);
  assert.ok(videoH > 40, `the picture is still shown: ${videoH}`);
  await alice.page.setViewportSize({ width: 600, height: 800 });
  // The chat can be dragged taller, never below its minimum; the picture takes the rest
  const chatHandle = alice.page.getByRole('separator', { name: 'Resize the chat' });
  await chatHandle.focus();
  for (let i = 0; i < 12; i++) await alice.page.keyboard.press('ArrowUp');
  await alice.page.waitForFunction(() => document.querySelector('.chat [role=log]')!.getBoundingClientRect().height > 200);
  const grown = (await heights())[0];
  for (let i = 0; i < 40; i++) await alice.page.keyboard.press('ArrowDown');
  await alice.page.waitForFunction(() => document.querySelector('.chat [role=log]')!.getBoundingClientRect().height < 130);
  const [smallest, videoNow] = await heights();
  assert.ok(smallest >= 124, `not below the minimum: ${smallest}`);
  assert.ok(videoNow > 100, `the picture fills the rest: ${videoNow}`);
  console.log(`ok: stacked chat resizable (${Math.round(grown)} px down to ${Math.round(smallest)} px)`);
  if (process.env.SHOTS_DIR) await alice.page.screenshot({ path: `${process.env.SHOTS_DIR}/stacked.png` });
  await alice.page.getByText('0 watching').waitFor();
  await alice.page.setViewportSize({ width: 1280, height: 800 });
  await setLayout('Modern');
  await alice.page.locator('.stage .tiles').waitFor();
  console.log('ok: stacked layout shows only the picture and stays stacked when narrow');

  // Bob connects afterwards and still learns about the stream
  await join(bob.page, bobName);
  // Next to the name in the channel list, and on the tile above the chat
  const watch = bob.page.locator('.sidebar').getByRole('button', { name: `Watch the screen of ${aliceName}`, exact: true });
  await watch.waitFor();
  const tile = bob.page.locator('.stage .tile', { hasText: aliceName });
  await tile.waitFor();
  console.log('ok: a late joiner sees who is sharing');

  // The tiles fill the stage exactly, whatever its size
  const fills = () => bob.page.evaluate(() => {
    const grid = document.querySelector('.stage .tiles')!.getBoundingClientRect();
    const tiles = [...document.querySelectorAll('.stage .tile')].map(e => e.getBoundingClientRect());
    const left = Math.min(...tiles.map(r => r.left)), right = Math.max(...tiles.map(r => r.right));
    const top = Math.min(...tiles.map(r => r.top)), bottom = Math.max(...tiles.map(r => r.bottom));
    return { ok: left - grid.left < 10 && grid.right - right < 10 && top - grid.top < 10 && grid.bottom - bottom < 10, height: Math.round(tiles[0].height), count: tiles.length };
  });
  const first = await fills();
  assert.ok(first.ok && first.count === 2, `tiles fill the stage: ${JSON.stringify(first)}`);
  const handle = bob.page.getByRole('separator', { name: 'Resize the tiles' });
  await handle.focus();
  for (let i = 0; i < 8; i++) await bob.page.keyboard.press('ArrowDown');
  await bob.page.waitForFunction(h => Math.round(document.querySelector('.stage .tile')!.getBoundingClientRect().height) > h, first.height);
  const taller = await fills();
  assert.ok(taller.ok, 'still filled after making the stage taller');
  await bob.page.setViewportSize({ width: 820, height: 700 });
  await bob.page.waitForFunction(() => document.querySelector('.stage .tiles')!.getBoundingClientRect().width < 700);
  assert.ok((await fills()).ok, 'still filled after making the window narrower');
  await bob.page.setViewportSize({ width: 1280, height: 800 });
  for (let i = 0; i < 8; i++) await bob.page.keyboard.press('ArrowUp');
  if (process.env.SHOTS_DIR) await bob.page.screenshot({ path: `${process.env.SHOTS_DIR}/tiles.png` });
  console.log(`ok: tiles fill the stage at every size (${first.height} to ${taller.height} px tall)`);

  await tile.click();
  await bob.page.getByRole('button', { name: 'Continue' }).click();
  const view = bob.page.getByRole('region', { name: 'Screen share' });
  await view.getByText(aliceName).waitFor();
  await bob.page.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 20000 });
  const size = await bob.page.evaluate(() => { const v = document.querySelector('.spot video') as HTMLVideoElement; return [v.videoWidth, v.videoHeight]; });
  await alice.page.locator('.stage .status', { hasText: '1 watching' }).waitFor();
  console.log(`ok: bob receives the picture (${size[0]}x${size[1]}), alice sees one viewer`);

  if (process.env.SHOTS_DIR) { await bob.page.waitForTimeout(500); await bob.page.screenshot({ path: `${process.env.SHOTS_DIR}/meeting.png` }); }
  // Right-click on the picture: statistics for both sides
  const nerd = async (page: Page, expect: RegExp[]) => {
    await page.locator('.spot video').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Stats for nerds' }).click();
    const box = page.getByRole('status', { name: 'Stream statistics' });
    for (const e of expect) await box.getByText(e).first().waitFor({ timeout: 8000 });
    const text = (await box.innerText()).replace(/\n+/g, ' | ');
    await box.getByRole('button', { name: 'Close statistics' }).click();
    await box.waitFor({ state: 'detached' });
    return text;
  };
  const viewerStats = await nerd(bob.page, [/^(VP8|VP9|H264|AV1)/, /^\d+x\d+/, /^\d+ kbit\/s$/, /^direct/]);
  const sharerStats = await nerd(alice.page, [new RegExp(`To ${bobName}`), /^(VP8|VP9|H264|AV1)/, /^\d+ kbit\/s$/]);
  console.log(`ok: stats for nerds (viewer: ${viewerStats.slice(0, 200)}...)`);
  assert.ok(sharerStats.includes('Round trip'));

  // Touch screens: holding a finger on the picture opens the same menu
  await bob.page.evaluate(() => {
    const el = document.querySelector('.spot .pic')!;
    const r = el.getBoundingClientRect();
    const touch = new Touch({ identifier: 1, target: el, clientX: r.left + 40, clientY: r.top + 40 });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], bubbles: true }));
  });
  await bob.page.getByRole('menuitem', { name: 'Stats for nerds' }).waitFor({ timeout: 3000 });
  await bob.page.keyboard.press('Escape');
  console.log('ok: long press on the picture opens the menu');

  // The large picture can move to a window of its own
  const opened = bob.app.waitForEvent('window');
  // From the right-click menu on the picture
  await bob.page.locator('.spot video').click({ button: 'right' });
  await bob.page.getByRole('menuitem', { name: 'Open in a separate window' }).click();
  const streamWindow = await opened;
  await streamWindow.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
  await view.getByText('Shown in a separate window.').waitFor();
  await streamWindow.close();
  await view.getByRole('button', { name: 'Open in a separate window' }).waitFor();
  await bob.page.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0);
  console.log('ok: stream in a separate window, back when it is closed');

  // Back to tiles hides the picture; the sharer's tile brings it back
  await view.getByRole('button', { name: 'Back to tiles' }).click();
  await view.waitFor({ state: 'detached' });
  assert.equal(await bob.page.locator('.stage .tile video').count(), 0);
  await tile.click();
  await view.waitFor();
  console.log('ok: large view hidden and shown again from the tile');

  // Leaving and coming back
  await view.getByRole('button', { name: 'Stop watching' }).click();
  await view.waitFor({ state: 'detached' });
  await alice.page.locator('.stage .status', { hasText: '0 watching' }).waitFor();
  // The sharer's profile says so and offers to watch
  await bob.page.locator('.sidebar .row.user', { hasText: aliceName }).click();
  const profile = bob.page.locator('.panel .sharing');
  await profile.getByText('Sharing their screen').waitFor();
  await profile.getByRole('button', { name: 'Watch' }).click();
  await profile.getByRole('button', { name: 'Stop watching' }).waitFor();
  await bob.page.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 20000 });
  console.log('ok: stop watching, watch again from the profile');

  // Alice stops: the view and the indicator go away
  await alice.page.locator('.me').getByRole('button', { name: 'Stop sharing your screen' }).click();
  await view.waitFor({ state: 'detached' });
  await watch.waitFor({ state: 'detached' });
  await profile.waitFor({ state: 'detached' });
  assert.equal(await alice.page.locator('.stage .status').count(), 0);
  console.log('ok: stopping ends the stream for viewers');

  // Camera instead of the screen, and a relay for networks without direct connections: both
  // instances point at a mumh5 proxy, and the viewer is limited to the relay over TCP
  const relayPort = 19000 + Math.floor(Math.random() * 500);
  const relay = spawn(process.execPath, ['server/main.ts'], {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...env, MUMH5_PORT: String(relayPort), MUMH5_ALLOW_ANY: '1', MUMH5_ALLOW_PRIVATE: '1', MUMH5_STUN_PORT: String(relayPort + 500), MUMH5_STUN_BIND: '127.0.0.1', MUMH5_TURN_IP: '127.0.0.1' }
  });
  cleanup.push(() => relay.kill());
  await new Promise<void>((res, rej) => { relay.stdout.on('data', d => { if (String(d).includes('listening')) res(); }); relay.on('exit', c => rej(new Error(`proxy exited with ${c}`))); });
  for (const p of [alice.page, bob.page]) {
    await p.getByTitle('Settings').click();
    await p.getByLabel('Relay').fill(`http://127.0.0.1:${relayPort}`);
    await p.getByLabel('Relay').blur();
    await p.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await bob.page.evaluate(() => localStorage.setItem('mumh5.iceDebug', 'relay-tcp'));

  await shareBtn.click();
  await picker.getByRole('tab', { name: 'Camera' }).click();
  await alice.page.waitForFunction(() => (document.querySelector('.preview video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
  assert.equal(await picker.getByLabel('Sound').count(), 0, 'no extra sound with a camera');
  await startBtn.click();
  await alice.page.locator('.sidebar .row.user.self').getByTitle('You are sharing your camera').waitFor();
  // Cameras play in the tiles and come on by themselves, like in a video call
  const cam = bob.page.locator('.sidebar').getByRole('button', { name: `Watch the camera of ${aliceName}`, exact: true });
  await cam.waitFor();
  const liveCams = (p: Page) => p.evaluate(() => [...document.querySelectorAll('.stage .tile video')].filter(v => (v as HTMLVideoElement).videoWidth > 0).length);
  const camsShown = (p: Page, n: number) => p.waitForFunction(
    want => [...document.querySelectorAll('.stage .tile video')].filter(v => (v as HTMLVideoElement).videoWidth > 0).length === want, n, { timeout: 30000 });
  await camsShown(bob.page, 1);
  // One person's camera can be hidden, and shown again
  await bob.page.locator('.stage .tile', { hasText: aliceName }).click({ button: 'right' });
  await bob.page.getByRole('menuitem', { name: 'Hide camera' }).click();
  await camsShown(bob.page, 0);
  await alice.page.locator('.stage .status', { hasText: '0 watching' }).waitFor();
  await bob.page.locator('.stage .tile', { hasText: aliceName }).click({ button: 'right' });
  await bob.page.getByRole('menuitem', { name: 'Show camera' }).click();
  await camsShown(bob.page, 1);
  assert.equal(await bob.page.getByRole('region', { name: 'Screen share' }).count(), 0, 'a camera does not take over the stage by itself');

  // Bob turns his camera on too: both now see both, each one their own mirrored
  await bob.page.locator('.me').getByRole('button', { name: 'Share your screen or camera' }).click();
  const bobDialog = bob.page.getByRole('dialog', { name: 'Share your screen' });
  await bobDialog.getByRole('tab', { name: 'Camera' }).click();
  await bob.page.waitForFunction(() => (document.querySelector('.preview video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
  await bobDialog.getByRole('button', { name: 'Start sharing' }).click();
  await camsShown(bob.page, 2);
  await camsShown(alice.page, 2);
  assert.equal(await bob.page.locator('.stage .tile.self video.mirror').count(), 1, 'own camera is mirrored');
  // The picture keeps its shape in the tile at any tile size: whole, not cropped
  const shape = () => bob.page.evaluate(() => [...document.querySelectorAll('.stage .tile video')].map(v => {
    const el = v as HTMLVideoElement, r = el.getBoundingClientRect();
    const scale = Math.min(r.width / el.videoWidth, r.height / el.videoHeight);
    return { fit: getComputedStyle(el).objectFit, inside: el.videoWidth * scale <= r.width + 1 && el.videoHeight * scale <= r.height + 1, box: r.width > 50 && r.height > 50 };
  }));
  for (const size of [{ width: 1280, height: 800 }, { width: 760, height: 620 }]) {
    await bob.page.setViewportSize(size);
    await camsShown(bob.page, 2);
    assert.ok((await shape()).every(s => s.fit === 'contain' && s.inside && s.box), `cameras whole at ${size.width} wide`);
  }
  await bob.page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await bob.page.locator('.stage .tile:not(.self) video.mirror').count(), 0);
  await alice.page.locator('.stage .status', { hasText: '1 watching' }).waitFor();
  await bob.page.locator('.stage .status', { hasText: '1 watching' }).waitFor();
  if (process.env.SHOTS_DIR) await bob.page.screenshot({ path: `${process.env.SHOTS_DIR}/cams.png` });

  // A click enlarges one camera; the statistics show it came through the relay
  await bob.page.locator('.stage .tile', { hasText: aliceName }).click();
  await bob.page.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 20000 });
  assert.equal(await bob.page.locator('.stage .tile', { hasText: aliceName }).locator('video').count(), 0, 'the enlarged camera is not also in its tile');
  assert.equal(await bob.page.locator('.stage .tile.self video').count(), 1, 'the other tiles keep theirs');
  const camStats = await nerd(bob.page, [/^relayed \(TURN\), reached over TCP/, /^0 direct, 0 through STUN, [1-9]\d* relayed/]);
  await bob.page.getByRole('region', { name: 'Screen share' }).getByRole('button', { name: 'Back to tiles' }).click();

  // Everyone's cameras off at once keeps Bob's own camera on and drops the others; on again brings them back
  await bob.page.locator('.stage').getByRole('button', { name: 'Hide all cameras' }).click();
  await camsShown(bob.page, 1);
  await alice.page.locator('.stage .status', { hasText: '0 watching' }).waitFor();
  await bob.page.locator('.stage').getByRole('button', { name: 'Show all cameras' }).click();
  await camsShown(bob.page, 2);
  await bob.page.locator('.me').getByRole('button', { name: 'Stop sharing your camera' }).click();
  await camsShown(alice.page, 1);
  await alice.page.locator('.me').getByRole('button', { name: 'Stop sharing your camera' }).click();
  await cam.waitFor({ state: 'detached' });
  await bob.page.evaluate(() => localStorage.removeItem('mumh5.iceDebug'));
  console.log(`ok: cameras of several people at once, in the tiles, through the relay (${camStats.match(/Picture \| [^|]+/)?.[0]})`);
  void liveCams;

  // A sharer who disconnects takes the stream with them
  await shareBtn.click();
  await pickAndStart();
  await watch.waitFor();
  await alice.page.getByTitle('Disconnect').click();
  await watch.waitFor({ state: 'detached' });
  console.log('ok: disconnecting ends the stream');

  // Sounds: the sharer hears the stream start and stop and viewers come and go; the channel hears streams start and stop
  const sounds = (p: Page) => p.evaluate(() => [...((window as any).__mumh5Sounds ?? [])] as string[]);
  const heardA = await sounds(alice.page), heardB = await sounds(bob.page);
  for (const ev of ['shareStarted', 'viewerJoined', 'viewerLeft', 'shareStopped']) assert.ok(heardA.includes(ev), `sharer hears ${ev}: ${heardA}`);
  for (const ev of ['shareStarted', 'shareStopped']) assert.ok(heardB.includes(ev), `viewer hears ${ev}: ${heardB}`);
  console.log('ok: sounds for streams and viewers');

  console.log('SHARE E2E PASSED');
} finally {
  for (const c of cleanup) c();
  await alice.app.close().catch(() => {});
  await bob.app.close().catch(() => {});
}
