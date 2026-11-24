import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/locales/en.ts';
import { de } from '../src/locales/de.ts';

const catalogs: Record<string, Record<string, string>> = { de };
const base = (k: string) => k.replace(/#\w+$/, '');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'locales' ? [] : sources(p);
    return /\.(svelte|ts)$/.test(f) && !/i18n(\.svelte)?\.ts$/.test(f) ? [readFileSync(p, 'utf8')] : [];
  });
}
const used = new Set<string>();
for (const text of sources('src')) for (const m of text.matchAll(/\btn?\(\s*'([\w.]+)'/g)) used.add(m[1]);

test('every key the code uses is in English', () => {
  assert.deepEqual([...used].filter(k => !(k in en)), []);
});

test('English has no keys the code does not use', () => {
  assert.deepEqual(Object.keys(en).filter(k => !used.has(base(k))), []);
});

const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
for (const [lang, cat] of Object.entries(catalogs)) {
  test(`${lang}: only known keys, same placeholders`, () => {
    for (const [k, v] of Object.entries(cat)) {
      assert.ok(k in en, `${k} is not in English`);
      // Plural forms may drop {n} ("one" often reads "a file"), so only plain entries must match
      if (!k.includes('#')) assert.equal(holes(v), holes(en[k as keyof typeof en]), k);
    }
  });
}

test('translation coverage', t => {
  for (const [lang, cat] of Object.entries(catalogs)) {
    const missing = Object.keys(en).filter(k => !(k in cat));
    t.diagnostic(`${lang}: ${Object.keys(en).length - missing.length}/${Object.keys(en).length}${missing.length ? `, missing ${missing.join(', ')}` : ''}`);
  }
});
