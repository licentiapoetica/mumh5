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
  await alice.page.getByText('You are sharing your screen').waitFor();
  await alice.page.locator('.sidebar .row.user.self').getByTitle('You are sharing your screen').waitFor();
  // The sharer's own tile shows what is being sent; clicking it makes it large
  await alice.page.waitForFunction(() => (document.querySelector('.stage .tile.self video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
  await alice.page.locator('.stage .tile.self').click();
  const ownView = alice.page.getByRole('region', { name: 'Screen share' });
  await ownView.getByText('Your screen').waitFor();
  await ownView.getByRole('button', { name: 'Back to tiles' }).click();
  await ownView.waitFor({ state: 'detached' });
  console.log('ok: sharing started from the dialog, own tile shows the stream');

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
  await alice.page.getByText('You are sharing your screen, 1 watching').waitFor();
  console.log(`ok: bob receives the picture (${size[0]}x${size[1]}), alice sees one viewer`);

  if (process.env.SHOTS_DIR) { await bob.page.waitForTimeout(500); await bob.page.screenshot({ path: `${process.env.SHOTS_DIR}/meeting.png` }); }
  // The large picture can move to a window of its own
  const opened = bob.app.waitForEvent('window');
  await view.getByRole('button', { name: 'Open in a separate window' }).click();
  const streamWindow = await opened;
  await streamWindow.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 15000 });
  await view.getByText('Shown in a separate window.').waitFor();
  await streamWindow.close();
  await view.getByRole('button', { name: 'Open in a separate window' }).waitFor();
  await bob.page.waitForFunction(() => (document.querySelector('.spot video') as HTMLVideoElement | null)?.videoWidth! > 0);
  console.log('ok: stream in a separate window, back when it is closed');

  // Like a meeting: back to tiles keeps the picture in the tile, a click makes it large again
  await view.getByRole('button', { name: 'Back to tiles' }).click();
  await view.waitFor({ state: 'detached' });
  await bob.page.waitForFunction(() => (document.querySelector('.stage .tile.video video') as HTMLVideoElement | null)?.videoWidth! > 0);
  await tile.click();
  await view.waitFor();
  console.log('ok: stream in the tile, large on click');

  // Leaving and coming back
  await view.getByRole('button', { name: 'Stop watching' }).click();
  await view.waitFor({ state: 'detached' });
  await alice.page.getByText('You are sharing your screen', { exact: true }).waitFor();
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
  assert.equal(await alice.page.getByText('You are sharing your screen').count(), 0);
  console.log('ok: stopping ends the stream for viewers');

  // A sharer who disconnects takes the stream with them
  await shareBtn.click();
  await pickAndStart();
  await watch.waitFor();
  await alice.page.getByTitle('Disconnect').click();
  await watch.waitFor({ state: 'detached' });
  console.log('ok: disconnecting ends the stream');

  console.log('SHARE E2E PASSED');
} finally {
  await alice.app.close().catch(() => {});
  await bob.app.close().catch(() => {});
}
