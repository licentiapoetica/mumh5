// Standalone Appearance checks; no Mumble server required.
// CHROMIUM_PATH=/path/to/chromium npm run test:e2e:backgrounds
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const failures: string[] = [];
  const remoteImages: string[] = [];
  page.on('pageerror', e => failures.push(e.message));
  page.on('request', r => {
    if (r.resourceType() === 'image' && /^https?:/.test(r.url()) && !r.url().startsWith(server.resolvedUrls!.local[0])) remoteImages.push(r.url());
  });
  await page.goto(server.resolvedUrls!.local[0]);
  const open = async () => {
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
  };
  const design = (name: string) => page.getByRole('group', { name: 'Background design', exact: true }).getByRole('button', { name, exact: true });
  const imageInput = () => page.getByLabel('Background image', { exact: true });
  const homeArt = page.locator('.home > .background-art');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('mumh5.settings')!));
  const shot = async (name: string) => {
    if (!process.env.SHOTS_DIR) return;
    await mkdir(process.env.SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `${name}.png`), animations: 'disabled' });
  };
  await open();
  assert.equal(await page.locator('.background-art').count(), 0, 'existing profiles keep the plain background');

  await design('Grid').click();
  await page.getByLabel('Design color').fill('#e07040');
  await page.getByLabel('Background strength').fill('35');
  assert.equal(await homeArt.getAttribute('data-design'), 'grid');
  assert.equal(await homeArt.evaluate(el => getComputedStyle(el).opacity), '0.35');
  assert.match(await homeArt.evaluate(el => getComputedStyle(el).backgroundImage), /224, 112, 64/);
  // The decoration sits within its surface, behind content, and cannot swallow clicks.
  assert.deepEqual(await homeArt.evaluate(el => ({
    pointer: getComputedStyle(el).pointerEvents, z: getComputedStyle(el).zIndex,
    isolation: getComputedStyle(el.parentElement!).isolation
  })), { pointer: 'none', z: '-1', isolation: 'isolate' });
  await page.reload();
  await homeArt.waitFor();
  assert.equal(await homeArt.getAttribute('data-design'), 'grid');
  await open();
  for (const name of ['Gradient', 'Dots']) {
    await design(name).click();
    assert.equal(await homeArt.getAttribute('data-design'), name.toLowerCase());
  }
  await shot('background-design-settings');
  // Dots and grid take a size and spacing; a new design starts from its own.
  await page.getByLabel('Dot size').fill('3');
  await page.getByLabel('Spacing').fill('40');
  assert.equal(await homeArt.evaluate(el => getComputedStyle(el).backgroundSize), '40px 40px');
  assert.match(await homeArt.evaluate(el => getComputedStyle(el).backgroundImage), /3px/);
  assert.deepEqual([(await saved()).backgroundMark, (await saved()).backgroundSpacing], [3, 40]);
  await design('Grid').click();
  assert.equal(await homeArt.evaluate(el => getComputedStyle(el).backgroundSize), '32px 32px');
  await design('Dots').click();
  assert.equal(await homeArt.evaluate(el => getComputedStyle(el).backgroundSize), '20px 20px');

  await design('Image').click();
  await page.getByRole('button', { name: 'Choose image', exact: true }).waitFor({ state: 'visible' });
  const png = await readFile(new URL('../../build/icon.png', import.meta.url));
  await imageInput().setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: png });
  await page.getByText('wallpaper.png', { exact: true }).waitFor();
  const first = await homeArt.evaluate(el => getComputedStyle(el).backgroundImage);
  assert.match(first, /blob:/);
  const blob = await page.evaluate(async () => {
    const module = '/src/lib/blobstore.ts';
    const file = await (await import(module)).getBlob('appearance.background');
    return { name: file.name, size: file.size };
  });
  assert.deepEqual(blob, { name: 'wallpaper.png', size: png.length });
  assert.ok(JSON.stringify(await saved()).length < 5000, 'image bytes stay out of settings');
  for (const [fit, size, repeat] of [['contain', 'contain', 'no-repeat'], ['tile', 'auto', 'repeat'], ['cover', 'cover', 'no-repeat']]) {
    await page.getByLabel('Image fit').selectOption(fit);
    assert.equal(await homeArt.evaluate(el => getComputedStyle(el).backgroundSize), size);
    assert.equal(await homeArt.evaluate(el => getComputedStyle(el).backgroundRepeat), repeat);
  }
  // Invalid content and unsupported files leave the last successful import in place.
  for (const [name, mimeType, buffer, message] of [
    ['broken.png', 'image/png', Buffer.from('broken'), 'Could not read or save this image.'],
    ['design.svg', 'image/svg+xml', Buffer.from('<svg/>'), 'Choose a PNG'],
    ['large.png', 'image/png', Buffer.alloc(20 * 1024 * 1024 + 1), 'Choose an image smaller']
  ] as const) {
    await imageInput().setInputFiles({ name, mimeType, buffer });
    await page.getByRole('alert').filter({ hasText: message }).waitFor();
    assert.equal(await homeArt.evaluate(el => getComputedStyle(el).backgroundImage), first);
    assert.equal((await saved()).backgroundDesign, 'image');
  }
  await imageInput().setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
  await page.getByText('replacement.png', { exact: true }).waitFor();
  assert.notEqual(await homeArt.evaluate(el => getComputedStyle(el).backgroundImage), first);
  // A storage failure must keep the previous image and report the failed operation.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restoreBackgroundPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args) {
      if (args[1] === 'appearance.background') throw new DOMException('Test storage quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  const replacement = await homeArt.evaluate(el => getComputedStyle(el).backgroundImage);
  await imageInput().setInputFiles({ name: 'unsaved.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('alert').filter({ hasText: 'Could not read or save this image.' }).waitFor();
  assert.equal(await homeArt.evaluate(el => getComputedStyle(el).backgroundImage), replacement);
  await page.evaluate(() => (window as any).__restoreBackgroundPut());
  await page.reload();
  await homeArt.waitFor();
  assert.match(await homeArt.evaluate(el => getComputedStyle(el).backgroundImage), /blob:/);
  await open();
  await page.getByText('replacement.png', { exact: true }).waitFor();
  await design('None').click();
  assert.equal(await page.locator('.background-art').count(), 0);
  await design('Image').click();
  await homeArt.waitFor();

  // Every Standard layout and both narrow and wide Rooms screens use the same design.
  for (const layout of ['Modern', 'Classic', 'Stacked']) {
    await page.getByRole('radio', { name: layout, exact: true }).click();
    await homeArt.waitFor();
  }
  for (const theme of ['Light', 'Windows 95', 'Dark']) {
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await homeArt.waitFor();
    assert.match(await homeArt.evaluate(el => getComputedStyle(el).backgroundImage), /blob:/);
  }
  await page.getByRole('radio', { name: 'Rooms', exact: true }).click();
  // The channel list (the room list here) has none by default, the chat's or its own design.
  const treeMode = (name: string) => page.getByRole('group', { name: 'Channel list background', exact: true }).getByRole('button', { name, exact: true });
  await treeMode('Own design').click();
  await page.getByRole('group', { name: 'Channel list background design', exact: true }).getByRole('button', { name: 'Dots', exact: true }).click();
  assert.equal((await saved()).treeBackgroundStyle.design, 'dots');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.chat2 > .background-art').waitFor();
  await page.locator('.rooms > .background-art[data-design="dots"]').waitFor();
  assert.match(await page.locator('.chat2 > .background-art').evaluate(el => getComputedStyle(el).backgroundImage), /blob:/);
  await shot('background-rooms');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const name of ['Chat', 'Voice', 'People', 'You']) {
      await page.getByRole('navigation', { name: 'Screens' }).getByRole('button', { name, exact: true }).click();
      await page.locator('main .background-art').waitFor();
    }
  }
  await page.locator('.you').getByRole('button', { name: /^Appearance/ }).click();
  await page.getByRole('button', { name: 'Remove image', exact: true }).click();
  await design('None').waitFor();
  await treeMode('None').click();
  await page.waitForFunction(() => !document.querySelector('.background-art'));
  assert.equal((await saved()).backgroundDesign, 'none');
  assert.equal(await page.evaluate(async () => {
    const module = '/src/lib/blobstore.ts';
    return !!await (await import(module)).getBlob('appearance.background');
  }), false, 'removal deletes the stored image');
  await page.reload();
  await page.getByRole('navigation', { name: 'Screens' }).waitFor();
  assert.equal(await page.locator('.background-art').count(), 0);
  assert.deepEqual(remoteImages, [], 'backgrounds never fetch remote images');
  assert.deepEqual(failures, []);
  console.log('BACKGROUND E2E PASSED: designs, color, strength, image import, fit, validation, replacement, reload, layouts, Rooms and removal');
} finally {
  await browser.close();
  await server.close();
}
