// Independent scrolling and responsive sizing in both interfaces; no server required.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('mumh5.identities', JSON.stringify({ identities: [], defaultId: null, setupDone: true })));
  await page.goto(server.resolvedUrls!.local[0]);
  await page.evaluate(async () => {
    const sessionPath = '/src/lib/session.svelte.ts', clientPath = '/src/core/client.ts', codecPath = '/src/core/proto.ts';
    const { session } = await import(sessionPath);
    const { MumbleClient } = await import(clientPath);
    const { createCodec } = await import(codecPath);
    const client = new MumbleClient(createCodec());
    for (let id = 0; id < 70; id++) client.channels.set(id, { id, parent: id === 0 ? null : 0, name: `Channel ${id}`, description: '', descriptionHash: null,
      position: id, temporary: false, links: new Set(), maxUsers: 0, canEnter: true });
    session.client = client;
    session.server = { id: 'fixture', label: 'Test server', host: 'localhost', port: 64738, username: 'test', password: '' };
    session.status = 'connected';
    session.expanded[0] = true;
    session.tick++;
  });
  const chats = page.locator('.conversation-lists:visible');
  const populate = (count: number) => page.evaluate(async count => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    session.logs = Object.fromEntries(Array.from({ length: count }, (_, i) => [`dm:${i + 100}`, []]));
  }, count);
  for (const mode of ['side', 'classic', 'stacked', 'rooms']) {
    await page.evaluate(async mode => {
      const module = '/src/lib/settings.svelte.ts';
      const { store } = await import(module);
      store.settings.interface = mode === 'rooms' ? 'rooms' : 'standard';
      store.settings.arrangement = mode === 'rooms' ? 'side' : mode;
    }, mode);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 1000, height: 600 }, { width: 390, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
      if (mode !== 'rooms' && mode !== 'stacked' && viewport.width < 760 && !await chats.isVisible()) await page.getByRole('button', { name: 'Open channels' }).click();
      await populate(0);
      await chats.getByText('No private chats yet.').waitFor();
      const emptyHeight = await chats.locator('.private-chats').evaluate(el => el.getBoundingClientRect().height);
      await populate(1);
      await page.waitForFunction(() => document.querySelectorAll('.private-scroll li').length === 1);
      const shortHeight = await chats.locator('.private-chats').evaluate(el => el.getBoundingClientRect().height);
      assert.ok(shortHeight < emptyHeight + 70, `${mode}: short list uses only needed space (${emptyHeight} -> ${shortHeight})`);
      await populate(70);
      await page.waitForFunction(() => document.querySelectorAll('.private-scroll li').length === 70);
      const dimensions = await chats.evaluate(el => {
        const lists = el.querySelector('.lists')!, privateArea = el.querySelector('.private-chats')!;
        const channels = el.querySelector('.scroll')!, messages = el.querySelector('.private-scroll')!;
        return { available: lists.clientHeight, privateHeight: privateArea.getBoundingClientRect().height,
          channelHeight: channels.clientHeight, channelContent: channels.scrollHeight, privateContent: messages.scrollHeight, privateClient: messages.clientHeight, channelOverflow: channels.scrollHeight > channels.clientHeight, privateOverflow: messages.scrollHeight > messages.clientHeight };
      });
      assert.ok(dimensions.privateHeight <= dimensions.available / 2 + 1, `${mode}: private section capped at half (${JSON.stringify(dimensions)})`);
      assert.ok(dimensions.channelOverflow && dimensions.privateOverflow, `${mode}: lists scroll separately (${JSON.stringify(dimensions)})`);
      await chats.locator('.scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.equal(await chats.locator('.private-scroll').evaluate(el => el.scrollTop), 0);
      await page.evaluate(async () => {
        const module = '/src/lib/session.svelte.ts';
        const { session } = await import(module);
        session.unread = { 'ch:1': 3, 'dm:100': 2 };
      });
      await chats.getByRole('button', { name: /^Direct messages/ }).click();
      assert.equal(await chats.locator('.private-scroll').isVisible(), false);
      assert.equal(await chats.getByRole('button', { name: /^Direct messages/ }).locator('.badge').textContent(), '2', `${mode}: direct-message header counts only private unreads`);
      await chats.getByRole('button', { name: /^Direct messages/ }).click();
      await chats.getByRole('button', { name: /^Channels and chats/ }).click();
      assert.equal(await chats.locator('.lists').isVisible(), false);
      assert.equal(await chats.getByRole('button', { name: /^Channels and chats/ }).locator('.badge').textContent(), '5', `${mode}: collapsed group includes channel and private unreads`);
      await chats.getByRole('button', { name: /^Channels and chats/ }).click();
      await page.evaluate(async () => {
        const module = '/src/lib/session.svelte.ts';
        const { session } = await import(module);
        session.unread = {};
      });
    }
    console.log(`ok: ${mode} private chats remain visible, size to content, scroll independently and collapse`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
