// Writes the generated color schemes: src/themes-generated.css and src/lib/themes-generated.ts.
// Each scheme is a few numbers (surface hue and saturation, accent hue and saturation); the
// shades are derived from them and nudged until text, links and accent labels are readable.
//   npm run themes
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function hex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function luminance(c) {
  const n = parseInt(c.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// Moves the lightness away from the backgrounds until the color is readable on all of them
function readable(h, s, l, backgrounds, min, dir) {
  let c = hex(h, s, l);
  while (backgrounds.some(bg => contrast(c, bg) < min) && l > 0 && l < 100) { l += dir; c = hex(h, s, l); }
  return c;
}

// [id, name, note, surface hue, surface saturation, accent hue, accent saturation, options]
const DARK = [
  ['slate', 'Slate', 'Blue-grey, calm', 215, 14, 215, 70],
  ['graphite', 'Graphite', 'Neutral grey, no color', 0, 0, 0, 0],
  ['charcoal', 'Charcoal', 'Warm grey, amber accents', 30, 5, 36, 85],
  ['obsidian', 'Obsidian', 'Near black, violet accents', 260, 10, 265, 85, { base: 3 }],
  ['navy', 'Navy', 'Dark blue', 222, 45, 215, 90],
  ['cobalt', 'Cobalt', 'Blue, yellow accents', 218, 60, 46, 95, { base: 8, link: 190 }],
  ['indigo', 'Indigo', 'Blue-violet', 240, 35, 245, 90],
  ['violet', 'Violet', 'Purple', 270, 35, 275, 85],
  ['orchid', 'Orchid', 'Soft purple-pink', 295, 28, 300, 70],
  ['magenta', 'Magenta', 'Dark pink', 320, 30, 325, 85],
  ['crimson', 'Crimson', 'Dark red', 350, 30, 352, 80],
  ['ruby', 'Ruby', 'Deep red, orange accents', 340, 40, 12, 85, { base: 5 }],
  ['rust', 'Rust', 'Red-brown', 15, 35, 18, 80],
  ['copper', 'Copper', 'Brown, muted orange', 25, 30, 28, 65],
  ['amber', 'Amber', 'Dark yellow-brown', 38, 30, 42, 95],
  ['olive', 'Olive', 'Yellow-green', 70, 22, 75, 60],
  ['moss', 'Moss', 'Muted green', 95, 22, 100, 50],
  ['emerald', 'Emerald', 'Rich green', 150, 35, 152, 70],
  ['jade', 'Jade', 'Blue-green', 165, 30, 168, 65],
  ['teal', 'Teal', 'Green-blue', 180, 35, 180, 70],
  ['lagoon', 'Lagoon', 'Bright turquoise accents', 192, 45, 190, 85],
  ['arctic', 'Arctic', 'Lighter cool grey-blue', 200, 25, 195, 75, { base: 9 }],
  ['storm', 'Storm', 'Lighter blue-grey', 225, 18, 200, 60, { base: 10 }],
  ['dusk', 'Dusk', 'Purple evening, orange accents', 255, 22, 20, 85, { base: 9 }],
  ['wine', 'Wine', 'Dark red-purple', 335, 35, 340, 60, { base: 5 }],
  ['cocoa', 'Cocoa', 'Brown', 22, 25, 30, 55, { base: 7 }],
  ['espresso', 'Espresso', 'Very dark brown', 28, 30, 35, 70, { base: 4 }],
  ['terminal', 'Terminal', 'Green on black', 120, 30, 120, 90, { base: 2, textHue: 120, textSat: 85, link: 150 }],
  ['phosphor', 'Phosphor', 'Amber on black', 40, 30, 40, 95, { base: 2, textHue: 40, textSat: 90, link: 25 }],
  ['neon', 'Neon', 'Black, pink and cyan', 280, 20, 320, 100, { base: 3, link: 185 }],
  ['synthwave', 'Synthwave', 'Purple, pink and cyan', 265, 45, 320, 90, { base: 8, link: 185 }],
  ['aurora', 'Aurora', 'Dark blue, green accents', 210, 30, 160, 75],
  ['abyss', 'Abyss', 'Blue-black, turquoise accents', 230, 50, 195, 90, { base: 3 }],
  ['carbon', 'Carbon', 'Black, red accents', 0, 0, 0, 85, { base: 3 }],
  ['ash', 'Ash', 'Lighter grey, blue accents', 0, 0, 210, 60, { base: 12 }],
  ['steel', 'Steel', 'Grey-blue, orange accents', 210, 10, 30, 80, { base: 11 }],
  ['ink', 'Ink', 'Blue-black, yellow accents', 235, 30, 50, 90, { base: 3 }],
  ['sapphire', 'Sapphire', 'Strong blue', 228, 55, 228, 95],
  ['azure', 'Azure', 'Bright blue accents', 208, 50, 205, 95],
  ['peacock', 'Peacock', 'Turquoise, purple accents', 188, 50, 300, 70],
  ['pine', 'Pine', 'Dark green, orange accents', 160, 40, 35, 85, { base: 4 }],
  ['fern', 'Fern', 'Soft green', 125, 25, 130, 55],
  ['lime', 'Lime', 'Yellow-green accents', 85, 30, 82, 85],
  ['citrus', 'Citrus', 'Dark yellow, orange accents', 60, 25, 28, 95],
  ['sunset', 'Sunset', 'Purple, orange accents', 280, 30, 25, 95],
  ['flamingo', 'Flamingo', 'Dark rose, bright pink', 330, 25, 345, 90],
  ['cherry', 'Cherry', 'Deep red', 355, 40, 355, 90, { base: 5 }],
  ['brick', 'Brick', 'Red-brown, gold accents', 8, 35, 40, 80],
  ['terracotta', 'Terracotta', 'Clay, teal accents', 18, 30, 175, 55, { base: 8 }],
  ['sandstone', 'Sandstone', 'Lighter warm grey', 35, 18, 20, 70, { base: 10 }],
  ['mocha', 'Mocha', 'Brown, lilac accents', 20, 18, 280, 50, { base: 9 }],
  ['walnut', 'Walnut', 'Dark brown, gold accents', 25, 35, 45, 80, { base: 5 }],
  ['bronze', 'Bronze', 'Yellow-brown', 40, 35, 38, 70],
  ['brass', 'Brass', 'Dark gold', 48, 30, 50, 85],
  ['mulberry', 'Mulberry', 'Dark purple-pink', 310, 35, 310, 65, { base: 5 }],
  ['grape', 'Grape', 'Strong purple', 280, 40, 280, 90],
  ['iris', 'Iris', 'Lighter blue-violet', 250, 30, 255, 90, { base: 9 }],
  ['twilight', 'Twilight', 'Night blue, pink accents', 245, 35, 330, 75, { base: 5 }],
  ['nebula', 'Nebula', 'Purple, turquoise accents', 270, 45, 190, 85, { base: 4 }],
  ['cathode', 'Cathode', 'Cyan on black', 185, 30, 185, 90, { base: 2, textHue: 185, textSat: 80, link: 160 }],
  ['bubblegum', 'Bubblegum', 'Purple-pink, cyan links', 300, 25, 330, 95, { base: 8, link: 185 }],
  ['volcano', 'Volcano', 'Black, lava orange', 10, 30, 20, 100, { base: 3 }],
  ['glacier', 'Glacier', 'The lightest dark, cool', 205, 30, 190, 70, { base: 12 }],
  ['seaweed', 'Seaweed', 'Dark teal, green accents', 170, 35, 90, 60, { base: 4 }]
];
const LIGHT = [
  ['snow', 'Snow', 'Cool white', 220, 10, 225, 75],
  ['linen', 'Linen', 'Warm white', 40, 30, 25, 60],
  ['sky', 'Sky', 'Light blue', 205, 60, 210, 85],
  ['mint', 'Mint', 'Light green', 150, 40, 160, 70],
  ['lavender', 'Lavender', 'Light purple', 265, 45, 265, 60],
  ['blush', 'Blush', 'Light pink', 345, 50, 345, 65],
  ['peach', 'Peach', 'Light orange', 25, 65, 18, 75],
  ['lemon', 'Lemon', 'Light yellow', 55, 60, 45, 90],
  ['sage', 'Sage', 'Grey-green', 100, 20, 110, 35],
  ['latte', 'Latte', 'Milky brown', 30, 35, 25, 45],
  ['ice', 'Ice', 'Pale turquoise', 190, 45, 195, 80],
  ['cloud', 'Cloud', 'Soft blue-grey', 210, 25, 210, 60],
  ['pearl', 'Pearl', 'Near white, rose accents', 300, 8, 320, 45],
  ['cream', 'Cream', 'Soft yellow', 48, 55, 30, 70],
  ['sand', 'Sand', 'Beige', 38, 40, 20, 55],
  ['rose', 'Rose', 'Pink-red', 355, 55, 350, 70],
  ['coral', 'Coral', 'Light red-orange', 12, 65, 8, 75],
  ['apricot', 'Apricot', 'Warm orange', 32, 70, 28, 85],
  ['pistachio', 'Pistachio', 'Yellow-green', 95, 35, 110, 50],
  ['seafoam', 'Seafoam', 'Green-turquoise', 165, 40, 172, 75],
  ['aqua', 'Aqua', 'Turquoise', 182, 50, 186, 85],
  ['periwinkle', 'Periwinkle', 'Blue-violet', 232, 55, 235, 70],
  ['lilac', 'Lilac', 'Soft purple', 285, 40, 285, 55],
  ['petal', 'Petal', 'Purple-pink', 320, 45, 320, 60],
  ['fog', 'Fog', 'Grey with a little blue', 200, 8, 200, 25]
];

function dark([id, name, note, h, s, a, as, o = {}]) {
  const b = o.base ?? 6;
  const bg = [b, b + 3, b + 5.5, b + 10].map(l => hex(h, s, l));
  const th = o.textHue ?? h, ts = o.textSat ?? Math.min(s, 20);
  const accent = hex(a, as, as ? 62 : 80);
  const v = {
    '--bg-0': bg[0], '--bg-1': bg[1], '--bg-2': bg[2], '--bg-3': bg[3],
    '--bg-hover': hex(h, s, b + 13), '--bg-active': hex(h, s, b + 18), '--line': hex(h, s, b + 11),
    '--text': readable(th, ts, o.textSat ? 70 : 91, bg, 7.5, 1),
    '--text-dim': readable(th, o.textSat ? ts * 0.7 : Math.min(s, 15), o.textSat ? 50 : 66, bg, 4.6, 1),
    '--text-faint': hex(th, o.textSat ? ts * 0.5 : Math.min(s, 12), 45),
    '--accent': accent, '--accent-hover': hex(a, as, as ? 69 : 88),
    '--accent-text': contrast('#ffffff', accent) >= contrast('#0b0b0b', accent) ? '#ffffff' : '#0b0b0b',
    '--speaking': a > 90 && a < 170 ? '#f2c14e' : '#3bd16f',
    '--danger': readable(4, 85, 62, bg, 4.6, 1), '--warn': '#e8b23c',
    '--link': readable(o.link ?? (a > 190 && a < 250 ? 185 : 210), 85, 70, bg, 4.6, 1)
  };
  return { id, name, note, kind: 'dark', v };
}

function light([id, name, note, h, s, a, as]) {
  const bg = [hex(h, s, 89), hex(h, s, 94.5), hex(h, s, 98)];
  const accent = readable(a, as, 42, ['#ffffff'], 4.6, -1);
  const v = {
    '--bg-0': bg[0], '--bg-1': bg[1], '--bg-2': bg[2], '--bg-3': hex(h, s, 91),
    '--bg-hover': hex(h, s, 87), '--bg-active': hex(h, s, 82), '--line': hex(h, Math.min(s, 30), 82),
    '--text': readable(h, 20, 13, bg, 7.5, -1),
    '--text-dim': readable(h, 12, 34, bg, 4.6, -1),
    '--text-faint': hex(h, 10, 52),
    '--accent': accent, '--accent-hover': readable(a, as, 34, ['#ffffff'], 6, -1), '--accent-text': '#ffffff',
    '--speaking': readable(140, 65, 34, bg, 3.2, -1), '--danger': readable(4, 70, 44, bg, 4.6, -1), '--warn': readable(38, 85, 36, bg, 3.2, -1),
    '--link': readable(215, 75, 40, bg, 4.6, -1)
  };
  return { id, name, note, kind: 'light', v };
}

const themes = [...DARK.map(dark), ...LIGHT.map(light)];

const css = '/* Generated by scripts/gen-themes.mjs (npm run themes). Do not edit by hand. */\n\n' + themes.map(t =>
  `:root[data-theme="${t.id}"], [data-theme-preview="${t.id}"] {\n  --rail: var(--bg-0);\n${Object.entries(t.v).map(([k, c]) => `  ${k}: ${c};`).join('\n')}\n  color-scheme: ${t.kind};\n}\n`).join('\n');
writeFileSync(path.join(root, 'src/themes-generated.css'), css);

const ts = '// Generated by scripts/gen-themes.mjs (npm run themes). Do not edit by hand.\n' +
  'export const GENERATED_THEMES = [\n' + themes.map(t => `  { id: '${t.id}', name: '${t.name}', note: '${t.note}', light: ${t.kind === 'light'} }`).join(',\n') + '\n] as const;\n';
writeFileSync(path.join(root, 'src/lib/themes-generated.ts'), ts);
console.log(`${themes.length} schemes written`);
