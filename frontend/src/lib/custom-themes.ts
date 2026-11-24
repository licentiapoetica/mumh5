// Themes people make themselves: the same color variables as the built-in schemes, plus a font and
// a chat text size. Only checked hex colors and known fonts reach the page, so a shared theme file
// cannot carry CSS.
export const COLOR_GROUPS = [
  { name: 'Surfaces', colors: [
    { key: 'bg-2', name: 'Chat', note: 'The main background' },
    { key: 'bg-1', name: 'Panels', note: 'Channel list, members, dialogs' },
    { key: 'bg-0', name: 'Fields', note: 'Text boxes, code blocks, the deepest background' },
    { key: 'rail', name: 'Server list', note: 'The strip of server icons' },
    { key: 'bg-3', name: 'Buttons', note: 'Buttons and cards' },
    { key: 'bg-hover', name: 'Hover', note: 'Under the pointer' },
    { key: 'bg-active', name: 'Selected', note: 'Pressed and selected rows' },
    { key: 'line', name: 'Lines', note: 'Borders between areas' }
  ] },
  { name: 'Text', colors: [
    { key: 'text', name: 'Text', note: 'Messages and names' },
    { key: 'text-dim', name: 'Secondary text', note: 'Labels, times, descriptions' },
    { key: 'text-faint', name: 'Faint text', note: 'Placeholders and hints' },
    { key: 'link', name: 'Links', note: 'Links in chat and settings' }
  ] },
  { name: 'Accent', colors: [
    { key: 'accent', name: 'Accent', note: 'Main buttons and selections' },
    { key: 'accent-hover', name: 'Accent hover', note: 'Main buttons under the pointer' },
    { key: 'accent-text', name: 'Text on accent', note: 'Labels on main buttons' },
    { key: 'accent-hover-text', name: 'Text on accent hover', note: 'Labels on main buttons under the pointer' }
  ] },
  { name: 'Status', colors: [
    { key: 'speaking', name: 'Connected and active', note: 'Connection wave and status, live marks' },
    { key: 'danger', name: 'Danger', note: 'Errors and destructive actions' },
    { key: 'warn', name: 'Warning', note: 'Warnings' }
  ] }
] as const;

export type ColorKey = typeof COLOR_GROUPS[number]['colors'][number]['key'];
export type ThemeColors = Record<ColorKey, string>;
export const COLOR_KEYS = COLOR_GROUPS.flatMap(g => g.colors.map(c => c.key)) as ColorKey[];

// Installed or bundled fonts only: a theme never makes the app fetch anything
export const THEME_FONTS = [
  { id: 'inter', name: 'Inter', stack: '' },
  { id: 'system', name: 'System', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Ubuntu, Cantarell, sans-serif' },
  { id: 'serif', name: 'Serif', stack: 'Georgia, Cambria, "Times New Roman", "Noto Serif", serif' },
  { id: 'mono', name: 'Monospace', stack: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace' }
] as const;
export type ThemeFont = typeof THEME_FONTS[number]['id'];

export const CHAT_SIZE = { min: 12, max: 20, normal: 15 } as const;
export const THEME_NAME_MAX = 40;
export const THEME_FILE_MAX = 64 * 1024;

// The mark beside people in the lists, set per state and apart from the palette: changing the
// accent or copying colors from another theme leaves it alone
export const ORB_SHAPES = [
  { id: 'sphere', name: 'Sphere' }, { id: 'dot', name: 'Dot' }, { id: 'ring', name: 'Ring' },
  { id: 'square', name: 'Square' }, { id: 'none', name: 'Hidden' }
] as const;
export type OrbShape = typeof ORB_SHAPES[number]['id'];
export const ORB_SIZE = { min: 40, max: 100, normal: 80 } as const;
export const ORB_GLOW_MAX = 12;
// border: the rim around the sphere, which by default only the idle state has
export interface OrbLook { color: string; shape: OrbShape; size: number; glow: number; border: boolean }
export type OrbState = 'idle' | 'talking';
// name: the color of a talking person's name; null leaves the name as it is
export interface ThemeIndicator { idle: OrbLook; talking: OrbLook; name: string | null }

export const defaultIndicator = (accent: string): ThemeIndicator => ({
  idle: { color: accent, shape: 'sphere', size: ORB_SIZE.normal, glow: 0, border: true },
  talking: { color: accent, shape: 'sphere', size: ORB_SIZE.normal, glow: 0, border: false },
  name: null
});

/** What to draw; the built-in schemes keep the sphere in their accent. */
export const orbLook = (indicator: ThemeIndicator | null | undefined, speaking: boolean): OrbLook =>
  indicator?.[speaking ? 'talking' : 'idle'] ?? { color: 'var(--accent)', shape: 'sphere', size: ORB_SIZE.normal, glow: 0, border: !speaking };

export type CustomThemeId = `custom:${string}`;
export interface CustomTheme {
  id: CustomThemeId;
  name: string;
  colors: ThemeColors;
  font: ThemeFont;
  chatSize: number;
  indicator: ThemeIndicator;
}

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return /^#[0-9a-f]{3}$/.test(v) ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : null;
}

const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};

