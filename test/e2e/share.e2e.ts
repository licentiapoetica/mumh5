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
  const picker = alice.page.getByRole('dialog', { name: 'Share your screen' });
  await picker.locator('.sources button').first().click();
  await alice.page.getByText('You are sharing your screen').waitFor();
  await alice.page.locator('.sidebar .row.user.self').getByTitle('You are sharing your screen').waitFor();
  console.log('ok: sharing started from the picker');

  // Bob connects afterwards and still learns about the stream
  await join(bob.page, bobName);
  const watch = bob.page.getByRole("button", { name: `Watch the screen of ${aliceName}`, exact: true });
  await watch.waitFor();
  console.log('ok: a late joiner sees who is sharing');

  await watch.click();
  await bob.page.getByRole('button', { name: 'Continue' }).click();
  const view = bob.page.getByRole('region', { name: 'Screen share' });
  await view.getByText(aliceName).waitFor();
  await bob.page.waitForFunction(() => (document.querySelector('.watch video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 20000 });
  const size = await bob.page.evaluate(() => { const v = document.querySelector('.watch video') as HTMLVideoElement; return [v.videoWidth, v.videoHeight]; });
  await alice.page.getByText('You are sharing your screen, 1 watching').waitFor();
  console.log(`ok: bob receives the picture (${size[0]}x${size[1]}), alice sees one viewer`);

  // Leaving and coming back
  await view.getByRole('button', { name: 'Stop watching' }).click();
  await view.waitFor({ state: 'detached' });
  await alice.page.getByText('You are sharing your screen', { exact: true }).waitFor();
  await watch.click();
  await bob.page.waitForFunction(() => (document.querySelector('.watch video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 20000 });
  console.log('ok: stop watching and watch again');

  // Alice stops: the view and the indicator go away
  await alice.page.locator('.me').getByRole('button', { name: 'Stop sharing your screen' }).click();
  await view.waitFor({ state: 'detached' });
  await watch.waitFor({ state: 'detached' });
  assert.equal(await alice.page.getByText('You are sharing your screen').count(), 0);
  console.log('ok: stopping ends the stream for viewers');

  // A sharer who disconnects takes the stream with them
  await shareBtn.click();
  await picker.locator('.sources button').first().click();
  await watch.waitFor();
  await alice.page.getByTitle('Disconnect').click();
  await watch.waitFor({ state: 'detached' });
  console.log('ok: disconnecting ends the stream');

  console.log('SHARE E2E PASSED');
} finally {
  await alice.app.close().catch(() => {});
  await bob.app.close().catch(() => {});
}
