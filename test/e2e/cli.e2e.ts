// Two real headless processes plus a bot using the SDK. No browser or display.
// MUMBLE_TEST_HOST=127.0.0.1:64749 npm run test:e2e:cli
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { HeadlessClient } from '../../cli/client.ts';

if (!process.env.MUMBLE_TEST_HOST) { console.log('MUMBLE_TEST_HOST not set, skipping headless integration'); process.exit(0); }
const address = new URL(`mumble://${process.env.MUMBLE_TEST_HOST}`);
const host = address.hostname, port = Number(address.port || 64738);
const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-headless-e2e-'));
const tag = Date.now().toString(36);

class ProcessBot {
  child: ChildProcessWithoutNullStreams;
  events: any[] = [];
  stderr = '';
  sequence = 0;
  exit: Promise<{ code: number | null; signal: string | null }>;
  constructor(name: string, extra: string[]) {
    this.child = spawn(process.execPath, [process.env.CLI_TEST_ENTRY || 'cli/main.ts', '--server', host, '--port', String(port), '--name', name,
      '--state-dir', path.join(directory, name), '--trust-new', ...extra], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' } });
    createInterface({ input: this.child.stdout }).on('line', line => { if (line.startsWith('{')) this.events.push(JSON.parse(line)); else this.stderr += line + '\n'; });
    this.child.stderr.on('data', data => { this.stderr += data; });
    this.exit = new Promise(resolve => this.child.on('exit', (code, signal) => resolve({ code, signal })));
  }
  async wait(predicate: (event: any) => boolean, timeout = 25000): Promise<any> {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const found = this.events.find(predicate); if (found) return found;
      if (this.child.exitCode != null) throw new Error(`CLI exited: ${this.stderr}\n${JSON.stringify(this.events)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out: ${this.stderr}\n${JSON.stringify(this.events)}`);
  }
  async command(op: string, args: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.sequence;
    this.child.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
    const response = await this.wait(e => e.id === id);
    assert.equal(response.ok, true, JSON.stringify(response)); return response;
  }
  async close(): Promise<void> {
    if (this.child.exitCode != null) return;
    await this.command('quit');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 5000);
    try { const ended = await this.exit; assert.equal(ended.code, 0, `${JSON.stringify(ended)} ${this.stderr} ${JSON.stringify(this.events.slice(-12))}`); } finally { clearTimeout(timer); }
  }
}

async function tone(file: string, hz: number): Promise<void> {
  const bytes = Buffer.alloc(48000 * 2 * 14);
  for (let i = 0; i < bytes.length / 2; i++) bytes.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * hz * i / 48000)), i * 2);
  await writeFile(file, bytes);
}

function frequency(bytes: Buffer): number {
  let end = bytes.length / 2;
  while (end > 0 && Math.abs(bytes.readInt16LE((end - 1) * 2)) < 100) end--;
  const start = Math.max(0, end - 48000);
  let crossings = 0;
  for (let i = start + 1; i < end; i++) if ((bytes.readInt16LE((i - 1) * 2) < 0) !== (bytes.readInt16LE(i * 2) < 0)) crossings++;
  return crossings / 2 / ((end - start) / 48000);
}

