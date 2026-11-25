// Translation without a library. Texts are looked up by key; English (`src/locales/en.ts`) is the
// fallback for every language, so a missing translation shows English and a missing key its id.

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

export function translate(catalog: Catalog | undefined, fallback: Catalog, key: string, params?: Params): string {
  return format(catalog?.[key] ?? fallback[key] ?? key, params);
}

/**
 * Text for a count. A catalog gives the forms of its language as `<key>#<category>` (Intl.PluralRules
 * categories: zero, one, two, few, many) and the plain `<key>` for every other count. English is used
 * with English's own rules when the language has no entry at all.
 */
export function translatePlural(catalog: Catalog | undefined, fallback: Catalog, lang: string, key: string, n: number, params?: Params): string {
  const pick = (c: Catalog | undefined, rules: string) => c?.[`${key}#${new Intl.PluralRules(rules).select(n)}`] ?? c?.[key];
  return format(pick(catalog, lang) ?? pick(fallback, 'en') ?? key, { n, ...params });
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
