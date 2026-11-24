// Translation without a library. The English text is the key, so code reads as before and a
// missing translation falls back to English by itself.

export type Catalog = Record<string, string>;
export type Params = Record<string, string | number>;

export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' }
] as const;
export type LanguageId = typeof LANGUAGES[number]['id'];

/** {name} placeholders; one that is not given stays as written. */
export function format(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, k: string) => (k in params ? String(params[k]) : whole));
}

export function translate(catalog: Catalog | undefined, key: string, params?: Params): string {
  return format(catalog?.[key] ?? key, params);
}

/** The first of the browser's preferred languages that has a catalog; English otherwise. */
export function pickLanguage(preferred: readonly string[]): LanguageId {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const hit = LANGUAGES.find(l => l.id === base);
    if (hit) return hit.id;
  }
  return 'en';
}

/**
 * Plural form. `other` is the English text for any count but 1, `one` for 1. A catalog gives its
 * language's forms as `<other>#<category>` (Intl.PluralRules categories: zero, one, two, few, many),
 * with the plain `<other>` entry as the fallback form.
 */
export function translatePlural(catalog: Catalog | undefined, lang: string, other: string, one: string, n: number, params?: Params): string {
  const merged = { n, ...params };
  if (!catalog) return format(n === 1 ? one : other, merged);
  const category = new Intl.PluralRules(lang).select(n);
  return format(catalog[`${other}#${category}`] ?? catalog[other] ?? (n === 1 ? one : other), merged);
}
