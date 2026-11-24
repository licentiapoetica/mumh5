import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, translate, translatePlural, pickLanguage } from '../src/core/i18n.ts';
import { de } from '../src/locales/de.ts';

test('falls back to the English key', () => {
  assert.equal(translate({}, 'Mute'), 'Mute');
  assert.equal(translate(undefined, 'Mute'), 'Mute');
  assert.equal(translate({ Mute: 'Stumm' }, 'Mute'), 'Stumm');
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

test('translations keep their placeholders', () => {
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const [k, v] of Object.entries(de)) assert.equal(holes(v), holes(k), k);
});

test('plural forms', () => {
  const cat = { '{n} files': '{n} Dateien', '{n} files#one': '{n} Datei' };
  assert.equal(translatePlural(cat, 'de', '{n} files', '{n} file', 1), '1 Datei');
  assert.equal(translatePlural(cat, 'de', '{n} files', '{n} file', 3), '3 Dateien');
  assert.equal(translatePlural(undefined, 'en', '{n} files', '{n} file', 1), '1 file');
  assert.equal(translatePlural(undefined, 'en', '{n} files', '{n} file', 0), '0 files');
});
