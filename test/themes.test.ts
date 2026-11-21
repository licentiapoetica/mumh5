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

// Code token colors (app.css, .hl) are oklch(from var(--text) calc(l * a + b) chroma hue); computed
// here the way the browser does, chroma reduced until the color fits sRGB
const appCss = readFileSync(path.resolve(import.meta.dirname, '../src/app.css'), 'utf8');
const tokens = [...appCss.matchAll(/(--syn-[\w-]+): oklch\(from var\(--text\) calc\(l \* ([\d.]+) \+ ([\d.]+)\) ([\d.]+) ([\d.]+)\)/g)]
  .map(m => ({ name: m[1], a: Number(m[2]), b: Number(m[3]), c: Number(m[4]), h: Number(m[5]) }));

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function oklabLightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}
function oklchToLinear(L: number, C: number, H: number): number[] {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
function oklchHex(L: number, C: number, H: number): string {
  let c = C;
  while (c > 0 && oklchToLinear(L, c, H).some(v => v < -1e-4 || v > 1 + 1e-4)) c -= 0.002;
  return '#' + oklchToLinear(L, Math.max(c, 0), H).map(v => Math.round(255 * toGamma(Math.min(1, Math.max(0, v)))).toString(16).padStart(2, '0')).join('');
}

test('code token colors are all parsed from app.css', () => assert.equal(tokens.length, 7));

for (const t of themes) {
  test(`${t.id}: code token colors are readable`, () => {
    const l = oklabLightness(t.vars['--text']);
    for (const k of tokens) {
      const color = oklchHex(l * k.a + k.b, k.c, k.h);
      assert.ok(contrast(color, t.vars['--bg-0']) >= 4.5, `${k.name} ${color} on --bg-0: ${contrast(color, t.vars['--bg-0']).toFixed(1)}`);
    }
  });
}
