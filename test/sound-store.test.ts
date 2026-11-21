import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SoundStore } from '../electron/sound-store.ts';
import { defaultSoundSettings } from '../src/core/sound-events.ts';

test('sound profile and imported files persist together in the user config directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-sounds-'));
  try {
    const store = new SoundStore(directory);
    assert.equal(await store.load(), null);
    assert.equal(await store.read('pack'), null);
    const settings = defaultSoundSettings();
    settings.on.mute = true;
    settings.pack = { name: 'pack.zip' };
    settings.custom.mute = { name: 'mic.wav' };
    await store.write('pack', new Uint8Array([1, 2, 3]));
    await store.write('sound:mute', new Uint8Array([4, 5]));
    await Promise.all([store.save({ ...settings, volume: 0.1 }), store.save({ ...settings, volume: 0.8 })]);
    const reopened = new SoundStore(directory);
    assert.equal((await reopened.load())?.volume, 0.8);
    assert.deepEqual((await reopened.load())?.on, { mute: true });
    assert.deepEqual(Array.from((await reopened.read('pack'))!), [1, 2, 3]);
    assert.deepEqual(Array.from((await reopened.read('sound:mute'))!), [4, 5]);
    assert.ok(JSON.parse(await readFile(path.join(directory, 'sounds.json'), 'utf8')).pack);
    await reopened.remove('sound:mute');
    assert.equal(await reopened.read('sound:mute'), null);
    assert.deepEqual(Array.from((await reopened.read('pack'))!), [1, 2, 3]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('sound storage accepts only known event keys, bounded data and valid settings', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-sounds-'));
  try {
    const store = new SoundStore(directory);
    assert.throws(() => store.read('../../identities.json'), /Invalid sound key/);
    assert.throws(() => store.write('sound:../identities', new Uint8Array()), /Invalid sound key/);
    await assert.rejects(store.write('sound:mute', new Uint8Array(4 * 1024 * 1024 + 1)), /oversized/);
    await store.save({ volume: -10, on: { mute: 'yes', unknown: true } });
    assert.equal((await store.load())?.volume, 0);
    assert.deepEqual((await store.load())?.on, {});
  } finally { await rm(directory, { recursive: true, force: true }); }
});
