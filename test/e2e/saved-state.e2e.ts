// Saved servers survive what used to lose them. Needs no Mumble server.
//   npm run build && npm run test:e2e:saved
import './english.ts';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const profile = mkdtempSync(path.join(tmpdir(), 'mumh5-e2e-'));
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const servers = [
  { id: 'keep-1', label: 'First kept server', host: 'one.invalid', port: 64738, username: 'me', password: '' },
  { id: 'keep-2', label: 'Second kept server', host: 'two.invalid', port: 64738, username: 'me', password: '' }
];

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [root, `--user-data-dir=${profile}`, '--ozone-platform=x11', '--disable-audio-output'],
    env: { ...env, MUMH5_E2E: '1' } as Record<string, string>
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.querySelector('#app')?.childElementCount);
  return { app, page };
}
const stored = (page: Awaited<ReturnType<typeof launch>>['page']) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('mumh5.servers') ?? '[]') as { id: string }[]).map(s => s.id));

try {
  // A profile from before the file existed: the list is only in browser storage
  let run = await launch();
  await run.page.evaluate(list => localStorage.setItem('mumh5.servers', JSON.stringify(list)), servers);
  await run.page.reload();
  await run.page.waitForFunction(() => !!document.querySelector('#app')?.childElementCount);
  assert.deepEqual(await stored(run.page), ['keep-1', 'keep-2']);

  // A second copy on the same profile gets empty browser storage and still has the list
  const second = await launch();
  assert.deepEqual(await stored(second.page), ['keep-1', 'keep-2'], 'second open copy');
  await second.app.close();
  await run.app.close();

  // Chromium replaced the database
  rmSync(path.join(profile, 'Local Storage'), { recursive: true, force: true });
  run = await launch();
  assert.deepEqual(await stored(run.page), ['keep-1', 'keep-2'], 'after losing Local Storage');
  await run.page.getByText('First kept server').first().waitFor({ timeout: 10000 });
  await run.app.close();
  console.log('saved state E2E passed');
} finally {
  rmSync(profile, { recursive: true, force: true });
}
