import { test } from 'bun:test';
import assert from './assert.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COLOR_KEYS, applyThemeStyle, colorProblems, contrast, defaultIndicator, deriveColors, fixColors, hoverLabel, normalizeHex, orbLook,
  parseThemeFile, sanitizeTheme, themeFile, themeFileName, uniqueThemeName, type CustomTheme, type ThemeColors
} from '../src/lib/custom-themes.ts';

const id = 'custom:test' as const;
const theme = (colors: ThemeColors): CustomTheme => ({
  id, name: 'Test', colors, font: 'serif', chatSize: 17,
  indicator: {
    idle: { color: '#333333', shape: 'ring', size: 60, glow: 0, border: false },
    talking: { color: '#ff00aa', shape: 'sphere', size: 100, glow: 6, border: true },
    name: '#00ddff'
  }
});

test('a main button stays readable under the pointer', () => {
  const base = deriveColors('#000000', '#ffffff', '#000000');
  const older: Partial<ThemeColors> = { ...base, 'accent-hover': '#ffffff', 'accent-text': '#d4d4d4' };
  delete older['accent-hover-text'];
  const t = sanitizeTheme({ colors: older }, id)!;
  assert.equal(t.colors['accent-hover-text'], '#0b0b0b', 'a theme saved before this color gets a readable one');
  assert.deepEqual(colorProblems(t.colors), []);
  const chosen = { ...t.colors, 'accent-hover-text': '#d4d4d4' };
  assert.deepEqual(colorProblems(chosen).map(p => p.key), ['accent-hover-text']);
  assert.deepEqual(colorProblems(fixColors(chosen)), []);
  assert.equal(fixColors(chosen)['accent-text'], '#d4d4d4', 'the label on the plain button is left alone');
});

test('a hovered main button never gets a label it hides', () => {
  const props = new Map<string, string>();
  const style = { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => { props.delete(k); return ''; } };
  const colors = { ...deriveColors('#000000', '#ffffff', '#000000'), 'accent-hover': '#ffffff', 'accent-hover-text': '#ffffff' };
  applyThemeStyle(style, theme(colors));
  assert.equal(props.get('--accent-hover-text'), '#0b0b0b', 'white on white');
  const missing: Partial<ThemeColors> = { ...colors, 'accent-text': '#d4d4d4' };
  delete missing['accent-hover-text'];
  applyThemeStyle(style, theme(missing as ThemeColors));
  assert.equal(props.get('--accent-hover-text'), '#0b0b0b', 'a theme in memory from before this color');
  applyThemeStyle(style, theme({ ...colors, 'accent-hover': '#102030', 'accent-hover-text': '#ffcc00' }));
  assert.equal(props.get('--accent-hover-text'), '#ffcc00', 'a readable choice is kept');
});

test('a talking name has its own color, and none unless chosen', () => {
  const colors = deriveColors('#16181d', '#eceef2', '#7c6cff');
  assert.equal(sanitizeTheme({ colors }, id)!.indicator.name, null, 'not the connected color');
  assert.equal(sanitizeTheme({ colors, indicator: { name: 'red;x:url(y)' } }, id)!.indicator.name, null);
  assert.equal(sanitizeTheme({ colors, indicator: { name: '#0df' } }, id)!.indicator.name, '#00ddff');
});

test('the indicator is kept per state and checked like everything else in a file', () => {
  const colors = deriveColors('#16181d', '#eceef2', '#7c6cff');
  const t = parseThemeFile(JSON.stringify({ mumh5Theme: 1, colors, indicator: {
    idle: { color: '#123', shape: 'none', size: 1000, glow: -4, border: 'yes' },
    talking: { color: 'red;x:url(y)', shape: 'none', size: '90', glow: 99, border: true }
  } }), id)!;
  assert.deepEqual(t.indicator.idle, { color: '#112233', shape: 'none', size: 100, glow: 0, border: true });
  assert.deepEqual(t.indicator.talking, { color: '#7c6cff', shape: 'sphere', size: 80, glow: 12, border: true }, 'a talking person always shows');
});

test('themes saved before the indicator had settings keep the accent sphere', () => {
  const colors = deriveColors('#16181d', '#eceef2', '#7c6cff');
  assert.deepEqual(sanitizeTheme({ name: 'Old', colors }, id)!.indicator, defaultIndicator('#7c6cff'));
  assert.equal(sanitizeTheme({ name: 'Old', colors, indicator: { talking: { color: '#ff00aa' } } }, id)!.indicator.talking.border, false);
  assert.deepEqual(orbLook(null, true), { color: 'var(--accent)', shape: 'sphere', size: 80, glow: 0, border: false });
  assert.equal(orbLook(null, false).border, true);
});

test('hex colors are normalized and anything else is refused', () => {
  assert.equal(normalizeHex(' #ABC '), '#aabbcc');
  assert.equal(normalizeHex('#A1b2C3'), '#a1b2c3');
  for (const bad of ['red', '#12', '#12345g', 'url(x)', '#fff;--x:1', 5, null]) assert.equal(normalizeHex(bad), null);
});

