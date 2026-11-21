import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_KINDS, applyReaction, decodeReact, encodeReact, findReacted, isEmoji, messageRef, reactorKey, reactorNames, textRef, type ReactSignal, type Reaction } from '../src/core/reactions.ts';

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const sig: ReactSignal = { c: 3, r: messageRef('hello'), s: 7, a: 12, e: '\u{1F44D}\u{1F3FD}', on: true };

test('a signal survives encoding and stays small', () => {
  const data = encodeReact(sig);
  assert.ok(data.length < 120, `${data.length} bytes`);
  assert.deepEqual(decodeReact(data), sig);
  assert.deepEqual(decodeReact(encodeReact({ ...sig, c: null, s: null, r: textRef('mabc123'), on: false })), { ...sig, c: null, s: null, r: 't:mabc123', on: false });
});

test('malformed signals are refused', () => {
  for (const bad of [
    { ...sig, e: 'x' }, { ...sig, e: '<b>' }, { ...sig, e: '\u{1F44D}x' }, { ...sig, e: '' },
    { ...sig, r: 'h:<img>' }, { ...sig, r: 'x:abc' }, { ...sig, c: -1 }, { ...sig, c: 1.5 }, { ...sig, s: 'a' },
    { ...sig, a: -1 }, { ...sig, a: 'NaN' }, { ...sig, on: 1 }, null, [], 'text'
  ]) assert.equal(decodeReact(enc(bad)), null, JSON.stringify(bad));
  assert.equal(decodeReact(new TextEncoder().encode('{nope')), null);
  assert.equal(decodeReact(new Uint8Array(700)), null);
});

test('emoji check takes sequences, flags and keycaps', () => {
  for (const e of ['\u{1F600}', '❤️', '\u{1F468}‍\u{1F469}‍\u{1F467}', '\u{1F1E9}\u{1F1EA}', '#️⃣', '\u{1F44B}\u{1F3FF}']) assert.ok(isEmoji(e), e);
  for (const e of ['a', '1', '\u{1F600}\u{1F600}', '\u{1F600} ', '<']) assert.ok(!isEmoji(e), e);
});

test('refs tell messages apart', () => {
  assert.equal(messageRef('hi'), messageRef('hi'));
  assert.notEqual(messageRef('hi'), messageRef('hi '));
  assert.notEqual(messageRef('ab'), messageRef('ba'));
  assert.match(messageRef('x'.repeat(100000)), /^h:[0-9a-z]+$/);
});

test('a reaction finds the message by ref, author and age', () => {
  const now = 1_000_000;
  const entries = [
    { id: 1, kind: 'text', ref: 'h:ok', authorSession: 7, time: now - 600_000 },
    { id: 2, kind: 'text', ref: 'h:ok', authorSession: 8, time: now - 59_000 },
    { id: 3, kind: 'text', ref: 'h:ok', authorSession: 7, time: now - 60_000 },
    { id: 4, kind: 'system', ref: 'h:ok', authorSession: 7, time: now },
    { id: 5, kind: 'text', ref: 'h:other', authorSession: 7, time: now }
  ];
  assert.equal(findReacted(entries, { r: 'h:ok', s: 7, a: 61 }, now)?.id, 3);
  assert.equal(findReacted(entries, { r: 'h:ok', s: 7, a: 590 }, now)?.id, 1);
  assert.equal(findReacted(entries, { r: 'h:ok', s: 8, a: 0 }, now)?.id, 2);
  assert.equal(findReacted(entries, { r: 'h:none', s: 7, a: 0 }, now), undefined);
  // An author no longer online on this side still matches
  assert.equal(findReacted([{ id: 9, kind: 'text', ref: 't:x', authorSession: null, time: 5 }], { r: 't:x', s: 3, a: 0 }, now)?.id, 9);
});

test('adding and removing reactions', () => {
  const a = { k: 'aa', name: 'alice' }, b = { k: 'bb', name: 'bob' };
  let list: Reaction[] = [];
  list = applyReaction(list, 'X', a, true)!;
  list = applyReaction(list, 'Y', b, true)!;
  list = applyReaction(list, 'X', b, true)!;
  assert.deepEqual(list, [{ emoji: 'X', who: [a, b] }, { emoji: 'Y', who: [b] }]);
  assert.equal(applyReaction(list, 'X', a, true), null, 'twice is once');
  assert.equal(applyReaction(list, 'Z', a, false), null);
  list = applyReaction(list, 'Y', b, false)!;
  assert.deepEqual(list, [{ emoji: 'X', who: [a, b] }]);
  list = applyReaction(list, 'X', a, false)!;
  assert.deepEqual(list, [{ emoji: 'X', who: [b] }]);
  let many: Reaction[] = [];
  for (let i = 0; i < MAX_KINDS; i++) many = applyReaction(many, String(i), a, true)!;
  assert.equal(applyReaction(many, 'more', a, true), null);
  assert.ok(applyReaction(many, '0', b, true), 'existing ones still take more people');
});

test('names and keys', () => {
  assert.equal(reactorKey({ hash: 'abc', name: 'x' }), 'abc');
  assert.equal(reactorKey({ hash: '', name: 'x' }), 'n:x');
  assert.equal(reactorNames(['a']), 'a');
  assert.equal(reactorNames(['a', 'b']), 'a and b');
  assert.equal(reactorNames(['a', 'b', 'c']), 'a, b and c');
  assert.equal(reactorNames(['a', 'b', 'c', 'd']), 'a, b, c and 1 other');
  assert.equal(reactorNames(['a', 'b', 'c', 'd', 'e']), 'a, b, c and 2 others');
});
