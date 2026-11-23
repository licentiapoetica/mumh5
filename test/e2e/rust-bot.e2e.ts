// Native binary integration; Node is only the independent Mumble test peer.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { HeadlessClient } from '../../cli/client.ts';
if (!process.env.MUMBLE_TEST_HOST || !process.env.MUMBLE_SUPERUSER_PASSWORD) {
  console.log('MUMBLE_TEST_HOST and MUMBLE_SUPERUSER_PASSWORD required; skipping native bot integration'); process.exit(0);
}
const address = new URL(`mumble://${process.env.MUMBLE_TEST_HOST}`);
const host = address.hostname, port = Number(address.port || 64738);
const binary = process.env.CLI_TEST_BINARY || path.resolve('rust-cli/target/debug/mumh5-cli');
const directory = await mkdtemp(path.join(tmpdir(), 'mumh5-rust-bot-'));
const tag = Date.now().toString(36);
let admin: HeadlessClient | undefined, guest: HeadlessClient | undefined;
const processes: ReturnType<typeof launch>[] = [];
function launch(name: string, trust: boolean, extra: string[] = []) {
  const child = spawn(binary, ['--server', host, '--port', String(port), '--name', name, '--state-dir', path.join(directory, name), ...(trust ? ['--trust-new'] : []), ...extra], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MUMH5_PASSWORD: '', MUMH5_ADMIN_USER_IDS: '' }
  });
  const events: any[] = []; let stderr = '';
  createInterface({ input: child.stdout }).on('line', line => events.push(JSON.parse(line)));
  child.stderr.on('data', bytes => { stderr += bytes; });
  const exit = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)));
  const wait = async () => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try { return await exit; } finally { clearTimeout(timer); }
  };
  return { child, events, wait, stderr: () => stderr };
}
function response(client: HeadlessClient, fragment: string) {
  return new Promise<any>((resolve, reject) => {
    const listener = (event: any) => { if (event.html.includes(fragment)) { clearTimeout(timer); client.off('text', listener); resolve(event); } };
    const timer = setTimeout(() => { client.off('text', listener); reject(new Error(`Missing bot reply: ${fragment}`)); }, 15000);
    client.on('text', listener);
  });
}
try {
  const denied = launch(`untrusted-${tag}`, false); processes.push(denied);
  assert.equal(await denied.wait(), 1); assert.match(denied.stderr(), /Untrusted server certificate/);
  const pinned = launch(`untrusted-${tag}`, true, ['--exit-on-eof']); processes.push(pinned);
  pinned.child.stdin.end('{"op":"quit"}\n'); assert.equal(await pinned.wait(), 0, pinned.stderr());
  const reused = launch(`untrusted-${tag}`, false, ['--exit-on-eof']); processes.push(reused);
  reused.child.stdin.end('{"op":"quit"}\n'); assert.equal(await reused.wait(), 0, reused.stderr());
  console.log('ok: native TLS refuses untrusted first use, then reuses the pinned identity without trust flags');
  admin = await HeadlessClient.connect({ host, port, name: 'SuperUser', password: process.env.MUMBLE_SUPERUSER_PASSWORD, stateDir: path.join(directory, 'admin'), trustNew: true });
  guest = await HeadlessClient.connect({ host, port, name: `guest-${tag}`, stateDir: path.join(directory, 'guest'), trustNew: true });
  assert.equal(admin.protocol.self?.userId, 0);
  const bot = launch(`bot-${tag}`, true, ['--bot', '--admin-user-ids', '0']); processes.push(bot);
  const until = Date.now() + 15000;
  while (!bot.events.some(e => e.event === 'ready') && Date.now() < until) await delay(20);
  const ready = bot.events.find(e => e.event === 'ready'); assert.ok(ready, bot.stderr());
  let reply = response(guest, 'pong'); await guest.sendText('!ping', { user: ready.session });
  const pong = await reply; assert.deepEqual(pong.sessions, [guest.protocol.session]);
  await delay(1650);
  reply = response(guest, 'allowlisted registered user ID'); await guest.sendText('!shutdown', { user: ready.session }); await reply;
  assert.equal(bot.child.exitCode, null, 'a guest cannot shut down the bot');
  await delay(1650);
  reply = response(admin, 'mute on submitted'); await admin.sendText('!mute on', { user: ready.session }); await reply;
  await delay(1650); assert.equal(admin.protocol.users.get(ready.session)?.selfMute, true);
  reply = response(admin, 'deaf on submitted'); await admin.sendText('!deaf on', { user: ready.session }); await reply;
  assert.equal(admin.protocol.users.get(ready.session)?.selfDeaf, true);
  assert.equal(admin.protocol.users.get(ready.session)?.selfMute, true);
  await delay(1650);
  reply = response(admin, 'mute off submitted'); await admin.sendText('!mute off', { user: ready.session }); await reply;
  assert.equal(admin.protocol.users.get(ready.session)?.selfMute, false);
  assert.equal(admin.protocol.users.get(ready.session)?.selfDeaf, false, 'unmuting also undeafens');
  await delay(1650);
  reply = response(admin, 'Shutting down'); await admin.sendText('!shutdown', { user: ready.session }); await reply;
  assert.equal(await bot.wait(), 0, bot.stderr());
  console.log('ok: native chat commands reply privately, reject guest control, authorize registered IDs and exit cleanly');
} finally {
  for (const p of processes) if (p.child.exitCode == null) p.child.kill('SIGKILL');
  await guest?.close(); await admin?.close(); await rm(directory, { recursive: true, force: true });
}
