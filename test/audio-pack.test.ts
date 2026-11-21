import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { listAudioPack, readAudioPack, readPackClip, MAX_AUDIO_FILE, MAX_AUDIO_PACK } from '../src/core/audio-pack.ts';
import { PACK_PATHS, QUIET_EVENTS, SOUND_EVENTS, normalizeSoundSettings, upgradeSoundSettings } from '../src/core/sound-events.ts';
import { DEFAULT_AUDIO_PACK_LIMITS, MIB, parseAudioPackLimits } from '../src/core/audio-pack-limits.ts';

const standard = new URL('../src/assets/default-audio-pack.zip', import.meta.url);
const clip = 'AudioNotification/SelfMute.wav';

test('runtime sound limits fall back for older proxies and reject invalid byte limits', () => {
  assert.deepEqual(parseAudioPackLimits(undefined), DEFAULT_AUDIO_PACK_LIMITS);
  assert.deepEqual(parseAudioPackLimits({ pack: 128 * MIB }), { ...DEFAULT_AUDIO_PACK_LIMITS, pack: 128 * MIB });
  for (const value of [0, -1, 1.5, Infinity, NaN, '128', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseAudioPackLimits({ pack: value }), /Invalid sound pack pack limit/);
  }
});

test('configured limits allow larger archives and clips through import, listing and playback', () => {
  const wav = new Uint8Array(5 * MIB);
  wav.set(new TextEncoder().encode('RIFF'), 0);
  wav.set(new TextEncoder().encode('WAVE'), 8);
  const bytes = zipSync({ [clip]: wav }, { level: 0 });
  const limits = { file: 8 * MIB, pack: 16 * MIB, unpacked: 16 * MIB };
  assert.throws(() => readAudioPack(bytes), /4 MiB/);
  assert.deepEqual(readAudioPack(bytes, limits).get(clip), wav);
  assert.deepEqual(listAudioPack(bytes, limits), [clip]);
  assert.deepEqual(readPackClip(bytes, clip, limits), wav);
  for (const parse of [readAudioPack, listAudioPack, (b: Uint8Array, l: typeof limits) => readPackClip(b, clip, l)]) {
    assert.throws(() => parse(bytes, { ...limits, pack: MIB }), /at most 1 MiB/);
    assert.throws(() => parse(bytes, { ...limits, unpacked: 4 * MIB }), /expands beyond 4 MiB/);
    assert.throws(() => parse(bytes, { ...limits, file: MIB }), /larger than 1 MiB/);
    assert.throws(() => parse(zipSync({ '../evil.wav': wav }), limits), /unsafe path/);
  }
});

test('the supplied standard ZIP contains all automatic event mappings and 134 WAV clips', async () => {
  const clips = readAudioPack(await readFile(standard));
  assert.equal(clips.size, 134);
  for (const path of Object.values(PACK_PATHS)) assert.ok(clips.has(path), path);
  assert.ok(clips.has('PermissionNotification/Denied/ChannelFull.wav'));
  assert.ok(!clips.has('manifest.json'));
});

test('ZIP hierarchy maps exact paths without mute/unmute or join/leave collisions', async () => {
  const clips = readAudioPack(await readFile(standard));
  const partial = readAudioPack(zipSync({
    [clip]: clips.get(clip)!,
    [PACK_PATHS.unmute!]: clips.get(PACK_PATHS.unmute!)!,
    'manifest.json': new TextEncoder().encode('{}')
  }));
  assert.equal(partial.size, 2);
  assert.notDeepEqual(partial.get(clip), partial.get(PACK_PATHS.unmute!));
  assert.equal(partial.get(PACK_PATHS.userJoined!), undefined);
});

