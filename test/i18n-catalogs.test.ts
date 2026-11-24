import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { de } from '../src/locales/de.ts';

// Every t('...') and tn('...', '...') literal in the source. A catalog key nobody uses is a leftover
// from a renamed text; a text without a catalog entry only falls back to English, which is allowed.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'locales' ? [] : sources(p);
    return /\.(svelte|ts)$/.test(f) ? [readFileSync(p, 'utf8')] : [];
  });
}
const used = new Set<string>();
for (const text of sources('src')) {
  for (const m of text.matchAll(/\bt(n?)\(\s*'((?:[^'\\]|\\.)*)'(?:\s*,\s*'((?:[^'\\]|\\.)*)')?/g)) {
    used.add(m[2].replace(/\\'/g, "'"));
    if (m[1] && m[3]) used.add(m[3].replace(/\\'/g, "'"));
  }
}

test('German has no keys the code does not use', () => {
  const stale = Object.keys(de).filter(k => !used.has(k.replace(/#\w+$/, '')));
  assert.deepEqual(stale, []);
});
