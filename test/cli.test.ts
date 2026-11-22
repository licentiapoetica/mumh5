import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { options } from '../cli/options.ts';
import { frameBytes } from '../cli/video.ts';
import { frames } from '../cli/media-files.ts';
import { botIdentity, trustServer } from '../cli/identity.ts';
import { DuplexAudio, AUDIO_BYTES } from '../cli/audio.ts';
import { commandLines } from '../cli/control.ts';
import { Readable } from 'node:stream';
import { MumbleClient, type User } from '../src/core/client.ts';
import { createCodec } from '../src/core/proto.ts';
import { encodeVoice, relayAsServer, decodeVoice } from '../src/core/voice-packet.ts';
import { instantiateOpus, WasmEncoder, WasmDecoder } from '../src/lib/audio/opus-wasm.ts';

test('headless CLI validates addresses, media paths, fingerprints and video dimensions', () => {
  assert.equal(options(['--help']).help, true);
  assert.throws(() => options([]), /required/);
  const base = ['--server', 'localhost', '--name', 'bot'];
  const parsed = options([...base, '--channel', '/Lobby']);
  assert.equal(parsed.help, false);
  if (!parsed.help) { assert.equal(parsed.port, 64738); assert.equal(parsed.channel, '/Lobby'); assert.equal(parsed.trustNew, false); }
  assert.throws(() => options([...base, '--port', '0']), /port/);
  assert.throws(() => options([...base, '--audio-in', '-']), /reserved for JSON/);
  assert.throws(() => options([...base, '--audio-in', 'same', '--audio-out', 'same']), /different/);
  assert.throws(() => options([...base, '--server-fingerprint', 'wrong']), /SHA-256/);
  assert.equal(frameBytes(160, 120), 28800);
  for (const [w, h] of [[1, 2], [161, 120], [640, 0], [100000, 120]]) assert.throws(() => frameBytes(w, h), /dimensions/);
});

test('bot identities persist and server pin changes require an explicit matching fingerprint', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-cli-identity-'));
  try {
    const first = await botIdentity(directory, 'bot');
    assert.equal((await botIdentity(directory, 'renamed bot')).fingerprint, first.fingerprint);
    if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, 'identity.json'))).mode & 0o077, 0);
    const original = { fingerprint: 'a'.repeat(64), authorized: false };
    await assert.rejects(trustServer(directory, 'localhost', 64738, original, false), /Untrusted/);
    await trustServer(directory, 'localhost', 64738, original, true);
    await trustServer(directory, 'localhost', 64738, original, false);
    const changed = { ...original, fingerprint: 'b'.repeat(64) };
    await assert.rejects(trustServer(directory, 'localhost', 64738, changed, true), /changed/);
    await assert.rejects(trustServer(directory, 'localhost', 64738, changed, false, 'c'.repeat(64)), /does not match/);
    await trustServer(directory, 'localhost', 64738, changed, false, changed.fingerprint);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('raw file framing preserves complete frames and rejects a truncated final frame', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-cli-frames-'));
  try {
    const file = path.join(directory, 'input.raw');
    await writeFile(file, Buffer.from([1, 2, 3, 4, 5, 6]));
    const out: Buffer[] = [];
    for await (const frame of frames(file, 2, new AbortController().signal)) out.push(frame);
    assert.deepEqual(out.map(f => [...f]), [[1, 2], [3, 4], [5, 6]]);
    await assert.rejects(async () => { for await (const _ of frames(file, 4, new AbortController().signal)) {} }, /Incomplete/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('JSON input preserves split UTF-8 and rejects an oversized unfinished command', async () => {
  const bytes = Buffer.from('{"text":"hello 🌍"}\r\n{"op":"quit"}');
  const input = Readable.from(Array.from(bytes, n => Buffer.from([n])));
  const lines: string[] = [];
  for await (const line of commandLines(input)) lines.push(line);
  assert.deepEqual(lines, ['{"text":"hello 🌍"}', '{"op":"quit"}']);
  await assert.rejects(async () => {
    for await (const _ of commandLines(Readable.from([Buffer.alloc(9)]), 8)) {}
  }, /Command exceeds/);
});

function frequency(pcm: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < pcm.length; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) crossings++;
  return crossings / 2 / (pcm.length / 48000);
}

test('incoming audio never feeds outgoing audio, and simultaneous directions keep distinct tones', async t => {
  const opus = await instantiateOpus(await readFile(new URL('../node_modules/@evan/opus/wasm/opus.wasm', import.meta.url)));
  const client = new MumbleClient(createCodec()); client.session = 1; client.serverVersionNum = 0x010500;
  client.users.set(1, { session: 1, selfMute: false, selfDeaf: false, mute: false, deaf: false, suppress: false } as User);
  const sent: Uint8Array[] = []; client.sendVoice = packet => { sent.push(packet); };
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const duplex = await DuplexAudio.create(client);
  const incoming: Buffer[] = []; duplex.output.on('data', b => incoming.push(b));
  await new Promise<void>(resolve => process.nextTick(resolve));
  const packets: Uint8Array[] = [], source = new WasmEncoder(opus, 40000, 20, p => packets.push(p));
  try {
    for (let i = 0; i < 100; i++) source.push(Float32Array.from({ length: 480 }, (_, n) => 0.3 * Math.sin(2 * Math.PI * 440 * (i * 480 + n) / 48000)));
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) duplex.receive(relayAsServer(encodeVoice({ target: 0, frame: i, opus: packets[i / 2], last: false }, true), 2, true));
      t.mock.timers.tick(10);
    }
    assert.equal(sent.length, 0, 'receiving one second of speech sends zero voice packets');
    incoming.length = 0;
    for (let i = 0; i < 100; i++) {
      const pcm = Buffer.alloc(AUDIO_BYTES);
      for (let n = 0; n < 480; n++) pcm.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * 880 * (i * 480 + n) / 48000)), n * 2);
      duplex.input.write(pcm);
      if (i % 2 === 0) duplex.receive(relayAsServer(encodeVoice({ target: 0, frame: 100 + i, opus: packets[i / 2], last: false }, true), 2, true));
      t.mock.timers.tick(10);
    }
    const decoder = new WasmDecoder(opus);
    const outgoing = Float32Array.from(sent.flatMap(p => [...(decoder.decode(decodeVoice(relayAsServer(p, 1, true))!.opus) ?? [])]));
    assert.ok(Math.abs(frequency(outgoing.subarray(24000)) - 880) < 20, 'outgoing contains the input tone, not received speech');
    const buffer = Buffer.concat(incoming);
    const received = Float32Array.from({ length: buffer.length / 2 }, (_, i) => buffer.readInt16LE(i * 2) / 32768);
    assert.ok(Math.abs(frequency(received.subarray(24000)) - 440) < 20, 'incoming contains only the remote tone');
    decoder.close();
  } finally { duplex.close(); source.close(); }
});
