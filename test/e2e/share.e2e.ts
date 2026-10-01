// Screen sharing between two instances of the built app on a real Mumble server.
//   npm run build && MUMBLE_TEST_HOST=localhost:64739 npm run test:e2e:share
import { _electron as electron, type Page } from 'playwright-core';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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

  // The tiles fill the stage, and the stage can be made taller or shorter
  const tileWidth = async () => Math.round((await tile.boundingBox())!.width);
  const before = await tileWidth();
  const handle = bob.page.getByRole('separator', { name: 'Resize the tiles' });
  await handle.focus();
  for (let i = 0; i < 8; i++) await bob.page.keyboard.press('ArrowDown');
  await bob.page.waitForFunction(w => Math.round(document.querySelector('.stage .tile')!.getBoundingClientRect().width) > w, before);
  const taller = await tileWidth();
  for (let i = 0; i < 8; i++) await bob.page.keyboard.press('ArrowUp');
  await bob.page.waitForFunction(w => Math.round(document.querySelector('.stage .tile')!.getBoundingClientRect().width) < w, taller);
  if (process.env.SHOTS_DIR) await bob.page.screenshot({ path: `${process.env.SHOTS_DIR}/tiles.png` });
  console.log(`ok: tiles scale with the stage height (${before} to ${taller} px wide)`);

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
  await alice.app.close().catch(() => {});
  await bob.app.close().catch(() => {});
}
