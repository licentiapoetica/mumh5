// Standalone sound settings and real media playback; no Mumble server required.
// CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e:sounds
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { readAudioPack } from '../../src/core/audio-pack.ts';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage();
  const failures: string[] = [];
  page.on('pageerror', e => { failures.push(e.message); console.error(e.message); });
  await page.goto(server.resolvedUrls!.local[0]);
  const open = async () => {
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.getByRole('tab', { name: 'Sounds' }).click();
    await page.getByRole('button', { name: 'Import ZIP audio pack...' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  };
  const play = (event: string, force = false) => page.evaluate(async ({ event, force }) => {
    const module = '/src/lib/audio/sounds.svelte.ts';
    await (await import(module)).sounds.play(event, force);
  }, { event, force });
  const log = () => page.evaluate(() => [...((window as any).__mumh5Sounds ?? [])] as string[]);
  await open();
  assert.equal(await page.locator('.events input:checked').count(), 3);
  assert.equal(await page.getByLabel('Clip for You muted', { exact: true }).locator('option').count(), 135);
  await play('connected');
  assert.equal((await log()).length, 0, 'optional event is silent');
  await play('privateMessage');
  assert.deepEqual(await log(), ['privateMessage'], 'standard WAV really starts playing');
  await play('poke');
  assert.deepEqual(await log(), ['privateMessage'], 'spoken clips do not overlap');
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await page.getByRole('checkbox', { name: 'You muted', exact: true }).check();

  const clips = readAudioPack(await readFile(new URL('../../src/assets/default-audio-pack.zip', import.meta.url)));
  const custom = zipSync({ 'AudioNotification/SelfMute.wav': clips.get('AudioNotification/SelfMute.wav')! });
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'my-pack.zip', mimeType: 'application/zip', buffer: Buffer.from(custom) });
  await page.getByText('my-pack.zip', { exact: true }).waitFor();
  assert.equal(await page.locator('.events input:checked').count(), 4, 'import keeps event choices');
  await play('mute', true);
  assert.ok((await log()).includes('mute'));
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await page.getByLabel('Clip for Someone poked you').selectOption('SystemNotification/Warning.wav');
  await page.reload();
  await open();
  await page.getByText('my-pack.zip', { exact: true }).waitFor();
  assert.ok(await page.getByRole('checkbox', { name: 'You muted', exact: true }).isChecked());
  assert.equal(await page.getByLabel('Clip for Someone poked you').inputValue(), 'SystemNotification/Warning.wav');
  await play('mute', true);
  assert.deepEqual(await log(), ['mute'], 'imported ZIP survives reload and plays');
  await page.getByRole('button', { name: 'Stop preview' }).click();

  // A bad archive cannot replace the last good pack or change event settings.
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken') });
  await page.locator('.error').waitFor();
  await page.getByText('my-pack.zip', { exact: true }).waitFor();
  assert.equal(await page.locator('.events input:checked').count(), 4);

  // Individual overrides are stored separately from the pack and also survive reload.
  const choose = page.waitForEvent('filechooser');
  await page.locator('.events li').filter({ has: page.getByRole('checkbox', { name: 'You muted', exact: true }) }).getByRole('button', { name: 'Choose file' }).click();
  await (await choose).setFiles({ name: 'my-mute.wav', mimeType: 'audio/wav', buffer: Buffer.from(clips.get('AudioNotification/SelfUnmute.wav')!) });
  await page.getByText('my-mute.wav', { exact: true }).waitFor();
  await page.reload();
  await open();
  await page.getByText('my-mute.wav', { exact: true }).waitFor();
  await play('mute', true);
  assert.deepEqual(await log(), ['mute']);
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await page.getByRole('button', { name: 'Reset all to built-in' }).click();
  await page.getByText('Chatterbox female (standard)', { exact: true }).waitFor();
  assert.equal(await page.locator('.events input:checked').count(), 4);
  await page.getByRole('button', { name: 'Use quiet defaults' }).click();
  assert.equal(await page.locator('.events input:checked').count(), 3);
  await page.reload();
  await open();
  assert.equal(await page.locator('.events input:checked').count(), 3);
  assert.equal(await page.locator('.error').count(), 0);
  assert.deepEqual(failures, []);
  console.log('SOUND E2E PASSED: default playback, event toggles, ZIP import, clip selection, custom files, reload, invalid ZIP, reset');
} finally {
  await browser.close();
  await server.close();
}
