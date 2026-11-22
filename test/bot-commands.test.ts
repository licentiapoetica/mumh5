import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleChatCommand } from '../cli/examples/chat-commands.ts';
import type { HeadlessClient, HeadlessText } from '../cli/index.ts';

function setup(userId: number | null) {
  const replies: { text: string; user: number }[] = [], joins: string[] = [], mute: boolean[] = [], deaf: boolean[] = [];
  let stopped = false;
  const bot = {
    protocol: { users: new Map([[7, { userId, name: 'admin' }]]), self: { name: 'helper', channelId: 0 },
      setSelfMute: (value: boolean) => mute.push(value), setSelfDeaf: (value: boolean) => deaf.push(value), flushed: async () => {} },
    audio: null, channelPath: () => '/', join: async (channel: string) => { joins.push(channel); },
    sendText: async (text: string, target: { user: number }) => { replies.push({ text, user: target.user }); }
  } as unknown as HeadlessClient;
  const options = { adminUserIds: new Set([12]), shutdown: async () => { stopped = true; } };
  const command = (html: string, extra: Partial<HeadlessText> = {}) => handleChatCommand(bot, {
    html, actor: 7, author: 'admin', self: false, textChannel: false, channels: [0], sessions: [], trees: [], time: 0, ...extra
  }, options);
  return { bot, replies, joins, mute, deaf, command, stopped: () => stopped };
}

test('chat commands use authoritative registered IDs and reject unregistered users and name impersonation', async () => {
  for (const userId of [null, 99]) {
    const demo = setup(userId);
    for (const command of ['!join /Private', '!mute on', '!deaf on', '!shutdown']) await demo.command(command);
    assert.deepEqual(demo.joins, []); assert.deepEqual(demo.mute, []); assert.deepEqual(demo.deaf, []);
    assert.equal(demo.stopped(), false);
    assert.ok(demo.replies.every(reply => reply.user === 7 && reply.text.includes('allowlisted')));
  }
});

test('allowlisted chat commands join full paths, validate mute/deafen arguments, and reply before shutting down', async () => {
  const demo = setup(12);
  await demo.command('!join /Lobby Room'); await demo.command('!mute on'); await demo.command('!mute off'); await demo.command('!deaf on');
  assert.deepEqual(demo.joins, ['/Lobby Room']); assert.deepEqual(demo.mute, [true, false]); assert.deepEqual(demo.deaf, [true]);
  await demo.command('!mute yes'); assert.match(demo.replies.at(-1)!.text, /Usage: !mute/);
  assert.equal(demo.mute.length, 2);
  await demo.command('!shutdown'); assert.equal(demo.replies.at(-1)!.text, 'Shutting down.'); assert.equal(demo.stopped(), true);
});

test('public chat commands reply privately, expose identity for setup and ignore self/server/unrecognized messages', async () => {
  const demo = setup(null);
  await demo.command('!ping'); assert.deepEqual(demo.replies[0], { text: 'pong', user: 7 });
  await demo.command('!whoami'); assert.match(demo.replies.at(-1)!.text, /register your user/);
  await demo.command('!status'); assert.match(demo.replies.at(-1)!.text, /audio disabled/);
  await demo.command('!help'); assert.match(demo.replies.at(-1)!.text, /!join/);
  const count = demo.replies.length;
  await demo.command('!ping', { self: true }); await demo.command('!ping', { actor: null });
  await demo.command('!pingpong'); await demo.command('<b>!ping</b>');
  assert.equal(demo.replies.length, count);
});

test('command errors become private replies rather than unhandled event-handler rejections', async () => {
  const demo = setup(12);
  demo.bot.join = async () => { throw new Error('Channel not found'); };
  await demo.command('!join /Missing');
  assert.deepEqual(demo.replies, [{ text: 'Command failed: Channel not found', user: 7 }]);
});
