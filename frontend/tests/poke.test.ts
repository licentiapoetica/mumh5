import { test } from 'bun:test';
import assert from './assert.ts';
import { POKE_MARK, POKE_MAX, encodePoke, decodePoke } from '../src/core/poke.ts';

test('a poke reads as a private message elsewhere and decodes back', () => {
  const html = encodePoke('Hey wake up!');
  assert.equal(html, POKE_MARK + 'Poked you: Hey wake up!');
  assert.equal(decodePoke(html), 'Hey wake up!');
});

test('an empty poke has no note', () => {
  assert.equal(encodePoke('   '), POKE_MARK + 'Poked you');
  assert.equal(decodePoke(encodePoke('')), '');
});

test('markup in the note is escaped going out and comes back as text', () => {
  const html = encodePoke('<b>a & b</b> "q"');
  assert.ok(!html.slice(POKE_MARK.length).includes('<'));
  assert.equal(decodePoke(html), '<b>a & b</b> "q"');
});

test('tags from other senders are dropped, numeric entities decoded', () => {
  assert.equal(decodePoke(POKE_MARK + 'Poked you: <img src=x onerror=alert(1)>hi&#33;<br/>there&#x21;'), 'hi! there!');
});

test('ordinary messages are not pokes', () => {
  assert.equal(decodePoke('Poked you: hi'), null);
  assert.equal(decodePoke('hello ' + POKE_MARK), null);
});

test('the note is capped', () => {
  assert.equal(decodePoke(encodePoke('x'.repeat(500)))?.length, POKE_MAX);
});