for (const [name, bg, text, accent] of [
  ['dark', '#16181d', '#eceef2', '#7c6cff'], ['light', '#fbfaf7', '#1c1c20', '#b4321f'],
  ['saturated', '#30104a', '#ffe9fb', '#ffcc00'], ['black', '#000000', '#ffffff', '#00ff88']
]) {
  test(`three colors make a complete, readable palette: ${name}`, () => {
    const c = deriveColors(bg, text, accent);
    assert.deepEqual(Object.keys(c).sort(), [...COLOR_KEYS].sort());
    assert.deepEqual([c['bg-2'], c.text, c.accent], [bg, text, accent], 'the chosen colors stay');
    assert.deepEqual(colorProblems(c), []);
  });
}

test('fixing changes only the colors that are hard to read', () => {
  const good = deriveColors('#16181d', '#eceef2', '#7c6cff');
  const bad = { ...good, text: '#30323a', link: '#20222a' };
  assert.deepEqual(colorProblems(bad).map(p => p.key), ['text', 'link']);
  const fixed = fixColors(bad);
  assert.deepEqual(colorProblems(fixed), []);
  for (const k of COLOR_KEYS) if (k !== 'text' && k !== 'link') assert.equal(fixed[k], bad[k], k);
  assert.ok(contrast(fixed.text, fixed['bg-0']) >= 4.5);
});

test('the built-in schemes pass the readability check', () => {
  const css = ['themes.css', 'themes-generated.css'].map(f => readFileSync(path.resolve(import.meta.dirname, '../src', f), 'utf8')).join('\n');
  const blocks = [...css.matchAll(/\[data-theme-preview="([\w-]+)"\] \{([^}]*)\}/g)];
  assert.equal(blocks.length, 100);
  for (const [, name, body] of blocks) {
    const v = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(m => [m[1], m[2]]));
    const all = { ...v, rail: v['bg-0'], 'accent-hover-text': hoverLabel(v['accent-text'], v['accent-hover']) } as ThemeColors;
    assert.deepEqual(colorProblems(all).map(p => `${p.key} ${p.ratio.toFixed(2)}`), [], name);
  }
});

test('a theme file round-trips', () => {
  const t = theme(deriveColors('#16181d', '#eceef2', '#7c6cff'));
  assert.deepEqual(parseThemeFile(themeFile(t), id), t);
});

test('a theme file cannot carry anything but colors, a known font and a size', () => {
  const colors: Record<string, string> = { ...deriveColors('#16181d', '#eceef2', '#7c6cff') };
  colors.link = 'red;background:url(https://example.com/x)';
  colors['--evil'] = '#000000';
  const t = parseThemeFile(JSON.stringify({ mumh5Theme: 1, name: 'a\n\u0007b', font: 'url(x)', chatSize: 900, colors, css: 'body{}' }), id)!;
  assert.match(t.colors.link, /^#[0-9a-f]{6}$/);
  assert.deepEqual(Object.keys(t.colors).sort(), [...COLOR_KEYS].sort());
  assert.deepEqual([t.name, t.font, t.chatSize], ['a b', 'inter', 20]);
  assert.equal('css' in t, false);
});

test('broken or foreign files are refused', () => {
  const colors = deriveColors('#16181d', '#eceef2', '#7c6cff');
  for (const text of ['', 'nope', '[]', 'null', '{}', JSON.stringify({ colors }), JSON.stringify({ mumh5Theme: 2, colors }),
    JSON.stringify({ mumh5Theme: 1, colors: { ...colors, accent: 'blue' } }), ' '.repeat(70000)]) {
    assert.equal(parseThemeFile(text, id), null, text.slice(0, 40));
  }
  assert.equal(sanitizeTheme(null, id), null);
});

test('names stay unique and file names stay plain', () => {
  assert.equal(uniqueThemeName('Night', ['Day']), 'Night');
  assert.equal(uniqueThemeName('Night', ['night', 'Night (2)']), 'Night (3)');
  assert.ok(uniqueThemeName('x'.repeat(40), ['x'.repeat(40)]).length <= 40);
  assert.equal(themeFileName('My ../ Theme!'), 'my-theme.mumh5-theme.json');
  assert.equal(themeFileName('...'), 'theme.mumh5-theme.json');
});

test('applying a theme and taking it off leaves no variable behind', () => {
  const props = new Map<string, string>();
  const style = { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => { props.delete(k); return ''; } };
  applyThemeStyle(style, theme(deriveColors('#fbfaf7', '#1c1c20', '#b4321f')));
  assert.equal(props.get('--accent'), '#b4321f');
  assert.equal(props.get('--fs-chat'), '17px');
  assert.equal(props.get('--name-talking'), '#00ddff');
  assert.match(props.get('--font')!, /Georgia/);
  assert.equal(props.get('color-scheme'), 'light');
  applyThemeStyle(style, null);
  assert.equal(props.size, 0);
});
