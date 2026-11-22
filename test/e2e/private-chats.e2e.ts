// Private chats as tabs above the chat (stacked, narrow windows) or as a list beside it; no server required.
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
    for (let id = 0; id < 20; id++) client.channels.set(id, { id, parent: id === 0 ? null : 0, name: `Channel ${id}`, description: '', descriptionHash: null,
      position: id, temporary: false, links: new Set(), maxUsers: 0, canEnter: true });
    session.client = client;
    session.server = { id: 'fixture', label: 'Test server', host: 'localhost', port: 64738, username: 'test', password: '' };
    session.status = 'connected';
    session.expanded[0] = true;
    session.tick++;
  });
  // Private chats with offline people, named through the kept names
  const populate = (count: number) => page.evaluate(async count => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    const keys = Array.from({ length: count }, (_, i) => `dm:${i + 100}`);
    for (const key of keys) session.dmNames[key] = `Person ${key.slice(3)}`;
    session.unread = {};
    session.logs = Object.fromEntries(keys.map(key => [key, []]));
  }, count);
  const select = (key: string) => page.evaluate(async key => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    session.selectView(key);
  }, key);
  const view = () => page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    return session.view as string;
  });
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
  const tabs = page.getByRole('tablist', { name: 'Open chats' });

  for (const mode of ['side', 'classic', 'stacked', 'rooms']) {
    await page.evaluate(async mode => {
      const module = '/src/lib/settings.svelte.ts';
      const { store } = await import(module);
      store.settings.interface = mode === 'rooms' ? 'rooms' : 'standard';
      store.settings.arrangement = mode === 'rooms' ? 'side' : mode;
    }, mode);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 700 }]) {
      await page.setViewportSize(viewport);
      await frame();
      const narrow = viewport.width < (mode === 'rooms' ? 900 : 760);
      const tabbed = mode === 'stacked' || narrow;
      const where = `${mode} at ${viewport.width}px`;
      await populate(3);
      await select('ch:5');
      await select('dm:100');
      await frame();
      if (tabbed) {
        await tabs.waitFor();
        assert.equal(await tabs.getByRole('tab').count(), 4, `${where}: the channel and three private chats`);
        assert.match(await tabs.getByRole('tab').first().textContent() ?? '', /Channel 5/, `${where}: the first tab is the channel shown last`);
        assert.equal(await tabs.getByRole('tab', { name: /Person 100/ }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('.sidebar .dm-row').count(), 0, `${where}: no second list in the channel tree`);
        await tabs.getByRole('tab').first().click();
        assert.equal(await view(), 'ch:5', `${where}: one click back to the channel`);
        await tabs.getByRole('tab', { name: /Person 101/ }).click();
        assert.equal(await view(), 'dm:101', `${where}: one click to a private chat`);
        await page.evaluate(async () => {
          const module = '/src/lib/session.svelte.ts';
          const { session } = await import(module);
          session.unread = { 'dm:102': 2, 'ch:5': 4 };
        });
        assert.equal(await tabs.getByRole('tab', { name: /Person 102/ }).locator('.badge').textContent(), '2');
        assert.equal(await tabs.getByRole('tab').first().locator('.badge').textContent(), '4', `${where}: the channel tab counts its unread messages`);
        await tabs.getByRole('button', { name: 'Close conversation with Person 102' }).click();
        assert.equal(await tabs.getByRole('tab').count(), 3, `${where}: the close button removes the tab`);
        await populate(40);
        await select('dm:139');
        await frame();
        const fit = await tabs.evaluate(el => ({ scrolls: el.scrollWidth > el.clientWidth, page: document.documentElement.scrollWidth <= window.innerWidth,
          selected: (() => { const r = el.querySelector('[aria-selected="true"]')!.getBoundingClientRect(), box = el.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; })() }));
        assert.ok(fit.scrolls && fit.page && fit.selected, `${where}: many tabs scroll sideways inside the strip and keep the open one in view (${JSON.stringify(fit)})`);
        await populate(0);
        await select('ch:5');
        await tabs.waitFor({ state: 'detached' });
      } else {
        assert.equal(await tabs.count(), 0, `${where}: no tabs beside a list`);
        const list = mode === 'rooms' ? page.getByRole('region', { name: 'Rooms' }) : page.locator('.sidebar');
        await list.getByText('Person 101').click();
        assert.equal(await view(), 'dm:101', `${where}: one click from the list`);
        await populate(0);
      }
    }
    console.log(`ok: ${mode} private chats as tabs where the list is not beside the chat, as a list where it is`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
