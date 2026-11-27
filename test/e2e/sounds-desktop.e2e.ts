// Built desktop app: native IPC, user config files, file:// assets and playback.
// npm run build && npm run test:e2e:sounds:desktop (requires DISPLAY on Linux)
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { IdentityStore } from '../../electron/identity-store.ts';
import { readAudioPack } from '../../src/core/audio-pack.ts';

const root = path.resolve(import.meta.dirname, '../..');
const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-desktop-sounds-'));
await new IdentityStore(directory).finishSetup();
const { ELECTRON_RUN_AS_NODE, VITE_DEV_SERVER_URL, ...env } = process.env;
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [root, `--user-data-dir=${directory}`, '--ozone-platform=x11', '--disable-audio-output'],
  env: env as Record<string, string>
});
try {
  const page = await app.firstWindow();
  // Settings in the main window, where the steps look for it
  await page.evaluate(() => localStorage.setItem('mumh5.settingsInline', '1'));
  const failures: string[] = [];
  page.on('pageerror', e => failures.push(e.message));
  const open = async () => {
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.getByRole('tab', { name: 'Sounds' }).click();
    await page.waitForFunction(() => !!document.querySelector('fieldset:not([disabled])'));
  };
  await open();
  assert.equal(await page.locator('.events input:checked').count(), 3);
  assert.equal(await page.getByLabel('Clip for You muted', { exact: true }).locator('option').count(), 135);
  const preview = page.getByRole('button', { name: 'Play You muted', exact: true });
  await preview.click();
  await page.waitForFunction(() => ((window as any).__mumh5Sounds ?? []).includes('mute'));
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await page.getByRole('checkbox', { name: 'You muted', exact: true }).check();
  await page.getByLabel('Clip for Someone poked you').selectOption('SystemNotification/Warning.wav');
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(path.join(root, 'src/assets/default-audio-pack.zip'));
  await page.locator('.help strong').getByText('default-audio-pack.zip', { exact: true }).waitFor();
  await page.waitForFunction(() => !!document.querySelector('fieldset:not([disabled])'));
  const config = JSON.parse(await readFile(path.join(directory, 'sounds.json'), 'utf8'));
  assert.equal(config.on.mute, true);
  assert.equal(config.clips.poke, 'SystemNotification/Warning.wav');
  assert.equal(config.pack.name, 'default-audio-pack.zip');
  assert.deepEqual(await readFile(path.join(directory, 'sounds/packs', `${config.pack.id}.zip`)), await readFile(path.join(root, 'src/assets/default-audio-pack.zip')));
  await page.reload();
  await open();
  assert.equal(await page.locator('.events input:checked').count(), 4);
  assert.equal(await page.getByLabel('Clip for Someone poked you').inputValue(), 'SystemNotification/Warning.wav');
  await page.locator('.help strong').getByText('default-audio-pack.zip', { exact: true }).waitFor();
  await preview.click();
  await page.waitForFunction(() => ((window as any).__mumh5Sounds ?? []).includes('mute'));
  assert.equal(await page.locator('.error').count(), 0);
  // The previous single-pack format is retained as the first library entry.
  const legacy = { ...config, pack: { name: 'legacy.zip' } };
  delete legacy.packs;
  await writeFile(path.join(directory, 'sounds/pack.zip'), await readFile(path.join(root, 'src/assets/default-audio-pack.zip')));
  await writeFile(path.join(directory, 'sounds.json'), JSON.stringify(legacy));
  await page.reload();
  await open();
  assert.equal(await page.getByLabel('Audio pack', { exact: true }).locator('option').count(), 2);
  assert.equal(await page.getByLabel('Audio pack', { exact: true }).locator('option:checked').textContent(), 'legacy.zip');
  const library = JSON.parse(await readFile(path.join(directory, 'sounds.json'), 'utf8'));
  assert.equal(library.packs.length, 1);
  assert.equal(library.pack.id, library.packs[0].id);
  await preview.click();
  await page.waitForFunction(() => ((window as any).__mumh5Sounds ?? []).includes('mute'));
  assert.equal(await page.locator('.error').count(), 0);
  // Older installations kept preferences in localStorage and clips in either
  // IndexedDB or inline data URLs. Both migrate into the native config directory.
  const clips = readAudioPack(await readFile(path.join(root, 'src/assets/default-audio-pack.zip')));
  const mute = clips.get('AudioNotification/SelfMute.wav')!;
  const unmute = clips.get('AudioNotification/SelfUnmute.wav')!;
  await page.evaluate(async ({ mute, unmute }) => {
    localStorage.setItem('mumh5.sounds', JSON.stringify({ enabled: true, volume: 0.4, on: { mute: true, unmute: false }, custom: {
      mute: { name: 'legacy-inline.wav', data: `data:audio/wav;base64,${mute}` },
      unmute: { name: 'legacy-indexeddb.wav' }
    } }));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('mumh5', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(new Blob([Uint8Array.from(atob(unmute), c => c.charCodeAt(0))], { type: 'audio/wav' }), 'sound:unmute');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { mute: Buffer.from(mute).toString('base64'), unmute: Buffer.from(unmute).toString('base64') });
  await rm(path.join(directory, 'sounds.json'));
  await page.reload();
  await open();
  await page.getByText('legacy-inline.wav', { exact: true }).waitFor();
  await page.getByText('legacy-indexeddb.wav', { exact: true }).waitFor();
  assert.deepEqual(await readFile(path.join(directory, 'sounds/mute.audio')), Buffer.from(mute));
  assert.deepEqual(await readFile(path.join(directory, 'sounds/unmute.audio')), Buffer.from(unmute));
  const migrated = JSON.parse(await readFile(path.join(directory, 'sounds.json'), 'utf8'));
  assert.equal(migrated.on.mute, true);
  assert.equal(migrated.on.unmute, false);
  assert.equal(migrated.on.userJoined, true, 'a missing choice meant on in older versions');
  assert.equal(migrated.on.messageSent, false);
  assert.equal(migrated.custom.mute.data, undefined);
  await preview.click();
  await page.waitForFunction(() => ((window as any).__mumh5Sounds ?? []).includes('mute'));
  assert.equal(await page.locator('.error').count(), 0);

  // Importing a known pack again restores its archive if the file went missing.
  const standardZip = path.join(root, 'src/assets/default-audio-pack.zip');
  const zipInput = page.locator('input[accept=".zip,application/zip"]');
  await zipInput.setInputFiles(standardZip);
  await page.locator('.help strong').getByText('default-audio-pack.zip', { exact: true }).waitFor();
  await page.waitForFunction(() => !!document.querySelector('fieldset:not([disabled])'));
  const library2 = JSON.parse(await readFile(path.join(directory, 'sounds.json'), 'utf8'));
  const archive = path.join(directory, 'sounds/packs', `${library2.packs[0].id}.zip`);
  await rm(archive);
  await zipInput.setInputFiles(standardZip);
  for (let i = 0; i < 100 && !(await readFile(archive).catch(() => null)); i++) await page.waitForTimeout(100);
  assert.deepEqual(await readFile(archive), await readFile(standardZip));
  await page.waitForFunction(() => !!document.querySelector('fieldset:not([disabled])'));

  // A damaged settings file does not lose the library.
  await writeFile(path.join(directory, 'sounds.json'), '{"packs":[');
  await page.reload();
  await open();
  await page.getByText('Sound settings were damaged', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Audio pack', { exact: true }).locator('option').count(), 2);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'sounds.json'), 'utf8')).packs.length, 1);
  assert.equal(await readFile(path.join(directory, 'sounds.json.damaged'), 'utf8'), '{"packs":[');
  assert.deepEqual(failures, []);
  console.log('DESKTOP SOUND E2E PASSED: bundled playback, native ZIP storage, config source, reload, preview and legacy migration');
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
