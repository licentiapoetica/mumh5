import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT, TEXT_MARK, HAND_OVER, MAX_HTML, TextAssembler, encodeText, encodeHistory, parseMsg, parseHistory, mergeMsgs, isTextChannel, markText, stripMark, newId, type TextMsg } from '../src/core/text-signal.ts';

const msg = (i: string, t: number, h = 'hi'): TextMsg => ({ i, c: 3, t, n: 'ann', k: 'abc', h });

test('the marker turns a description into a text channel and comes off again', () => {
  assert.equal(isTextChannel('<b>Rules</b>'), false);
  const marked = markText('<b>Rules</b>', true);
  assert.equal(marked, TEXT_MARK + '<b>Rules</b>');
  assert.equal(isTextChannel(marked), true);
  // Marking twice leaves one marker
  assert.equal(markText(marked, true), marked);
  assert.equal(markText(marked, false), '<b>Rules</b>');
  assert.equal(stripMark(marked), '<b>Rules</b>');
});

test('a message survives the trip, in packets Murmur accepts', async () => {
  const body = { i: newId(), c: 7, h: '<b>hello</b> ' + 'x'.repeat(3000) };
  const packets = await encodeText(TEXT.msg, body);
  assert.ok(packets.every(p => p.length <= 1000));
  const assembler = new TextAssembler();
  let signal = null;
  for (const p of packets) signal = await assembler.push(1, p);
  assert.equal(signal?.type, TEXT.msg);
  assert.deepEqual(parseMsg(signal?.text), body);
});

test('a short message is one packet', async () => {
  assert.equal((await encodeText(TEXT.msg, { i: newId(), c: 1, h: 'How is everyone doing today?' })).length, 1);
});

test('malformed messages are refused', () => {
  assert.equal(parseMsg('nope'), null);
  assert.equal(parseMsg('[]'), null);
  assert.equal(parseMsg(JSON.stringify({ i: 'a', c: -1, h: 'x' })), null);
  assert.equal(parseMsg(JSON.stringify({ i: 'a', c: 1, h: '' })), null);
  assert.equal(parseMsg(JSON.stringify({ i: '', c: 1, h: 'x' })), null);
  assert.equal(parseMsg(JSON.stringify({ i: 'a', c: 1, h: 'x'.repeat(MAX_HTML + 1) })), null);
});

test('history keeps valid entries, limits their number and pulls future times back', () => {
  const now = 1_000_000;
  const m = [
    { i: 'a', t: 500, n: 'ann', k: 'h1', h: 'one' },
    { i: 'b', t: now + 99999, n: 'bob', k: '', h: 'two' },
    { i: 'c', t: 'soon', n: 'eve', k: '', h: 'bad time' },
    { i: 'd', t: 600, n: 'eve', k: '', h: '' },
    null
  ];
  assert.deepEqual(parseHistory(JSON.stringify({ c: 4, m }), now), [
    { i: 'a', c: 4, t: 500, n: 'ann', k: 'h1', h: 'one' },
    { i: 'b', c: 4, t: now, n: 'bob', k: '', h: 'two' }
  ]);
  const many = Array.from({ length: HAND_OVER + 30 }, (_, i) => ({ i: `m${i}`, t: i, n: 'ann', k: '', h: 'x' }));
  assert.equal(parseHistory(JSON.stringify({ c: 4, m: many }), now).length, HAND_OVER);
  assert.deepEqual(parseHistory('{"c":4}', now), []);
});

test('merging adds only unknown messages, in order of time, and keeps the newest', () => {
  const have = [msg('a', 10), msg('c', 30)];
  const { all, added } = mergeMsgs(have, [msg('b', 20), msg('a', 10), msg('d', 40)]);
  assert.deepEqual(all.map(m => m.i), ['a', 'b', 'c', 'd']);
  assert.deepEqual(added.map(m => m.i), ['b', 'd']);
  assert.equal(mergeMsgs(have, [msg('a', 10)]).added.length, 0);
  // Over the limit the oldest go, and an old message that does not make it is not reported as added
  const kept = mergeMsgs([msg('x', 50), msg('y', 60)], [msg('old', 1), msg('z', 70)], 2);
  assert.deepEqual(kept.all.map(m => m.i), ['y', 'z']);
  assert.deepEqual(kept.added.map(m => m.i), ['z']);
});

test('history that is too large for one signal is cut down to the newest messages', async () => {
  // Incompressible text, so 50 messages do not fit
  const noise = (seed: number) => Array.from({ length: 1500 }, (_, i) => ((i + 1) * (seed + 7) * 2654435761 >>> 0).toString(36)).join('');
  const msgs = Array.from({ length: 50 }, (_, i) => msg(`m${i}`, i, noise(i)));
  const packets = await encodeHistory(3, msgs);
  assert.ok(packets.length > 0 && packets.length <= 32);
  const assembler = new TextAssembler();
  let signal = null;
  for (const p of packets) signal = await assembler.push(1, p);
  const back = parseHistory(signal?.text);
  assert.ok(back.length > 0 && back.length < 50);
  assert.equal(back[back.length - 1].i, 'm49');
});
