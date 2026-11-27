// Standalone sound settings and real media playback; no Mumble server required.
// CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e:sounds
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { readAudioPack } from '../../src/core/audio-pack.ts';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem('mumh5.identities', JSON.stringify({ identities: [], defaultId: null, setupDone: true })));
  // Settings in the page, where the steps look for it, not in a window of its own
  await page.addInitScript(() => localStorage.setItem('mumh5.settingsInline', '1'));
  const failures: string[] = [];
  page.on('pageerror', e => { failures.push(e.message); console.error(e.message); });
  await page.addInitScript(() => {
    const blobs = new Map<string, Blob>();
    (window as any).__soundBlobs = blobs;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = create(blob);
      blobs.set(url, blob as Blob);
      return url;
    };
    URL.revokeObjectURL = url => { blobs.delete(url); revoke(url); };
  });
  const packFetches: string[] = [];
  page.on('request', r => { if (r.resourceType() === 'fetch' && r.url().includes('default-audio-pack')) packFetches.push(r.url()); });
  await page.goto(server.resolvedUrls!.local[0]);
  await page.getByRole('button', { name: 'Configure', exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.deepEqual(packFetches, [], 'the standard pack is not fetched at start');
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
  const sourceHash = (event = 'mute') => page.evaluate(async event => {
    const module = '/src/lib/audio/sounds.svelte.ts';
    const source = await (await import(module)).sounds.source(event);
    const bytes = await ((window as any).__soundBlobs.get(source) as Blob).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }, event);
  const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
  await open();
  assert.equal(packFetches.length, 1, 'opening Sounds loads it once');
  assert.equal(await page.locator('.events input:checked').count(), 3);
  assert.equal(await page.getByLabel('Clip for You muted', { exact: true }).locator('option').count(), 135);

  // Dragging the volume slider saves once, after it stops.
  const saves = await page.evaluate(async () => {
    const module = '/src/lib/audio/sounds.svelte.ts';
    const { sounds } = await import(module);
    const original = Storage.prototype.setItem;
    let count = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'mumh5.sounds') count++;
      original.call(this, key, value);
    };
    for (let i = 1; i <= 10; i++) sounds.update({ volume: 0.5 + i / 100 });
    const during = count;
    await new Promise(r => setTimeout(r, 500));
    Storage.prototype.setItem = original;
    return { during, after: count, saved: JSON.parse(localStorage.getItem('mumh5.sounds')!).volume };
  });
  assert.deepEqual(saves, { during: 0, after: 1, saved: 0.6 });

  await play('connected');
  assert.equal((await log()).length, 0, 'optional event is silent');
  await play('privateMessage');
  assert.deepEqual(await log(), ['privateMessage'], 'standard WAV really starts playing');
  await page.getByRole('checkbox', { name: 'Someone joined your channel', exact: true }).check();
  await play('userJoined');
  assert.deepEqual(await log(), ['privateMessage', 'userJoined'], 'a routine event replaces ongoing speech');
  await play('poke');
  assert.deepEqual(await log(), ['privateMessage', 'userJoined', 'poke'], 'an alert replaces the clip playing');
  await page.getByRole('checkbox', { name: 'You muted', exact: true }).check();
  await page.getByRole('checkbox', { name: 'You unmuted', exact: true }).check();
  await play('mute');
  await play('unmute');
  await play('mute');
  assert.deepEqual((await log()).slice(-3), ['mute', 'unmute', 'mute'], 'the last mic sound always matches the state');
  // Repeated events restart; silent events leave the current notification alone.
  const repeat = await page.evaluate(async () => {
    const module = '/src/lib/audio/sounds.svelte.ts';
    const { sounds } = await import(module);
    const previous = sounds.active;
    await sounds.play('privateMessage');
    const first = sounds.active;
    await sounds.play('privateMessage');
    const second = sounds.active;
    await sounds.play('connected');
    return { previousPaused: previous.paused, firstPaused: first.paused,
      replaced: first !== second, silentPreserved: sounds.active === second && !second.paused };
  });
  assert.deepEqual(repeat, { previousPaused: true, firstPaused: true, replaced: true, silentPreserved: true });
  // A slow source must not reclaim the slot after a newer notification has started.
  const race = await page.evaluate(async () => {
    const module = '/src/lib/audio/sounds.svelte.ts';
    const { sounds } = await import(module);
    const source = sounds.source.bind(sounds);
    let release: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    sounds.source = async (event: string) => {
      if (event === 'userJoined') { entered(); await blocked; }
      return source(event);
    };
    const older = sounds.play('userJoined');
    await started;
    const pausedImmediately = !sounds.active;
    await sounds.play('poke');
    const newest = sounds.active;
    release!();
    await older;
    sounds.source = source;
    return { pausedImmediately, latestWon: sounds.active === newest && !newest.paused };
  });
  assert.deepEqual(race, { pausedImmediately: true, latestWon: true });
  // A clip that is paused by the system or fails while playing frees the slot
  for (const type of ['pause', 'error']) {
    const busy = await page.evaluate(async type => {
      const module = '/src/lib/audio/sounds.svelte.ts';
      const { sounds } = await import(module);
      sounds.active.dispatchEvent(new Event(type));
      return sounds.playing || !!sounds.active;
    }, type);
    assert.equal(busy, false, `${type} frees the playback slot`);
    if (type === 'pause') {
      await play('userJoined');
      assert.equal((await log()).at(-1), 'userJoined', 'a routine event plays again');
    }
    await play('unmute');
  }
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await page.getByRole('checkbox', { name: 'Someone joined your channel', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'You unmuted', exact: true }).uncheck();

  const clips = readAudioPack(await readFile(new URL('../../src/assets/default-audio-pack.zip', import.meta.url)));
  const custom = zipSync({ 'AudioNotification/SelfMute.wav': clips.get('AudioNotification/SelfMute.wav')! });
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'my-pack.zip', mimeType: 'application/zip', buffer: Buffer.from(custom) });
  await page.locator('.help strong').getByText('my-pack.zip', { exact: true }).waitFor();
  assert.equal(await page.locator('.events input:checked').count(), 4, 'import keeps event choices');
  await play('mute', true);
  assert.ok((await log()).includes('mute'));
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await page.getByLabel('Clip for Someone poked you').selectOption('SystemNotification/Warning.wav');
  await page.reload();
  await open();
  await page.locator('.help strong').getByText('my-pack.zip', { exact: true }).waitFor();
  assert.ok(await page.getByRole('checkbox', { name: 'You muted', exact: true }).isChecked());
  assert.equal(await page.getByLabel('Clip for Someone poked you').inputValue(), 'SystemNotification/Warning.wav');
  await play('mute', true);
  assert.deepEqual(await log(), ['mute'], 'imported ZIP survives reload and plays');
  await page.getByRole('button', { name: 'Stop preview' }).click();

  // A bad archive cannot replace the last good pack or change event settings.
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken') });
  await page.locator('.error').waitFor();
  await page.locator('.help strong').getByText('my-pack.zip', { exact: true }).waitFor();
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

  // Switching packs sets the file aside without deleting it.
  await page.getByLabel('Audio pack', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Use my file', exact: true }).waitFor();
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfMute.wav')!), 'the pack plays while the file is set aside');
  await page.reload();
  await open();
  await page.getByRole('button', { name: 'Use my file', exact: true }).click();
  await page.getByText('my-mute.wav', { exact: true }).waitFor();
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfUnmute.wav')!), 'the file is back');

  await page.getByRole('button', { name: 'Reset all to built-in' }).click();
  await page.locator('.help strong').getByText('Chatterbox female (standard)', { exact: true }).waitFor();
  assert.equal(await page.locator('.events input:checked').count(), 4);
  await page.getByRole('button', { name: 'Use quiet defaults' }).click();
  assert.equal(await page.locator('.events input:checked').count(), 3);
  await page.reload();
  await open();
  assert.equal(await page.locator('.events input:checked').count(), 3);
  assert.equal(await page.locator('.error').count(), 0);

  // Multiple imports build a library. Switching changes the actual audio bytes,
  // and the standard pack remains available after imports and after reload.
  const library = page.getByLabel('Audio pack', { exact: true });
  const second = zipSync({ 'AudioNotification/SelfMute.wav': clips.get('AudioNotification/SelfUnmute.wav')! });
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles([
    { name: 'my-pack.zip', mimeType: 'application/zip', buffer: Buffer.from(custom) },
    { name: 'second.zip', mimeType: 'application/zip', buffer: Buffer.from(second) }
  ]);
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await library.locator('option').count(), 3, 'standard plus two distinct saved packs');
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfUnmute.wav')!));
  await library.selectOption({ label: 'my-pack.zip' });
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfMute.wav')!));
  await library.selectOption({ label: 'second.zip' });
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  await page.reload();
  await open();
  assert.equal(await library.locator('option').count(), 3);
  assert.equal(await library.locator('option:checked').textContent(), 'second.zip');
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfUnmute.wav')!));
  await library.selectOption('');
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfMute.wav')!), 'switch back to vanilla');
  assert.equal(await library.locator('option').count(), 3, 'vanilla keeps the personal library');

  // Folder imports, from generated folders.
  const fixtures = await mkdtemp(path.join(tmpdir(), 'mumh5-sound-fixtures-'));
  try {
    const folderClip = { 'pack-one': clips.get('AudioNotification/SelfDeaf.wav')!, 'pack-two': clips.get('AudioNotification/SelfUndeaf.wav')! };
    for (const [name, data] of Object.entries(folderClip)) {
      await mkdir(path.join(fixtures, name, 'AudioNotification'), { recursive: true });
      await writeFile(path.join(fixtures, name, 'AudioNotification/SelfMute.wav'), data);
      const before = await library.locator('option').count();
      await page.locator('input[webkitdirectory]').setInputFiles(path.join(fixtures, name));
      await page.locator('.help strong').getByText(`${name}.zip`, { exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
      assert.equal(await library.locator('option').count(), before + 1);
      assert.equal(await sourceHash(), hash(data));
      await play('mute', true);
      await page.getByRole('button', { name: 'Stop preview' }).click();
    }
    const folders = await library.locator('option').count();
    const sameAudio = zipSync({ 'AudioNotification/SelfMute.wav': folderClip['pack-two'] });
    await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'same-audio.zip', mimeType: 'application/zip', buffer: Buffer.from(sameAudio) });
    await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
    assert.equal(await library.locator('option').count(), folders, 'folder and ZIP of the same clips share one entry');
    await library.selectOption({ label: 'pack-one.zip' });
    await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
    assert.equal(await sourceHash(), hash(folderClip['pack-one']));
    await page.reload();
    await open();
    assert.equal(await library.locator('option').count(), folders);
    assert.equal(await library.locator('option:checked').textContent(), 'pack-one.zip');
    await library.selectOption('');
    await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
    assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfMute.wav')!));

    // A folder over the limit is refused before anything is read or zipped.
    const large = path.join(fixtures, 'too-large', 'AudioNotification');
    await mkdir(large, { recursive: true });
    for (let i = 0; i < 9; i++) await writeFile(path.join(large, `Clip${i}.wav`), Buffer.alloc(4 * 1024 * 1024));
    await page.locator('input[webkitdirectory]').setInputFiles(path.dirname(large));
    await page.locator('.error').getByText('Sound pack folders must be at most 32 MiB', { exact: false }).waitFor();
    assert.equal(await library.locator('option').count(), folders);
  } finally { await rm(fixtures, { recursive: true, force: true }); }

  await library.selectOption({ label: 'second.zip' });
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  const count = await library.locator('option').count();
  await page.getByRole('button', { name: 'Remove pack', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await library.locator('option').count(), count - 1);
  assert.equal(await library.inputValue(), '', 'removing active pack selects vanilla');
  assert.equal(await page.locator('.events input:checked').count(), 3);
  assert.equal(await page.locator('.error').count(), 0);

  // A clip choice the active pack lacks uses the automatic clip and returns with its pack.
  const extra = zipSync({ 'AudioNotification/Extra.wav': clips.get('AudioNotification/SelfUnmute.wav')! });
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'extra.zip', mimeType: 'application/zip', buffer: Buffer.from(extra) });
  await page.locator('.help strong').getByText('extra.zip', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  const muteClip = page.getByLabel('Clip for You muted', { exact: true });
  await muteClip.selectOption('AudioNotification/Extra.wav');
  await library.selectOption('');
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await muteClip.inputValue(), '', 'selector shows Automatic');
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfMute.wav')!), 'not a synthesized tone');
  await library.selectOption({ label: 'extra.zip' });
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await muteClip.inputValue(), 'AudioNotification/Extra.wav');

  // Without the standard pack, the user's own pack still loads.
  // Only the download: Vite serves the module that names the asset from the same path
  await page.route('**/default-audio-pack*', route => route.request().resourceType() === 'fetch' ? route.abort() : route.continue());
  await page.reload();
  await open();
  await page.locator('.error').getByText('Could not load the standard pack', { exact: false }).waitFor();
  assert.equal(await sourceHash(), hash(clips.get('AudioNotification/SelfUnmute.wav')!), 'imported clip plays');
  await page.unroute('**/default-audio-pack*');
  await page.reload();
  await open();
  await muteClip.selectOption('');
  await library.selectOption('');
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));

  // A pack's own clip reaches events the standard pack has no clip for; the others keep their tone.
  const toneBefore = await sourceHash('shareStopped');
  const own = clips.get('AudioNotification/SelfDeaf.wav')!;
  const variants = zipSync({ 'MessageNotification/Poked.wav': own, 'UserNotification/ScreenShareStarted.wav': own });
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({ name: 'variants.zip', mimeType: 'application/zip', buffer: Buffer.from(variants) });
  await page.locator('.help strong').getByText('variants.zip', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await sourceHash('poke'), hash(own), 'poke plays the pack clip');
  assert.equal(await sourceHash('shareStarted'), hash(own), 'screen share plays the pack clip');
  assert.equal(await sourceHash('shareStopped'), toneBefore, 'a clip the pack lacks keeps its tone');
  assert.equal(await page.getByLabel('Clip for Someone poked you', { exact: true }).locator('option').first().textContent(), 'Automatic: Poked.wav');
  await library.selectOption('');
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));

  // One unusable file in a loose import is reported; the others still apply.
  await page.locator('input[accept="audio/*,.wav,.mp3,.ogg,.opus,.flac,.m4a,.ini"]').setInputFiles([
    { name: 'deafen.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) },
    { name: 'undeafen.wav', mimeType: 'audio/wav', buffer: Buffer.from(clips.get('AudioNotification/SelfUndeaf.wav')!) }
  ]);
  await page.locator('.report').getByText('deafen.wav is larger than 4 MiB', { exact: false }).waitFor();
  await page.getByText('undeafen.wav', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reset all to built-in' }).click();
  await page.waitForFunction(() => !document.querySelector('fieldset[disabled]'));
  assert.equal(await page.locator('.error').count(), 0);
  assert.deepEqual(failures, []);
  console.log('SOUND E2E PASSED: default playback, event toggles, ZIP import, clip selection, custom files, reload, invalid ZIP, reset');
} finally {
  await browser.close();
  await server.close();
}