const bots: ProcessBot[] = [];
let sdk: HeadlessClient | undefined;
try {
  await Promise.all([tone(path.join(directory, 'a-in.s16le'), 880), tone(path.join(directory, 'b-in.s16le'), 440)]);
  const aName = `cli-a-${tag}`, bName = `cli-b-${tag}`;
  const a = new ProcessBot(aName, ['--audio-in', path.join(directory, 'a-in.s16le'), '--audio-out', path.join(directory, 'a-out.s16le'), '--video-out', path.join(directory, 'a-video'), '--fps', '10']); bots.push(a);
  const aReady = await a.wait(e => e.event === 'ready');
  const b = new ProcessBot(bName, ['--audio-in', path.join(directory, 'b-in.s16le'), '--audio-out', path.join(directory, 'b-out.s16le'), '--video-out', path.join(directory, 'b-video'), '--fps', '10']); bots.push(b);
  const bReady = await b.wait(e => e.event === 'ready');
  assert.notEqual(aReady.session, bReady.session);
  await a.command('send', { text: 'hello <bot>&' });
  const channel = await b.wait(e => e.event === 'text' && e.html.includes('hello'));
  assert.equal(channel.html, 'hello &lt;bot&gt;&amp;'); assert.equal(channel.actor, aReady.session);
  await b.command('send', { user: aName, text: 'private reply' });
  const pm = await a.wait(e => e.event === 'text' && e.html === 'private reply');
  assert.deepEqual(pm.sessions, [aReady.session]); assert.deepEqual(pm.channels, []);
  console.log('ok: real headless CLI processes exchange channel and private text');

  sdk = await HeadlessClient.connect({ host, port, name: `sdk-${tag}`, stateDir: path.join(directory, 'sdk'), trustNew: true });
  assert.equal(sdk.audio, null, 'a text-only bot does not start audio processing');
  sdk.on('text', message => { if (message.html === '!ping' && message.actor != null) void sdk!.sendText('pong', { user: message.actor }); });
  await a.command('send', { user: sdk.protocol.session, text: '!ping' });
  await a.wait(e => e.event === 'text' && e.html === 'pong');
  console.log('ok: reusable SDK implements a bot user without browser or audio initialization');

  await Promise.all([a.command('share', { width: 160, height: 120 }), b.command('share', { width: 160, height: 120 })]);
  const light = Buffer.alloc(160 * 120 * 3 / 2, 128), dark = Buffer.alloc(light.length, 128);
  light.fill(180, 0, 160 * 120); dark.fill(60, 0, 160 * 120);
  let pumping = false;
  const frameErrors: unknown[] = [];
  const sdkFrame = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SDK video reception timed out')), 25000);
    sdk!.once('videoFrame', frame => { clearTimeout(timer); assert.equal(frame.session, aReady.session); resolve(); });
  });
  await sdk.video.watch(aReady.session);
  const timer = setInterval(() => {
    if (pumping) return;
    pumping = true;
    void Promise.all([a.command('video', { data: dark.toString('base64') }), b.command('video', { data: light.toString('base64') })])
      .catch(e => frameErrors.push(e)).finally(() => { pumping = false; });
  }, 100);
  try {
    await Promise.all([a.wait(e => e.event === 'video'), b.wait(e => e.event === 'video'), sdkFrame]);
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.deepEqual(frameErrors, []);
  } finally { clearInterval(timer); }
  await sdk.video.unwatch();
  await sdk.close(); sdk = undefined;
  for (const bot of bots) assert.equal(bot.events.some(e => e.event === 'mediaError'), false, JSON.stringify(bot.events.filter(e => e.event === 'mediaError')));
  await Promise.all(bots.map(bot => bot.close()));
  for (const [name, expected] of [['a-video', 180], ['b-video', 60]] as const) {
    const files = await readdir(path.join(directory, name)); assert.ok(files.length);
    const bytes = await readFile(path.join(directory, name, files[0]));
    assert.match(bytes.subarray(0, 70).toString(), /^YUV4MPEG2 W160 H120/);
    const frame = bytes.indexOf(Buffer.from('FRAME\n')) + 6;
    assert.ok(frame >= 6 && bytes.length >= frame + 160 * 120, 'a real video frame was recorded');
    const luma = bytes.subarray(frame, frame + 160 * 120);
    const average = luma.reduce((sum, n) => sum + n, 0) / luma.length;
    assert.ok(Math.abs(average - expected) < 20, `received the other bot's video (${average})`);
  }
  console.log('ok: bidirectional native WebRTC video crosses real Mumble signaling and records decoded frames');
  const receivedA = frequency(await readFile(path.join(directory, 'a-out.s16le')));
  const receivedB = frequency(await readFile(path.join(directory, 'b-out.s16le')));
  assert.ok(Math.abs(receivedA - 440) < 20, `A receives B's 440 Hz tone, without feeding its own 880 Hz input back: ${receivedA}`);
  assert.ok(Math.abs(receivedB - 880) < 20, `B receives A's 880 Hz tone independently: ${receivedB}`);
  console.log('ok: separate incoming/outgoing PCM streams carry distinct tones without feedback');
} finally {
  await sdk?.close();
  for (const bot of bots) if (bot.child.exitCode == null) bot.child.kill('SIGKILL');
  await rm(directory, { recursive: true, force: true });
}
