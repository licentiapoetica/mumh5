import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, translate, translatePlural, pickLanguage } from '../src/core/i18n.ts';

test('falls back to English, then to the key', () => {
  assert.equal(translate({ a: 'Stumm' }, { a: 'Mute' }, 'a'), 'Stumm');
  assert.equal(translate({}, { a: 'Mute' }, 'a'), 'Mute');
  assert.equal(translate(undefined, { a: 'Mute' }, 'a'), 'Mute');
  assert.equal(translate(undefined, {}, 'a.b'), 'a.b');
});

test('fills placeholders and leaves unknown ones', () => {
  assert.equal(format('Hi {name}, {n} new', { name: 'A', n: 3 }), 'Hi A, 3 new');
  assert.equal(format('Hi {name}', {}), 'Hi {name}');
});

test('picks the first preferred language with a catalog', () => {
  assert.equal(pickLanguage(['fr-FR', 'de-AT', 'en']), 'de');
  assert.equal(pickLanguage(['fr']), 'en');
  assert.equal(pickLanguage([]), 'en');
});

test('plural forms', () => {
  const en = { f: '{n} files', 'f#one': '{n} file' };
  const de = { f: '{n} Dateien', 'f#one': '{n} Datei' };
  assert.equal(translatePlural(de, en, 'de', 'f', 1), '1 Datei');
  assert.equal(translatePlural(de, en, 'de', 'f', 3), '3 Dateien');
  assert.equal(translatePlural(en, en, 'en', 'f', 1), '1 file');
  assert.equal(translatePlural(en, en, 'en', 'f', 0), '0 files');
  // A language without the entry uses English with English's rules, not its own
  assert.equal(translatePlural({}, en, 'fr', 'f', 0), '0 files');
  assert.equal(translatePlural(undefined, {}, 'en', 'f', 2), 'f');
});
