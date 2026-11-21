import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';
import { compileModule } from 'svelte/compiler';
import type { Session as SessionType } from '../src/lib/session.svelte.ts';
import type { SavedServer } from '../src/lib/settings.svelte.ts';

// Compile the real session and use the real protocol client. Replace browser services so
// failures and timers are deterministic, without a microphone, proxy or Mumble server.
const sessionPath = new URL('../src/lib/session.svelte.ts', import.meta.url).pathname;
const stubs = `
  export const control = { opens: 0, failure: false, fingerprint: 'first', hold: null, attached: null };
  export const native = { platformInfo: async () => ({ os: 'test', osVersion: '' }) };
  export const desktop = null, ui = { pokes: [] }, notifyPoke = () => {};
  export async function openTransport() {
    control.opens++;
    if (control.hold) await control.hold;
    if (control.failure) throw new Error('Server unavailable');
    return { secure: Promise.resolve({ fingerprint: control.fingerprint, authorized: false }),
      send() {}, close() {}, onData: null, onClose: null };
  }
  export const store = { displayName: u => u.name, pins: {}, pin(key, value) { this.pins[key] = value; }, tokensFor: () => [], addToken() {}, removeToken() {} };
  const service = { isText() { return false; }, channelRemoved() {}, closed() {}, entered() {}, receive() {}, userMoved() {}, userLeft() {} };
  export const share = service, textChannels = service, files = service;
  export const voice = { settings: { forceTcp: false }, attach(c) { control.attached = c; }, detach() { control.attached = null; } };
  export const sounds = { play() {} };
  export const ownAvatar = { loaded: Promise.resolve(), bytes: null };
  export const renderIncoming = x => x, textToHtml = x => x, escapeHtml = x => x;
  export const formatBytes = x => String(x), fileKind = () => 'file';
  export const makeInlineImage = () => {}, originalImage = () => {}, videoPoster = () => {};
`;
const result = await build({
  stdin: { contents: `export * from ${JSON.stringify(sessionPath)}; export { control, store, ui } from 'test:stubs';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{
    name: 'session-test',
    setup(b) {
      b.onResolve({ filter: /^test:stubs$/ }, () => ({ path: 'stubs', namespace: 'stub' }));
      b.onResolve({ filter: /^\.\// }, args => args.importer === sessionPath ? { path: 'stubs', namespace: 'stub' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stubs }));
      b.onLoad({ filter: /session\.svelte\.ts$/ }, args => ({
        contents: compileModule(transformSync(readFileSync(args.path, 'utf8'), { loader: 'ts', target: 'esnext' }).code, { filename: args.path, generate: 'server' }).js.code
      }));
    }
  }]
});
const { Session, sessions, control, store, ui } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`) as {
  Session: new () => SessionType;
  sessions: { voiceId: string | null; activeId: string | null; open(s: SavedServer): void; connectOnStart(list: SavedServer[]): void; close(id: string): void; byServer(id: string): SessionType | undefined };
  control: { opens: number; failure: boolean; fingerprint: string; hold: Promise<void> | null; attached: unknown };
  store: { pins: Record<string, string> };
  ui: { prompt: import('../src/lib/ui.svelte.ts').PromptRequest | null };
};
const server = (autoReconnect?: boolean, id = 'test'): SavedServer => ({
  id, label: id, host: 'localhost', port: 64738, username: 'Tester', password: '', autoReconnect
});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(t: TestContext): SessionType {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  control.opens = 0;
  control.failure = false;
  control.fingerprint = 'first';
  control.hold = null;
  store.pins = {};
  const s = new Session();
  t.after(() => { s.disconnect(); sessions.close('test'); sessions.close('other'); });
  return s;
}
function sync(s: SessionType) {
  s.client!.synced = true;
  s.client!.emit('synced');
}

test('auto reconnect is opt-in, including for previously saved servers', async t => {
  const s = setup(t);
  for (const enabled of [undefined, false]) {
    await s.connect(server(enabled));
    s.client!.emit('close', 'Connection lost');
    assert.equal(s.reconnectDelay, null);
  }
  t.mock.timers.tick(60_000);
  assert.equal(control.opens, 2);
});

test('connection loss retries with bounded backoff, reset only by a lasting connection', async t => {
  const s = setup(t);
  await s.connect(server(true));
  sync(s);
  s.client!.emit('close', 'Connection lost');
  control.failure = true;
  for (const delay of [5, 10, 20, 30, 30]) {
    assert.equal(s.reconnectDelay, delay);
    const before = control.opens;
    t.mock.timers.tick(delay * 1000 - 1);
    assert.equal(control.opens, before);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(control.opens, before + 1);
  }
  control.failure = false;
  t.mock.timers.tick(30_000);
  await flush();
  sync(s);
  assert.equal(s.status, 'connected');
  assert.equal(s.reconnectDelay, null);
  // Dropped right after login (a kick on join): keep backing off
  s.client!.emit('close', 'Connection lost again');
  assert.equal(s.reconnectDelay, 30);
  t.mock.timers.tick(30_000);
  await flush();
  sync(s);
  t.mock.timers.tick(61_000);
  s.client!.emit('close', 'Connection lost after a while');
  assert.equal(s.reconnectDelay, 5);
});

test('the countdown goes down every second', async t => {
  const s = setup(t);
  await s.connect(server(true));
  s.client!.emit('close', 'Connection lost');
  assert.equal(s.reconnectDelay, 5);
  t.mock.timers.tick(1000);
  assert.equal(s.reconnectDelay, 4);
  t.mock.timers.tick(3000);
  assert.equal(s.reconnectDelay, 1);
});

test('a full server or a name still in use is retried, other rejections are not', async t => {
  const s = setup(t);
  for (const [type, retried] of [[6, true], [5, true], [4, false], [0, false]] as const) {
    await s.connect(server(true));
    s.client!.emit('reject', type, 'Refused');
    s.client!.emit('close', 'Refused');
    assert.equal(s.reconnectDelay != null, retried, `reject type ${type}`);
  }
  // A full server, then a retry that only times out: still retried
  await s.connect(server(true));
  s.client!.emit('reject', 6, 'Server is full');
  s.client!.emit('close', 'Server is full');
  t.mock.timers.tick(5000);
  await flush();
  t.mock.timers.tick(20_000);
  assert.equal(s.error, 'Login timed out');
  assert.equal(s.reconnectDelay, 10);
});

test('the kick notice stays through failed retries and clears once back in', async t => {
  const s = setup(t);
  await s.connect(server(true));
  sync(s);
  const client = s.client!;
  client.session = 7;
  client.emit('userRemove', { session: 7 } as never, null, 'spam', false);
  client.emit('close', 'Disconnected');
  control.failure = true;
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(s.error, 'Server unavailable');
  assert.equal(s.disconnectInfo?.kind, 'kicked');
  assert.equal(s.disconnectInfo?.reason, 'spam');
  control.failure = false;
  t.mock.timers.tick(10_000);
  await flush();
  sync(s);
  assert.equal(s.disconnectInfo, null);
});

test('an automatic reconnect keeps channel chats, drops direct chats and rejoins the channel', async t => {
  const s = setup(t);
  await s.connect(server(true));
  const before = s.client!;
  before.channels.set(0, { id: 0, name: 'Root' } as never);
  before.channels.set(4, { id: 4, name: 'Raid' } as never);
  before.session = 7;
  before.users.set(7, { session: 7, name: 'Tester', channelId: 4 } as never);
  sync(s);
  s.logs = { 'ch:4': [{ id: 1 } as never], 'dm:9': [{ id: 2 } as never] };
  s.unread = { 'dm:9': 1 };
  before.emit('close', 'Connection lost');
  t.mock.timers.tick(5000);
  await flush();
  const after = s.client!;
  assert.notEqual(after, before);
  const joins: number[] = [];
  after.joinChannel = (id: number) => { joins.push(id); };
  after.channels.set(0, { id: 0, name: 'Root' } as never);
  after.channels.set(4, { id: 4, name: 'Raid' } as never);
  after.session = 3;
  after.users.set(3, { session: 3, name: 'Tester', channelId: 0 } as never);
  sync(s);
  assert.deepEqual(joins, [4]);
  assert.equal(s.view, 'ch:4');
  assert.equal(s.logs['ch:4'][0].id, 1);
  assert.equal(s.logs['dm:9'], undefined);
  assert.equal(s.unread['dm:9'], undefined);
  // A manual connect starts over
  await s.connect(server(true));
  assert.deepEqual(s.logs, {});
});

test('voice waits for a server that reconnects by itself', async t => {
  setup(t);
  sessions.open(server(true));
  sessions.open(server(true, 'other'));
  await flush();
  const s = sessions.byServer('test')!;
  sync(s);
  sync(sessions.byServer('other')!);
  assert.equal(sessions.voiceId, 'test');
  s.client!.emit('close', 'Connection lost');
  assert.equal(sessions.voiceId, 'test');
  assert.equal(control.attached, null);
  t.mock.timers.tick(5000);
  await flush();
  sync(s);
  assert.equal(sessions.voiceId, 'test');
  assert.equal(control.attached, s.client);
  // Without a retry, voice moves on
  s.client!.emit('close', 'Connection lost');
  s.cancelReconnect();
  assert.equal(sessions.voiceId, 'other');
  assert.equal(control.attached, sessions.byServer('other')!.client);
});

test('initial connection failure and login timeout retry', async t => {
  const s = setup(t);
  control.failure = true;
  await s.connect(server(true));
  assert.equal(s.error, 'Server unavailable');
  assert.equal(s.reconnectDelay, 5);
  control.failure = false;
  t.mock.timers.tick(5000);
  await flush();
  t.mock.timers.tick(20_000);
  assert.equal(s.error, 'Login timed out');
  assert.equal(s.reconnectDelay, 10);
});

test('remote disconnect and kicks retry; bans and login rejections stop', async t => {
  const s = setup(t);
  await s.connect(server(true));
  s.client!.emit('close', 'Disconnected');
  assert.equal(s.reconnectDelay, 5);
  for (const ban of [false, true]) {
    await s.connect(server(true));
    const client = s.client!;
    client.session = 7;
    client.emit('userRemove', { session: 7 } as never, null, 'Moderation reason', ban);
    client.emit('close', 'Disconnected');
    assert.equal(s.disconnectInfo?.kind, ban ? 'banned' : 'kicked');
    assert.equal(s.reconnectDelay, ban ? null : 5);
  }
  await s.connect(server(true));
  s.client!.emit('reject', 3, 'Wrong password');
  s.client!.emit('close', 'Wrong password');
  assert.equal(s.reconnectDelay, null);
});

test('manual disconnect, cancel and reconnect clear pending retries', async t => {
  const s = setup(t);
  for (const stop of [() => s.disconnect(), () => s.cancelReconnect()]) {
    await s.connect(server(true));
    s.client!.emit('close', 'Connection lost');
    stop();
    assert.equal(s.reconnectDelay, null);
    const before = control.opens;
    t.mock.timers.tick(60_000);
    assert.equal(control.opens, before);
  }
  await s.connect(server(true));
  s.client!.emit('close', 'Connection lost');
  s.reconnect();
  await flush();
  sync(s);
  const before = control.opens;
  t.mock.timers.tick(60_000);
  assert.equal(control.opens, before, 'no duplicate attempt after manual reconnect');
});

test('changed certificates pause retries until explicitly accepted', async t => {
  const s = setup(t);
  await s.connect(server(true));
  s.client!.emit('close', 'Connection lost');
  control.fingerprint = 'changed';
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(s.error, 'The server certificate changed.');
  assert.ok(s.certPrompt);
  assert.equal(s.reconnectDelay, null);
  s.acceptCertificate();
  await flush();
  assert.equal(s.certPrompt, null);
  assert.ok(s.client);
});

test('closing a server while a retry is in flight invalidates it', async t => {
  setup(t);
  sessions.open(server(true));
  await flush();
  const s = sessions.byServer('test')!;
  s.client!.emit('close', 'Connection lost');
  let release!: () => void;
  control.hold = new Promise<void>(resolve => { release = resolve; });
  t.mock.timers.tick(5000);
  sessions.close('test');
  release();
  await flush();
  assert.equal(s.status, 'idle');
  assert.equal(s.client, null);
  assert.equal(s.reconnectDelay, null);
  t.mock.timers.tick(60_000);
  assert.equal(control.opens, 2);
});

test('each server owns its retries and closing one preserves the other', async t => {
  setup(t);
  sessions.open(server(true));
  sessions.open(server(true, 'other'));
  await flush();
  sessions.byServer('test')!.client!.emit('close', 'Connection lost');
  const other = sessions.byServer('other')!;
  other.client!.emit('close', 'Connection lost');
  sessions.close('test');
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(control.opens, 3);
  assert.ok(other.client);
});

test('connect at start opens only the servers marked for it and shows the first', async t => {
  setup(t);
  const marked = { ...server(false, 'other'), autoConnect: true };
  const second = { ...server(false, 'test'), autoConnect: true };
  sessions.connectOnStart([{ ...server(false, 'unmarked') }, marked, second]);
  await flush();
  assert.equal(control.opens, 2);
  assert.equal(sessions.byServer('unmarked'), undefined);
  assert.equal(sessions.byServer('other')?.status, 'connecting');
  assert.equal(sessions.byServer('test')?.status, 'connecting');
  assert.equal(sessions.activeId, 'other');
});

// Bulk moves use the same connection lifecycle: requests are not confirmations.
async function moveSession(t: TestContext) {
  const s = setup(t);
  await s.connect(server());
  const client = s.client!;
  client.channels.set(0, { id: 0, name: 'Root', description: '' } as never);
  client.channels.set(4, { id: 4, name: 'Games', description: '' } as never);
  client.session = 7;
  for (const id of [7, 8, 9]) client.users.set(id, { session: id, name: `Person ${id}`, channelId: 0 } as never);
  const sent: number[] = [];
  client.setUserState = id => { sent.push(id); };
  s.selectChannelUsers(0);
  s.selectedUsers = [8, 9];
  return { s, client, sent };
}

test('bulk move waits for server updates, retains refusals and permits retry', async t => {
  const { s, client, sent } = await moveSession(t);
  s.moveUsers([8, 9], 4);
  assert.deepEqual(sent, [8, 9]);
  assert.deepEqual(s.selectedUsers, [8, 9]);
  assert.equal(s.movingUsers, true);
  s.clearUserSelection();
  s.toggleUser(7);
  s.moveUsers([8], 0);
  assert.deepEqual(s.selectedUsers, [8, 9], 'in-flight selection is stable');
  const moved = client.users.get(8)!;
  moved.channelId = 4;
  client.emit('user', moved, ['channelId'], 7, false);
  assert.deepEqual(s.selectedUsers, [9]);
  client.emit('permissionDenied', { type: 1, permission: 32, channelId: 0, session: 9, reason: '', name: '' });
  assert.equal(s.movingUsers, false);
  assert.deepEqual(s.userMove!.people.map(p => p.status), ['moved', 'failed']);
  assert.deepEqual(s.selectedUsers, [9]);
  s.moveUsers([9], 4);
  assert.deepEqual(sent, [8, 9, 9]);
  client.users.get(9)!.channelId = 4;
  client.emit('user', client.users.get(9)!, ['channelId'], 7, false);
  assert.equal(s.movingUsers, false);
  assert.deepEqual(s.selectedUsers, []);
  assert.equal(s.selectingUsers, false);
  t.mock.timers.tick(15_000);
  assert.equal(s.userMove!.people[0].status, 'moved', 'the previous timer cannot corrupt a retry');
});

test('bulk move timeouts retain selection and unrelated denials are not attributed', async t => {
  const { s, client } = await moveSession(t);
  s.moveUsers([8, 9], 4);
  client.emit('permissionDenied', { type: 1, permission: 32, channelId: 0, session: 7, reason: '', name: '' });
  assert.ok(s.userMove!.people.every(p => p.status === 'pending'));
  t.mock.timers.tick(15_000);
  assert.equal(s.movingUsers, false);
  assert.deepEqual(s.selectedUsers, [8, 9]);
  assert.ok(s.userMove!.people.every(p => p.status === 'failed' && p.reason.includes('No confirmation')));
});

test('bulk moves handle removed users, removed destinations and connection loss', async t => {
  const { s, client } = await moveSession(t);
  s.moveUsers([8, 9], 4);
  client.users.delete(8);
  client.emit('userRemove', { session: 8, channelId: 0 } as never, null, '', false);
  assert.deepEqual(s.selectedUsers, [9]);
  assert.equal(s.userMove!.people[0].status, 'failed');
  client.channels.delete(4);
  client.emit('channelRemove', 4);
  assert.equal(s.movingUsers, false);
  assert.match(s.userMove!.people[1].reason, /removed/);
  client.channels.set(4, { id: 4, name: 'Games' } as never);
  s.moveUsers([9], 4);
  client.emit('close', 'Connection lost');
  assert.equal(s.userMove, null);
  assert.deepEqual(s.selectedUsers, []);
  assert.equal(s.selectingUsers, false);
  t.mock.timers.tick(15_000);
  assert.equal(s.userMove, null);
});

test('bulk move password prompts wait for a decision and cancel only your own join', async t => {
  const { s, client } = await moveSession(t);
  client.channels.get(4)!.canEnter = false;
  s.selectedUsers = [7, 8];
  s.moveUsers([7, 8], 4);
  assert.equal(s.userMove!.people[0].status, 'password');
  const prompt = ui.prompt!;
  assert.ok(prompt);
  t.mock.timers.tick(15_001);
  assert.equal(s.userMove!.people[0].status, 'password', 'waiting for input is not a timeout');
  assert.equal(s.userMove!.people[1].status, 'failed');
  prompt.oncancel!();
  assert.equal(s.movingUsers, false);
  assert.deepEqual(s.selectedUsers, [7, 8]);
  assert.match(s.userMove!.people[0].reason, /cancelled/);
});

test('bulk move password submission resumes confirmation tracking', async t => {
  const { s, client } = await moveSession(t);
  client.channels.get(4)!.canEnter = false;
  s.selectedUsers = [7];
  s.moveUsers([7], 4);
  const prompt = ui.prompt!;
  prompt.onsubmit('secret');
  prompt.oncancel!(); // The app closes a submitted prompt through the same callback.
  assert.equal(s.userMove!.people[0].status, 'pending');
  client.users.get(7)!.channelId = 4;
  client.emit('user', client.users.get(7)!, ['channelId'], 7, false);
  assert.equal(s.userMove!.people[0].status, 'moved');
  assert.deepEqual(s.selectedUsers, []);
});

test('modifier selection, explicit selection and channel selection share one mode', async t => {
  const s = setup(t);
  assert.equal(s.selectingUsers, false);
  s.toggleUser(8); // Used by the modifier-click shortcut and person menu.
  assert.equal(s.selectingUsers, true);
  assert.deepEqual(s.selectedUsers, [8]);
  s.beginUserSelection(); // Used by the Select people button.
  assert.deepEqual(s.selectedUsers, [8], 'entering the same mode preserves the existing selection');
  s.toggleUser(9); // Subsequent plain row clicks use the same toggle.
  assert.deepEqual(s.selectedUsers, [8, 9]);
  s.toggleUser(8);
  s.toggleUser(9);
  assert.equal(s.selectingUsers, true, 'deselecting the last person stays in selection mode');
  assert.deepEqual(s.selectedUsers, []);
  s.clearUserSelection();
  assert.equal(s.selectingUsers, false, 'Cancel and Escape leave the shared mode');
  s.beginUserSelection();
  s.toggleUser(8);
  assert.deepEqual(s.selectedUsers, [8]);
  s.clearUserSelection();
  assert.deepEqual(s.selectedUsers, []);
});