export function mix(a: string, b: string, amount: number): string {
  const y = channels(b);
  return '#' + channels(a).map((v, i) => Math.round(v + (y[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The color, moved toward white or black only as far as it takes to read on all the backgrounds. */
export function readableOn(color: string, backgrounds: string[], min: number): string {
  const worst = (c: string) => Math.min(...backgrounds.map(b => contrast(c, b)));
  if (worst(color) >= min) return color;
  const end = worst('#ffffff') >= worst('#000000') ? '#ffffff' : '#000000';
  for (let step = 1; step < 25; step++) {
    const c = mix(color, end, step / 25);
    if (worst(c) >= min) return c;
  }
  return end;
}

const labelOn = (color: string) => contrast('#ffffff', color) >= contrast('#0b0b0b', color) ? '#ffffff' : '#0b0b0b';
const LABEL_MIN = 3.5;

/** A main button's label under the pointer: the usual one while it stays readable there. */
export const hoverLabel = (label: string, hover: string) => contrast(label, hover) >= LABEL_MIN ? label : labelOn(hover);

/** A full palette from the three colors people choose first; those three stay exactly as chosen. */
export function deriveColors(background: string, text: string, accent: string): ThemeColors {
  const light = luminance(background) > 0.35;
  const toText = (t: number) => mix(background, text, t);
  const bg0 = light ? toText(0.1) : mix(background, '#000000', 0.42);
  const bg1 = light ? toText(0.05) : mix(background, '#000000', 0.2);
  const surfaces = [bg0, bg1, background];
  const accentHover = mix(accent, light ? '#000000' : '#ffffff', 0.14);
  return {
    'bg-0': bg0, 'bg-1': bg1, 'bg-2': background, rail: bg0,
    'bg-3': toText(light ? 0.08 : 0.07),
    'bg-hover': toText(light ? 0.12 : 0.11),
    'bg-active': toText(light ? 0.18 : 0.16),
    line: toText(light ? 0.16 : 0.11),
    text,
    'text-dim': readableOn(mix(text, background, 0.3), surfaces, 4.5),
    'text-faint': mix(text, background, 0.52),
    link: readableOn(mix(accent, text, 0.3), surfaces, 4.5),
    accent,
    'accent-hover': accentHover,
    'accent-text': labelOn(accent),
    'accent-hover-text': hoverLabel(labelOn(accent), accentHover),
    speaking: readableOn(light ? '#1f9d4c' : '#3bd16f', [background], 3),
    danger: readableOn(light ? '#d33a34' : '#f0504a', [background], 3),
    warn: readableOn(light ? '#b7791f' : '#e8b23c', [background], 3)
  };
}

// What must stay readable, on what. The same limits the built-in schemes are tested against.
const TEXT_ON: ColorKey[] = ['bg-0', 'bg-1', 'bg-2'];
const READABILITY: { key: ColorKey; on: ColorKey[]; min: number }[] = [
  { key: 'text', on: TEXT_ON, min: 4.5 },
  { key: 'text-dim', on: TEXT_ON, min: 4.5 },
  { key: 'link', on: ['bg-2'], min: 4 },
  { key: 'accent-text', on: ['accent'], min: LABEL_MIN },
  { key: 'accent-hover-text', on: ['accent-hover'], min: LABEL_MIN },
  { key: 'speaking', on: ['bg-2'], min: 2.5 },
  { key: 'danger', on: ['bg-2'], min: 2.5 },
  { key: 'warn', on: ['bg-2'], min: 2.5 }
];

export interface ColorProblem { key: ColorKey; ratio: number; min: number }

export function colorProblems(colors: ThemeColors): ColorProblem[] {
  return READABILITY.flatMap(({ key, on, min }) => {
    const ratio = Math.min(...on.map(b => contrast(colors[key], colors[b])));
    return ratio < min ? [{ key, ratio, min }] : [];
  });
}

/** Only the colors that are hard to read change, each as little as it takes. */
export function fixColors(colors: ThemeColors): ThemeColors {
  const next = { ...colors };
  for (const { key, on, min } of READABILITY) next[key] = readableOn(next[key], on.map(b => next[b]), min);
  return next;
}

export const isCustomTheme = (id: unknown): id is CustomThemeId => typeof id === 'string' && id.startsWith('custom:');

const cleanName = (value: unknown) =>
  (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '').slice(0, THEME_NAME_MAX).trim();

const within = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

// Hiding is for the idle state: a talking person always shows
function sanitizeOrb(raw: unknown, fallback: OrbLook, canHide: boolean): OrbLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const shape = ORB_SHAPES.find(s => s.id === r.shape && (canHide || s.id !== 'none'))?.id ?? fallback.shape;
  return {
    color: normalizeHex(r.color) ?? fallback.color,
    shape,
    size: within(r.size, ORB_SIZE.min, ORB_SIZE.max, fallback.size),
    glow: within(r.glow, 0, ORB_GLOW_MAX, fallback.glow),
    border: typeof r.border === 'boolean' ? r.border : fallback.border
  };
}

/** A theme from storage or a file, or null. Missing shades are filled in from its main colors. */
export function sanitizeTheme(raw: unknown, id: CustomThemeId): CustomTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const given = (r.colors && typeof r.colors === 'object' ? r.colors : {}) as Record<string, unknown>;
  const background = normalizeHex(given['bg-2']), text = normalizeHex(given.text), accent = normalizeHex(given.accent);
  if (!background || !text || !accent) return null;
  const derived = deriveColors(background, text, accent);
  const colors = Object.fromEntries(COLOR_KEYS.map(k => [k, normalizeHex(given[k]) ?? derived[k]])) as ThemeColors;
  // Themes saved before this color existed: from their own hover, not a derived one
  colors['accent-hover-text'] = normalizeHex(given['accent-hover-text']) ?? hoverLabel(colors['accent-text'], colors['accent-hover']);
  const size = Number(r.chatSize);
  // Themes saved before the indicator had settings keep the look they had
  const orbs = (r.indicator && typeof r.indicator === 'object' ? r.indicator : {}) as Record<string, unknown>;
  const plain = defaultIndicator(colors.accent);
  return {
    id,
    name: cleanName(r.name) || 'Imported theme',
    colors,
    font: THEME_FONTS.find(f => f.id === r.font)?.id ?? 'inter',
    chatSize: Number.isFinite(size) ? Math.min(CHAT_SIZE.max, Math.max(CHAT_SIZE.min, Math.round(size))) : CHAT_SIZE.normal,
    indicator: {
      idle: sanitizeOrb(orbs.idle, plain.idle, true),
      talking: sanitizeOrb(orbs.talking, plain.talking, false),
      name: normalizeHex(orbs.name)
    }
  };
}

export function themeFile(t: CustomTheme): string {
  return JSON.stringify({ mumh5Theme: 1, name: t.name, font: t.font, chatSize: t.chatSize, colors: t.colors, indicator: t.indicator }, null, 2) + '\n';
}

export function parseThemeFile(text: string, id: CustomThemeId): CustomTheme | null {
  if (text.length > THEME_FILE_MAX) return null;
  try {
    const raw = JSON.parse(text);
    return raw?.mumh5Theme === 1 ? sanitizeTheme(raw, id) : null;
  } catch {
    return null;
  }
}

export function uniqueThemeName(name: string, taken: string[]): string {
  const used = new Set(taken.map(n => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const next = name.slice(0, THEME_NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!used.has(next.toLowerCase())) return next;
  }
}

export const themeFileName = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme'}.mumh5-theme.json`;

/** Puts a theme on an element's inline style; null takes it off again. */
export function applyThemeStyle(style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>, theme: CustomTheme | null): void {
  for (const k of COLOR_KEYS) {
    if (theme) style.setProperty(`--${k}`, theme.colors[k]);
    else style.removeProperty(`--${k}`);
  }
  const stack = theme ? THEME_FONTS.find(f => f.id === theme.font)?.stack : '';
  if (stack) style.setProperty('--font', stack);
  else style.removeProperty('--font');
  // A label that vanishes under the pointer is never what a theme wants, whatever it holds
  if (theme) style.setProperty('--accent-hover-text', hoverLabel(theme.colors['accent-hover-text'] ?? theme.colors['accent-text'], theme.colors['accent-hover']));
  if (theme?.indicator.name) style.setProperty('--name-talking', theme.indicator.name);
  else style.removeProperty('--name-talking');
  if (theme) {
    style.setProperty('--fs-chat', `${theme.chatSize}px`);
    style.setProperty('--orb-talking', theme.indicator.talking.color);
    style.setProperty('color-scheme', luminance(theme.colors['bg-2']) > 0.35 ? 'light' : 'dark');
  } else {
    style.removeProperty('--fs-chat');
    style.removeProperty('--orb-talking');
    style.removeProperty('color-scheme');
  }
}

/** The colors as an inline style, for a miniature of the theme. */
export const themeVars = (colors: ThemeColors) => COLOR_KEYS.map(k => `--${k}:${colors[k]}`).join(';');
