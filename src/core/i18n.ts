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
