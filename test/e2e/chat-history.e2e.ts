// Durable history and safe conversation routing across reloads and reconnects.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date() });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('mumh5.identities', JSON.stringify({ identities: [], defaultId: null, setupDone: true })));
  await page.goto(server.resolvedUrls!.local[0]);
  const connect = (bob = 2, owner = 'alice-identity', host = 'localhost') => page.evaluate(async ({ bob, owner, host }) => {
    const sessionPath = '/src/lib/session.svelte.ts', clientPath = '/src/core/client.ts', codecPath = '/src/core/proto.ts', historyPath = '/src/lib/chat-history.ts';
    const { session, sessions } = await import(sessionPath);
    const { MumbleClient } = await import(clientPath);
    const { createCodec } = await import(codecPath);
    const { chatHistory } = await import(historyPath);
    const client = new MumbleClient(createCodec());
    const user = (id: number, name: string, hash: string) => ({ session: id, name, hash, userId: null, channelId: 0,
      mute: false, deaf: false, suppress: false, selfMute: false, selfDeaf: false, prioritySpeaker: false, recording: false,
      comment: '', commentHash: null, texture: null, textureHash: null });
    client.session = 1;
    client.users.set(1, user(1, 'Alice', owner));
    if (bob > 0) client.users.set(bob, user(bob, 'Bob', 'bob-identity'));
    // Reusing Bob's old numeric session must not inherit his private conversation.
    if (bob !== 2) client.users.set(2, user(2, 'Mallory', 'other-identity'));
    client.channels.set(0, { id: 0, parent: null, name: 'Root', description: '', descriptionHash: null,
      position: 0, temporary: false, links: new Set(), maxUsers: 0, canEnter: true });
    session.client = client;
    session.server = { id: 'fixture', label: 'Test server', host, port: 64738, username: 'Alice', password: '' };
    session.logs = {}; session.unread = {}; session.view = 'ch:0';
    session.status = 'connected'; session.tick++;
    await chatHistory.entered(sessions.active);
  }, { bob, owner, host });
  const snapshot = () => page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    return { keys: Object.keys(session.logs), names: { ...session.dmNames },
      messages: Object.fromEntries(Object.entries(session.logs).map(([key, entries]: [string, any]) => [key, entries.map((e: any) => e.html)])) };
  });
  const flush = () => page.evaluate(async () => {
    const historyPath = '/src/lib/chat-history.ts', sessionPath = '/src/lib/session.svelte.ts';
    await (await import(historyPath)).chatHistory.flush((await import(sessionPath)).sessions.active);
  });
  await connect();
  await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    (await import(module)).session.sendText('memory only before opt in', 'ch:0');
  });
  await flush();
  assert.deepEqual(await page.evaluate(async () => {
    const module = '/src/lib/blobstore.ts';
    return (await (await import(module)).dataKeys()).filter((key: string) => key.startsWith('chat-history:') || key.startsWith('text:'));
  }), [], 'history saving is off by default');
  await page.reload(); await connect();
  assert.equal((await snapshot()).keys.length, 0, 'unsaved messages are not restored');
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat and files', exact: true }).click();
  const saveHistory = page.getByRole('checkbox', { name: 'Save chat history on this device', exact: true });
  assert.equal(await saveHistory.isChecked(), false);
  assert.equal(await page.getByRole('spinbutton', { name: 'Delete messages older than (hours)', exact: true }).isDisabled(), true);
  await saveHistory.check();
  assert.equal(await page.getByRole('spinbutton', { name: 'Delete messages older than (hours)', exact: true }).inputValue(), '24');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  console.log('ok: client-side saving is off by default and explicitly enabled in Chat and files settings');
  await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    session.selectView('dm:2');
    session.sendText('saved private reply', 'dm:2');
    session.receive(session.client, { actor: 2, channels: [], trees: [], sessions: [1], html: '<b>saved private message</b>', time: Date.now() });
    session.sendText('saved channel message', 'ch:0');
    for (let i = 0; i < 205; i++) session.receive(session.client, { actor: 2, channels: [], trees: [], sessions: [1], html: `history batch ${i}`, time: Date.now() });
  });
  await flush();
  await page.reload();
  await connect(22);
  let saved = await snapshot();
  assert.ok(saved.messages['dm:22'].some((m: string) => m.includes('saved private message')));
  assert.ok(saved.messages['dm:22'].some((m: string) => m.includes('saved private reply')));
  assert.ok(saved.messages['ch:0'].some((m: string) => m.includes('saved channel message')));
  assert.equal(saved.keys.includes('dm:2'), false, 'old session ID belongs to another person');
  assert.equal(saved.names['dm:22'], 'Bob');
  assert.equal(saved.messages['dm:22'].length, 207, 'all messages within the retention window survive without a 200-message cap');
  await page.locator('.dm', { hasText: 'Bob' }).click();
  await page.locator('.msg', { hasText: 'saved private message' }).waitFor();
  console.log('ok: private and channel history survives reload; private chats follow identity, not session ID');

  // Reactions on saved messages: yours and someone else's, in a private chat and a channel
  const thumbs = '\u{1F44D}', party = '\u{1F389}';
  await page.evaluate(async ({ thumbs, party }) => {
    const sessionPath = '/src/lib/session.svelte.ts', reactPath = '/src/core/reactions.ts', libPath = '/src/lib/reactions.ts';
    const { session, sessions } = await import(sessionPath);
    const { encodeReact, messageRef, REACT_DATA_ID } = await import(reactPath);
    const { reactions } = await import(libPath);
    session.client.serverVersionNum = 0x010500;
    const dm = session.logs['dm:22'].find((e: any) => e.html.includes('saved private message'));
    session.react('dm:22', dm.id, thumbs);
    reactions.receive(sessions.active, 22, REACT_DATA_ID, encodeReact({ c: null, r: messageRef('<b>saved private message</b>'), s: 2, a: (Date.now() - dm.time) / 1000, e: party, on: true }));
    const ch = session.logs['ch:0'].find((e: any) => e.html.includes('saved channel message'));
    session.react('ch:0', ch.id, party);
  }, { thumbs, party });
  await flush();
  await page.reload(); await connect(22);
  const reacted = await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    const pick = (key: string, text: string) => session.logs[key].find((e: any) => e.html.includes(text)).reactions
      .map((r: any) => ({ emoji: r.emoji, who: r.who.map((w: any) => w.k) }));
    return { dm: pick('dm:22', 'saved private message'), ch: pick('ch:0', 'saved channel message'), reply: pick('dm:22', 'saved private reply') };
  });
  assert.deepEqual(reacted.dm, [{ emoji: thumbs, who: ['alice-identity'] }, { emoji: party, who: ['bob-identity'] }]);
  assert.deepEqual(reacted.ch, [{ emoji: party, who: ['alice-identity'] }]);
  assert.deepEqual(reacted.reply, []);
  await page.evaluate(async ({ thumbs }) => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    session.client.serverVersionNum = 0x010500;
    const dm = session.logs['dm:22'].find((e: any) => e.html.includes('saved private message'));
    session.react('dm:22', dm.id, thumbs, false);
  }, { thumbs });
  await flush();
  await page.reload(); await connect(22);
  assert.deepEqual(await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    const { session } = await import(module);
    return session.logs['dm:22'].find((e: any) => e.html.includes('saved private message')).reactions.map((r: any) => r.emoji);
  }), [party], 'a reaction taken back stays gone after reload');
  // Text channels keep their messages in a store of their own
  const textChannel = (react: boolean) => page.evaluate(async ({ react, thumbs }) => {
    const sessionPath = '/src/lib/session.svelte.ts', textPath = '/src/lib/text-channels.ts', signalPath = '/src/core/text-signal.ts', storagePath = '/src/lib/blobstore.ts';
    const { session, sessions } = await import(sessionPath);
    const { textChannels } = await import(textPath);
    const { TEXT_MARK } = await import(signalPath);
    if (react) await (await import(storagePath)).putData('text:localhost:64738', { 5: [{ i: 'kept-note', c: 5, t: Date.now() - 60_000, n: 'Bob', k: 'bob-identity', h: 'text channel note' }] });
    session.client.serverVersionNum = 0x010500;
    session.client.channels.set(5, { id: 5, parent: 0, name: 'Notes', description: TEXT_MARK, descriptionHash: null,
      position: 0, temporary: false, links: new Set(), maxUsers: 0, canEnter: true });
    session.tick++;
    await textChannels.entered(sessions.active);
    const note = () => session.logs['ch:5'].find((e: any) => e.html.includes('text channel note'));
    if (react) {
      session.react('ch:5', note().id, thumbs);
      await textChannels.persist(sessions.active);
    }
    return note().reactions.map((r: any) => ({ emoji: r.emoji, who: r.who.map((w: any) => w.k) }));
  }, { react, thumbs });
  await textChannel(true);
  await page.reload(); await connect(22);
  assert.deepEqual(await textChannel(false), [{ emoji: thumbs, who: ['alice-identity'] }]);
  console.log('ok: reactions on saved messages survive reload, in chats and text channels');

  await page.reload(); await connect(0);
  saved = await snapshot();
  const offline = saved.keys.find(key => key.startsWith('dm:-'))!;
  assert.ok(offline);
  assert.equal(saved.names[offline], 'Bob');
  await page.locator('.dm', { hasText: 'Bob' }).click();
  assert.equal(await page.locator('.composer [contenteditable="true"]').count(), 0, 'offline history cannot send to a reused session');
  const denied = await page.evaluate(async key => {
    const module = '/src/lib/session.svelte.ts';
    return (await import(module)).session.sendText('do not deliver', key);
  }, offline);
  assert.equal(denied, false);
  await page.evaluate(async () => {
    const sessionPath = '/src/lib/session.svelte.ts', historyPath = '/src/lib/chat-history.ts';
    const { session, sessions } = await import(sessionPath);
    const bob = { ...session.client.users.get(2), session: 33, name: 'Bob', hash: 'bob-identity' };
    session.client.users.set(33, bob);
    (await import(historyPath)).chatHistory.userChanged(sessions.active, bob);
    session.tick++;
  });
  saved = await snapshot();
  assert.equal(saved.keys.includes(offline), false);
  assert.ok(saved.messages['dm:33'].some((m: string) => m.includes('saved private message')));
  await page.evaluate(async () => {
    const sessionPath = '/src/lib/session.svelte.ts', historyPath = '/src/lib/chat-history.ts';
    const { session, sessions } = await import(sessionPath);
    const bob = session.client.users.get(33);
    session.client.users.delete(33);
    (await import(historyPath)).chatHistory.userLeft(sessions.active, bob);
    session.client.users.set(33, { ...bob, name: 'Impostor', hash: 'impostor-identity' });
    (await import(historyPath)).chatHistory.userChanged(sessions.active, session.client.users.get(33));
    session.tick++;
  });
  saved = await snapshot();
  assert.equal(saved.keys.includes('dm:33'), false, 'a reused session number cannot inherit a departed peer’s history');
  console.log('ok: offline conversations retain names and return to the right peer when they reconnect');

  await page.reload(); await connect(22, 'another-account');
  assert.equal((await snapshot()).keys.length, 0, 'different identities cannot see each other’s history');
  await page.reload(); await connect(22, 'alice-identity', 'different-server');
  assert.equal((await snapshot()).keys.length, 0, 'different servers keep separate history');
  await page.reload(); await connect(22);
  await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    (await import(module)).session.closeDm('dm:22');
  });
  await flush();
  await page.reload(); await connect(22);
  assert.equal((await snapshot()).keys.some(key => key.startsWith('dm:')), false, 'closing a conversation remains closed after reload');
  await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    (await import(module)).session.selectView('dm:22');
  });
  assert.ok((await snapshot()).messages['dm:22'].some((m: string) => m.includes('saved private message')), 'reopening a hidden chat restores its retained messages');
  await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    (await import(module)).session.deleteDm('dm:22');
  });
  await flush(); await page.reload(); await connect(22);
  await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    (await import(module)).session.selectView('dm:22');
  });
  assert.equal((await snapshot()).messages['dm:22'].length, 0, 'Delete history explicitly removes retained messages');
  console.log('ok: history is scoped to server/account; closing hides history and explicit deletion removes it');

  const firstTime = await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    (await import(module)).session.sendText('expires after 24 hours', 'ch:0');
    return Date.now();
  });
  await flush();
  await page.clock.fastForward(23 * 60 * 60 * 1000);
  await page.evaluate(async oldTime => {
    const sessionPath = '/src/lib/session.svelte.ts', storagePath = '/src/lib/blobstore.ts';
    const { session } = await import(sessionPath);
    session.sendText('recent message stays', 'ch:0');
    const { putData } = await import(storagePath);
    const messages = [
      { id: 'old', time: oldTime, author: 'Bob', self: false, raw: 'expired inactive message' },
      { id: 'new', time: Date.now(), author: 'Bob', self: false, raw: 'recent inactive message' }
    ];
    await putData('chat-history:inactive-test', [{ route: 'hash:offline', name: 'Bob', messages }]);
    await putData('text:inactive-test', { 0: messages.map(m => ({ i: m.id, c: 0, t: m.time, n: m.author, k: '', h: m.raw })) });
  }, firstTime);
  await flush();
  await page.clock.fastForward(60 * 60 * 1000 + 1000);
  const expired = await page.evaluate(async () => {
    const historyPath = '/src/lib/chat-history.ts', storagePath = '/src/lib/blobstore.ts', sessionPath = '/src/lib/session.svelte.ts';
    await (await import(historyPath)).chatHistory.expire();
    const { getData } = await import(storagePath);
    const { session } = await import(sessionPath);
    return { current: session.logs['ch:0'].map((m: any) => m.html),
      inactive: (await getData('chat-history:inactive-test'))[0].messages.map((m: any) => m.raw),
      text: (await getData('text:inactive-test'))[0].map((m: any) => m.h) };
  });
  assert.equal(expired.current.some((m: string) => m.includes('expires after 24 hours')), false);
  assert.ok(expired.current.some((m: string) => m.includes('recent message stays')));
  assert.deepEqual(expired.inactive, ['recent inactive message']);
  assert.deepEqual(expired.text, ['recent inactive message']);
  await page.reload(); await connect(22);
  assert.equal((await snapshot()).messages['ch:0'].some((m: string) => m.includes('expires after 24 hours')), false);
  console.log('ok: client deletes expired messages from live chats, saved history and inactive accounts after 24 hours');
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat and files', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Delete messages older than (hours)', exact: true }).fill('1');
  await page.getByRole('spinbutton', { name: 'Delete messages older than (hours)', exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(async () => {
    const module = '/src/lib/chat-history.ts';
    await (await import(module)).chatHistory.expire();
  });
  assert.equal((await snapshot()).messages['ch:0'].length, 0, 'shortening retention immediately expires older visible messages');
  await page.evaluate(async () => {
    const module = '/src/lib/session.svelte.ts';
    (await import(module)).session.sendText('visible after opting out', 'ch:0');
  });
  await flush();
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat and files', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Save chat history on this device', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForFunction(async () => {
    const module = '/src/lib/blobstore.ts';
    return !(await (await import(module)).dataKeys()).some((key: string) => key.startsWith('chat-history:') || key.startsWith('text:'));
  });
  assert.ok((await snapshot()).messages['ch:0'].some((m: string) => m.includes('visible after opting out')));
  await page.reload(); await connect(22);
  assert.equal((await snapshot()).keys.length, 0, 'opting out removes saved history and prevents subsequent restore');
  console.log('ok: retention is configurable; opting out erases disk history while preserving the visible session');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
