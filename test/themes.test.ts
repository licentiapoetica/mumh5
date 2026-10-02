import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Every color scheme must stay readable: text on the surfaces it sits on, and the label on an accent button
const css = ['themes.css', 'themes-generated.css'].map(f => readFileSync(path.resolve(import.meta.dirname, '../src', f), 'utf8')).join('\n');
const settings = ['settings.svelte.ts', 'themes-generated.ts'].map(f => readFileSync(path.resolve(import.meta.dirname, '../src/lib', f), 'utf8')).join('\n');

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = [...css.matchAll(/\[data-theme-preview="([\w-]+)"\] \{([^}]*)\}/g)].map(m => ({
  id: m[1],
  vars: Object.fromEntries([...m[2].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map(v => [v[1], v[2]]))
}));

test('every scheme in the settings list has its colors, and the other way round', () => {
  const listed = [...settings.matchAll(/\{ id: '([\w-]+)', name:/g)].map(m => m[1]).sort();
  assert.deepEqual(themes.map(t => t.id).sort(), listed);
  assert.equal(listed.length, 100);
});

for (const t of themes) {
  test(`${t.id}: text is readable`, () => {
    const v = t.vars;
    for (const bg of ['--bg-0', '--bg-1', '--bg-2']) {
      assert.ok(contrast(v['--text'], v[bg]) >= 7, `text on ${bg}: ${contrast(v['--text'], v[bg]).toFixed(1)}`);
      assert.ok(contrast(v['--text-dim'], v[bg]) >= 4.5, `dim text on ${bg}: ${contrast(v['--text-dim'], v[bg]).toFixed(1)}`);
    }
    assert.ok(contrast(v['--accent-text'], v['--accent']) >= 3.5, `accent label: ${contrast(v['--accent-text'], v['--accent']).toFixed(1)}`);
    assert.ok(contrast(v['--link'], v['--bg-2']) >= 4, `link: ${contrast(v['--link'], v['--bg-2']).toFixed(1)}`);
  });
}
