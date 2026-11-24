import { test } from 'bun:test';
import assert from './assert.ts';
import { readFileSync } from 'node:fs';
import { SKIN_TONES, searchEmoji, toGroups, withTone, type RawEmojiGroup } from '../src/core/emoji.ts';

// Built at run time: the project's TypeScript target does not allow the v flag in a literal
const RGI = new RegExp('^\\p{RGI_Emoji}$', 'v');
const raw: RawEmojiGroup[] = JSON.parse(readFileSync(new URL('../node_modules/unicode-emoji-json/data-by-group.json', import.meta.url), 'utf8'));
const groups = toGroups(raw);
const all = groups.flatMap(g => g.emojis);

test('the palette holds every group and only valid emoji', () => {
  assert.equal(groups.length, 9);
  assert.ok(all.length > 1900);
  for (const e of all) assert.match(e.emoji, RGI, e.name);
});

test('every skin tone gives a valid emoji', () => {
  for (const { modifier } of SKIN_TONES) {
    for (const e of all.filter(x => x.tones)) assert.match(withTone(e.emoji, modifier), RGI, `${e.name} ${modifier}`);
  }
});

test('two people holding hands both get the tone, the handshake none', () => {
  const people = '\u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}';
  assert.equal(withTone(people, '\u{1F3FD}'), '\u{1F9D1}\u{1F3FD}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FD}');
});

test('search needs every word and ignores case', () => {
  assert.ok(searchEmoji(groups, 'THUMBS up').some(e => e.emoji === '\u{1F44D}'));
  assert.ok(!searchEmoji(groups, 'thumbs up').some(e => e.emoji === '\u{1F44E}'));
  assert.deepEqual(searchEmoji(groups, '   '), []);
});
