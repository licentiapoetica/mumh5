import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { decodeReact, findReacted, messageRef, REACT_DATA_ID, type ReactSignal } from '../src/core/reactions.ts';
import type { Session, ChatEntry } from '../src/lib/session.svelte.ts';

// Exercise the delivery service without browser settings; timers and users are controlled here.
const result = await build({
  entryPoints: [new URL('../src/lib/reactions.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{
    name: 'reaction-test',
    setup(b) {
      b.onResolve({ filter: /settings\.svelte\.ts$/ }, () => ({ path: 'settings', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const store = { displayName: u => u.name };' }));
    }
  }]
});
const { reactions } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`) as typeof import('../src/lib/reactions.ts');
const THUMBS = '\u{1F44D}';

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const self = { session: 1, name: 'Alice', hash: 'alice', channelId: 0 };
  const peer = { session: 2, name: 'Bob', hash: 'bob', channelId: 0 };
  const sent: { to: number[]; sig: ReactSignal }[] = [];
  const s = {
    status: 'connected', logs: { 'ch:0': [] }, isText: () => false,
    client: {
      self, session: 1, serverVersionNum: 0x010500, users: new Map([[1, self], [2, peer]]),
      sendPluginData(to: number[], id: string, packet: Uint8Array) {
        assert.equal(id, REACT_DATA_ID);
        const sig = decodeReact(packet);
        assert.ok(sig);
        sent.push({ to, sig });
      }
    }
  } as unknown as Session;
  t.after(() => reactions.closed(s));
  function add(id: number, html: string, authorSession = 2, time = Date.now()): ChatEntry {
    const entry: ChatEntry = { id, kind: 'text', html, ref: messageRef(html), author: '', authorSession, time, self: false, embeds: [], reactions: [] };
    s.logs['ch:0'].push(entry);
    return entry;
  }
  function fill() {
    const entry = add(0, 'filler');
    for (const emoji of ['\u{1F600}', THUMBS, '\u{1F389}', '\u2764\uFE0F']) reactions.toggle(s, 'ch:0', entry.id, emoji);
    assert.equal(sent.length, 4);
  }
  return { s, sent, add, fill };
}

for (const author of [1, 2]) {
  test(`queued reactions to identical messages stay separate (second author ${author})`, t => {
    const { s, sent, add, fill } = setup(t);
    const first = add(1, 'hello', 2, Date.now() - 10_000);
    const second = add(2, 'hello', author, Date.now() - 5_000);
    fill();
    reactions.toggle(s, 'ch:0', first.id, THUMBS);
    reactions.toggle(s, 'ch:0', second.id, THUMBS);
    t.mock.timers.tick(2_000);
    const delivered = sent.slice(4);
    assert.equal(delivered.length, 2);
    assert.deepEqual(delivered.map(p => findReacted([first, second], p.sig, Date.now())?.id), [first.id, second.id]);
    assert.deepEqual(delivered.map(p => p.to), [[2], [2]]);
  });
}

test('queued changes to the same reaction send only its final state', t => {
  const { s, sent, add, fill } = setup(t);
  const entry = add(1, 'hello');
  fill();
  reactions.toggle(s, 'ch:0', entry.id, THUMBS);
  reactions.toggle(s, 'ch:0', entry.id, THUMBS);
  t.mock.timers.tick(2_000);
  assert.equal(sent.length, 5);
  assert.equal(sent[4].sig.on, false);
  assert.deepEqual(entry.reactions, []);
});

test('queued reaction age is measured at transmission with subsecond precision', t => {
  const { s, sent, add, fill } = setup(t);
  const first = add(1, 'hello', 2, Date.now() - 5_000);
  const second = add(2, 'hello', 2, Date.now() - 4_000);
  fill();
  reactions.toggle(s, 'ch:0', first.id, THUMBS);
  t.mock.timers.tick(667);
  assert.equal(sent.length, 5);
  const sig = sent[4].sig;
  assert.equal(sig.a, (Date.now() - first.time) / 1000);
  assert.equal(findReacted([first, second], sig, Date.now()), first);
});
