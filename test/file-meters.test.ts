import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Meters, type PeerStat } from '../src/lib/file-meters.ts';
import type { Session } from '../src/lib/session.svelte.ts';

const s = {} as Session, other = {} as Session;

function setup() {
  const shown: Record<string, PeerStat[]> = {};
  const m = new Meters((id, peers) => { shown[id] = peers; }, () => null);
  return { m, shown };
}

test('pieces count per person and side, route and state follow', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { m, shown } = setup();
  m.update(s, 'f', 7, 'from', { state: 'waiting' });
  assert.deepEqual(shown.f.map(p => [p.session, p.dir, p.state, p.route]), [[7, 'from', 'waiting', 'server']]);
  m.add(s, 'f', 7, 'from', 1000, 'server');
  m.add(s, 'f', 7, 'from', 1000, 'direct');
  m.add(s, 'f', 9, 'to', 500, 'mumpeer');
  const from = shown.f.find(p => p.dir === 'from')!;
  assert.deepEqual([from.bytes, from.pieces, from.route, from.state], [2000, 2, 'direct', 'active']);
  assert.equal(shown.f.find(p => p.dir === 'to')!.route, 'mumpeer');
  // The rate is what moved over the last second
  t.mock.timers.tick(1000);
  assert.equal(shown.f.find(p => p.dir === 'from')!.rate, 2000);
  t.mock.timers.tick(4000);
  assert.equal(shown.f.find(p => p.dir === 'from')!.rate, 0, 'nothing moving after a while');
  t.mock.timers.reset();
});

test('done stays done until the person leaves; leaving is per server', () => {
  const { m, shown } = setup();
  m.add(s, 'f', 7, 'to', 10, 'server');
  m.update(s, 'f', 7, 'to', { state: 'done' });
  m.update(s, 'f', 7, 'to', { state: 'waiting', route: 'direct' });
  assert.deepEqual([shown.f[0].state, shown.f[0].route], ['done', 'direct']);
  m.add(s, 'g', 7, 'from', 10, 'server');
  m.left(other, 7);
  assert.equal(shown.g[0].state, 'active', 'someone with the same number on another server');
  m.left(s, 7);
  assert.equal(shown.g[0].state, 'gone');
  assert.equal(shown.f[0].state, 'done');
});

test('finishing marks only the busy ones of one side; a new download starts clean', () => {
  const { m, shown } = setup();
  m.add(s, 'f', 1, 'from', 10, 'server');
  m.update(s, 'f', 2, 'from', { state: 'gone' });
  m.add(s, 'f', 3, 'to', 10, 'server');
  m.finish('f', 'from', 'done');
  assert.deepEqual(shown.f.map(p => `${p.dir}${p.session}:${p.state}`), ['from1:done', 'from2:gone', 'to3:active']);
  m.clear('f', 'from');
  assert.deepEqual(shown.f.map(p => `${p.dir}${p.session}`), ['to3']);
});

test('no speed once done or gone', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { m, shown } = setup();
  m.add(s, 'f', 1, 'from', 1000, 'direct');
  t.mock.timers.tick(1000);
  assert.equal(shown.f[0].rate, 1000);
  m.finish('f', 'from', 'done');
  assert.equal(shown.f[0].rate, 0);
  t.mock.timers.tick(1000);
  assert.equal(shown.f[0].rate, 0);
  t.mock.timers.reset();
});

test('the route is the one that carried most, and a late server piece does not change it', () => {
  const { m, shown } = setup();
  m.update(s, 'f', 1, 'to', { state: 'connecting', route: 'direct' });
  assert.equal(shown.f[0].route, 'direct', 'a link being set up shows at once');
  m.add(s, 'f', 1, 'to', 10, 'server');
  assert.equal(shown.f[0].route, 'server');
  for (let i = 0; i < 3; i++) m.add(s, 'f', 1, 'to', 10, 'direct');
  m.add(s, 'f', 1, 'to', 10, 'server');
  m.update(s, 'f', 1, 'to', { route: 'server', state: 'waiting' });
  assert.equal(shown.f[0].route, 'direct');
  assert.deepEqual(shown.f[0].via, { server: 2, direct: 3 });
});

test('a link record keeps why it failed, and stays as used once the person has it', () => {
  const { m, shown } = setup();
  m.link(s, 'f', 1, 'from', { route: 'mumpeer', state: 'failed', reason: 'Relay trust required' });
  assert.deepEqual(shown.f[0].link, { route: 'mumpeer', state: 'failed', reason: 'Relay trust required' });
  m.link(s, 'f', 2, 'to', { route: 'mumpeer', state: 'open', reason: '' });
  m.update(s, 'f', 2, 'to', { state: 'done' });
  m.link(s, 'f', 2, 'to', { route: 'mumpeer', state: 'closed', reason: 'The link closed' });
  assert.equal(shown.f.find(p => p.session === 2)!.link!.state, 'open');
});

test('a link that closed after carrying pieces counts as used once the person has it', () => {
  const { m, shown } = setup();
  m.add(s, 'f', 3, 'to', 10, 'mumpeer');
  m.link(s, 'f', 3, 'to', { route: 'mumpeer', state: 'closed', reason: 'The link closed' });
  m.update(s, 'f', 3, 'to', { state: 'done' });
  assert.equal(shown.f[0].link!.state, 'open');
  m.link(s, 'f', 4, 'to', { route: 'direct', state: 'closed', reason: 'The link closed' });
  m.update(s, 'f', 4, 'to', { state: 'done' });
  assert.equal(shown.f.find(p => p.session === 4)!.link!.state, 'closed', 'nothing went over it');
});

test('an offer to connect directly that was never taken up goes away when the download ends', () => {
  const { m, shown } = setup();
  m.link(s, 'f', 1, 'from', { route: 'direct', state: 'ask', reason: '' });
  m.finish('f', 'from', 'done');
  assert.equal(shown.f[0].link, null);
});