test('invalid ZIPs and unsafe, empty or misplaced packs are rejected', () => {
  assert.throws(() => readAudioPack(new Uint8Array([1, 2, 3])));
  for (const name of ['../evil.wav', '/evil.wav', 'AudioNotification/../evil.wav', 'AudioNotification\\evil.wav']) {
    assert.throws(() => readAudioPack(zipSync({ [name]: new Uint8Array(44) })), /unsafe path/);
  }
  assert.throws(() => readAudioPack(zipSync({ 'wrapper/AudioNotification/SelfMute.wav': new Uint8Array(44) })), /No WAV clips/);
  assert.throws(() => readAudioPack(zipSync({ [clip]: new Uint8Array(44) })), /supported WAV/);
});

test('ZIP size, entry count and expanded file limits are enforced before inflation', () => {
  assert.throws(() => readAudioPack(new Uint8Array(MAX_AUDIO_PACK + 1)), /32 MiB/);
  assert.throws(() => readAudioPack(zipSync({ [clip]: new Uint8Array(MAX_AUDIO_FILE + 1) })), /4 MiB/);
  assert.throws(() => readAudioPack(zipSync(Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`${i}.txt`, new Uint8Array()])))), /too many entries/);
  const large = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`AudioNotification/Sound${i}.wav`, new Uint8Array(MAX_AUDIO_FILE)]));
  assert.throws(() => readAudioPack(zipSync(large)), /64 MiB/);
});

test('a saved pack lists its clips and unpacks one at a time, with the same checks', async () => {
  const bytes = await readFile(standard);
  const clips = readAudioPack(bytes);
  assert.deepEqual(listAudioPack(bytes).sort(), [...clips.keys()].sort());
  assert.deepEqual(readPackClip(bytes, clip), clips.get(clip));
  assert.throws(() => readPackClip(bytes, 'AudioNotification/Missing.wav'), /not in this sound pack/);
  assert.throws(() => listAudioPack(zipSync({ 'manifest.json': new Uint8Array(1) })), /No WAV clips/);
  assert.throws(() => listAudioPack(zipSync({ '../evil.wav': new Uint8Array(44) })), /unsafe path/);
  assert.throws(() => readPackClip(zipSync({ [clip]: new Uint8Array(44) }), clip), /supported WAV/);
});

test('quiet defaults have three events, and saved explicit choices and volume survive normalization', () => {
  assert.deepEqual([...QUIET_EVENTS], ['connectionLost', 'privateMessage', 'poke']);
  const settings = normalizeSoundSettings({
    enabled: false, volume: 3, on: { mute: true, privateMessage: false, unknown: true },
    clips: { mute: clip }, custom: { mute: { name: 'mine.wav' } }, pack: { name: 'my-pack.zip' }
  });
  assert.equal(settings.enabled, false);
  assert.equal(settings.volume, 1);
  assert.deepEqual(settings.on, { privateMessage: false, mute: true });
  assert.equal(settings.clips?.mute, clip);
  assert.equal(settings.pack?.name, 'my-pack.zip');
  assert.deepEqual(normalizeSoundSettings(null).on, {});
});

test('upgrading keeps what older versions played; new installs and current settings stay as they are', () => {
  const old = upgradeSoundSettings({ enabled: true, volume: 0.4, on: { unmute: false }, custom: { userJoined: { name: 'join.wav' } } }, true);
  assert.equal(old.on.userJoined, true, 'a missing choice meant on');
  assert.equal(old.on.unmute, false, 'explicit choices stay');
  assert.equal(old.on.messageSent, false, 'this one was off by default');
  assert.equal(Object.keys(old.on).length, SOUND_EVENTS.length);
  assert.equal(upgradeSoundSettings(null, true).on.userJoined, true, 'never opened Sounds on an earlier version');
  assert.deepEqual(upgradeSoundSettings(null, false).on, {}, 'new install');
  assert.deepEqual(upgradeSoundSettings({ on: { mute: true }, custom: {}, clips: {}, packs: [] }, true).on, { mute: true });
  assert.equal(normalizeSoundSettings({ custom: { mute: { name: 'a.wav', parked: true } } }).custom.mute?.parked, true);
});
